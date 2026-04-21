/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AcpBackend } from '@/common/types/acpTypes';
import { resolveLocaleKey } from '@/common/utils';
import { ipcBridge } from '@/common';
import { loadPresetAssistantResources } from '@/common/utils/presetAssistantResources';
import { ProcessConfig } from '@process/utils/initStorage';
import type { PluginType } from '../types';

const WEIXIN_FILE_SEND_SKILL = 'weixin-file-send';

type ChannelConversationExtra = {
  backend?: AcpBackend;
  customAgentId?: string;
  agentName?: string;
  enabledSkills?: string[];
  presetContext?: string;
  presetRules?: string;
  presetAssistantId?: string;
};

export function getChannelEnabledSkills(platform: PluginType): string[] | undefined {
  return platform === 'weixin' ? [WEIXIN_FILE_SEND_SKILL] : undefined;
}

export function buildChannelConversationExtra(args: {
  platform: PluginType;
  backend: string;
  customAgentId?: string;
  agentName?: string;
}): ChannelConversationExtra {
  const enabledSkills = getChannelEnabledSkills(args.platform);

  if (args.backend === 'gemini' || args.backend === 'codex' || args.backend === 'openclaw-gateway') {
    return enabledSkills ? { enabledSkills } : {};
  }

  return {
    backend: args.backend as AcpBackend,
    customAgentId: args.customAgentId,
    agentName: args.agentName,
    ...(enabledSkills ? { enabledSkills } : {}),
  };
}

function mergeEnabledSkills(...lists: Array<string[] | undefined>): string[] | undefined {
  const merged = Array.from(
    new Set(lists.flatMap((list) => (Array.isArray(list) ? list.map((item) => item.trim()).filter(Boolean) : [])))
  );

  return merged.length > 0 ? merged : undefined;
}

export async function hydrateChannelConversationExtra(args: {
  platform: PluginType;
  backend: string;
  customAgentId?: string;
  agentName?: string;
}): Promise<ChannelConversationExtra> {
  const baseExtra = buildChannelConversationExtra(args);
  const presetAssistantId = args.customAgentId?.trim();
  if (!presetAssistantId) {
    return baseExtra;
  }

  const language = await ProcessConfig.get('language');
  const localeKey = resolveLocaleKey(language || 'en-US');
  const resources = await loadPresetAssistantResources(
    {
      customAgentId: presetAssistantId,
      localeKey,
    },
    {
      readAssistantRule: ({ assistantId, locale }) => ipcBridge.fs.readAssistantRule.invoke({ assistantId, locale }),
      readAssistantSkill: ({ assistantId, locale }) => ipcBridge.fs.readAssistantSkill.invoke({ assistantId, locale }),
      readBuiltinRule: ({ fileName }) => ipcBridge.fs.readBuiltinRule.invoke({ fileName }),
      readBuiltinSkill: ({ fileName }) => ipcBridge.fs.readBuiltinSkill.invoke({ fileName }),
      getEnabledSkills: async (assistantId) => {
        const customAgents = await ProcessConfig.get('acp.customAgents');
        return customAgents?.find((agent) => agent.id === assistantId)?.enabledSkills;
      },
      warn: (message, error) => {
        console.warn(message, error);
      },
    }
  );

  const enabledSkills = mergeEnabledSkills(baseExtra.enabledSkills, resources.enabledSkills);

  if (args.backend === 'gemini') {
    return {
      ...baseExtra,
      presetAssistantId,
      ...(resources.rules ? { presetRules: resources.rules } : {}),
      ...(enabledSkills ? { enabledSkills } : {}),
    };
  }

  return {
    ...baseExtra,
    presetAssistantId,
    ...(resources.rules ? { presetContext: resources.rules } : {}),
    ...(enabledSkills ? { enabledSkills } : {}),
  };
}
