/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  buildDroidByokSiteId,
  listDroidByokSites,
  saveDroidByokConfig,
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

describe('DroidByokService — same baseUrl, different providers merge into a single site', () => {
  let settingsFile: FactorySettings | undefined;
  let processConfigValue: Record<string, unknown>;
  let fetchMock: ReturnType<typeof vi.fn>;
  const previousLegacyFlag = process.env.AIONUI_BYOK_LEGACY;

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

    delete process.env.AIONUI_BYOK_LEGACY;
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    if (previousLegacyFlag === undefined) {
      delete process.env.AIONUI_BYOK_LEGACY;
    } else {
      process.env.AIONUI_BYOK_LEGACY = previousLegacyFlag;
    }
  });

  it('merges anthropic + openai models on the same gateway into a single site card', async () => {
    // Anthropic model — probe hits /v1/messages.
    fetchMock.mockImplementation(async () => mockJsonResponse({ type: 'message' }));
    await saveDroidByokConfig({
      baseUrl: 'https://gateway.example.com',
      apiKey: 'sk-shared',
      model: 'claude-sonnet-4-6',
      displayName: 'Claude',
      provider: 'anthropic',
    });

    fetchMock.mockReset();
    // OpenAI responses endpoint — probe expects either `id` or `output` array.
    fetchMock.mockImplementation(async () => mockJsonResponse({ id: 'resp-ok', output: [] }));
    await saveDroidByokConfig({
      baseUrl: 'https://gateway.example.com',
      apiKey: 'sk-shared',
      model: 'gpt-5.4',
      displayName: 'GPT',
      provider: 'openai',
    });

    const sites = await listDroidByokSites();
    expect(sites).toHaveLength(1);
    const [site] = sites;

    // Same baseUrl → same site id (provider-agnostic).
    expect(site.id).toBe(buildDroidByokSiteId('https://gateway.example.com'));
    expect(site.modelCount).toBe(2);

    // `providers` surfaces both protocols deduped.
    expect(site.providers).toHaveLength(2);
    expect(site.providers).toContain('anthropic');
    expect(site.providers).toContain('openai');
  });

  it('keeps different baseUrls as separate sites even when provider coincides', async () => {
    fetchMock.mockImplementation(async () => mockJsonResponse({ type: 'message' }));

    await saveDroidByokConfig({
      baseUrl: 'https://a.example.com',
      apiKey: 'sk-a',
      model: 'claude-sonnet-4-6',
      provider: 'anthropic',
    });
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => mockJsonResponse({ type: 'message' }));
    await saveDroidByokConfig({
      baseUrl: 'https://b.example.com',
      apiKey: 'sk-b',
      model: 'claude-sonnet-4-6',
      provider: 'anthropic',
    });

    const sites = await listDroidByokSites();
    expect(sites).toHaveLength(2);
    const ids = sites.map((site) => site.id).toSorted();
    expect(ids).toEqual(
      [buildDroidByokSiteId('https://a.example.com'), buildDroidByokSiteId('https://b.example.com')].toSorted()
    );
  });
});
