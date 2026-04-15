/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import os from 'os';
import path from 'path';

export const AGENT_FACTORY_DIR_NAME = 'agent-factory';
export const AGENT_FACTORY_DATA_SYMLINK = '.agent-factory';
export const AGENT_FACTORY_CONFIG_SYMLINK = '.agent-factory-config';
export const AGENT_FACTORY_SERVER_DIR = '.agent-factory-server';

const getDevSuffix = (): string => {
  return process.env.AIONUI_MULTI_INSTANCE === '1' ? '-dev-2' : '-dev';
};

export function getEnvAwarePathName(baseName: string, isPackaged: boolean): string {
  if (isPackaged) return baseName;
  return `${baseName}${getDevSuffix()}`;
}

export function getDefaultLogDir(homeDir = os.homedir(), isPackaged: boolean): string {
  const logRootName = getEnvAwarePathName(AGENT_FACTORY_DIR_NAME, isPackaged);

  switch (process.platform) {
    case 'darwin':
      return path.join(homeDir, 'Library', 'Logs', logRootName);
    case 'win32':
      return path.join(process.env.APPDATA ?? path.join(homeDir, 'AppData', 'Roaming'), logRootName, 'logs');
    default:
      return path.join(homeDir, '.config', logRootName, 'logs');
  }
}

const PATH_SEGMENT_REPLACEMENTS = new Map<string, string>([
  ['AionUi-Dev-2', 'agent-factory-dev-2'],
  ['AionUi-Dev', 'agent-factory-dev'],
  ['AionUi', 'agent-factory'],
  ['.aionui-config-dev-2', '.agent-factory-config-dev-2'],
  ['.aionui-config-dev', '.agent-factory-config-dev'],
  ['.aionui-config', '.agent-factory-config'],
  ['.aionui-dev-2', '.agent-factory-dev-2'],
  ['.aionui-dev', '.agent-factory-dev'],
  ['.aionui-server', '.agent-factory-server'],
  ['.aionui', '.agent-factory'],
]);

export function normalizeLegacySystemPath(rawPath: string | null | undefined): string | undefined {
  if (!rawPath) return undefined;

  return rawPath
    .split(/([\\/]+)/)
    .map((segment) => PATH_SEGMENT_REPLACEMENTS.get(segment) ?? segment)
    .join('');
}
