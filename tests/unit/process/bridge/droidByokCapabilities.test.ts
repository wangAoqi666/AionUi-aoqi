/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';

const { mockGetFactoryRootDir } = vi.hoisted(() => ({
  mockGetFactoryRootDir: vi.fn(() => '/mock/.factory'),
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

vi.mock('@process/utils/initStorage', () => ({
  ProcessConfig: {
    get: vi.fn(),
    set: vi.fn(),
  },
  getFactoryRootDir: mockGetFactoryRootDir,
}));

import { inferByokModelCapabilities, resolveByokModelCapabilities } from '@/process/bridge/services/DroidByokService';

describe('inferByokModelCapabilities', () => {
  describe('Claude family', () => {
    it('maps claude-sonnet-4-6 to multimodal + extended thinking', () => {
      const caps = inferByokModelCapabilities('claude-sonnet-4-6', 'anthropic');
      expect(caps.supportsImageInput).toBe(true);
      expect(caps.reasoningLevels).toEqual(['off', 'low', 'medium', 'high']);
      expect(caps.defaultReasoning).toBe('off');
    });

    it('maps claude-3-5-sonnet to multimodal + no reasoning', () => {
      const caps = inferByokModelCapabilities('claude-3-5-sonnet-20241022', 'anthropic');
      expect(caps.supportsImageInput).toBe(true);
      expect(caps.reasoningLevels).toEqual(['none']);
      expect(caps.defaultReasoning).toBe('none');
    });

    it('maps claude-3-7-sonnet to extended thinking', () => {
      const caps = inferByokModelCapabilities('claude-3-7-sonnet-latest', 'anthropic');
      expect(caps.supportsImageInput).toBe(true);
      expect(caps.reasoningLevels).toEqual(['off', 'low', 'medium', 'high']);
      expect(caps.defaultReasoning).toBe('off');
    });

    it('maps claude-opus-4 to extended thinking + vision', () => {
      const caps = inferByokModelCapabilities('claude-opus-4-latest', 'anthropic');
      expect(caps.supportsImageInput).toBe(true);
      expect(caps.defaultReasoning).toBe('off');
    });
  });

  describe('OpenAI family', () => {
    it('maps gpt-5 to full reasoning + vision', () => {
      const caps = inferByokModelCapabilities('gpt-5-preview', 'openai');
      expect(caps.supportsImageInput).toBe(true);
      expect(caps.reasoningLevels).toEqual(['minimal', 'low', 'medium', 'high', 'xhigh']);
      expect(caps.defaultReasoning).toBe('medium');
    });

    it('maps gpt-5-codex to reasoning + vision', () => {
      const caps = inferByokModelCapabilities('gpt-5-codex', 'openai');
      expect(caps.supportsImageInput).toBe(true);
      expect(caps.reasoningLevels).toContain('xhigh');
    });

    it('maps o3 to reasoning + vision', () => {
      const caps = inferByokModelCapabilities('o3-pro', 'openai');
      expect(caps.supportsImageInput).toBe(true);
      expect(caps.reasoningLevels).toEqual(['minimal', 'low', 'medium', 'high']);
      expect(caps.defaultReasoning).toBe('medium');
    });

    it('maps o1-preview to reasoning but no vision', () => {
      const caps = inferByokModelCapabilities('o1-preview', 'openai');
      expect(caps.supportsImageInput).toBe(false);
      expect(caps.reasoningLevels).toEqual(['minimal', 'low', 'medium', 'high']);
    });

    it('maps gpt-4o to multimodal, no reasoning', () => {
      const caps = inferByokModelCapabilities('gpt-4o-mini', 'openai');
      expect(caps.supportsImageInput).toBe(true);
      expect(caps.reasoningLevels).toEqual(['none']);
      expect(caps.defaultReasoning).toBe('none');
    });

    it('maps codex-mini to reasoning + vision', () => {
      const caps = inferByokModelCapabilities('codex-mini-latest', 'openai');
      expect(caps.supportsImageInput).toBe(true);
      expect(caps.reasoningLevels).toContain('high');
    });

    it('maps gpt-3.5-turbo to no reasoning, no vision', () => {
      const caps = inferByokModelCapabilities('gpt-3.5-turbo', 'openai');
      expect(caps.supportsImageInput).toBe(false);
      expect(caps.reasoningLevels).toEqual(['none']);
    });
  });

  describe('Google / Gemini', () => {
    it('maps gemini-2.5-pro to extended thinking', () => {
      const caps = inferByokModelCapabilities('gemini-2.5-pro', 'google');
      expect(caps.supportsImageInput).toBe(true);
      expect(caps.reasoningLevels).toEqual(['off', 'low', 'medium', 'high']);
      expect(caps.defaultReasoning).toBe('off');
    });

    it('maps gemini-3 pro to always-on reasoning', () => {
      const caps = inferByokModelCapabilities('gemini-3-pro-preview', 'google');
      expect(caps.supportsImageInput).toBe(true);
      expect(caps.reasoningLevels).toEqual(['low', 'medium', 'high']);
      expect(caps.defaultReasoning).toBe('medium');
    });

    it('maps gemini-1.5-pro to vision, no reasoning', () => {
      const caps = inferByokModelCapabilities('gemini-1.5-pro-latest', 'google');
      expect(caps.supportsImageInput).toBe(true);
      expect(caps.reasoningLevels).toEqual(['none']);
    });

    it('routes gemini-2.5-pro via supportedEndpointTypes when providerHint missing', () => {
      const caps = inferByokModelCapabilities('gemini-2.5-pro', undefined, ['gemini']);
      expect(caps.supportsImageInput).toBe(true);
      expect(caps.reasoningLevels).toEqual(['off', 'low', 'medium', 'high']);
    });
  });

  describe('Other providers', () => {
    it('maps kimi-vl-a3b to multimodal', () => {
      const caps = inferByokModelCapabilities('kimi-vl-a3b', 'generic-chat-completion-api');
      expect(caps.supportsImageInput).toBe(true);
    });

    it('maps qwen-vl-max to multimodal, no reasoning', () => {
      const caps = inferByokModelCapabilities('qwen-vl-max', 'generic-chat-completion-api');
      expect(caps.supportsImageInput).toBe(true);
    });

    it('maps qwen3-32b to reasoning, no vision', () => {
      const caps = inferByokModelCapabilities('qwen3-32b', 'generic-chat-completion-api');
      expect(caps.supportsImageInput).toBe(false);
      expect(caps.reasoningLevels).toEqual(['off', 'low', 'medium', 'high']);
      expect(caps.defaultReasoning).toBe('off');
    });

    it('maps glm-4v to multimodal', () => {
      const caps = inferByokModelCapabilities('glm-4v-plus', 'generic-chat-completion-api');
      expect(caps.supportsImageInput).toBe(true);
    });

    it('maps glm-4.5 to reasoning', () => {
      const caps = inferByokModelCapabilities('glm-4.5', 'generic-chat-completion-api');
      expect(caps.reasoningLevels).toEqual(['off', 'low', 'medium', 'high']);
    });

    it('maps deepseek-r1 to reasoning, no vision', () => {
      const caps = inferByokModelCapabilities('deepseek-r1', 'generic-chat-completion-api');
      expect(caps.supportsImageInput).toBe(false);
      expect(caps.reasoningLevels).toEqual(['off', 'low', 'medium', 'high']);
      expect(caps.defaultReasoning).toBe('off');
    });

    it('falls back to safe defaults for unknown models', () => {
      const caps = inferByokModelCapabilities('mystery-model-v1', 'generic-chat-completion-api');
      expect(caps.supportsImageInput).toBe(false);
      expect(caps.reasoningLevels).toEqual(['none']);
      expect(caps.defaultReasoning).toBe('none');
    });
  });
});

describe('resolveByokModelCapabilities', () => {
  it('user overrides win over inferred defaults', () => {
    const caps = resolveByokModelCapabilities('claude-sonnet-4-6', 'anthropic', undefined, {
      supportsImageInput: false,
      reasoningLevels: ['off', 'high'],
      defaultReasoning: 'high',
    });
    expect(caps.supportsImageInput).toBe(false);
    expect(caps.reasoningLevels).toEqual(['off', 'high']);
    expect(caps.defaultReasoning).toBe('high');
  });

  it('falls back to the first valid level when defaultReasoning is invalid', () => {
    const caps = resolveByokModelCapabilities('claude-sonnet-4-6', 'anthropic', undefined, {
      reasoningLevels: ['off', 'low'],
      // xhigh is not in the reasoningLevels list → clamp to first
      defaultReasoning: 'xhigh',
    });
    expect(caps.defaultReasoning).toBe('off');
  });

  it('restores the default level list when overrides is empty', () => {
    const caps = resolveByokModelCapabilities('claude-sonnet-4-6', 'anthropic', undefined, {
      reasoningLevels: [],
    });
    // Falls back to the inferred default, not [].
    expect(caps.reasoningLevels.length).toBeGreaterThan(0);
  });

  it('sanitizes garbage reasoningLevels values', () => {
    const caps = resolveByokModelCapabilities('claude-sonnet-4-6', 'anthropic', undefined, {
      reasoningLevels: ['invalid' as never, 'off', 'low'],
      defaultReasoning: 'off',
    });
    expect(caps.reasoningLevels).toEqual(['off', 'low']);
  });
});
