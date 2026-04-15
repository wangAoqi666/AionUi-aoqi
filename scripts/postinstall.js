/**
 * Postinstall script for AionUi
 * Handles native module installation for different environments
 */

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const prepareBundledDroid = require('./prepareBundledDroid');

const projectRoot = path.resolve(__dirname, '..');

function installAppDeps() {
  console.log('Installing app deps for Electron...');
  execSync('bunx electron-builder install-app-deps', {
    stdio: 'inherit',
    cwd: projectRoot,
    env: {
      ...process.env,
      npm_config_build_from_source: 'true',
    },
  });
}

function verifyBetterSqlite3WithElectron() {
  const moduleRoot = path.join(projectRoot, 'node_modules', 'better-sqlite3');
  if (!fs.existsSync(moduleRoot)) {
    return { ok: false, output: 'better-sqlite3 is not installed' };
  }

  let electronExecutable;
  try {
    electronExecutable = require('electron');
  } catch (error) {
    return {
      ok: false,
      output: error instanceof Error ? error.message : String(error),
    };
  }

  const checkerPath = path.join(os.tmpdir(), `aionui-native-check-${process.pid}.cjs`);
  const checkerSource = `
const { app } = require('electron');
process.chdir(${JSON.stringify(projectRoot)});
app.whenReady().then(() => {
  try {
    require(${JSON.stringify(moduleRoot)});
    process.stdout.write('ok');
    app.exit(0);
  } catch (error) {
    process.stderr.write(error && error.stack ? error.stack : String(error));
    app.exit(1);
  }
});
`;

  fs.writeFileSync(checkerPath, checkerSource, 'utf8');

  try {
    const result = spawnSync(electronExecutable, [checkerPath], {
      cwd: projectRoot,
      env: process.env,
      encoding: 'utf8',
    });

    if (result.error) {
      return {
        ok: false,
        output: result.error.message,
      };
    }

    return {
      ok: result.status === 0,
      output: `${result.stdout || ''}${result.stderr || ''}`.trim(),
    };
  } finally {
    try {
      fs.unlinkSync(checkerPath);
    } catch {}
  }
}

function ensureElectronNativeModules(electronVersion) {
  console.log(`Rebuilding native modules for Electron ${electronVersion}...`);
  installAppDeps();

  const rebuiltCheck = verifyBetterSqlite3WithElectron();
  if (!rebuiltCheck.ok) {
    throw new Error(rebuiltCheck.output || `Failed to rebuild better-sqlite3 for Electron ${electronVersion}`);
  }

  console.log(`better-sqlite3 verified for Electron ${electronVersion}`);
}

// Note: web-tree-sitter is now a direct dependency in package.json
// No need for symlinks or copying - npm will install it directly to node_modules

function runPostInstall() {
  try {
    // Check if we're in a CI environment
    const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
    const electronVersion = require('../package.json').devDependencies.electron.replace(/^[~^]/, '');

    console.log(`Environment: CI=${isCI}, Electron=${electronVersion}`);

    if (isCI) {
      // In CI, skip rebuilding to use prebuilt binaries for better compatibility
      // 在 CI 中跳过重建，使用预编译的二进制文件以获得更好的兼容性
      console.log('CI environment detected, skipping rebuild to use prebuilt binaries');
      console.log('Native modules will be handled by electron-forge during packaging');
    } else {
      console.log('Local environment, ensuring Electron native modules');
      ensureElectronNativeModules(electronVersion);
    }

    console.log('Preparing bundled Factory CLI for local runtime detection');
    prepareBundledDroid();
  } catch (e) {
    console.error('Postinstall failed:', e.message);
    // Don't exit with error code to avoid breaking installation
  }
}

// Only run if this script is executed directly
if (require.main === module) {
  runPostInstall();
}

module.exports = {
  runPostInstall,
  ensureElectronNativeModules,
  verifyBetterSqlite3WithElectron,
};
