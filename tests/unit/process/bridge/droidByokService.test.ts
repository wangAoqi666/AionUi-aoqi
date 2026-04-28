/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockReadFile, mockWriteFile, mockMkdir, mockProcessConfigGet, mockProcessConfigSet, mockGetFactoryRootDir } =
  vi.hoisted(() => ({
    mockReadFile: vi.fn(),
    mockWriteFile: vi.fn(),
    mockMkdir: vi.fn(),
    mockProcessConfigGet: vi.fn(),
    mockProcessConfigSet: vi.fn(),
    mockGetFactoryRootDir: vi.fn(() => '/mock/.factory'),
  }));

vi.mock('node:fs/promises', () => ({
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
}));

vi.mock('@process/utils/initStorage', () => ({
  ProcessConfig: {
    get: mockProcessConfigGet,
    set: mockProcessConfigSet,
  },
  getFactoryRootDir: mockGetFactoryRootDir,
}));

import {
  fetchDroidByokModels,
  getDroidByokConfigs,
  importDroidByokConfigs,
  removeDroidByokConfig,
  saveDroidByokConfig,
  testDroidByokConfig,
} from '@/process/bridge/services/DroidByokService';

type FactorySettings = {
  customModels?: Array<Record<string, unknown>>;
};

const mockJsonResponse = (body: unknown, ok = true): Response =>
  ({
    ok,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as Response;

describe('DroidByokService', () => {
  let settingsFile: FactorySettings | undefined;
  let processConfigValue: Record<string, unknown>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    settingsFile = undefined;
    processConfigValue = {};
    fetchMock = vi.fn();

    mockReadFile.mockImplementation(async () => {
      if (settingsFile === undefined) {
        const error = new Error('ENOENT') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      }
      return JSON.stringify(settingsFile);
    });

    mockWriteFile.mockImplementation(async (_filePath: string, content: string) => {
      settingsFile = JSON.parse(content) as FactorySettings;
    });

    mockMkdir.mockResolvedValue(undefined);

    mockProcessConfigGet.mockImplementation(async (key: string) => {
      if (key === 'acp.config') {
        return processConfigValue;
      }
      return undefined;
    });

    mockProcessConfigSet.mockImplementation(async (key: string, value: Record<string, unknown>) => {
      if (key === 'acp.config') {
        processConfigValue = value;
      }
    });

    vi.stubGlobal('fetch', fetchMock);
  });

  it('returns managed BYOK configs from settings.local.json', async () => {
    settingsFile = {
      customModels: [
        {
          model: 'other-model',
          displayName: 'Other',
          baseUrl: 'https://other.example.com',
          apiKey: 'other-key',
          provider: 'anthropic',
        },
        {
          model: 'claude-sonnet-4-6',
          displayName: 'Claude Sonnet 4.6 [BYOK]',
          baseUrl: 'https://api.example.com',
          apiKey: 'sk-test',
          provider: 'anthropic',
          maxOutputTokens: 8192,
        },
      ],
    };
    processConfigValue = {
      droid: {
        byokModelRef: {
          model: 'claude-sonnet-4-6',
          baseUrl: 'https://api.example.com',
          provider: 'anthropic',
        },
      },
    };

    // M3.B: capability fields are now always populated (inferred from model id
    // when the stored entry lacks them).
    await expect(getDroidByokConfigs()).resolves.toEqual([
      {
        id: expect.any(String),
        model: 'claude-sonnet-4-6',
        displayName: 'Claude Sonnet 4.6 [BYOK]',
        baseUrl: 'https://api.example.com',
        apiKey: 'sk-test',
        provider: 'anthropic',
        maxOutputTokens: 8192,
        supportsImageInput: true,
        reasoningLevels: ['off', 'low', 'medium', 'high'],
        defaultReasoning: 'off',
      },
    ]);
    expect(processConfigValue).toEqual({
      droid: {
        byokModelRefs: [
          {
            id: expect.any(String),
            model: 'claude-sonnet-4-6',
            baseUrl: 'https://api.example.com',
            provider: 'anthropic',
          },
        ],
      },
    });
  });

  it('fetches remote models, infers providers, and caches the catalog', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/v1/models')) {
        return mockJsonResponse({
          data: [
            { id: 'gpt-5.4', supported_endpoint_types: ['openai', 'openai-response'] },
            { id: 'claude-sonnet-4-6', supported_endpoint_types: ['anthropic'] },
          ],
        });
      }

      return mockJsonResponse({ error: { message: 'Not Found' } }, false);
    });

    const first = await fetchDroidByokModels({
      baseUrl: 'https://gateway.example.com/v1/models',
      apiKey: 'sk-test',
    });
    const second = await fetchDroidByokModels({
      baseUrl: 'https://gateway.example.com',
      apiKey: 'sk-test',
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://gateway.example.com/v1/models',
      expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://gateway.example.com/v1beta/models',
      expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://gateway.example.com/models',
      expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) })
    );
    expect(first).toEqual(second);
    expect(first.models).toEqual([
      {
        model: 'claude-sonnet-4-6',
        displayName: 'claude-sonnet-4-6 [BYOK]',
        supportedEndpointTypes: ['anthropic'],
        inferredProvider: 'anthropic',
      },
      {
        model: 'gpt-5.4',
        displayName: 'gpt-5.4 [BYOK]',
        supportedEndpointTypes: ['openai', 'openai-response'],
        inferredProvider: 'openai',
      },
    ]);
  });

  it('prefers explicit endpoint metadata over gemini-like model names', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/v1/models')) {
        return mockJsonResponse({
          data: [{ id: 'gemini-2.5-pro', supported_endpoint_types: ['openai'] }],
        });
      }

      return mockJsonResponse({ error: { message: 'Not Found' } }, false);
    });

    const result = await fetchDroidByokModels({
      baseUrl: 'https://gateway.example.com',
      apiKey: 'sk-test',
      refresh: true,
    });

    expect(result.models).toEqual([
      {
        model: 'gemini-2.5-pro',
        displayName: 'gemini-2.5-pro [BYOK]',
        supportedEndpointTypes: ['openai'],
        inferredProvider: 'generic-chat-completion-api',
      },
    ]);
  });

  it('returns the first non-empty catalog even when another endpoint resolves empty', async () => {
    // Previously the implementation first-resolve-wins race with 3 endpoints
    // meant an empty `[]` response from the fastest endpoint could mask the
    // real catalog. The loadRemoteCatalog helper now waits for all endpoints
    // via Promise.allSettled and prefers fulfilled responses with non-empty
    // models, so we simulate that scenario explicitly.
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/v1/models')) {
        // fastest, but returns empty
        return Promise.resolve(mockJsonResponse({ data: [] }));
      }
      if (url.endsWith('/v1beta/models')) {
        return Promise.resolve(
          mockJsonResponse({
            data: [{ id: 'gpt-5.4', supported_endpoint_types: ['openai'] }],
          })
        );
      }
      return Promise.resolve(mockJsonResponse({ error: { message: 'Not Found' } }, false));
    });

    const result = await fetchDroidByokModels({
      baseUrl: 'https://gateway.example.com',
      apiKey: 'sk-test',
      refresh: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.models).toEqual([
      {
        model: 'gpt-5.4',
        displayName: 'gpt-5.4 [BYOK]',
        supportedEndpointTypes: ['openai'],
        inferredProvider: 'openai',
      },
    ]);
  });

  it('falls back to the alternate remote model endpoint when the first one hangs', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/v1/models')) {
        return new Promise<Response>((_, reject) => {
          setTimeout(() => reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })), 0);
        });
      }
      if (url.endsWith('/v1beta/models')) {
        return Promise.resolve(
          mockJsonResponse({
            data: [{ id: 'gpt-5.4', supported_endpoint_types: ['openai'] }],
          })
        );
      }
      return Promise.resolve(mockJsonResponse({ error: { message: 'Not Found' } }, false));
    });

    const result = await fetchDroidByokModels({
      baseUrl: 'https://gateway.example.com',
      apiKey: 'sk-test',
      refresh: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.models).toEqual([
      {
        model: 'gpt-5.4',
        displayName: 'gpt-5.4 [BYOK]',
        supportedEndpointTypes: ['openai'],
        inferredProvider: 'openai',
      },
    ]);
  });

  it('returns a timeout error when remote model fetch hangs', async () => {
    fetchMock.mockImplementation(() =>
      Promise.reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }))
    );

    await expect(
      fetchDroidByokModels({
        baseUrl: 'https://gateway.example.com',
        apiKey: 'sk-test',
        refresh: true,
      })
    ).rejects.toThrow('Remote request timed out after 15 seconds');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://gateway.example.com/v1/models',
      expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://gateway.example.com/v1beta/models',
      expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://gateway.example.com/models',
      expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) })
    );
  });

  it('saves a normalized config and resolves the OpenAI provider by probing', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'resp_1' }),
    } as Response);

    const config = await saveDroidByokConfig({
      baseUrl: ' https://api.example.com/v1/responses ',
      apiKey: ' sk-test ',
      model: ' gpt-5.4 ',
      displayName: '',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/v1/responses',
      expect.objectContaining({ method: 'POST' })
    );
    expect(config).toEqual({
      id: expect.any(String),
      model: 'gpt-5.4',
      displayName: 'gpt-5.4 [BYOK]',
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      provider: 'openai',
      maxOutputTokens: 8192,
      // GPT-5 family: full reasoning + vision by heuristic.
      supportsImageInput: true,
      reasoningLevels: ['minimal', 'low', 'medium', 'high', 'xhigh'],
      defaultReasoning: 'medium',
    });
    expect(settingsFile).toEqual({
      customModels: [
        {
          model: 'gpt-5.4',
          displayName: 'gpt-5.4 [BYOK]',
          baseUrl: 'https://api.example.com/v1',
          apiKey: 'sk-test',
          provider: 'openai',
          maxOutputTokens: 8192,
          supportsImageInput: true,
          reasoningLevels: ['minimal', 'low', 'medium', 'high', 'xhigh'],
          defaultReasoning: 'medium',
        },
      ],
    });
    expect(processConfigValue).toEqual({
      droid: {
        byokModelRefs: [
          {
            id: config.id,
            model: 'gpt-5.4',
            baseUrl: 'https://api.example.com',
            provider: 'openai',
          },
        ],
      },
    });
  });

  it('supports multiple managed BYOK entries and removes only the targeted config', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ type: 'message' }),
    } as Response);

    const first = await saveDroidByokConfig({
      baseUrl: 'https://api.one.example.com',
      apiKey: 'sk-one',
      model: 'claude-sonnet-4-6',
      displayName: 'Claude One',
      provider: 'anthropic',
    });
    const second = await saveDroidByokConfig({
      baseUrl: 'https://api.two.example.com',
      apiKey: 'sk-two',
      model: 'claude-sonnet-4-6',
      displayName: 'Claude Two',
      provider: 'anthropic',
    });

    await expect(getDroidByokConfigs()).resolves.toEqual([first, second]);

    await removeDroidByokConfig(first.id);

    expect(settingsFile).toEqual({
      customModels: [
        {
          model: 'claude-sonnet-4-6',
          displayName: 'Claude Two',
          baseUrl: 'https://api.two.example.com',
          apiKey: 'sk-two',
          provider: 'anthropic',
          maxOutputTokens: 8192,
          supportsImageInput: true,
          reasoningLevels: ['off', 'low', 'medium', 'high'],
          defaultReasoning: 'off',
        },
      ],
    });
    expect(processConfigValue).toEqual({
      droid: {
        byokModelRefs: [
          {
            id: second.id,
            model: 'claude-sonnet-4-6',
            baseUrl: 'https://api.two.example.com',
            provider: 'anthropic',
          },
        ],
      },
    });
  });

  it('updates an existing managed BYOK config by id without duplicating entries', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ type: 'message' }),
    } as Response);

    const first = await saveDroidByokConfig({
      baseUrl: 'https://api.one.example.com',
      apiKey: 'sk-one',
      model: 'claude-sonnet-4-6',
      displayName: 'Claude One',
      provider: 'anthropic',
    });
    const second = await saveDroidByokConfig({
      baseUrl: 'https://api.two.example.com',
      apiKey: 'sk-two',
      model: 'claude-sonnet-4-6',
      displayName: 'Claude Two',
      provider: 'anthropic',
    });

    const updated = await saveDroidByokConfig({
      existingId: first.id,
      baseUrl: 'https://api.one-updated.example.com',
      apiKey: 'sk-one-updated',
      model: 'claude-sonnet-4-6',
      displayName: 'Claude One Updated',
      provider: 'anthropic',
    });

    expect(updated).toEqual({
      id: expect.any(String),
      model: 'claude-sonnet-4-6',
      displayName: 'Claude One Updated',
      baseUrl: 'https://api.one-updated.example.com',
      apiKey: 'sk-one-updated',
      provider: 'anthropic',
      maxOutputTokens: 8192,
      supportsImageInput: true,
      reasoningLevels: ['off', 'low', 'medium', 'high'],
      defaultReasoning: 'off',
    });
    expect(settingsFile).toEqual({
      customModels: [
        {
          model: 'claude-sonnet-4-6',
          displayName: 'Claude Two',
          baseUrl: 'https://api.two.example.com',
          apiKey: 'sk-two',
          provider: 'anthropic',
          maxOutputTokens: 8192,
          supportsImageInput: true,
          reasoningLevels: ['off', 'low', 'medium', 'high'],
          defaultReasoning: 'off',
        },
        {
          model: 'claude-sonnet-4-6',
          displayName: 'Claude One Updated',
          baseUrl: 'https://api.one-updated.example.com',
          apiKey: 'sk-one-updated',
          provider: 'anthropic',
          maxOutputTokens: 8192,
          supportsImageInput: true,
          reasoningLevels: ['off', 'low', 'medium', 'high'],
          defaultReasoning: 'off',
        },
      ],
    });
    expect(processConfigValue).toEqual({
      droid: {
        byokModelRefs: [
          {
            id: second.id,
            model: 'claude-sonnet-4-6',
            baseUrl: 'https://api.two.example.com',
            provider: 'anthropic',
          },
          {
            id: updated.id,
            model: 'claude-sonnet-4-6',
            baseUrl: 'https://api.one-updated.example.com',
            provider: 'anthropic',
          },
        ],
      },
    });
  });

  it('imports selected remote models and reports per-model failures', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith('/v1/models')) {
        return mockJsonResponse({
          data: [
            { id: 'claude-sonnet-4-6', supported_endpoint_types: ['anthropic'] },
            { id: 'gpt-5.4', supported_endpoint_types: ['openai', 'openai-response'] },
          ],
        });
      }

      if (url.endsWith('/v1beta/models') || url.endsWith('/models')) {
        return mockJsonResponse({ error: { message: 'Not Found' } }, false);
      }

      if (url.endsWith('/v1/messages')) {
        return mockJsonResponse({ type: 'message' });
      }

      if (url.endsWith('/v1/chat/completions')) {
        return mockJsonResponse({ error: { message: 'Unsupported' } }, false);
      }

      return mockJsonResponse({ error: { message: `Unexpected URL: ${url}` } }, false);
    });

    const result = await importDroidByokConfigs({
      baseUrl: 'https://gateway.example.com',
      apiKey: 'sk-test',
      models: [
        { model: 'claude-sonnet-4-6', displayName: 'Claude Imported' },
        { model: 'gpt-5.4', displayName: 'GPT Imported', provider: 'generic-chat-completion-api' },
      ],
    });

    expect(result.imported).toEqual([
      {
        id: expect.any(String),
        model: 'claude-sonnet-4-6',
        displayName: 'Claude Imported',
        baseUrl: 'https://gateway.example.com',
        apiKey: 'sk-test',
        provider: 'anthropic',
        maxOutputTokens: 8192,
        supportsImageInput: true,
        reasoningLevels: ['off', 'low', 'medium', 'high'],
        defaultReasoning: 'off',
      },
    ]);
    expect(result.failed).toEqual([{ model: 'gpt-5.4', reason: 'Unsupported' }]);
    expect(settingsFile).toEqual({
      customModels: [
        {
          model: 'claude-sonnet-4-6',
          displayName: 'Claude Imported',
          baseUrl: 'https://gateway.example.com',
          apiKey: 'sk-test',
          provider: 'anthropic',
          maxOutputTokens: 8192,
          supportsImageInput: true,
          reasoningLevels: ['off', 'low', 'medium', 'high'],
          defaultReasoning: 'off',
        },
      ],
    });
  });

  it('rejects legacy google provider, and saves Gemini endpoints via generic-chat-completion-api', async () => {
    // Step 1: legacy 'google' provider must be rejected by normalizeInputPayload
    await expect(
      saveDroidByokConfig({
        baseUrl: 'https://generativelanguage.googleapis.com',
        apiKey: 'gem-key',
        model: 'gemini-2.5-pro',
        provider: 'google' as unknown as 'anthropic',
      })
    ).rejects.toThrow(/Unsupported provider/i);

    // Step 2: Factory-official generic-chat-completion-api path, baseUrl gets
    // rewritten to Gemini's OpenAI-compat endpoint automatically
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    } as Response);

    const config = await saveDroidByokConfig({
      baseUrl: 'https://generativelanguage.googleapis.com',
      apiKey: 'gem-key',
      model: 'gemini-2.5-pro',
      provider: 'generic-chat-completion-api',
    });

    expect(config.provider).toBe('generic-chat-completion-api');
    expect(config.baseUrl).toMatch(/\/v1beta\/openai$/);
    expect(settingsFile?.customModels?.[0]).toMatchObject({
      provider: 'generic-chat-completion-api',
      baseUrl: expect.stringMatching(/\/v1beta\/openai$/),
    });
  });

  it('persists openai/generic baseUrl with /v1 suffix and keeps anthropic baseUrl untouched', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    } as Response);

    await saveDroidByokConfig({
      baseUrl: 'https://gateway.example.com',
      apiKey: 'sk-generic',
      model: 'qwen3-32b',
      provider: 'generic-chat-completion-api',
    });

    expect(settingsFile?.customModels?.[0]).toMatchObject({
      provider: 'generic-chat-completion-api',
      baseUrl: 'https://gateway.example.com/v1',
    });

    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ type: 'message' }),
    } as Response);

    await saveDroidByokConfig({
      baseUrl: 'https://gateway.example.com',
      apiKey: 'sk-anthropic',
      model: 'claude-sonnet-4-6',
      provider: 'anthropic',
    });

    const persistedAnthropic = settingsFile?.customModels?.find((m) => m.provider === 'anthropic');
    expect(persistedAnthropic).toMatchObject({
      baseUrl: 'https://gateway.example.com',
    });
  });

  it('falls back to /messages when /v1/messages is unavailable during connection test', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        headers: { get: () => 'application/json' },
        json: async () => ({ error: { message: 'Not Found' } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ type: 'message' }),
      } as Response);

    const result = await testDroidByokConfig({
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      displayName: '',
      provider: 'anthropic',
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.example.com/v1/messages',
      expect.objectContaining({ method: 'POST' })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.example.com/messages',
      expect.objectContaining({ method: 'POST' })
    );
    expect(result).toEqual({
      id: expect.any(String),
      model: 'claude-sonnet-4-6',
      displayName: 'claude-sonnet-4-6 [BYOK]',
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      provider: 'anthropic',
      maxOutputTokens: 8192,
      supportsImageInput: true,
      reasoningLevels: ['off', 'low', 'medium', 'high'],
      defaultReasoning: 'off',
    });
  });

  // =====================================================================
  // M3.B capability tests
  // =====================================================================

  it('honours user-supplied capability overrides during save', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ type: 'message' }),
    } as Response);

    const config = await saveDroidByokConfig({
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      provider: 'anthropic',
      supportsImageInput: false,
      reasoningLevels: ['off', 'medium'],
      defaultReasoning: 'medium',
    });

    expect(config.supportsImageInput).toBe(false);
    expect(config.reasoningLevels).toEqual(['off', 'medium']);
    expect(config.defaultReasoning).toBe('medium');

    const entry = settingsFile?.customModels?.[0] as Record<string, unknown>;
    expect(entry.supportsImageInput).toBe(false);
    expect(entry.reasoningLevels).toEqual(['off', 'medium']);
    expect(entry.defaultReasoning).toBe('medium');
  });

  it('clamps an invalid defaultReasoning to the first valid reasoning level', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ type: 'message' }),
    } as Response);

    const config = await saveDroidByokConfig({
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      provider: 'anthropic',
      reasoningLevels: ['off', 'low'],
      defaultReasoning: 'xhigh',
    });

    expect(config.reasoningLevels).toEqual(['off', 'low']);
    expect(config.defaultReasoning).toBe('off');
  });

  it('infers reasoning + vision capabilities for OpenAI o-series by default', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'resp_1' }),
    } as Response);

    const config = await saveDroidByokConfig({
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      model: 'o4-mini',
      provider: 'openai',
    });

    expect(config.supportsImageInput).toBe(true);
    expect(config.reasoningLevels).toEqual(['minimal', 'low', 'medium', 'high']);
    expect(config.defaultReasoning).toBe('medium');
  });

  it('infers non-multimodal, no-reasoning defaults for legacy text models', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    } as Response);

    const config = await saveDroidByokConfig({
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      model: 'gpt-3.5-turbo',
      provider: 'openai',
    });

    expect(config.supportsImageInput).toBe(false);
    expect(config.reasoningLevels).toEqual(['none']);
    expect(config.defaultReasoning).toBe('none');
  });

  it('rejects unknown reasoning levels while keeping valid ones', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ type: 'message' }),
    } as Response);

    const config = await saveDroidByokConfig({
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      provider: 'anthropic',
      // Include garbage values to ensure the sanitizer drops them.
      reasoningLevels: ['off', 'invalid' as unknown as 'off', 'low'],
      defaultReasoning: 'off',
    });

    expect(config.reasoningLevels).toEqual(['off', 'low']);
    expect(config.defaultReasoning).toBe('off');
  });

  it('auto-upgrades legacy customModels entries that lack capability fields', async () => {
    settingsFile = {
      customModels: [
        {
          model: 'gpt-4o',
          displayName: 'GPT-4o Legacy',
          baseUrl: 'https://api.example.com/v1',
          apiKey: 'sk-test',
          provider: 'openai',
          maxOutputTokens: 8192,
        },
      ],
    };
    processConfigValue = {
      droid: {
        byokModelRefs: [
          {
            id: 'legacy-id',
            model: 'gpt-4o',
            baseUrl: 'https://api.example.com',
            provider: 'openai',
          },
        ],
      },
    };

    const configs = await getDroidByokConfigs();
    expect(configs).toHaveLength(1);
    // gpt-4o family: multimodal, no reasoning knob.
    expect(configs[0].supportsImageInput).toBe(true);
    expect(configs[0].reasoningLevels).toEqual(['none']);
    expect(configs[0].defaultReasoning).toBe('none');
  });

  it('imports models with per-entry capability overrides without probing', async () => {
    const result = await importDroidByokConfigs({
      baseUrl: 'https://gateway.example.com',
      apiKey: 'sk-test',
      skipProbe: true,
      models: [
        {
          model: 'custom-reasoner-v1',
          provider: 'generic-chat-completion-api',
          supportsImageInput: true,
          reasoningLevels: ['off', 'high'],
          defaultReasoning: 'high',
        },
      ],
    });

    expect(result.failed).toEqual([]);
    expect(result.imported).toHaveLength(1);
    const imported = result.imported[0];
    expect(imported.supportsImageInput).toBe(true);
    expect(imported.reasoningLevels).toEqual(['off', 'high']);
    expect(imported.defaultReasoning).toBe('high');
    expect(imported.provider).toBe('generic-chat-completion-api');
  });
});
