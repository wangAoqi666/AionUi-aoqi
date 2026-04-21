/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockProcessConfigGet, mockLoadPresetAssistantResources } = vi.hoisted(() => ({
  mockProcessConfigGet: vi.fn(),
  mockLoadPresetAssistantResources: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    fs: {
      readAssistantRule: { invoke: vi.fn() },
      readAssistantSkill: { invoke: vi.fn() },
      readBuiltinRule: { invoke: vi.fn() },
      readBuiltinSkill: { invoke: vi.fn() },
    },
  },
}));

vi.mock('@/common/utils', () => ({
  resolveLocaleKey: (language?: string) => language || 'en-US',
}));

vi.mock('@/common/utils/presetAssistantResources', () => ({
  loadPresetAssistantResources: mockLoadPresetAssistantResources,
}));

vi.mock('@process/utils/initStorage', () => ({
  ProcessConfig: {
    get: mockProcessConfigGet,
  },
}));

const { hydrateChannelConversationExtra } = await import('@/process/channels/utils/channelConversation');

describe('hydrateChannelConversationExtra', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProcessConfigGet.mockResolvedValue('zh-CN');
  });

  it('returns base extra when no preset assistant is configured', async () => {
    await expect(
      hydrateChannelConversationExtra({
        platform: 'weixin',
        backend: 'gemini',
      })
    ).resolves.toEqual({ enabledSkills: ['weixin-file-send'] });

    expect(mockLoadPresetAssistantResources).not.toHaveBeenCalled();
  });

  it('hydrates preset rules for gemini conversations and merges enabled skills', async () => {
    mockLoadPresetAssistantResources.mockResolvedValue({
      rules: 'system-rules',
      skills: '',
      enabledSkills: ['skill-a', 'weixin-file-send'],
    });

    await expect(
      hydrateChannelConversationExtra({
        platform: 'weixin',
        backend: 'gemini',
        customAgentId: 'builtin-helper',
        agentName: 'Preset Helper',
      })
    ).resolves.toEqual({
      enabledSkills: ['weixin-file-send', 'skill-a'],
      presetAssistantId: 'builtin-helper',
      presetRules: 'system-rules',
    });

    expect(mockProcessConfigGet).toHaveBeenCalledWith('language');
    expect(mockLoadPresetAssistantResources).toHaveBeenCalledWith(
      {
        customAgentId: 'builtin-helper',
        localeKey: 'zh-CN',
      },
      expect.any(Object)
    );
  });

  it('hydrates preset context for non-gemini backends', async () => {
    mockLoadPresetAssistantResources.mockResolvedValue({
      rules: 'assistant-context',
      skills: '',
      enabledSkills: ['skill-b'],
    });

    await expect(
      hydrateChannelConversationExtra({
        platform: 'telegram',
        backend: 'droid',
        customAgentId: 'builtin-helper',
        agentName: 'Factory Droid',
      })
    ).resolves.toEqual({
      backend: 'droid',
      customAgentId: 'builtin-helper',
      agentName: 'Factory Droid',
      enabledSkills: ['skill-b'],
      presetAssistantId: 'builtin-helper',
      presetContext: 'assistant-context',
    });
  });
});
