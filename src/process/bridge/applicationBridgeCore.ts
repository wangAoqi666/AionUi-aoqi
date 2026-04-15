/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Platform-agnostic application bridge handlers.
 * Safe to use in both Electron and standalone server mode.
 * Electron-only handlers (restart, devtools, zoom, CDP) remain in applicationBridge.ts.
 */
import { existsSync, readFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { ipcBridge } from '@/common';
import { getPlatformServices } from '@/common/platform';
import { getSystemDir, ProcessEnv } from '@process/utils/initStorage';
import { copyDirectoryRecursively } from '@process/utils';

const MAC_BUNDLED_BUN_SEGMENT = `${path.sep}Contents${path.sep}Resources${path.sep}bundled-bun${path.sep}`;
const MAC_BUNDLE_VERSION_REGEX = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/;

function extractMacBundleVersion(plistContent: string): string | null {
  const match = MAC_BUNDLE_VERSION_REGEX.exec(plistContent);
  return match?.[1]?.trim() || null;
}

export function getBundledHostAppVersion(
  pathEnv: string | undefined,
  platform: NodeJS.Platform = process.platform
): string | null {
  if (platform !== 'darwin' || !pathEnv) {
    return null;
  }

  const plistPaths = pathEnv
    .split(path.delimiter)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => {
      const separatorIndex = segment.indexOf(MAC_BUNDLED_BUN_SEGMENT);
      if (separatorIndex === -1) {
        return null;
      }

      const appBundlePath = segment.slice(0, separatorIndex);
      if (!appBundlePath.endsWith('.app')) {
        return null;
      }

      return path.join(appBundlePath, 'Contents', 'Info.plist');
    })
    .filter((plistPath): plistPath is string => Boolean(plistPath));

  for (const plistPath of new Set(plistPaths)) {
    try {
      if (!existsSync(plistPath)) {
        continue;
      }

      const plistContent = readFileSync(plistPath, 'utf8');
      const version = extractMacBundleVersion(plistContent);
      if (version) {
        return version;
      }
    } catch {
      continue;
    }
  }

  return null;
}

export function getApplicationDisplayVersion(): string {
  const platformServices = getPlatformServices();
  const runtimeVersion = platformServices.paths.getVersion();

  if (platformServices.paths.isPackaged()) {
    return runtimeVersion;
  }

  return getBundledHostAppVersion(process.env.PATH) || runtimeVersion;
}

export function initApplicationBridgeCore(): void {
  ipcBridge.application.getVersion.provider(() => {
    return Promise.resolve(getApplicationDisplayVersion());
  });

  ipcBridge.application.systemInfo.provider(() => {
    return Promise.resolve(getSystemDir());
  });

  ipcBridge.application.updateSystemInfo.provider(async ({ cacheDir, workDir }) => {
    try {
      const oldDir = getSystemDir();
      if (oldDir.cacheDir !== cacheDir) {
        await copyDirectoryRecursively(oldDir.cacheDir, cacheDir);
      }
      await ProcessEnv.set('aionui.dir', { cacheDir, workDir });
      return { success: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, msg };
    }
  });

  ipcBridge.application.getPath.provider(({ name }) => {
    // Resolve common paths without Electron
    const home = os.homedir();
    const map: Record<string, string> = {
      home,
      desktop: path.join(home, 'Desktop'),
      downloads: path.join(home, 'Downloads'),
    };
    return Promise.resolve(map[name] ?? home);
  });
}
