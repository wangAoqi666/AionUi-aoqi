/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { AcpBackendConfig, AcpModelInfo, AvailableAgent } from '../../src/renderer/pages/guid/types';
import type { IProvider } from '../../src/common/config/storage';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const configStorageMock = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn().mockResolvedValue(undefined),
}));

const ipcMock = vi.hoisted(() => ({
  getAvailableAgents: vi.fn(),
  probeModelInfo: vi.fn(),
  refreshCustomAgents: vi.fn().mockResolvedValue(undefined),
  getCustomAgents: vi.fn(),
  getAssistants: vi.fn(),
  remoteAgentList: vi.fn().mockResolvedValue([]),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../../src/common', () => ({
  ipcBridge: {
    acpConversation: {
      getAvailableAgents: { invoke: ipcMock.getAvailableAgents },
      probeModelInfo: { invoke: ipcMock.probeModelInfo },
      refreshCustomAgents: { invoke: ipcMock.refreshCustomAgents },
    },
    extensions: {
      getAssistants: { invoke: ipcMock.getAssistants },
    },
    remoteAgent: {
      list: { invoke: ipcMock.remoteAgentList },
    },
  },
}));

vi.mock('../../src/common/config/storage', () => ({
  ConfigStorage: configStorageMock,
}));

vi.mock('../../src/common/config/presets/assistantPresets', () => ({
  ASSISTANT_PRESETS: [],
}));

vi.mock('../../src/common/types/codex/codexModels', () => ({
  DEFAULT_CODEX_MODELS: [],
}));

let swrData: Record<string, unknown> = {};

function resetSwrCache() {
  swrData = {};
}

vi.mock('swr', () => ({
  default: (key: string, fetcher: () => Promise<unknown>) => {
    if (!(key in swrData)) {
      swrData[key] = undefined;
      fetcher()
        .then((data) => {
          swrData[key] = data;
        })
        .catch(() => {});
    }
    return { data: swrData[key], error: undefined, mutate: vi.fn() };
  },
  mutate: vi.fn(),
}));

vi.mock('../../src/renderer/utils/model/agentModes', () => ({
  getAgentModes: (backend?: string) => {
    if (backend === 'claude') {
      return [
        { value: 'default', label: 'Default' },
        { value: 'bypassPermissions', label: 'Bypass Permissions' },
      ];
    }
    return [
      { value: 'default', label: 'Default' },
      { value: 'yolo', label: 'YOLO' },
    ];
  },
  supportsModeSwitch: () => true,
}));

import { useGuidAgentSelection } from '../../src/renderer/pages/guid/hooks/useGuidAgentSelection';
import { resetDroidModelCatalog, setDroidModelCatalog, type FactoryModel } from '../../src/common/config/factoryModels';

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const PRESET_AGENT_ID = 'cowork';

const AVAILABLE_AGENTS: AvailableAgent[] = [
  { backend: 'gemini', name: 'Gemini' },
  { backend: 'claude', name: 'Claude' },
  { backend: 'custom', name: 'Cowork Assistant', customAgentId: PRESET_AGENT_ID, isPreset: true },
];

const CUSTOM_AGENTS: AcpBackendConfig[] = [
  {
    id: PRESET_AGENT_ID,
    name: 'Cowork Assistant',
    isPreset: true,
    enabled: true,
    presetAgentType: 'claude',
  } as AcpBackendConfig,
];

const CLAUDE_CACHED_MODEL: AcpModelInfo = {
  source: 'models',
  currentModelId: 'claude-sonnet-4-5-20250514',
  currentModelLabel: 'Claude Sonnet 4.5',
  availableModels: [
    { id: 'claude-sonnet-4-5-20250514', label: 'Claude Sonnet 4.5' },
    { id: 'claude-opus-4-5-20250514', label: 'Claude Opus 4.5' },
  ],
  canSwitch: true,
};

const DROID_CACHED_MODEL: AcpModelInfo = {
  source: 'models',
  currentModelId: 'gpt-5.4',
  currentModelLabel: 'GPT-5.4',
  availableModels: [
    { id: 'gpt-5.4', label: 'GPT-5.4' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  ],
  canSwitch: true,
};

const MODEL_LIST: IProvider[] = [
  {
    id: 'p1',
    name: 'Test Provider',
    platform: 'openai',
    baseUrl: '',
    apiKey: 'k',
    model: ['gpt-4'],
  } as IProvider,
];

const RUNTIME_DROID_MODELS: FactoryModel[] = [
  {
    id: 'claude-opus-4-6-fast',
    name: 'Claude Opus 4.6 Fast',
    reasoningLevels: ['off', 'low', 'medium', 'high'],
    defaultReasoning: 'high',
  },
  {
    id: 'gpt-5.4-fast',
    name: 'GPT-5.4 Fast',
    reasoningLevels: ['low', 'medium', 'high', 'xhigh'],
    defaultReasoning: 'medium',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupMocks(overrides?: {
  cachedModels?: Record<string, AcpModelInfo>;
  acpConfig?: Record<string, unknown>;
  geminiConfig?: Record<string, unknown>;
  availableAgents?: AvailableAgent[];
}) {
  const cachedModels = overrides?.cachedModels ?? { claude: CLAUDE_CACHED_MODEL };
  const acpConfig = overrides?.acpConfig ?? { claude: { preferredMode: 'bypassPermissions' } };
  const geminiConfig = overrides?.geminiConfig ?? {};
  const availableAgents = overrides?.availableAgents ?? AVAILABLE_AGENTS;

  ipcMock.getAvailableAgents.mockResolvedValue({ success: true, data: availableAgents });
  ipcMock.probeModelInfo.mockResolvedValue({ success: false });
  ipcMock.getAssistants.mockResolvedValue([]);

  configStorageMock.get.mockImplementation(async (key: string) => {
    switch (key) {
      case 'acp.cachedModels':
        return cachedModels;
      case 'acp.customAgents':
        return CUSTOM_AGENTS;
      case 'guid.lastSelectedAgent':
        return null;
      case 'acp.config':
        return acpConfig;
      case 'gemini.config':
        return geminiConfig;
      case 'gemini.defaultModel':
        return null;
      default:
        return null;
    }
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useGuidAgentSelection – preset agent config resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSwrCache();
    resetDroidModelCatalog();
    setupMocks();
  });

  const hookOptions = {
    modelList: MODEL_LIST,
    isGoogleAuth: false,
    localeKey: 'en-US',
  };

  it('currentAcpCachedModelInfo uses effective backend type for preset agent', async () => {
    const { result } = renderHook(() => useGuidAgentSelection(hookOptions));

    // Wait for initial data to load (availableAgents + cachedModels)
    await waitFor(() => {
      expect(result.current.availableAgents).toBeDefined();
    });

    // Select the preset agent
    act(() => {
      result.current.setSelectedAgentKey(`custom:${PRESET_AGENT_ID}`);
    });

    // Verify effective agent type resolves to 'claude' (via presetAgentType)
    await waitFor(() => {
      expect(result.current.isPresetAgent).toBe(true);
      expect(result.current.currentEffectiveAgentInfo.agentType).toBe('claude');
    });

    // Key assertion: cached model info should look up 'claude' key, not 'custom'
    expect(result.current.currentAcpCachedModelInfo).not.toBeNull();
    expect(result.current.currentAcpCachedModelInfo?.currentModelId).toBe('claude-sonnet-4-5-20250514');
    expect(result.current.currentAcpCachedModelInfo?.availableModels).toHaveLength(2);
  });

  it('currentAcpCachedModelInfo returns null when cached models have no entry for effective backend', async () => {
    setupMocks({ cachedModels: { codex: CLAUDE_CACHED_MODEL } });

    const { result } = renderHook(() => useGuidAgentSelection(hookOptions));

    await waitFor(() => {
      expect(result.current.availableAgents).toBeDefined();
    });

    act(() => {
      result.current.setSelectedAgentKey(`custom:${PRESET_AGENT_ID}`);
    });

    await waitFor(() => {
      expect(result.current.isPresetAgent).toBe(true);
    });

    // Preset maps to 'claude', but cache only has 'codex'
    expect(result.current.currentAcpCachedModelInfo).toBeNull();
  });

  it('selectedMode loads preferred mode from effective backend config', async () => {
    setupMocks({
      acpConfig: {
        claude: { preferredMode: 'bypassPermissions' },
      },
    });

    const { result } = renderHook(() => useGuidAgentSelection(hookOptions));

    await waitFor(() => {
      expect(result.current.availableAgents).toBeDefined();
    });

    act(() => {
      result.current.setSelectedAgentKey(`custom:${PRESET_AGENT_ID}`);
    });

    // Mode should load from acp.config.claude.preferredMode
    await waitFor(() => {
      expect(result.current.selectedMode).toBe('bypassPermissions');
    });
  });

  it('selectedMode defaults to "default" when no preferred mode is saved', async () => {
    setupMocks({ acpConfig: {} });

    const { result } = renderHook(() => useGuidAgentSelection(hookOptions));

    await waitFor(() => {
      expect(result.current.availableAgents).toBeDefined();
    });

    act(() => {
      result.current.setSelectedAgentKey(`custom:${PRESET_AGENT_ID}`);
    });

    // Wait a tick for mode loading effect
    await waitFor(() => {
      expect(result.current.isPresetAgent).toBe(true);
    });

    expect(result.current.selectedMode).toBe('default');
  });

  it('non-preset agent uses its own key for model cache lookup', async () => {
    const { result } = renderHook(() => useGuidAgentSelection(hookOptions));

    await waitFor(() => {
      expect(result.current.availableAgents).toBeDefined();
    });

    // Select claude directly from pill bar (non-preset)
    act(() => {
      result.current.setSelectedAgentKey('claude');
    });

    await waitFor(() => {
      expect(result.current.isPresetAgent).toBe(false);
      expect(result.current.selectedAgent).toBe('claude');
    });

    // Should look up acpCachedModels['claude']
    expect(result.current.currentAcpCachedModelInfo).not.toBeNull();
    expect(result.current.currentAcpCachedModelInfo?.currentModelId).toBe('claude-sonnet-4-5-20250514');
  });

  it('setSelectedMode saves mode under effective backend for preset agent', async () => {
    const { result } = renderHook(() => useGuidAgentSelection(hookOptions));

    await waitFor(() => {
      expect(result.current.availableAgents).toBeDefined();
    });

    act(() => {
      result.current.setSelectedAgentKey(`custom:${PRESET_AGENT_ID}`);
    });

    await waitFor(() => {
      expect(result.current.isPresetAgent).toBe(true);
    });

    // Clear mocks to only capture the mode save call
    configStorageMock.get.mockClear();
    configStorageMock.set.mockClear();
    configStorageMock.get.mockResolvedValue({});

    act(() => {
      result.current.setSelectedMode('bypassPermissions');
    });

    // savePreferredMode should be called with 'claude' (effective type), not 'custom'
    await waitFor(() => {
      const setCalls = configStorageMock.set.mock.calls;
      const acpConfigCall = setCalls.find(([key]: [string]) => key === 'acp.config');
      expect(acpConfigCall).toBeDefined();
      // Should save under the 'claude' key, not 'custom'
      const savedConfig = acpConfigCall?.[1] as Record<string, unknown>;
      expect(savedConfig).toHaveProperty('claude');
      expect((savedConfig.claude as Record<string, unknown>).preferredMode).toBe('bypassPermissions');
    });
  });

  it('uses the refreshed droid catalog for droid model options', async () => {
    setDroidModelCatalog(RUNTIME_DROID_MODELS);
    setupMocks({
      availableAgents: [{ backend: 'droid', name: 'Factory Droid' }],
      cachedModels: {
        droid: {
          ...DROID_CACHED_MODEL,
          currentModelId: 'claude-opus-4-6-fast',
          currentModelLabel: 'Claude Opus 4.6 Fast',
        },
      },
      acpConfig: {
        droid: { preferredModelId: 'claude-opus-4-6-fast' },
      },
    });

    const { result } = renderHook(() => useGuidAgentSelection(hookOptions));

    await waitFor(() => {
      expect(result.current.selectedAgentKey).toBe('droid');
      expect(result.current.selectedAcpModel).toBe('claude-opus-4-6-fast');
    });

    expect(result.current.currentAcpCachedModelInfo?.availableModels).toEqual([
      { id: 'claude-opus-4-6-fast', label: 'Claude Opus 4.6 Fast' },
      { id: 'gpt-5.4-fast', label: 'GPT-5.4 Fast' },
    ]);
  });

  it('falls back to a valid droid model when the saved preference is no longer in the refreshed catalog', async () => {
    setDroidModelCatalog(RUNTIME_DROID_MODELS);
    setupMocks({
      availableAgents: [{ backend: 'droid', name: 'Factory Droid' }],
      cachedModels: {
        droid: {
          ...DROID_CACHED_MODEL,
          currentModelId: 'removed-cached-model',
          currentModelLabel: 'Removed Cached Model',
        },
      },
      acpConfig: {
        droid: { preferredModelId: 'removed-preferred-model' },
      },
    });

    const { result } = renderHook(() => useGuidAgentSelection(hookOptions));

    await waitFor(() => {
      expect(result.current.selectedAgentKey).toBe('droid');
      expect(result.current.selectedAcpModel).toBe('claude-opus-4-6-fast');
    });

    await waitFor(() => {
      const acpConfigCall = configStorageMock.set.mock.calls.find(
        ([key, value]: [string, unknown]) =>
          key === 'acp.config' &&
          (value as { droid?: { preferredModelId?: string } })?.droid?.preferredModelId === 'claude-opus-4-6-fast'
      );
      expect(acpConfigCall).toBeDefined();
    });
  });

  it('sanitizes and persists incompatible droid spec settings after loading saved preferences', async () => {
    setupMocks({
      availableAgents: [{ backend: 'droid', name: 'Factory Droid' }],
      cachedModels: { droid: DROID_CACHED_MODEL },
      acpConfig: {
        droid: {
          preferredModelId: 'gpt-5.4',
          specModeModelId: 'claude-sonnet-4-6',
          specModeReasoningEffort: 'low',
        },
      },
    });

    const { result } = renderHook(() => useGuidAgentSelection(hookOptions));

    await waitFor(() => {
      expect(result.current.selectedAgentKey).toBe('droid');
      expect(result.current.selectedAcpModel).toBe('gpt-5.4');
    });

    await waitFor(() => {
      expect(result.current.pendingConfigOptions).toEqual({});
    });

    await waitFor(() => {
      const acpConfigCall = configStorageMock.set.mock.calls.find(([key]: [string]) => key === 'acp.config');
      expect(acpConfigCall).toBeDefined();
      expect(acpConfigCall?.[1]).toEqual({
        droid: {
          preferredModelId: 'gpt-5.4',
        },
      });
    });
  });
});
