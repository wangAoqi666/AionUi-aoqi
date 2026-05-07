/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ChannelPublishInstanceSettings,
  DroidChannelPlatform,
  DroidChannelRuntimeConfig,
} from '@/common/config/storage';
import {
  ConfigStorage,
  sanitizeChannelPublishInstanceSettings,
  sanitizeChannelPublishInstanceSettingsMap,
  sanitizeDroidChannelRuntimeConfig,
} from '@/common/config/storage';
import type { AcpBackendAll } from '@/common/types/acpTypes';

const CHANNEL_PUBLISH_INSTANCES_KEY = 'assistant.channel.publishInstances';

type LegacyPlatformConfig = Pick<ChannelPublishInstanceSettings, 'agent' | 'defaultModel' | 'droidRuntime'>;

type LegacyAgentKey =
  | 'assistant.telegram.agent'
  | 'assistant.lark.agent'
  | 'assistant.dingtalk.agent'
  | 'assistant.weixin.agent';

type LegacyModelKey =
  | 'assistant.telegram.defaultModel'
  | 'assistant.lark.defaultModel'
  | 'assistant.dingtalk.defaultModel'
  | 'assistant.weixin.defaultModel';

type LegacyRuntimeKey =
  | 'assistant.telegram.droidRuntime'
  | 'assistant.lark.droidRuntime'
  | 'assistant.dingtalk.droidRuntime'
  | 'assistant.weixin.droidRuntime';

const legacyAgentKeyMap: Record<DroidChannelPlatform, LegacyAgentKey> = {
  telegram: 'assistant.telegram.agent',
  lark: 'assistant.lark.agent',
  dingtalk: 'assistant.dingtalk.agent',
  weixin: 'assistant.weixin.agent',
};

const legacyModelKeyMap: Record<DroidChannelPlatform, LegacyModelKey> = {
  telegram: 'assistant.telegram.defaultModel',
  lark: 'assistant.lark.defaultModel',
  dingtalk: 'assistant.dingtalk.defaultModel',
  weixin: 'assistant.weixin.defaultModel',
};

const legacyRuntimeKeyMap: Record<DroidChannelPlatform, LegacyRuntimeKey> = {
  telegram: 'assistant.telegram.droidRuntime',
  lark: 'assistant.lark.droidRuntime',
  dingtalk: 'assistant.dingtalk.droidRuntime',
  weixin: 'assistant.weixin.droidRuntime',
};

const getDefaultBuiltinPluginId = (platform: DroidChannelPlatform) => `${platform}_default`;

async function loadLegacyPlatformConfig(platform: DroidChannelPlatform): Promise<LegacyPlatformConfig> {
  const [agent, defaultModel, droidRuntime] = await Promise.all([
    ConfigStorage.get(legacyAgentKeyMap[platform]),
    ConfigStorage.get(legacyModelKeyMap[platform]),
    ConfigStorage.get(legacyRuntimeKeyMap[platform]),
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

export type ChannelInstancePlatform = DroidChannelPlatform;

export async function loadChannelInstanceSettings(
  pluginId: string,
  platform?: ChannelInstancePlatform
): Promise<ChannelPublishInstanceSettings> {
  const allSettings = sanitizeChannelPublishInstanceSettingsMap(await ConfigStorage.get(CHANNEL_PUBLISH_INSTANCES_KEY));
  const current = sanitizeChannelPublishInstanceSettings(allSettings[pluginId]);

  if (!platform || pluginId !== getDefaultBuiltinPluginId(platform)) {
    return current;
  }

  const legacy = await loadLegacyPlatformConfig(platform);
  return sanitizeChannelPublishInstanceSettings({
    ...legacy,
    ...current,
    droidRuntime: current.droidRuntime ?? legacy.droidRuntime,
  });
}

let updateChain = Promise.resolve();

export async function updateChannelInstanceSettings(
  pluginId: string,
  updater: (current: ChannelPublishInstanceSettings) => ChannelPublishInstanceSettings
): Promise<void> {
  const task = updateChain.then(async () => {
    const allSettings = sanitizeChannelPublishInstanceSettingsMap(
      await ConfigStorage.get(CHANNEL_PUBLISH_INSTANCES_KEY)
    );
    const current = sanitizeChannelPublishInstanceSettings(allSettings[pluginId]);
    const next = sanitizeChannelPublishInstanceSettings(updater(current));

    await ConfigStorage.set(CHANNEL_PUBLISH_INSTANCES_KEY, {
      ...allSettings,
      [pluginId]: next,
    });
  });
  updateChain = task.catch(() => {});
  return task;
}
