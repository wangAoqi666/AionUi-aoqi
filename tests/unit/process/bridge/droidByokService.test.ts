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
  getDroidByokConfigs,
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

  beforeEach(() => {
    vi.clearAllMocks();
    settingsFile = undefined;
    processConfigValue = {};

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

    vi.stubGlobal('fetch', vi.fn());
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

  it('saves a normalized config while preserving unrelated custom models', async () => {
    settingsFile = {
      customModels: [
        {
          model: 'other-model',
          displayName: 'Other',
          baseUrl: 'https://other.example.com',
          apiKey: 'other-key',
          provider: 'anthropic',
        },
      ],
    };

    const config = await saveDroidByokConfig({
      baseUrl: ' https://api.example.com/v1/messages ',
      apiKey: ' sk-test ',
      model: ' claude-sonnet-4-6 ',
      displayName: '',
    });

    expect(config).toEqual({
      id: expect.any(String),
      model: 'claude-sonnet-4-6',
      displayName: 'claude-sonnet-4-6 [BYOK]',
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      provider: 'anthropic',
      maxOutputTokens: 8192,
    });
    expect(settingsFile).toEqual({
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
          displayName: 'claude-sonnet-4-6 [BYOK]',
          baseUrl: 'https://api.example.com',
          apiKey: 'sk-test',
          provider: 'anthropic',
          maxOutputTokens: 8192,
        },
      ],
    });
    expect(processConfigValue).toEqual({
      droid: {
        byokModelRefs: [
          {
            id: config.id,
            model: 'claude-sonnet-4-6',
            baseUrl: 'https://api.example.com',
            provider: 'anthropic',
          },
        ],
      },
    });
  });

  it('supports multiple managed BYOK entries and removes only the targeted config', async () => {
    const first = await saveDroidByokConfig({
      baseUrl: 'https://api.one.example.com',
      apiKey: 'sk-one',
      model: 'claude-sonnet-4-6',
      displayName: 'Claude One',
    });
    const second = await saveDroidByokConfig({
      baseUrl: 'https://api.two.example.com',
      apiKey: 'sk-two',
      model: 'claude-sonnet-4-6',
      displayName: 'Claude Two',
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
    const first = await saveDroidByokConfig({
      baseUrl: 'https://api.one.example.com',
      apiKey: 'sk-one',
      model: 'claude-sonnet-4-6',
      displayName: 'Claude One',
    });
    const second = await saveDroidByokConfig({
      baseUrl: 'https://api.two.example.com',
      apiKey: 'sk-two',
      model: 'claude-sonnet-4-6',
      displayName: 'Claude Two',
    });

    const updated = await saveDroidByokConfig({
      existingId: first.id,
      baseUrl: 'https://api.one-updated.example.com',
      apiKey: 'sk-one-updated',
      model: 'claude-sonnet-4-6',
      displayName: 'Claude One Updated',
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

  it('falls back to /messages when /v1/messages is unavailable during connection test', async () => {
    const fetchMock = vi.mocked(fetch);
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
