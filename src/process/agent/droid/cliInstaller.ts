/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Droid CLI installer/updater.
 *
 * Responsibilities:
 * - Detect whether a usable Node.js (>=18) is available on PATH.
 * - Install / update @factory/cli via npm using a domestic mirror by default
 *   (falls back to npmjs.org if the primary mirror is unreachable).
 * - Stream progress lines back to the renderer so users can see what is
 *   happening during a long-running install.
 *
 * We intentionally do not install Node.js silently — automating that on
 * Windows reliably requires admin rights and anti-virus cooperation which
 * we can't guarantee. Instead we surface a clear actionable message and
 * direct the user to the official installer.
 */

import { execFile, execFileSync, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import semver from 'semver';
import { getEnhancedEnv } from '@process/utils/shellEnv';
import { mainLog, mainWarn } from '@process/utils/mainLogger';

const execFileAsync = promisify(execFile);

const PRIMARY_REGISTRY = process.env.AIONUI_NPM_REGISTRY_URL || 'https://registry.npmmirror.com';
const FALLBACK_REGISTRY = 'https://registry.npmjs.org';
const FACTORY_CLI_PACKAGE = '@factory/cli';
const NODE_MIN_MAJOR = 18;
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;

export type NodeDetectionResult = {
  available: boolean;
  nodeVersion: string | null;
  nodePath: string | null;
  npmVersion: string | null;
  npmPath: string | null;
  meetsMinimum: boolean;
  recommendedAction: 'none' | 'installNode' | 'upgradeNode';
  downloadUrl: string;
  error?: string;
};

export type DroidCliInstallProgress = {
  phase: 'start' | 'resolving' | 'downloading' | 'installing' | 'verifying' | 'done' | 'error';
  message: string;
  registry?: string;
};

export type DroidCliInstallResult = {
  success: boolean;
  installedVersion: string | null;
  usedRegistry: string | null;
  message: string;
  error?: string;
};

type ProgressEmitter = (progress: DroidCliInstallProgress) => void;

function getNodeDownloadUrl(): string {
  if (process.platform === 'win32') {
    return 'https://nodejs.cn/download/';
  }
  return 'https://nodejs.org/';
}

function extractVersion(raw: string): string | null {
  const trimmed = raw.trim();
  const match = trimmed.match(/\d+\.\d+\.\d+/u);
  return match ? match[0] : trimmed || null;
}

function runInheritedTool(
  command: string,
  args: string[],
  timeoutMs = 5000
): { output: string | null; error?: string } {
  try {
    const output = execFileSync(command, args, {
      encoding: 'utf-8',
      timeout: timeoutMs,
      env: getEnhancedEnv(),
      windowsHide: true,
    }).trim();
    return { output };
  } catch (error) {
    return {
      output: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function getNodeBinaryName(): string {
  return process.platform === 'win32' ? 'node.exe' : 'node';
}

function getNpmBinaryName(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

/**
 * Detect Node.js and npm availability plus version suitability.
 */
export async function detectNodeRuntime(): Promise<NodeDetectionResult> {
  const nodeBin = getNodeBinaryName();
  const npmBin = getNpmBinaryName();

  const nodeResult = runInheritedTool(nodeBin, ['--version']);
  const npmResult = runInheritedTool(npmBin, ['--version']);

  const nodeVersion = nodeResult.output ? extractVersion(nodeResult.output) : null;
  const npmVersion = npmResult.output ? extractVersion(npmResult.output) : null;
  const available = Boolean(nodeResult.output && npmResult.output);
  const coerced = nodeVersion ? (semver.coerce(nodeVersion)?.version ?? null) : null;
  const meetsMinimum = Boolean(coerced && semver.gte(coerced, `${NODE_MIN_MAJOR}.0.0`));

  let recommendedAction: NodeDetectionResult['recommendedAction'] = 'none';
  if (!available) {
    recommendedAction = 'installNode';
  } else if (!meetsMinimum) {
    recommendedAction = 'upgradeNode';
  }

  return {
    available,
    nodeVersion,
    nodePath: nodeResult.output ? nodeBin : null,
    npmVersion,
    npmPath: npmResult.output ? npmBin : null,
    meetsMinimum,
    recommendedAction,
    downloadUrl: getNodeDownloadUrl(),
    ...(nodeResult.error && !available ? { error: nodeResult.error } : {}),
  };
}

async function runNpmStream(
  args: string[],
  registry: string,
  emit: ProgressEmitter
): Promise<{ success: boolean; stdout: string; stderr: string }> {
  const npmBin = getNpmBinaryName();
  const env = {
    ...getEnhancedEnv(),
    npm_config_registry: registry,
    npm_config_fund: 'false',
    npm_config_audit: 'false',
    npm_config_update_notifier: 'false',
  };

  return new Promise((resolve) => {
    const child = spawn(npmBin, [...args, '--registry', registry], {
      env,
      shell: process.platform === 'win32',
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore
      }
    }, INSTALL_TIMEOUT_MS);

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      stdout += text;
      text
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((line) => emit({ phase: 'installing', message: line, registry }));
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      stderr += text;
      text
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((line) => emit({ phase: 'installing', message: line, registry }));
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      stderr += error.message;
      resolve({ success: false, stdout, stderr });
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({ success: code === 0, stdout, stderr });
    });
  });
}

async function resolveInstalledVersion(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      getNpmBinaryName(),
      ['ls', '-g', FACTORY_CLI_PACKAGE, '--depth=0', '--json'],
      {
        env: getEnhancedEnv(),
        timeout: 15000,
        windowsHide: true,
      }
    );
    const parsed = JSON.parse(stdout) as {
      dependencies?: Record<string, { version?: string }>;
    };
    return parsed.dependencies?.[FACTORY_CLI_PACKAGE]?.version || null;
  } catch {
    return null;
  }
}

/**
 * Install or update @factory/cli globally via npm.
 * Tries the primary domestic mirror first, falls back to the official registry
 * if the mirror fails. Streams progress back through the supplied callback.
 */
export async function installOrUpdateDroidCli(options: {
  mode: 'install' | 'update';
  onProgress?: ProgressEmitter;
}): Promise<DroidCliInstallResult> {
  const emit: ProgressEmitter = (progress) => {
    mainLog('[DroidCliInstaller]', progress.phase, progress.message);
    options.onProgress?.(progress);
  };

  emit({ phase: 'start', message: `${options.mode === 'install' ? 'Installing' : 'Updating'} ${FACTORY_CLI_PACKAGE}` });

  const detection = await detectNodeRuntime();
  if (!detection.available) {
    const msg = `Node.js 未检测到，请先安装 Node.js (>= ${NODE_MIN_MAJOR}) 后再重试。下载地址：${detection.downloadUrl}`;
    emit({ phase: 'error', message: msg });
    return {
      success: false,
      installedVersion: null,
      usedRegistry: null,
      message: msg,
      error: detection.error,
    };
  }

  if (!detection.meetsMinimum) {
    const msg = `检测到的 Node.js 版本 ${detection.nodeVersion} 过低，需要 >= ${NODE_MIN_MAJOR}。下载地址：${detection.downloadUrl}`;
    emit({ phase: 'error', message: msg });
    return {
      success: false,
      installedVersion: null,
      usedRegistry: null,
      message: msg,
    };
  }

  const npmArgs =
    options.mode === 'update' ? ['update', '-g', FACTORY_CLI_PACKAGE] : ['install', '-g', FACTORY_CLI_PACKAGE];
  const registries = Array.from(new Set([PRIMARY_REGISTRY, FALLBACK_REGISTRY]));
  let lastStderr = '';
  let lastRegistry: string | null = null;

  for (const registry of registries) {
    lastRegistry = registry;
    emit({ phase: 'resolving', message: `使用镜像源: ${registry}`, registry });
    const result = await runNpmStream(npmArgs, registry, emit);
    if (result.success) {
      const version = await resolveInstalledVersion();
      const message = `${options.mode === 'install' ? '安装' : '更新'}成功 (${registry})`;
      emit({ phase: 'done', message, registry });
      return {
        success: true,
        installedVersion: version,
        usedRegistry: registry,
        message,
      };
    }
    lastStderr = result.stderr || result.stdout;
    mainWarn('[DroidCliInstaller]', `Install via ${registry} failed`, lastStderr);
    emit({
      phase: 'error',
      message: `镜像 ${registry} 失败，尝试备选镜像...`,
      registry,
    });
  }

  const failureMessage = `${options.mode === 'install' ? '安装' : '更新'} ${FACTORY_CLI_PACKAGE} 失败。详情: ${lastStderr.slice(-600) || '未知错误'}`;
  emit({ phase: 'error', message: failureMessage, ...(lastRegistry ? { registry: lastRegistry } : {}) });

  return {
    success: false,
    installedVersion: null,
    usedRegistry: lastRegistry,
    message: failureMessage,
    error: lastStderr,
  };
}
