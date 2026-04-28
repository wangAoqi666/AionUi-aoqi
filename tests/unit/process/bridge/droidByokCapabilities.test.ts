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

import {
  inferByokModelCapabilities,
  resolveByokModelCapabilities,
  verifyByokCapabilitiesAgainstCli,
} from '@/process/bridge/services/DroidByokService';

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

describe('verifyByokCapabilitiesAgainstCli', () => {
  describe('happy path — all models match', () => {
    it('returns ok for a single model that matches CLI', () => {
      const result = verifyByokCapabilitiesAgainstCli(
        [{ id: 'claude-sonnet-4-6', model: 'claude-sonnet-4-6', supportsImageInput: true }],
        [{ id: 'claude-sonnet-4-6', noImageSupport: false }]
      );
      expect(result.ok).toEqual(['claude-sonnet-4-6']);
      expect(result.missing).toEqual([]);
      expect(result.conflict).toEqual([]);
      expect(result.unreachable).toBe(false);
    });

    it('returns ok for multiple models that all match CLI', () => {
      const result = verifyByokCapabilitiesAgainstCli(
        [
          { id: 'gpt-4o', model: 'gpt-4o', supportsImageInput: true },
          { id: 'gpt-3.5-turbo', model: 'gpt-3.5-turbo', supportsImageInput: false },
        ],
        [
          { id: 'gpt-4o', noImageSupport: false },
          { id: 'gpt-3.5-turbo', noImageSupport: true },
        ]
      );
      expect(result.ok).toEqual(['gpt-4o', 'gpt-3.5-turbo']);
      expect(result.missing).toEqual([]);
      expect(result.conflict).toEqual([]);
    });

    it('returns ok when local does not claim image support and CLI reports noImageSupport', () => {
      const result = verifyByokCapabilitiesAgainstCli(
        [{ id: 'text-model', model: 'text-model', supportsImageInput: false }],
        [{ id: 'text-model', noImageSupport: true }]
      );
      expect(result.ok).toEqual(['text-model']);
      expect(result.conflict).toEqual([]);
    });
  });

  describe('missing path — model absent in CLI catalog', () => {
    it('reports single missing model', () => {
      const result = verifyByokCapabilitiesAgainstCli(
        [{ id: 'custom-model-v1', model: 'custom-model-v1', supportsImageInput: true }],
        [{ id: 'some-other-model' }]
      );
      expect(result.missing).toEqual(['custom-model-v1']);
      expect(result.ok).toEqual([]);
      expect(result.conflict).toEqual([]);
      expect(result.unreachable).toBe(false);
    });

    it('reports multiple missing models alongside ok models', () => {
      const result = verifyByokCapabilitiesAgainstCli(
        [
          { id: 'known-model', model: 'known-model', supportsImageInput: false },
          { id: 'missing-a', model: 'missing-a' },
          { id: 'missing-b', model: 'missing-b', supportsImageInput: true },
        ],
        [{ id: 'known-model', noImageSupport: true }]
      );
      expect(result.ok).toEqual(['known-model']);
      expect(result.missing).toEqual(['missing-a', 'missing-b']);
      expect(result.conflict).toEqual([]);
    });

    it('reports missing when CLI catalog is empty', () => {
      const result = verifyByokCapabilitiesAgainstCli(
        [{ id: 'my-model', model: 'my-model', supportsImageInput: true }],
        []
      );
      expect(result.missing).toEqual(['my-model']);
      expect(result.ok).toEqual([]);
    });
  });

  describe('conflict path — CLI noImageSupport contradicts local supportsImageInput', () => {
    it('detects conflict when local says supportsImageInput=true but CLI says noImageSupport=true', () => {
      const result = verifyByokCapabilitiesAgainstCli(
        [{ id: 'vision-model', model: 'vision-model', supportsImageInput: true }],
        [{ id: 'vision-model', noImageSupport: true }]
      );
      expect(result.conflict).toEqual([
        {
          modelId: 'vision-model',
          field: 'supportsImageInput',
          local: true,
          cli: false,
        },
      ]);
      expect(result.ok).toEqual([]);
      expect(result.missing).toEqual([]);
    });

    it('detects multiple conflicts across different models', () => {
      const result = verifyByokCapabilitiesAgainstCli(
        [
          { id: 'model-a', model: 'model-a', supportsImageInput: true },
          { id: 'model-b', model: 'model-b', supportsImageInput: true },
          { id: 'model-c', model: 'model-c', supportsImageInput: false },
        ],
        [
          { id: 'model-a', noImageSupport: true },
          { id: 'model-b', noImageSupport: true },
          { id: 'model-c', noImageSupport: true },
        ]
      );
      expect(result.conflict).toHaveLength(2);
      expect(result.conflict.map((c) => c.modelId)).toEqual(['model-a', 'model-b']);
      expect(result.ok).toEqual(['model-c']);
    });

    it('does not treat undefined noImageSupport as conflict', () => {
      const result = verifyByokCapabilitiesAgainstCli(
        [{ id: 'ambiguous-model', model: 'ambiguous-model', supportsImageInput: true }],
        [{ id: 'ambiguous-model' }] // noImageSupport undefined → supports image
      );
      expect(result.ok).toEqual(['ambiguous-model']);
      expect(result.conflict).toEqual([]);
    });
  });

  describe('CLI unreachable path', () => {
    it('returns unreachable sentinel when cliModels is null', () => {
      const result = verifyByokCapabilitiesAgainstCli(
        [{ id: 'my-model', model: 'my-model', supportsImageInput: true }],
        null
      );
      expect(result.unreachable).toBe(true);
      expect(result.ok).toEqual([]);
      expect(result.missing).toEqual([]);
      expect(result.conflict).toEqual([]);
    });

    it('threads through the CLI diagnostic code when the latest probe failed', () => {
      const result = verifyByokCapabilitiesAgainstCli(
        [{ id: 'my-model', model: 'my-model', supportsImageInput: true }],
        null,
        {
          code: 'missing-platform-binary',
          stage: 'preflight',
          detail: 'Could not find the droid binary for win32-x64',
        }
      );

      expect(result.unreachable).toBe(true);
      expect(result.cliDiagnosticCode).toBe('missing-platform-binary');
    });

    it('returns unreachable even with multiple local configs', () => {
      const result = verifyByokCapabilitiesAgainstCli(
        [
          { id: 'a', model: 'a', supportsImageInput: true },
          { id: 'b', model: 'b', supportsImageInput: false },
        ],
        null
      );
      expect(result.unreachable).toBe(true);
      expect(result.ok).toEqual([]);
    });

    it('returns unreachable with empty local configs', () => {
      const result = verifyByokCapabilitiesAgainstCli([], null);
      expect(result.unreachable).toBe(true);
    });
  });

  describe('mixed scenarios', () => {
    it('handles ok + missing + conflict in a single call', () => {
      const result = verifyByokCapabilitiesAgainstCli(
        [
          { id: 'ok-model', model: 'ok-model', supportsImageInput: true },
          { id: 'missing-model', model: 'missing-model', supportsImageInput: false },
          { id: 'conflict-model', model: 'conflict-model', supportsImageInput: true },
        ],
        [
          { id: 'ok-model', noImageSupport: false },
          { id: 'conflict-model', noImageSupport: true },
        ]
      );
      expect(result.ok).toEqual(['ok-model']);
      expect(result.missing).toEqual(['missing-model']);
      expect(result.conflict).toHaveLength(1);
      expect(result.conflict[0].modelId).toBe('conflict-model');
      expect(result.unreachable).toBe(false);
    });

    it('returns empty arrays when no local configs exist', () => {
      const result = verifyByokCapabilitiesAgainstCli([], [{ id: 'cli-model' }]);
      expect(result.ok).toEqual([]);
      expect(result.missing).toEqual([]);
      expect(result.conflict).toEqual([]);
      expect(result.unreachable).toBe(false);
    });
  });
});
