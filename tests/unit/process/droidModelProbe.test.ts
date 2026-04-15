/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const createSessionMock = vi.hoisted(() => vi.fn());
const mainLogMock = vi.hoisted(() => vi.fn());
const mainWarnMock = vi.hoisted(() => vi.fn());

vi.mock('@factory/droid-sdk', () => ({
  createSession: createSessionMock,
}));

vi.mock('@process/utils/shellEnv', () => ({
  getEnhancedEnv: () => ({ TEST_ENV: '1' }),
}));

vi.mock('@process/utils/mainLogger', () => ({
  mainLog: mainLogMock,
  mainWarn: mainWarnMock,
}));

vi.mock('@process/agent/droid/cliRuntime', () => ({
  resolveWorkingDroidCli: vi.fn((execPath?: string | null) => ({
    execPath: execPath || 'droid',
    cliPath: execPath || 'droid',
    source: 'system',
    version: '1.0.0',
  })),
}));

import { mapDroidAvailableModelToFactoryModel, probeDroidModelCatalog } from '@/process/agent/droid/modelProbe';

describe('probeDroidModelCatalog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps probed Droid models into the internal catalog format', async () => {
    const closeMock = vi.fn().mockResolvedValue(undefined);
    createSessionMock.mockResolvedValue({
      initResult: {
        availableModels: [
          {
            id: 'glm-5',
            displayName: 'Droid Core (GLM-5)',
            supportedReasoningEfforts: ['dynamic'],
            defaultReasoningEffort: 'dynamic',
          },
          {
            id: 'claude-opus-4-6-fast',
            displayName: 'Claude Opus 4.6 Fast',
            supportedReasoningEfforts: ['off', 'high'],
            defaultReasoningEffort: 'high',
          },
        ],
      },
      close: closeMock,
    });

    const catalog = await probeDroidModelCatalog({
      cwd: '/tmp/project',
      execPath: '/usr/local/bin/droid',
    });

    expect(createSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/tmp/project',
        execPath: '/usr/local/bin/droid',
        env: { TEST_ENV: '1' },
        machineId: 'aionui-droid-model-probe',
      })
    );
    expect(catalog).toEqual([
      {
        id: 'glm-5',
        name: 'Droid Core (GLM-5)',
        reasoningLevels: ['none'],
        defaultReasoning: 'none',
      },
      {
        id: 'claude-opus-4-6-fast',
        name: 'Claude Opus 4.6 Fast',
        reasoningLevels: ['off', 'high'],
        defaultReasoning: 'high',
      },
    ]);
    expect(closeMock).toHaveBeenCalledTimes(1);
    expect(mainLogMock).toHaveBeenCalled();
  });

  it('returns null when probing the Droid catalog fails', async () => {
    createSessionMock.mockRejectedValue(new Error('probe failed'));

    await expect(
      probeDroidModelCatalog({
        cwd: '/tmp/project',
      })
    ).resolves.toBeNull();

    expect(mainWarnMock).toHaveBeenCalled();
  });

  it('maps dynamic reasoning effort to the UI none level', () => {
    expect(
      mapDroidAvailableModelToFactoryModel({
        id: 'kimi-k2.5',
        displayName: 'Droid Core (Kimi K2.5)',
        supportedReasoningEfforts: ['dynamic'],
        defaultReasoningEffort: 'dynamic',
      } as Parameters<typeof mapDroidAvailableModelToFactoryModel>[0])
    ).toEqual({
      id: 'kimi-k2.5',
      name: 'Droid Core (Kimi K2.5)',
      reasoningLevels: ['none'],
      defaultReasoning: 'none',
    });
  });

  it('preserves custom model metadata from the Droid SDK catalog', () => {
    expect(
      mapDroidAvailableModelToFactoryModel({
        id: 'custom-claude-sonnet-4-6',
        modelId: 'claude-sonnet-4-6',
        displayName: 'Claude Sonnet 4.6 [BYOK]',
        modelProvider: 'anthropic',
        isCustom: true,
        supportedReasoningEfforts: ['high'],
        defaultReasoningEffort: 'high',
      } as Parameters<typeof mapDroidAvailableModelToFactoryModel>[0])
    ).toEqual({
      id: 'custom-claude-sonnet-4-6',
      name: 'Claude Sonnet 4.6 [BYOK]',
      sourceModelId: 'claude-sonnet-4-6',
      modelProvider: 'anthropic',
      isCustom: true,
      reasoningLevels: ['high'],
      defaultReasoning: 'high',
    });
  });
});
