/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync } from 'node:fs';
import path from 'node:path';

export type DroidCliSource = 'bundled' | 'custom' | 'system';
export type DroidCliResolution = {
  execPath: string;
  source: DroidCliSource;
};

function getBinaryName(): string {
  return process.platform === 'win32' ? 'droid.exe' : 'droid';
}

function getRuntimeResourcesRoot(): string | null {
  const runtimeResourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (runtimeResourcesPath && existsSync(runtimeResourcesPath)) {
    return runtimeResourcesPath;
  }
  return null;
}

function resolveProjectInstalledDroidBinary(): string | null {
  const binaryPath = path.join(process.cwd(), 'node_modules', '@factory', 'cli', 'bin', getBinaryName());
  return existsSync(binaryPath) ? binaryPath : null;
}

export function getBundledDroidDir(): string | null {
  const runtimeKey = `${process.platform}-${process.arch}`;
  const cwdBundledDir = path.join(process.cwd(), 'resources', 'bundled-droid', runtimeKey);
  const runtimeResourcesRoot = getRuntimeResourcesRoot();
  const candidates = [
    runtimeResourcesRoot ? path.join(runtimeResourcesRoot, 'bundled-droid', runtimeKey) : null,
    cwdBundledDir,
  ];

  for (const bundledDir of candidates) {
    if (bundledDir && existsSync(bundledDir)) {
      return bundledDir;
    }
  }

  return null;
}

export function resolveBundledDroidBinary(): string | null {
  const bundledDir = getBundledDroidDir();
  if (!bundledDir) {
    return null;
  }

  const binaryPath = path.join(bundledDir, getBinaryName());
  return existsSync(binaryPath) ? binaryPath : null;
}

export function resolveDroidCliCandidates(configuredCliPath?: string | null): DroidCliResolution[] {
  const trimmedCliPath = configuredCliPath?.trim();
  const bundledBinaryPath = resolveBundledDroidBinary();
  const projectInstalledBinaryPath = resolveProjectInstalledDroidBinary();
  const candidates: DroidCliResolution[] = [];

  if (trimmedCliPath && trimmedCliPath !== 'droid') {
    if (bundledBinaryPath && path.resolve(trimmedCliPath) === path.resolve(bundledBinaryPath)) {
      return [{ execPath: bundledBinaryPath, source: 'bundled' }];
    }

    if (projectInstalledBinaryPath && path.resolve(trimmedCliPath) === path.resolve(projectInstalledBinaryPath)) {
      return [{ execPath: projectInstalledBinaryPath, source: 'bundled' }];
    }

    return [{ execPath: trimmedCliPath, source: 'custom' }];
  }

  // Prefer system-installed droid first — bundled binaries have proven unreliable
  // on some Windows machines (e.g. Bun baseline illegal instruction). Users are
  // expected to install @factory/cli globally via the in-app initializer.
  candidates.push({
    execPath: trimmedCliPath || 'droid',
    source: 'system',
  });

  if (bundledBinaryPath) {
    candidates.push({ execPath: bundledBinaryPath, source: 'bundled' });
  }

  if (projectInstalledBinaryPath) {
    candidates.push({ execPath: projectInstalledBinaryPath, source: 'bundled' });
  }

  return candidates;
}

export function resolveDroidCliPath(configuredCliPath?: string | null): DroidCliResolution {
  return resolveDroidCliCandidates(configuredCliPath)[0] || { execPath: 'droid', source: 'system' };
}
