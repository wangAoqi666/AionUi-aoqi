/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AcpBackendAll } from '@/common/types/acpTypes';

export type ChannelConversationAgentOption = {
  backend: AcpBackendAll;
  name: string;
  customAgentId?: string;
  isPreset?: boolean;
  isExtension?: boolean;
};

export const DEFAULT_CHANNEL_CONVERSATION_AGENT: ChannelConversationAgentOption = {
  backend: 'droid',
  name: 'Factory Droid',
};

const parseStoredChannelConversationAgent = (
  value: unknown
): Pick<ChannelConversationAgentOption, 'backend' | 'customAgentId'> | null => {
  if (typeof value === 'string') {
    return value === 'droid' ? { backend: 'droid' } : null;
  }

  if (!value || typeof value !== 'object' || !('backend' in value) || typeof value.backend !== 'string') {
    return null;
  }

  const storedAgent = value as {
    backend: AcpBackendAll;
    customAgentId?: unknown;
  };

  return {
    backend: storedAgent.backend,
    ...(typeof storedAgent.customAgentId === 'string' && storedAgent.customAgentId
      ? { customAgentId: storedAgent.customAgentId }
      : {}),
  };
};

export const getChannelConversationAgentKey = (
  agent: Pick<ChannelConversationAgentOption, 'backend' | 'customAgentId'>
): string => {
  return agent.customAgentId ? `${agent.backend}|${agent.customAgentId}` : agent.backend;
};

export const getChannelConversationAgentOptions = (
  agents?: ChannelConversationAgentOption[]
): ChannelConversationAgentOption[] => {
  const droidAgent = agents?.find((agent) => agent.backend === 'droid');
  if (!droidAgent) {
    return [DEFAULT_CHANNEL_CONVERSATION_AGENT];
  }

  return [
    {
      ...DEFAULT_CHANNEL_CONVERSATION_AGENT,
      name: droidAgent.name || DEFAULT_CHANNEL_CONVERSATION_AGENT.name,
      ...(droidAgent.customAgentId ? { customAgentId: droidAgent.customAgentId } : {}),
      ...(typeof droidAgent.isPreset === 'boolean' ? { isPreset: droidAgent.isPreset } : {}),
      ...(typeof droidAgent.isExtension === 'boolean' ? { isExtension: droidAgent.isExtension } : {}),
    },
  ];
};

export const resolveChannelConversationAgentSelection = (
  saved: unknown,
  agents?: ChannelConversationAgentOption[]
): {
  availableAgents: ChannelConversationAgentOption[];
  selectedAgent: ChannelConversationAgentOption;
  shouldPersistSelection: boolean;
} => {
  const availableAgents = getChannelConversationAgentOptions(agents);
  const selectedAgent = availableAgents[0];
  const savedAgent = parseStoredChannelConversationAgent(saved);

  return {
    availableAgents,
    selectedAgent,
    shouldPersistSelection:
      !savedAgent || getChannelConversationAgentKey(savedAgent) !== getChannelConversationAgentKey(selectedAgent),
  };
};
