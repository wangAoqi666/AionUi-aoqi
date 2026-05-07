const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const CLI_PACKAGE_NAME = '@factory/cli';
const DOWNLOAD_RETRY_COUNT = 3;
const NETWORK_TIMEOUT_MS = Number(process.env.AIONUI_DOWNLOAD_TIMEOUT_MS || 600000);
const PRIMARY_REGISTRY_BASE_URL = process.env.AIONUI_NPM_REGISTRY_URL || 'https://registry.npmmirror.com';
const FALLBACK_REGISTRY_BASE_URL = process.env.AIONUI_DROID_NPM_FALLBACK_REGISTRY_URL || 'https://registry.npmjs.org';
const FACTORY_DOWNLOADS_BASE_URL = process.env.AIONUI_DROID_DOWNLOADS_BASE_URL || 'https://downloads.factory.ai';

const PLATFORM_PACKAGES = {
  'darwin-arm64': { regular: '@factory/cli-darwin-arm64' },
  'darwin-x64': {
    regular: '@factory/cli-darwin-x64',
    baseline: '@factory/cli-darwin-x64-baseline',
  },
  'linux-arm64': { regular: '@factory/cli-linux-arm64' },
  'linux-x64': {
    regular: '@factory/cli-linux-x64',
    baseline: '@factory/cli-linux-x64-baseline',
  },
  'win32-x64': {
    regular: '@factory/cli-win32-x64',
    baseline: '@factory/cli-win32-x64-baseline',
  },
  'win32-arm64': { regular: '@factory/cli-win32-arm64' },
};

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function removeDirectorySafe(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
}

function getConfiguredCliVersion() {
  const configured = process.env.AIONUI_DROID_CLI_VERSION;
  return configured && configured.trim() ? configured.trim() : 'latest';
}

function shouldSkipDroidBundle() {
  return process.env.AIONUI_SKIP_DROID_BUNDLE === '1' || process.env.AGENT_FACTORY_SKIP_DROID_BUNDLE === '1';
}

function getTargetPlatform() {
  const target = process.env.AIONUI_DROID_TARGET_PLATFORM;
  return target && target.trim() ? target.trim() : process.platform;
}

function getTargetArch() {
  const target = process.env.AIONUI_DROID_TARGET_ARCH || process.env.npm_config_target_arch;
  return target && target.trim() ? target.trim() : process.arch;
}

function getBinaryName(platform) {
  return platform === 'win32' ? 'droid.exe' : 'droid';
}

function getDownloadsPlatform(platform) {
  return platform === 'win32' ? 'windows' : platform;
}

function getDownloadsArch(arch, packageName) {
  if (arch === 'x64' && packageName?.endsWith('-baseline')) {
    return 'x64-baseline';
  }

  return arch;
}

function selectPackageName(platform, arch) {
  const packages = PLATFORM_PACKAGES[`${platform}-${arch}`];
  if (!packages) {
    return null;
  }

  return packages.baseline || packages.regular;
}

function runCommand(command, args) {
  execFileSync(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: NETWORK_TIMEOUT_MS,
  });
}

function downloadFile(url, outputPath, options = {}) {
  const { preferWget = false } = options;

  if (process.platform === 'win32') {
    const psScript = [
      "$ProgressPreference='SilentlyContinue'",
      `Invoke-WebRequest -Uri '${url}' -OutFile '${outputPath.replace(/'/g, "''")}'`,
    ].join('; ');

    for (let attempt = 0; attempt < DOWNLOAD_RETRY_COUNT; attempt += 1) {
      try {
        runCommand('powershell', ['-NoProfile', '-NonInteractive', '-Command', psScript]);
        return;
      } catch (error) {
        if (attempt === DOWNLOAD_RETRY_COUNT - 1) {
          throw error;
        }
      }
    }
    return;
  }

  const downloadStrategies = preferWget
    ? [
        ['wget', ['-q', '--tries=3', '--waitretry=2', '-O', outputPath, url]],
        [
          'curl',
          [
            '-L',
            '--fail',
            '--silent',
            '--show-error',
            '--retry',
            String(DOWNLOAD_RETRY_COUNT),
            '--retry-delay',
            '2',
            '--retry-all-errors',
            '-o',
            outputPath,
            url,
          ],
        ],
      ]
    : [
        [
          'curl',
          [
            '-L',
            '--fail',
            '--silent',
            '--show-error',
            '--retry',
            String(DOWNLOAD_RETRY_COUNT),
            '--retry-delay',
            '2',
            '--retry-all-errors',
            '-o',
            outputPath,
            url,
          ],
        ],
        ['wget', ['-q', '--tries=3', '--waitretry=2', '-O', outputPath, url]],
      ];

  let lastError = null;

  for (const [command, args] of downloadStrategies) {
    try {
      runCommand(command, args);
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

function readJsonFromUrl(url) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-droid-packument-'));
  const outputPath = path.join(tempDir, 'response.json');

  try {
    downloadFile(url, outputPath);
    return JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
  } finally {
    removeDirectorySafe(tempDir);
  }
}

function readTextFromUrl(url) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-droid-text-'));
  const outputPath = path.join(tempDir, 'response.txt');

  try {
    downloadFile(url, outputPath);
    return fs.readFileSync(outputPath, 'utf-8').trim();
  } finally {
    removeDirectorySafe(tempDir);
  }
}

function getPackument(packageName, registryBaseUrl) {
  const encodedName = packageName.replace('/', '%2f');
  return readJsonFromUrl(`${registryBaseUrl}/${encodedName}`);
}

function resolveVersionData(packageName, requestedVersion, registryBaseUrl) {
  const packument = getPackument(packageName, registryBaseUrl);
  const exactVersion =
    requestedVersion === 'latest'
      ? packument['dist-tags']?.latest
      : packument.versions?.[requestedVersion]
        ? requestedVersion
        : null;

  if (!exactVersion) {
    throw new Error(`Unable to resolve ${packageName}@${requestedVersion}`);
  }

  const versionData = packument.versions?.[exactVersion];
  if (!versionData?.dist?.tarball) {
    throw new Error(`Missing tarball for ${packageName}@${exactVersion}`);
  }

  return {
    version: exactVersion,
    tarballUrl: versionData.dist.tarball,
    registryBaseUrl,
    packageData: versionData,
  };
}

function extractFileFromTarball(tarballBuffer, filePath) {
  let offset = 0;

  while (offset < tarballBuffer.length) {
    const header = tarballBuffer.subarray(offset, offset + 512);
    offset += 512;

    const entryName = header.toString('utf-8', 0, 100).replace(/\0.*/g, '');
    const entrySizeRaw = header.toString('utf-8', 124, 136).replace(/\0.*/g, '').trim();
    const entrySize = entrySizeRaw ? parseInt(entrySizeRaw, 8) : 0;

    if (!entryName || Number.isNaN(entrySize)) {
      break;
    }

    if (entryName === filePath) {
      return tarballBuffer.subarray(offset, offset + entrySize);
    }

    offset = (offset + entrySize + 511) & ~511;
  }

  return null;
}

function ensureExecutableMode(filePath) {
  if (process.platform !== 'win32') {
    fs.chmodSync(filePath, 0o755);
  }
}

function getCliRegistryCandidates() {
  return Array.from(new Set([PRIMARY_REGISTRY_BASE_URL, FALLBACK_REGISTRY_BASE_URL]));
}

function getBinaryRegistryCandidates() {
  return Array.from(new Set([FALLBACK_REGISTRY_BASE_URL, PRIMARY_REGISTRY_BASE_URL]));
}

function normalizeDependencyVersion(version) {
  if (typeof version !== 'string') {
    return null;
  }

  const trimmedVersion = version.trim();
  return trimmedVersion ? trimmedVersion.replace(/^[~^]/u, '') : null;
}

function resolveExpectedPlatformVersion(packageName, requestedVersion) {
  let lastError = null;

  for (const registryBaseUrl of getCliRegistryCandidates()) {
    try {
      const resolvedCliPackage = resolveVersionData(CLI_PACKAGE_NAME, requestedVersion, registryBaseUrl);
      return {
        cliVersion: resolvedCliPackage.version,
        platformVersion: normalizeDependencyVersion(
          resolvedCliPackage.packageData?.optionalDependencies?.[packageName]
        ),
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error(`Unable to resolve ${CLI_PACKAGE_NAME}@${requestedVersion}`);
}

function validateBinary(filePath, platform, arch) {
  if (platform !== process.platform || arch !== process.arch) {
    return null;
  }

  const versionOutput = execFileSync(filePath, ['--version'], {
    encoding: 'utf-8',
    timeout: 10000,
  }).trim();

  if (/placeholder|please reinstall/i.test(versionOutput)) {
    throw new Error(`Received placeholder Factory CLI binary: ${versionOutput}`);
  }

  return versionOutput;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function prepareFromFactoryDownloads({
  platform,
  arch,
  packageName,
  requestedVersion,
  cliVersion,
  binaryName,
  targetDir,
  targetBinaryPath,
}) {
  const downloadsPlatform = getDownloadsPlatform(platform);
  const downloadsArch = getDownloadsArch(arch, packageName);
  const binaryUrl = `${FACTORY_DOWNLOADS_BASE_URL}/factory-cli/releases/${cliVersion}/${downloadsPlatform}/${downloadsArch}/${binaryName}`;
  const shaUrl = `${binaryUrl}.sha256`;
  const tempBinaryPath = `${targetBinaryPath}.download`;

  fs.rmSync(tempBinaryPath, { force: true });
  downloadFile(binaryUrl, tempBinaryPath);

  const expectedSha = readTextFromUrl(shaUrl);
  const actualSha = sha256File(tempBinaryPath);
  if (expectedSha && actualSha !== expectedSha.toLowerCase()) {
    fs.rmSync(tempBinaryPath, { force: true });
    throw new Error(`Checksum mismatch for Factory CLI binary from ${binaryUrl}`);
  }

  fs.copyFileSync(tempBinaryPath, targetBinaryPath);
  fs.rmSync(tempBinaryPath, { force: true });
  ensureExecutableMode(targetBinaryPath);
  const binaryVersion = validateBinary(targetBinaryPath, platform, arch);
  const manifest = {
    platform,
    arch,
    requestedVersion,
    cliVersion,
    version: cliVersion,
    binaryVersion,
    generatedAt: new Date().toISOString(),
    sourceType: 'factory-downloads',
    source: {
      url: binaryUrl,
      shaUrl,
      downloadsPlatform,
      downloadsArch,
    },
    files: [binaryName],
    skipped: false,
  };

  writeJson(path.join(targetDir, 'manifest.json'), manifest);
  console.log(`Bundled Factory CLI prepared from Factory downloads: resources/bundled-droid/${platform}-${arch}/${binaryName}`);
  return { prepared: true, dir: targetDir, version: cliVersion };
}

function prepareBundledDroid() {
  const projectRoot = path.resolve(__dirname, '..');
  const platform = getTargetPlatform();
  const arch = getTargetArch();
  const runtimeKey = `${platform}-${arch}`;
  const requestedVersion = getConfiguredCliVersion();
  const packageName = selectPackageName(platform, arch);

  const targetDir = path.join(projectRoot, 'resources', 'bundled-droid', runtimeKey);
  const binaryName = getBinaryName(platform);
  const targetBinaryPath = path.join(targetDir, binaryName);

  // Allow explicit skip to avoid network hangs (e.g. when npm registry / wget proxy stalls)
  if (shouldSkipDroidBundle()) {
    removeDirectorySafe(targetDir);
    ensureDirectory(targetDir);
    const manifest = {
      platform,
      arch,
      requestedVersion,
      generatedAt: new Date().toISOString(),
      sourceType: 'none',
      source: {},
      files: [],
      skipped: true,
      reason: 'Skipped via AIONUI_SKIP_DROID_BUNDLE=1 or AGENT_FACTORY_SKIP_DROID_BUNDLE=1',
    };
    writeJson(path.join(targetDir, 'manifest.json'), manifest);
    console.warn('Factory CLI bundle skipped (AIONUI_SKIP_DROID_BUNDLE=1 or AGENT_FACTORY_SKIP_DROID_BUNDLE=1)');
    return { prepared: false, reason: 'skipped' };
  }

  removeDirectorySafe(targetDir);
  ensureDirectory(targetDir);

  if (!packageName) {
    const manifest = {
      platform,
      arch,
      requestedVersion,
      generatedAt: new Date().toISOString(),
      sourceType: 'none',
      source: {},
      files: [],
      skipped: true,
      reason: `Unsupported Factory CLI target: ${runtimeKey}`,
    };

    writeJson(path.join(targetDir, 'manifest.json'), manifest);
    console.warn(`Factory CLI bundle skipped: ${manifest.reason}`);
    return { prepared: false, reason: 'unsupported_platform' };
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-bundled-droid-'));
  const archivePath = path.join(tempDir, 'droid.tgz');
  const tempBinaryPath = path.join(tempDir, binaryName);

  try {
    const expectedVersion = resolveExpectedPlatformVersion(packageName, requestedVersion);
    const platformVersion = expectedVersion.platformVersion || expectedVersion.cliVersion;
    let lastError = null;

    for (const registryBaseUrl of getBinaryRegistryCandidates()) {
      try {
        const resolved = resolveVersionData(packageName, platformVersion, registryBaseUrl);
        downloadFile(resolved.tarballUrl, archivePath, { preferWget: true });

        const archiveBuffer = fs.readFileSync(archivePath);
        const tarballBuffer = zlib.gunzipSync(archiveBuffer);
        const binaryBuffer = extractFileFromTarball(tarballBuffer, `package/bin/${binaryName}`);

        if (!binaryBuffer) {
          throw new Error(`Binary package/bin/${binaryName} not found in ${packageName}@${resolved.version}`);
        }

        fs.writeFileSync(tempBinaryPath, binaryBuffer);
        ensureExecutableMode(tempBinaryPath);
        const binaryVersion = validateBinary(tempBinaryPath, platform, arch);
        fs.copyFileSync(tempBinaryPath, targetBinaryPath);
        ensureExecutableMode(targetBinaryPath);

        const manifest = {
          platform,
          arch,
          requestedVersion,
          cliVersion: expectedVersion.cliVersion,
          version: resolved.version,
          binaryVersion,
          generatedAt: new Date().toISOString(),
          sourceType: 'download',
          source: {
            packageName,
            registryBaseUrl,
            tarballUrl: resolved.tarballUrl,
          },
          files: [binaryName],
          skipped: false,
        };

        writeJson(path.join(targetDir, 'manifest.json'), manifest);
        console.log(`Bundled Factory CLI prepared: resources/bundled-droid/${runtimeKey}/${binaryName}`);
        return { prepared: true, dir: targetDir, version: resolved.version };
      } catch (error) {
        lastError = error;
      }
    }

    try {
      return prepareFromFactoryDownloads({
        platform,
        arch,
        packageName,
        requestedVersion,
        cliVersion: expectedVersion.cliVersion,
        binaryName,
        targetDir,
        targetBinaryPath,
      });
    } catch (downloadError) {
      throw downloadError || lastError || new Error('Unable to download a valid Factory CLI binary');
    }
  } catch (error) {
    const manifest = {
      platform,
      arch,
      requestedVersion,
      generatedAt: new Date().toISOString(),
      sourceType: 'none',
      source: {
        cliPackageName: CLI_PACKAGE_NAME,
        packageName,
      },
      files: [],
      skipped: true,
      reason: error instanceof Error ? error.message : String(error),
    };

    writeJson(path.join(targetDir, 'manifest.json'), manifest);
    console.warn(`Failed to prepare bundled Factory CLI: ${manifest.reason}`);
    return { prepared: false, reason: 'error' };
  } finally {
    removeDirectorySafe(tempDir);
  }
}

module.exports = prepareBundledDroid;
