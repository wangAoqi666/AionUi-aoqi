/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const createSessionMock = vi.hoisted(() => vi.fn());
const getEnhancedEnvMock = vi.hoisted(() => vi.fn(() => ({ TEST_ENV: '1' })));
const mainLogMock = vi.hoisted(() => vi.fn());
const mainWarnMock = vi.hoisted(() => vi.fn());
const resolveWorkingDroidCliMock = vi.hoisted(() =>
  vi.fn((execPath?: string | null) => ({
    execPath: execPath || 'droid',
    cliPath: execPath || 'droid',
    source: 'system',
    version: '1.0.0',
  }))
);

vi.mock('@factory/droid-sdk', () => ({
  createSession: createSessionMock,
  FACTORY_PROTOCOL_VERSION: '2026-04-24',
}));

vi.mock('@process/utils/shellEnv', () => ({
  getEnhancedEnv: getEnhancedEnvMock,
}));

vi.mock('@process/utils/mainLogger', () => ({
  mainLog: mainLogMock,
  mainWarn: mainWarnMock,
}));

vi.mock('@process/agent/droid/cliRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@process/agent/droid/cliRuntime')>();
  return {
    ...actual,
    resolveWorkingDroidCli: resolveWorkingDroidCliMock,
  };
});

import {
  mapDroidAvailableModelToFactoryModel,
  probeDroidModelCatalog,
  probeDroidStatus,
} from '@/process/agent/droid/modelProbe';

describe('probeDroidModelCatalog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEnhancedEnvMock.mockReturnValue({ TEST_ENV: '1' });
    resolveWorkingDroidCliMock.mockReset();
    resolveWorkingDroidCliMock.mockImplementation((execPath?: string | null) => ({
      execPath: execPath || 'droid',
      cliPath: execPath || 'droid',
      source: 'system',
      version: '1.0.0',
    }));
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
    expect(getEnhancedEnvMock).toHaveBeenCalledWith(undefined, {
      includeBundledDroidInPath: false,
    });
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

  it('tail-merges SDK stream-jsonrpc args onto the resolver execArgs prefix when probing the catalog', async () => {
    // Regression guard: `@factory/droid-sdk`'s ProcessTransport FULLY overrides
    // its DEFAULT_EXEC_ARGS when the caller passes any truthy execArgs. If we
    // only hand over the `['<js-entrypoint>']` launch prefix, droid spawns
    // without `exec --input-format stream-jsonrpc --output-format stream-jsonrpc`
    // and starts its interactive TUI instead, deadlocking
    // `droid.initialize_session` for 60 s on every BYOK verification. The
    // composeSdkExecArgs helper tail-merges the 5 canonical SDK args so the
    // spawned process actually speaks the JSON-RPC stream protocol.
    const closeMock = vi.fn().mockResolvedValue(undefined);
    resolveWorkingDroidCliMock.mockReturnValue({
      execPath: 'node',
      execArgs: ['/Users/test/AppData/Roaming/npm/node_modules/@factory/cli/bin/droid'],
      cliPath: null,
      source: 'system',
      version: '1.2.3',
    });
    createSessionMock.mockResolvedValue({
      initResult: {
        availableModels: [],
      },
      close: closeMock,
    });

    await probeDroidModelCatalog({
      cwd: '/tmp/project',
    });

    expect(createSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        execPath: 'node',
        execArgs: [
          '/Users/test/AppData/Roaming/npm/node_modules/@factory/cli/bin/droid',
          'exec',
          '--input-format',
          'stream-jsonrpc',
          '--output-format',
          'stream-jsonrpc',
        ],
      })
    );
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it('keeps execArgs undefined when the resolver returns a native binary (Linux/Mac path) so the SDK uses its own DEFAULT_EXEC_ARGS', async () => {
    // On Linux/Mac the resolver returns `{ execPath: '/usr/bin/droid' }` with
    // no execArgs. Forcing an explicit execArgs would override the SDK's
    // DEFAULT_EXEC_ARGS and accidentally break the POSIX path that already
    // works. composeSdkExecArgs returns `undefined` for an empty prefix so
    // the SDK fallback stays intact.
    const closeMock = vi.fn().mockResolvedValue(undefined);
    resolveWorkingDroidCliMock.mockReturnValue({
      execPath: '/opt/homebrew/bin/droid',
      cliPath: '/opt/homebrew/bin/droid',
      source: 'system',
      version: '1.2.3',
    });
    createSessionMock.mockResolvedValue({
      initResult: {
        availableModels: [],
      },
      close: closeMock,
    });

    await probeDroidModelCatalog({
      cwd: '/tmp/project',
    });

    const callOptions = createSessionMock.mock.calls[0][0] as { execArgs?: string[] };
    expect(callOptions.execArgs).toBeUndefined();
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it('tail-merges SDK stream-jsonrpc args when probing status through a node shim', async () => {
    const closeMock = vi.fn().mockResolvedValue(undefined);
    resolveWorkingDroidCliMock.mockReturnValue({
      execPath: 'node',
      execArgs: ['/Users/test/AppData/Roaming/npm/node_modules/@factory/cli/bin/droid'],
      cliPath: null,
      source: 'system',
      version: '1.2.3',
    });
    createSessionMock.mockResolvedValue({
      initResult: {
        availableModels: [{ id: 'glm-5' }],
      },
      close: closeMock,
    });

    await expect(
      probeDroidStatus({
        cwd: '/tmp/project',
      })
    ).resolves.toMatchObject({
      available: true,
      loginStatus: 'authenticated',
      modelCount: 1,
      cliSource: 'system',
      cliVersion: '1.2.3',
    });

    expect(createSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        execPath: 'node',
        execArgs: [
          '/Users/test/AppData/Roaming/npm/node_modules/@factory/cli/bin/droid',
          'exec',
          '--input-format',
          'stream-jsonrpc',
          '--output-format',
          'stream-jsonrpc',
        ],
        env: { TEST_ENV: '1' },
        machineId: 'agent-factory-droid-status-probe',
      })
    );
    expect(getEnhancedEnvMock).toHaveBeenCalledWith(undefined, {
      includeBundledDroidInPath: false,
    });
    expect(closeMock).toHaveBeenCalledTimes(1);
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

  it('treats a Windows version timeout as a soft preflight and still probes the catalog through the SDK', async () => {
    const closeMock = vi.fn().mockResolvedValue(undefined);
    resolveWorkingDroidCliMock.mockReturnValue({
      execPath: 'node',
      execArgs: ['C:/Users/test/AppData/Roaming/npm/node_modules/droid/bin/droid'],
      cliPath: null,
      source: 'system',
      version: null,
      error: 'spawnSync node ETIMEDOUT',
      diagnostic: {
        code: 'probe-timeout',
        stage: 'preflight',
        detail: 'spawnSync node ETIMEDOUT',
      },
    });
    createSessionMock.mockResolvedValue({
      initResult: {
        availableModels: [
          {
            id: 'custom:Claude Sonnet 4.6 [BYOK]',
            modelId: 'claude-sonnet-4-6',
            modelProvider: 'anthropic',
            displayName: 'Claude Sonnet 4.6 [BYOK]',
            isCustom: true,
            supportedReasoningEfforts: ['high'],
            defaultReasoningEffort: 'high',
          },
        ],
      },
      close: closeMock,
    });

    await expect(
      probeDroidModelCatalog({
        cwd: '/tmp/project',
      })
    ).resolves.toEqual([
      {
        id: 'custom:Claude Sonnet 4.6 [BYOK]',
        name: 'Claude Sonnet 4.6 [BYOK]',
        sourceModelId: 'claude-sonnet-4-6',
        modelProvider: 'anthropic',
        isCustom: true,
        reasoningLevels: ['high'],
        defaultReasoning: 'high',
      },
    ]);

    expect(createSessionMock).toHaveBeenCalledTimes(1);
    expect(mainWarnMock).toHaveBeenCalledWith(
      '[DroidModelProbe]',
      'Droid model probe version preflight timed out; continuing with SDK session spawn',
      expect.objectContaining({
        diagnosticCode: 'probe-timeout',
      })
    );
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it('treats a Windows version timeout as a soft preflight when probing status', async () => {
    const closeMock = vi.fn().mockResolvedValue(undefined);
    resolveWorkingDroidCliMock.mockReturnValue({
      execPath: 'node',
      execArgs: ['C:/Users/test/AppData/Roaming/npm/node_modules/droid/bin/droid'],
      cliPath: null,
      source: 'system',
      version: null,
      error: 'spawnSync node ETIMEDOUT',
      diagnostic: {
        code: 'probe-timeout',
        stage: 'preflight',
        detail: 'spawnSync node ETIMEDOUT',
      },
    });
    createSessionMock.mockResolvedValue({
      initResult: {
        availableModels: [{ id: 'glm-5' }],
      },
      close: closeMock,
    });

    await expect(
      probeDroidStatus({
        cwd: '/tmp/project',
      })
    ).resolves.toMatchObject({
      available: true,
      loginStatus: 'authenticated',
      modelCount: 1,
      cliSource: 'system',
      cliVersion: null,
    });

    expect(createSessionMock).toHaveBeenCalledTimes(1);
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it('refuses to start a catalog session when the resolver only has a cmd.exe shell wrapper (pipeCompatible=false)', async () => {
    // The v0.108.0 tester regression: cmd.exe /c droid.cmd answers --version
    // but the SDK's `droid.initialize_session` hangs 60s on the cmd.exe
    // shell layer. The probe must abort early without touching createSession.
    resolveWorkingDroidCliMock.mockReturnValue({
      execPath: 'cmd.exe',
      execArgs: ['/d', '/s', '/c', 'C:/Users/qwq/AppData/Roaming/npm/droid.cmd'],
      cliPath: null,
      source: 'system',
      version: '0.108.0',
      pipeCompatible: false,
    });

    await expect(
      probeDroidModelCatalog({
        cwd: '/tmp/project',
      })
    ).resolves.toBeNull();

    expect(createSessionMock).not.toHaveBeenCalled();
    expect(mainWarnMock).toHaveBeenCalled();
  });

  it('surfaces a clear status error instead of silently hanging when only a cmd.exe shell wrapper is available', async () => {
    resolveWorkingDroidCliMock.mockReturnValue({
      execPath: 'cmd.exe',
      execArgs: ['/d', '/s', '/c', 'C:/Users/qwq/AppData/Roaming/npm/droid.cmd'],
      cliPath: null,
      source: 'system',
      version: '0.108.0',
      pipeCompatible: false,
    });

    const status = await probeDroidStatus({
      cwd: '/tmp/project',
    });

    expect(status).toMatchObject({
      available: false,
      loginStatus: 'unavailable',
      modelCount: 0,
      cliVersion: '0.108.0',
    });
    expect(status.error).toBeTruthy();
    expect(status.error).toContain('cmd.exe');
    expect(createSessionMock).not.toHaveBeenCalled();
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
