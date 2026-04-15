import * as fs from 'fs';
import { createRequire } from 'module';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import { afterEach, describe, expect, it } from 'vitest';

type PrepareBundledDroid = () => {
  prepared: boolean;
  reason?: string;
  version?: string;
};

type TargetBackup = {
  targetDir: string;
  existed: boolean;
  backupDir: string | null;
};

type MockDownloadPayload = Buffer | Record<string, unknown> | string;
type ExecFileSyncMock = (command: string, args: string[]) => Buffer | string;

const require = createRequire(import.meta.url);
const prepareBundledDroidPath = require.resolve('../../scripts/prepareBundledDroid.js');
const nodeModule = require('module') as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const realChildProcess = require('child_process') as {
  execFileSync: ExecFileSyncMock;
};

function loadPrepareBundledDroid(mockExecFileSync?: ExecFileSyncMock): PrepareBundledDroid {
  const originalLoad = nodeModule._load;

  nodeModule._load = (request: string, parent: unknown, isMain: boolean) => {
    if (request === 'child_process') {
      return {
        execFileSync: mockExecFileSync || realChildProcess.execFileSync,
      };
    }

    return originalLoad(request, parent, isMain);
  };

  try {
    delete require.cache[prepareBundledDroidPath];
    return require(prepareBundledDroidPath) as PrepareBundledDroid;
  } finally {
    nodeModule._load = originalLoad;
  }
}

function createTarHeader(filePath: string, size: number): Buffer {
  const header = Buffer.alloc(512, 0);
  const fileNameBuffer = Buffer.from(filePath, 'utf8');
  const sizeBuffer = Buffer.from(`${size.toString(8).padStart(11, '0')}\0`, 'utf8');
  const mtimeBuffer = Buffer.from(`${'0'.repeat(11)}\0`, 'utf8');

  fileNameBuffer.copy(header, 0, 0, Math.min(fileNameBuffer.length, 100));
  Buffer.from('0000755\0', 'utf8').copy(header, 100);
  Buffer.from('0000000\0', 'utf8').copy(header, 108);
  Buffer.from('0000000\0', 'utf8').copy(header, 116);
  sizeBuffer.copy(header, 124);
  mtimeBuffer.copy(header, 136);
  header.fill(32, 148, 156);
  header[156] = '0'.charCodeAt(0);
  Buffer.from('ustar\0', 'utf8').copy(header, 257);
  Buffer.from('00', 'utf8').copy(header, 263);

  const checksum = header.reduce((sum, value) => sum + value, 0);
  Buffer.from(`${checksum.toString(8).padStart(6, '0')}\0 `, 'utf8').copy(header, 148);

  return header;
}

function createBinaryTarball(binaryName: string): Buffer {
  const binaryBuffer = Buffer.from('#!/bin/sh\necho 0.99.0\n', 'utf8');
  const padding = Buffer.alloc((512 - (binaryBuffer.length % 512)) % 512, 0);
  const tarball = Buffer.concat([
    createTarHeader(`package/bin/${binaryName}`, binaryBuffer.length),
    binaryBuffer,
    padding,
    Buffer.alloc(1024, 0),
  ]);

  return zlib.gzipSync(tarball);
}

function createExecFileSyncMock(downloads: Record<string, MockDownloadPayload>, binaryVersion = '0.99.0') {
  const requests: string[] = [];
  const mockExecFileSync: ExecFileSyncMock = (command: string, args: string[]) => {
    if (command === 'curl' || command === 'wget') {
      const outputIndex = args.findIndex((arg) => arg === '-o' || arg === '-O');
      const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : null;
      const url = args.at(-1);

      if (!outputPath || !url || !(url in downloads)) {
        throw new Error(`Unexpected download request: ${command} ${args.join(' ')}`);
      }

      requests.push(url);
      const payload = downloads[url];
      const content =
        payload instanceof Buffer ? payload : typeof payload === 'string' ? payload : JSON.stringify(payload);

      fs.writeFileSync(outputPath, content);
      return Buffer.alloc(0);
    }

    if (args.length === 1 && args[0] === '--version') {
      return `${binaryVersion}\n`;
    }

    throw new Error(`Unexpected execFileSync call: ${command} ${args.join(' ')}`);
  };

  return { mockExecFileSync, requests };
}

describe('prepareBundledDroid', () => {
  const projectRoot = path.resolve(__dirname, '../..');
  const originalTargetPlatform = process.env.AIONUI_DROID_TARGET_PLATFORM;
  const originalTargetArch = process.env.AIONUI_DROID_TARGET_ARCH;
  const originalRegistryUrl = process.env.AIONUI_NPM_REGISTRY_URL;
  const originalFallbackRegistryUrl = process.env.AIONUI_DROID_NPM_FALLBACK_REGISTRY_URL;

  let tempRoot: string | null = null;
  let targetBackups: TargetBackup[] = [];

  function backupTargetDir(runtimeKey: string): string {
    const targetDir = path.join(projectRoot, 'resources', 'bundled-droid', runtimeKey);
    const existed = fs.existsSync(targetDir);
    let backupDir: string | null = null;

    tempRoot ??= fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-droid-bundle-test-'));

    if (existed) {
      backupDir = path.join(tempRoot, runtimeKey.replace(/[\\/]/g, '-'));
      fs.cpSync(targetDir, backupDir, { recursive: true });
      fs.rmSync(targetDir, { recursive: true, force: true });
    }

    targetBackups.push({ targetDir, existed, backupDir });
    return targetDir;
  }

  afterEach(async () => {
    process.env.AIONUI_DROID_TARGET_PLATFORM = originalTargetPlatform;
    process.env.AIONUI_DROID_TARGET_ARCH = originalTargetArch;
    process.env.AIONUI_NPM_REGISTRY_URL = originalRegistryUrl;
    process.env.AIONUI_DROID_NPM_FALLBACK_REGISTRY_URL = originalFallbackRegistryUrl;

    for (const { targetDir, existed, backupDir } of targetBackups.toReversed()) {
      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
      }

      if (existed && backupDir && fs.existsSync(backupDir)) {
        fs.mkdirSync(path.dirname(targetDir), { recursive: true });
        fs.cpSync(backupDir, targetDir, { recursive: true });
      }
    }

    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }

    tempRoot = null;
    targetBackups = [];
    delete require.cache[prepareBundledDroidPath];
  });

  it('writes a skipped manifest for unsupported platforms', async () => {
    process.env.AIONUI_DROID_TARGET_PLATFORM = 'freebsd';
    process.env.AIONUI_DROID_TARGET_ARCH = 'x64';

    const runtimeKey = 'freebsd-x64';
    const targetDir = backupTargetDir(runtimeKey);
    const prepareBundledDroid = loadPrepareBundledDroid();

    const result = prepareBundledDroid();

    expect(result.prepared).toBe(false);
    expect(result.reason).toBe('unsupported_platform');

    const manifest = JSON.parse(fs.readFileSync(path.join(targetDir, 'manifest.json'), 'utf8')) as {
      skipped: boolean;
      reason: string;
    };

    expect(manifest.skipped).toBe(true);
    expect(manifest.reason).toContain('Unsupported Factory CLI target');
  });

  it('prefers npmjs for platform binaries and enables download retries', async () => {
    const runtimeKey = 'linux-arm64';
    const packageName = '@factory/cli-linux-arm64';
    const targetDir = backupTargetDir(runtimeKey);
    const primaryRegistry = 'https://mirror.example.com';
    const fallbackRegistry = 'https://registry.npmjs.org';
    const { mockExecFileSync, requests } = createExecFileSyncMock({
      [`${primaryRegistry}/@factory%2fcli`]: {
        'dist-tags': { latest: '0.99.0' },
        versions: {
          '0.99.0': {
            dist: { tarball: `${primaryRegistry}/@factory/cli/-/cli-0.99.0.tgz` },
            optionalDependencies: {
              [packageName]: '0.99.0',
            },
          },
        },
      },
      [`${fallbackRegistry}/@factory%2fcli-linux-arm64`]: {
        'dist-tags': { latest: '0.99.0' },
        versions: {
          '0.99.0': {
            dist: { tarball: `${fallbackRegistry}/${packageName}/-/cli-linux-arm64-0.99.0.tgz` },
          },
        },
      },
      [`${fallbackRegistry}/${packageName}/-/cli-linux-arm64-0.99.0.tgz`]: createBinaryTarball('droid'),
    });

    process.env.AIONUI_DROID_TARGET_PLATFORM = 'linux';
    process.env.AIONUI_DROID_TARGET_ARCH = 'arm64';
    process.env.AIONUI_NPM_REGISTRY_URL = primaryRegistry;
    process.env.AIONUI_DROID_NPM_FALLBACK_REGISTRY_URL = fallbackRegistry;

    const prepareBundledDroid = loadPrepareBundledDroid(mockExecFileSync);
    const result = prepareBundledDroid();

    expect(result.prepared).toBe(true);
    expect(result.version).toBe('0.99.0');

    const manifest = JSON.parse(fs.readFileSync(path.join(targetDir, 'manifest.json'), 'utf8')) as {
      cliVersion: string;
      source: { registryBaseUrl: string };
    };

    expect(manifest.cliVersion).toBe('0.99.0');
    expect(manifest.source.registryBaseUrl).toBe(fallbackRegistry);
    expect(fs.existsSync(path.join(targetDir, 'droid'))).toBe(true);
    expect(requests.includes(`${fallbackRegistry}/@factory%2fcli-linux-arm64`)).toBe(true);
    expect(requests.includes(`${primaryRegistry}/@factory%2fcli-linux-arm64`)).toBe(false);
  });

  it('skips outdated platform registries when the expected version is unavailable', async () => {
    const runtimeKey = 'win32-arm64';
    const packageName = '@factory/cli-win32-arm64';
    const targetDir = backupTargetDir(runtimeKey);
    const primaryRegistry = 'https://mirror.example.com';
    const fallbackRegistry = 'https://registry.npmjs.org';
    const { mockExecFileSync, requests } = createExecFileSyncMock({
      [`${primaryRegistry}/@factory%2fcli`]: {
        'dist-tags': { latest: '0.99.0' },
        versions: {
          '0.99.0': {
            dist: { tarball: `${primaryRegistry}/@factory/cli/-/cli-0.99.0.tgz` },
            optionalDependencies: {
              [packageName]: '0.99.0',
            },
          },
        },
      },
      [`${fallbackRegistry}/@factory%2fcli-win32-arm64`]: {
        'dist-tags': { latest: '0.0.1' },
        versions: {
          '0.0.1': {
            dist: { tarball: `${fallbackRegistry}/${packageName}/-/cli-win32-arm64-0.0.1.tgz` },
          },
        },
      },
      [`${primaryRegistry}/@factory%2fcli-win32-arm64`]: {
        'dist-tags': { latest: '0.99.0' },
        versions: {
          '0.99.0': {
            dist: { tarball: `${primaryRegistry}/${packageName}/-/cli-win32-arm64-0.99.0.tgz` },
          },
        },
      },
      [`${primaryRegistry}/${packageName}/-/cli-win32-arm64-0.99.0.tgz`]: createBinaryTarball('droid.exe'),
    });

    process.env.AIONUI_DROID_TARGET_PLATFORM = 'win32';
    process.env.AIONUI_DROID_TARGET_ARCH = 'arm64';
    process.env.AIONUI_NPM_REGISTRY_URL = primaryRegistry;
    process.env.AIONUI_DROID_NPM_FALLBACK_REGISTRY_URL = fallbackRegistry;

    const prepareBundledDroid = loadPrepareBundledDroid(mockExecFileSync);
    const result = prepareBundledDroid();

    expect(result.prepared).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(path.join(targetDir, 'manifest.json'), 'utf8')) as {
      source: { registryBaseUrl: string };
    };

    expect(manifest.source.registryBaseUrl).toBe(primaryRegistry);
    expect(fs.existsSync(path.join(targetDir, 'droid.exe'))).toBe(true);
    expect(requests.includes(`${fallbackRegistry}/@factory%2fcli-win32-arm64`)).toBe(true);
    expect(requests.includes(`${primaryRegistry}/@factory%2fcli-win32-arm64`)).toBe(true);
    expect(requests.includes(`${fallbackRegistry}/${packageName}/-/cli-win32-arm64-0.0.1.tgz`)).toBe(false);
  });
});
