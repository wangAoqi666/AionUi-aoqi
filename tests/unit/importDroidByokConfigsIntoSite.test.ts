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
  fetchDroidByokModelsForSite,
  importDroidByokConfigsIntoSite,
  listDroidByokSites,
  saveDroidByokConfig,
} from '@/process/bridge/services/DroidByokService';

type FactorySettings = {
  customModels?: Array<Record<string, unknown>>;
};

const mockJsonResponse = (body: unknown, ok = true, status = 200): Response =>
  ({
    ok,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as Response;

describe('DroidByokService — site-scoped add-model reuses stored apiKey', () => {
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

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const seedSite = async () => {
    fetchMock.mockImplementation(async () => mockJsonResponse({ type: 'message' }));
    await saveDroidByokConfig({
      baseUrl: 'https://gateway.example.com',
      apiKey: 'sk-stored',
      model: 'claude-sonnet-4-6',
      displayName: 'Claude Sonnet',
      provider: 'anthropic',
    });
    fetchMock.mockReset();
  };

  it('importDroidByokConfigsIntoSite reuses the stored apiKey + baseUrl', async () => {
    await seedSite();
    const siteId = buildDroidByokSiteId('https://gateway.example.com');

    // Capture which URL+Authorization header is seen during the probe. We
    // don't care about the validation response shape, only that the stored
    // `sk-stored` key is forwarded.
    let seenAuthHeader: string | undefined;
    fetchMock.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      const authHeader =
        (init?.headers as Record<string, string> | undefined)?.['x-api-key'] ??
        (init?.headers as Record<string, string> | undefined)?.Authorization ??
        (init?.headers as Record<string, string> | undefined)?.authorization ??
        '';
      seenAuthHeader = String(authHeader);
      void url;
      return mockJsonResponse({ type: 'message' });
    });

    const result = await importDroidByokConfigsIntoSite({
      siteId,
      models: [{ model: 'claude-haiku-4', displayName: 'Claude Haiku', provider: 'anthropic' }],
    });

    expect(result.imported).toHaveLength(1);
    expect(result.imported[0].model).toBe('claude-haiku-4');

    // Authorization header carried the stored key (either via `x-api-key`
    // or Bearer — both are acceptable depending on provider).
    expect(seenAuthHeader).toMatch(/sk-stored/);

    // The site now has 2 models under the same id.
    const sites = await listDroidByokSites();
    expect(sites.find((site) => site.id === siteId)?.modelCount).toBe(2);
  });

  it('fetchDroidByokModelsForSite reuses stored apiKey without exposing it in result', async () => {
    await seedSite();
    const siteId = buildDroidByokSiteId('https://gateway.example.com');

    fetchMock.mockImplementation(async () =>
      mockJsonResponse({
        data: [{ id: 'claude-sonnet-4-6' }, { id: 'claude-haiku-4' }],
      })
    );

    const catalog = await fetchDroidByokModelsForSite({ siteId, refresh: true });

    expect(Array.isArray(catalog.models)).toBe(true);
    // Catalog payload must never include the plaintext API key.
    expect(JSON.stringify(catalog)).not.toContain('sk-stored');
  });

  it('rejects when the site has no stored apiKey', async () => {
    await expect(fetchDroidByokModelsForSite({ siteId: 'deadbeefdeadbeef', refresh: false })).rejects.toThrow(
      /no stored API key|rotate key/i
    );
  });
});
