/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { GuidSendDeps } from '../../src/renderer/pages/guid/hooks/useGuidSend';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockCreate = vi.fn().mockResolvedValue({ id: 'new-conv', extra: { workspace: '' } });
const mockWarmup = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/common', () => ({
  ipcBridge: {
    conversation: {
      create: { invoke: (...args: unknown[]) => mockCreate(...args) },
      warmup: { invoke: (...args: unknown[]) => mockWarmup(...args) },
    },
  },
}));

vi.mock('../../src/renderer/utils/emitter', () => ({
  emitter: { emit: vi.fn() },
}));

vi.mock('../../src/renderer/utils/file/messageFiles', () => ({
  buildDisplayMessage: vi.fn((input: string) => input),
}));

vi.mock('../../src/renderer/utils/workspace/workspaceHistory', () => ({
  updateWorkspaceTime: vi.fn(),
}));

vi.mock('../../src/common/types/acpTypes', async () => {
  const actual = await vi.importActual<typeof import('../../src/common/types/acpTypes')>(
    '../../src/common/types/acpTypes'
  );
  return {
    ...actual,
    isAcpRoutedPresetType: vi.fn(() => false),
  };
});

vi.mock('@arco-design/web-react', () => ({
  Message: { info: vi.fn(), error: vi.fn() },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en-US' },
  }),
}));

import { useGuidSend } from '../../src/renderer/pages/guid/hooks/useGuidSend';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeps(overrides: Partial<GuidSendDeps> = {}): GuidSendDeps {
  return {
    input: 'test message',
    setInput: vi.fn(),
    files: [],
    setFiles: vi.fn(),
    dir: '',
    setDir: vi.fn(),
    setLoading: vi.fn(),
    selectedAgent: 'remote',
    selectedAgentKey: 'remote:agent-1',
    selectedAgentInfo: undefined,
    isPresetAgent: false,
    selectedMode: 'default',
    selectedAcpModel: null,
    pendingConfigOptions: {},
    cachedConfigOptions: [],
    currentModel: undefined,
    findAgentByKey: vi.fn(),
    getEffectiveAgentType: vi.fn(() => ({ agentType: 'remote', isAvailable: true })),
    resolvePresetRulesAndSkills: vi.fn().mockResolvedValue({}),
    resolveEnabledSkills: vi.fn(),
    isMainAgentAvailable: vi.fn(() => true),
    getAvailableFallbackAgent: vi.fn(() => null),
    currentEffectiveAgentInfo: { agentType: 'remote', isAvailable: true },
    isGoogleAuth: false,
    setMentionOpen: vi.fn(),
    setMentionQuery: vi.fn(),
    setMentionSelectorOpen: vi.fn(),
    setMentionActiveIndex: vi.fn(),
    navigate: vi.fn().mockResolvedValue(undefined),
    closeAllTabs: vi.fn(),
    openTab: vi.fn(),
    activeTab: null,
    t: vi.fn((key: string) => key),
    ...overrides,
  } as GuidSendDeps;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useGuidSend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mockCreate.mockResolvedValue({ id: 'new-conv', extra: { workspace: '' } });
  });

  describe('remote agent path', () => {
    it('creates remote conversation via IPC', async () => {
      const deps = makeDeps();
      const { result } = renderHook(() => useGuidSend(deps));

      await act(async () => {
        await result.current.handleSend();
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'remote',
          name: 'test message',
          extra: expect.objectContaining({
            remoteAgentId: undefined,
          }),
        })
      );
    });

    it('stores initial message in sessionStorage', async () => {
      const deps = makeDeps();
      const { result } = renderHook(() => useGuidSend(deps));

      await act(async () => {
        await result.current.handleSend();
      });

      const stored = sessionStorage.getItem('acp_initial_message_new-conv');
      expect(stored).toBeTruthy();
      const parsed = JSON.parse(stored!);
      expect(parsed.input).toBe('test message');
    });

    it('navigates to conversation after creation', async () => {
      const deps = makeDeps();
      const { result } = renderHook(() => useGuidSend(deps));

      await act(async () => {
        await result.current.handleSend();
      });

      expect(deps.navigate).toHaveBeenCalledWith('/conversation/new-conv');
    });

    it('handles null conversation result gracefully', async () => {
      mockCreate.mockResolvedValueOnce(null);
      const deps = makeDeps();
      const { result } = renderHook(() => useGuidSend(deps));

      await act(async () => {
        await result.current.handleSend();
      });

      // Should not navigate or throw
      expect(deps.navigate).not.toHaveBeenCalled();
    });

    it('handles conversation missing id gracefully', async () => {
      mockCreate.mockResolvedValueOnce({ extra: {} });
      const deps = makeDeps();
      const { result } = renderHook(() => useGuidSend(deps));

      await act(async () => {
        await result.current.handleSend();
      });

      expect(deps.navigate).not.toHaveBeenCalled();
    });

    it('throws on conversation creation error', async () => {
      mockCreate.mockRejectedValueOnce(new Error('create failed'));
      const deps = makeDeps();
      const { result } = renderHook(() => useGuidSend(deps));

      await expect(
        act(async () => {
          await result.current.handleSend();
        })
      ).rejects.toThrow('create failed');
    });

    it('stores files in initial message when provided', async () => {
      const deps = makeDeps({ files: ['/tmp/a.ts'] });
      const { result } = renderHook(() => useGuidSend(deps));

      await act(async () => {
        await result.current.handleSend();
      });

      const stored = sessionStorage.getItem('acp_initial_message_new-conv');
      const parsed = JSON.parse(stored!);
      expect(parsed.files).toEqual(['/tmp/a.ts']);
    });

    it('opens tab for custom workspace', async () => {
      const deps = makeDeps({ dir: '/custom/workspace' });
      const { result } = renderHook(() => useGuidSend(deps));

      await act(async () => {
        await result.current.handleSend();
      });

      expect(deps.closeAllTabs).toHaveBeenCalled();
      expect(deps.openTab).toHaveBeenCalledWith({ id: 'new-conv', extra: { workspace: '' } });
    });

    it('preserves existing tabs when new conversation stays in the same workspace', async () => {
      const deps = makeDeps({
        dir: '/custom/workspace',
        activeTab: {
          id: 'existing-tab',
          name: 'existing',
          workspace: '/custom/workspace',
          type: 'acp',
        },
      });
      const { result } = renderHook(() => useGuidSend(deps));

      await act(async () => {
        await result.current.handleSend();
      });

      expect(deps.closeAllTabs).not.toHaveBeenCalled();
      expect(deps.openTab).toHaveBeenCalledWith({ id: 'new-conv', extra: { workspace: '' } });
    });

    it('closes existing tabs when switching to a different workspace', async () => {
      const deps = makeDeps({
        dir: '/new/workspace',
        activeTab: {
          id: 'existing-tab',
          name: 'existing',
          workspace: '/old/workspace',
          type: 'acp',
        },
      });
      const { result } = renderHook(() => useGuidSend(deps));

      await act(async () => {
        await result.current.handleSend();
      });

      expect(deps.closeAllTabs).toHaveBeenCalled();
      expect(deps.openTab).toHaveBeenCalledWith({ id: 'new-conv', extra: { workspace: '' } });
    });
  });

  describe('builtin preset assistants', () => {
    it('keeps builtin presets on Factory Droid and preserves preset identity', async () => {
      const deps = makeDeps({
        selectedAgent: 'custom',
        selectedAgentKey: 'custom:builtin-cowork',
        selectedAgentInfo: {
          backend: 'custom',
          name: 'Cowork',
          customAgentId: 'builtin-cowork',
          isPreset: true,
        },
        isPresetAgent: true,
        currentModel: {} as GuidSendDeps['currentModel'],
        resolvePresetRulesAndSkills: vi.fn().mockResolvedValue({ rules: 'builtin droid rules' }),
        resolveEnabledSkills: vi.fn(() => ['paper-sync']),
        getEffectiveAgentType: vi.fn(() => ({
          agentType: 'droid',
          isFallback: false,
          originalType: 'droid',
          isAvailable: false,
        })),
        isMainAgentAvailable: vi.fn(() => false),
        getAvailableFallbackAgent: vi.fn(() => 'gemini'),
        findAgentByKey: vi.fn((key: string) =>
          key === 'droid' ? { backend: 'droid', name: 'Factory Droid', cliPath: '/usr/local/bin/droid' } : undefined
        ),
      });
      const { result } = renderHook(() => useGuidSend(deps));

      await act(async () => {
        await result.current.handleSend();
      });

      expect(deps.getAvailableFallbackAgent).not.toHaveBeenCalled();
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'acp',
          extra: expect.objectContaining({
            backend: 'droid',
            presetAssistantId: 'builtin-cowork',
            presetContext: 'builtin droid rules',
            enabledSkills: ['paper-sync'],
          }),
        })
      );
    });
  });

  describe('sendMessageHandler', () => {
    it('resets input state after successful send', async () => {
      const deps = makeDeps();
      const { result } = renderHook(() => useGuidSend(deps));

      await act(async () => {
        result.current.sendMessageHandler();
        // Wait for the promise chain
        await new Promise((r) => setTimeout(r, 50));
      });

      expect(deps.setInput).toHaveBeenCalledWith('');
      expect(deps.setFiles).toHaveBeenCalledWith([]);
      expect(deps.setDir).toHaveBeenCalledWith('');
      expect(deps.setLoading).toHaveBeenCalledWith(false);
    });
  });

  describe('isButtonDisabled', () => {
    it('is true when input is empty', () => {
      const deps = makeDeps({ input: '' });
      const { result } = renderHook(() => useGuidSend(deps));
      expect(result.current.isButtonDisabled).toBe(true);
    });

    it('is true when input is whitespace only', () => {
      const deps = makeDeps({ input: '   ' });
      const { result } = renderHook(() => useGuidSend(deps));
      expect(result.current.isButtonDisabled).toBe(true);
    });

    it('is false when input has content', () => {
      const deps = makeDeps({ input: 'hello' });
      const { result } = renderHook(() => useGuidSend(deps));
      expect(result.current.isButtonDisabled).toBe(false);
    });
  });
});
