/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import { getPlatformServices } from '@/common/platform';
import { getEnvAwarePathName } from './appPathConfig';

/**
 * Returns baseName unchanged in release builds, or baseName + '-dev' in dev builds.
 * When AIONUI_MULTI_INSTANCE=1, appends '-2' to isolate the second dev instance.
 * Used to isolate symlink and directory names between environments.
 *
 * @example
 * getEnvAwareName('.agent-factory')        // release → '.agent-factory',        dev → '.agent-factory-dev'
 * getEnvAwareName('.agent-factory-config') // release → '.agent-factory-config', dev → '.agent-factory-config-dev'
 * // with AIONUI_MULTI_INSTANCE=1:  dev → '.agent-factory-dev-2'
 */
export function getEnvAwareName(baseName: string): string {
  return getEnvAwarePathName(baseName, getPlatformServices().paths.isPackaged() === true);
}
