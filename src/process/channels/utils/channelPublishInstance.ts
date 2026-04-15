/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ChannelPublishInstanceSettings, DroidChannelRuntimeConfig } from '@/common/config/storage';
import type { AcpBackendAll } from '@/common/types/acpTypes';
import {
  sanitizeChannelPublishInstanceSettings,
  sanitizeChannelPublishInstanceSettingsMap,
  sanitizeDroidChannelRuntimeConfig,
} from '@/common/config/storage';
import { ProcessConfig } from '@process/utils/initStorage';
import type { ChannelPlatform } from '../types';
import { getDefaultChannelPluginId } from '../types';

type LegacyPlatformConfig = Pick<ChannelPublishInstanceSettings, 'agent' | 'defaultModel' | 'droidRuntime'>;

async function loadLegacyPlatformConfig(platform: ChannelPlatform): Promise<LegacyPlatformConfig> {
  const [agent, defaultModel, droidRuntime] = await Promise.all([
    ProcessConfig.get(`assistant.${platform}.agent` as never),
    ProcessConfig.get(`assistant.${platform}.defaultModel` as never),
    ProcessConfig.get(`assistant.${platform}.droidRuntime` as never),
  ]);

  return sanitizeChannelPublishInstanceSettings({
    agent:
      agent && typeof agent === 'object' && typeof (agent as { backend?: unknown }).backend === 'string'
        ? {
            backend: (agent as { backend: AcpBackendAll }).backend,
            customAgentId:
              typeof (agent as { customAgentId?: unknown }).customAgentId === 'string'
                ? (agent as { customAgentId: string }).customAgentId
                : undefined,
            name: typeof (agent as { name?: unknown }).name === 'string' ? (agent as { name: string }).name : undefined,
          }
        : undefined,
    defaultModel:
      defaultModel &&
      typeof defaultModel === 'object' &&
      typeof (defaultModel as { id?: unknown }).id === 'string' &&
      typeof (defaultModel as { useModel?: unknown }).useModel === 'string'
        ? {
            id: (defaultModel as { id: string }).id,
            useModel: (defaultModel as { useModel: string }).useModel,
          }
        : undefined,
    droidRuntime: sanitizeDroidChannelRuntimeConfig(droidRuntime as DroidChannelRuntimeConfig | null | undefined),
  });
}

export async function loadChannelPublishInstanceSettingsMap(): Promise<Record<string, ChannelPublishInstanceSettings>> {
  return sanitizeChannelPublishInstanceSettingsMap(await ProcessConfig.get('assistant.channel.publishInstances'));
}

export async function loadChannelPublishInstanceSettings(
  pluginId: string,
  platform: ChannelPlatform
): Promise<ChannelPublishInstanceSettings> {
  const storedSettings = await loadChannelPublishInstanceSettingsMap();
  const current = sanitizeChannelPublishInstanceSettings(storedSettings[pluginId]);

  if (pluginId !== getDefaultChannelPluginId(platform)) {
    return current;
  }

  const legacy = await loadLegacyPlatformConfig(platform);
  return sanitizeChannelPublishInstanceSettings({
    ...legacy,
    ...current,
    droidRuntime: current.droidRuntime ?? legacy.droidRuntime,
  });
}
