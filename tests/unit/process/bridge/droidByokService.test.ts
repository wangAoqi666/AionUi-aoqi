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

    await expect(getDroidByokConfigs()).resolves.toEqual([
      {
        id: expect.any(String),
        model: 'claude-sonnet-4-6',
        displayName: 'Claude Sonnet 4.6 [BYOK]',
        baseUrl: 'https://api.example.com',
        apiKey: 'sk-test',
        provider: 'anthropic',
        maxOutputTokens: 8192,
      },
    ]);
  });

  it('fetches remote models, infers providers, and caches the catalog', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { id: 'gpt-5.4', supported_endpoint_types: ['openai', 'openai-response'] },
          { id: 'claude-sonnet-4-6', supported_endpoint_types: ['anthropic'] },
        ],
      }),
    } as Response);

    const first = await fetchDroidByokModels({
      baseUrl: 'https://gateway.example.com/v1/models',
      apiKey: 'sk-test',
    });
    const second = await fetchDroidByokModels({
      baseUrl: 'https://gateway.example.com',
      apiKey: 'sk-test',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://gateway.example.com/v1/models',
      expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
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

  it('returns models as soon as any remote endpoint succeeds even if another request stays pending', async () => {
    fetchMock
      .mockImplementationOnce(() => new Promise<Response>(() => {}))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: 'gpt-5.4', supported_endpoint_types: ['openai'] }],
        }),
      } as Response);

    const result = await fetchDroidByokModels({
      baseUrl: 'https://gateway.example.com',
      apiKey: 'sk-test',
      refresh: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
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
    fetchMock
      .mockImplementationOnce(
        () =>
          new Promise<Response>((_, reject) => {
            setTimeout(() => reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })), 0);
          })
      )
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: 'gpt-5.4', supported_endpoint_types: ['openai'] }],
        }),
      } as Response);

    const result = await fetchDroidByokModels({
      baseUrl: 'https://gateway.example.com',
      apiKey: 'sk-test',
      refresh: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
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
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }));
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }));

    await expect(
      fetchDroidByokModels({
        baseUrl: 'https://gateway.example.com',
        apiKey: 'sk-test',
        refresh: true,
      })
    ).rejects.toThrow('Remote request timed out after 15 seconds');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://gateway.example.com/v1/models',
      expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
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
        },
        {
          model: 'claude-sonnet-4-6',
          displayName: 'Claude One Updated',
          baseUrl: 'https://api.one-updated.example.com',
          apiKey: 'sk-one-updated',
          provider: 'anthropic',
          maxOutputTokens: 8192,
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
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { id: 'claude-sonnet-4-6', supported_endpoint_types: ['anthropic'] },
            { id: 'gpt-5.4', supported_endpoint_types: ['openai', 'openai-response'] },
          ],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ type: 'message' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        headers: { get: () => 'application/json' },
        json: async () => ({ error: { message: 'Unsupported' } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        headers: { get: () => 'application/json' },
        json: async () => ({ error: { message: 'Unsupported' } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        headers: { get: () => 'application/json' },
        json: async () => ({ error: { message: 'Unsupported' } }),
      } as Response);

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
        },
      ],
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
    });
  });
});
