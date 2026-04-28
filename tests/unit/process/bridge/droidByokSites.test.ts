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
  importDroidByokConfigs,
  listDroidByokSites,
  migrateLegacyModelsIntoSites,
  removeDroidByokSite,
  rotateDroidByokSiteApiKey,
  saveDroidByokConfig,
  upsertDroidByokSite,
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

describe('DroidByokService site aggregation (B1)', () => {
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

    // Always restore so individual tests can opt into legacy mode explicitly.
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

  /**
   * Helper — seeds a single BYOK model via the normal save path. Uses a
   * permissive `/v1/messages` mock that accepts any anthropic probe.
   */
  const seedAnthropicModel = async (params: {
    baseUrl: string;
    apiKey: string;
    model: string;
    displayName?: string;
  }) => {
    fetchMock.mockImplementation(async () => mockJsonResponse({ type: 'message' }));
    const config = await saveDroidByokConfig({
      baseUrl: params.baseUrl,
      apiKey: params.apiKey,
      model: params.model,
      displayName: params.displayName ?? '',
      provider: 'anthropic',
    });
    fetchMock.mockReset();
    return config;
  };

  it('exposes a stable id derived from normalized baseUrl (provider-agnostic)', () => {
    // Trailing slash / case differences normalize to the same id.
    const first = buildDroidByokSiteId('https://API.Example.com/');
    const second = buildDroidByokSiteId('https://api.example.com');
    expect(first).toEqual(second);
    expect(first).toHaveLength(16);
    expect(first).toMatch(/^[0-9a-f]+$/i);

    // Different path → intentionally different id (protocol variants of the
    // same gateway are tracked separately so the UI can show them as-is).
    const withPath = buildDroidByokSiteId('https://api.example.com/v1/messages');
    expect(withPath).not.toEqual(first);

    // Different host → different id.
    const different = buildDroidByokSiteId('https://api.other.example.com');
    expect(different).not.toEqual(first);
  });

  it('groups BYOK entries by baseUrl (provider-agnostic) and hides plaintext apiKey', async () => {
    await seedAnthropicModel({
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-anthro',
      model: 'claude-sonnet-4-6',
      displayName: 'Claude Sonnet [BYOK]',
    });
    await seedAnthropicModel({
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-anthro',
      model: 'claude-haiku-4',
      displayName: 'Claude Haiku [BYOK]',
    });

    const sites = await listDroidByokSites();
    expect(sites).toHaveLength(1);
    const [site] = sites;
    expect(site.providers).toContain('anthropic');
    expect(site.baseUrl).toBe('https://api.example.com');
    expect(site.modelCount).toBe(2);
    expect(site.hasApiKey).toBe(true);
    expect(site).not.toHaveProperty('apiKey');
    expect(site.id).toEqual(buildDroidByokSiteId(site.baseUrl));
  });

  it('rejects creating an empty site without an existing id', async () => {
    await expect(
      upsertDroidByokSite({
        baseUrl: 'https://api.example.com',
        provider: 'anthropic',
        label: 'Brand new',
      })
    ).rejects.toThrow(/at least one model/i);
  });

  it('rotateDroidByokSiteApiKey rewrites every matching entry and preserves other fields', async () => {
    const first = await seedAnthropicModel({
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-old',
      model: 'claude-sonnet-4-6',
    });
    const second = await seedAnthropicModel({
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-old',
      model: 'claude-haiku-4',
    });

    const siteId = buildDroidByokSiteId('https://api.example.com');
    const site = await rotateDroidByokSiteApiKey(siteId, 'sk-rotated');
    expect(site.id).toEqual(siteId);
    expect(site.hasApiKey).toBe(true);

    const entries = settingsFile?.customModels ?? [];
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry.apiKey).toBe('sk-rotated');
      expect(entry.provider).toBe('anthropic');
      expect(entry.baseUrl).toBe('https://api.example.com');
    }
    // Sanity: other identifiers unchanged.
    expect(entries.map((entry) => entry.model).toSorted()).toEqual([first.model, second.model].toSorted());
  });

  it('removeDroidByokSite cascades to every model under the site and prunes labels', async () => {
    await seedAnthropicModel({
      baseUrl: 'https://api.keep.example.com',
      apiKey: 'sk-keep',
      model: 'claude-sonnet-4-6',
    });
    await seedAnthropicModel({
      baseUrl: 'https://api.remove.example.com',
      apiKey: 'sk-remove',
      model: 'claude-sonnet-4-6',
    });

    const keepId = buildDroidByokSiteId('https://api.keep.example.com');
    const removeId = buildDroidByokSiteId('https://api.remove.example.com');

    // Attach labels to both sites so we can assert the orphan one is pruned.
    await upsertDroidByokSite({
      id: keepId,
      baseUrl: 'https://api.keep.example.com',
      provider: 'anthropic',
      label: 'Keep',
    });
    await upsertDroidByokSite({
      id: removeId,
      baseUrl: 'https://api.remove.example.com',
      provider: 'anthropic',
      label: 'Doomed',
    });

    await removeDroidByokSite(removeId);

    const sites = await listDroidByokSites();
    expect(sites).toHaveLength(1);
    expect(sites[0].id).toBe(keepId);
    expect(sites[0].label).toBe('Keep');

    const droid = (processConfigValue as { droid?: Record<string, unknown> }).droid ?? {};
    const labels = Array.isArray((droid as { byokSiteLabels?: unknown }).byokSiteLabels)
      ? ((droid as { byokSiteLabels: Array<{ id: string }> }).byokSiteLabels as Array<{ id: string }>)
      : [];
    expect(labels.map((entry) => entry.id)).toEqual([keepId]);
  });

  it('migrateLegacyModelsIntoSites is a no-op when AIONUI_BYOK_LEGACY=1', async () => {
    process.env.AIONUI_BYOK_LEGACY = '1';

    // Pre-seed a duplicate legacy shape — migration must leave it alone.
    settingsFile = {
      customModels: [
        {
          model: 'claude-sonnet-4-6',
          displayName: 'Dup A',
          baseUrl: 'https://api.example.com',
          apiKey: 'sk-dup',
          provider: 'anthropic',
        },
        {
          model: 'claude-sonnet-4-6',
          displayName: 'Dup B',
          baseUrl: 'https://api.example.com',
          apiKey: 'sk-dup',
          provider: 'anthropic',
        },
      ],
    };
    processConfigValue = { droid: {} };

    await migrateLegacyModelsIntoSites();

    expect(settingsFile?.customModels).toHaveLength(2);
    const droid = (processConfigValue as { droid?: { byokMigrationVersion?: number } }).droid ?? {};
    expect(droid.byokMigrationVersion).toBeUndefined();
  });

  it('migrateLegacyModelsIntoSites dedupes on (provider, model, normalizedBaseUrl) and is idempotent', async () => {
    settingsFile = {
      customModels: [
        {
          model: 'claude-sonnet-4-6',
          displayName: 'Old Entry',
          baseUrl: 'https://api.example.com',
          apiKey: 'sk-old',
          provider: 'anthropic',
        },
        // Same (provider, model, normalized baseUrl) — should be deduped; the
        // LAST entry wins so the fresh apiKey + displayName survives.
        {
          model: 'claude-sonnet-4-6',
          displayName: 'Fresh Entry',
          baseUrl: 'https://api.example.com/v1/messages',
          apiKey: 'sk-fresh',
          provider: 'anthropic',
        },
        // Different model — should remain independently.
        {
          model: 'claude-haiku-4',
          displayName: 'Haiku',
          baseUrl: 'https://api.example.com',
          apiKey: 'sk-fresh',
          provider: 'anthropic',
        },
      ],
    };
    processConfigValue = { droid: {} };

    await migrateLegacyModelsIntoSites();

    expect(settingsFile?.customModels).toHaveLength(2);
    const deduped = settingsFile?.customModels ?? [];
    const sonnet = deduped.find((entry) => entry.model === 'claude-sonnet-4-6');
    expect(sonnet?.displayName).toBe('Fresh Entry');
    expect(sonnet?.apiKey).toBe('sk-fresh');

    const droid = (processConfigValue as { droid?: { byokMigrationVersion?: number } }).droid ?? {};
    expect(droid.byokMigrationVersion).toBe(1);

    // Second call — must be fully idempotent (no extra customModels rewrites).
    mockWriteFile.mockClear();
    await migrateLegacyModelsIntoSites();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('upsertDroidByokSite rotates every underlying entry when baseUrl changes', async () => {
    await seedAnthropicModel({
      baseUrl: 'https://api.old.example.com',
      apiKey: 'sk-old',
      model: 'claude-sonnet-4-6',
    });
    await seedAnthropicModel({
      baseUrl: 'https://api.old.example.com',
      apiKey: 'sk-old',
      model: 'claude-haiku-4',
    });

    const oldId = buildDroidByokSiteId('https://api.old.example.com');
    const updated = await upsertDroidByokSite({
      id: oldId,
      baseUrl: 'https://api.new.example.com',
      provider: 'anthropic',
      label: 'Renamed',
      apiKey: 'sk-new',
    });

    expect(updated.baseUrl).toBe('https://api.new.example.com');
    expect(updated.id).toBe(buildDroidByokSiteId('https://api.new.example.com'));
    expect(updated.label).toBe('Renamed');
    expect(updated.modelCount).toBe(2);

    const entries = settingsFile?.customModels ?? [];
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry.baseUrl).toBe('https://api.new.example.com');
      expect(entry.apiKey).toBe('sk-new');
      expect(entry.provider).toBe('anthropic');
    }
  });

  it('importDroidByokConfigs feeds a new site that listDroidByokSites surfaces', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/v1/messages')) {
        return mockJsonResponse({ type: 'message' });
      }
      return mockJsonResponse({ error: { message: 'Not Found' } }, false);
    });

    await importDroidByokConfigs({
      baseUrl: 'https://imported.example.com',
      apiKey: 'sk-import',
      models: [{ model: 'claude-sonnet-4-6', displayName: 'Imported Claude', provider: 'anthropic' }],
    });

    const sites = await listDroidByokSites();
    expect(sites).toHaveLength(1);
    expect(sites[0].baseUrl).toBe('https://imported.example.com');
    expect(sites[0].providers).toContain('anthropic');
    expect(sites[0].modelCount).toBe(1);
    expect(sites[0].hasApiKey).toBe(true);
  });

  // =====================================================================
  // M3.B capability aggregation
  // =====================================================================

  it('aggregates supportsImageInput with OR semantics across site members', async () => {
    fetchMock.mockImplementation(async () => mockJsonResponse({ type: 'message' }));

    // Multimodal model (Claude 4) under the site.
    await saveDroidByokConfig({
      baseUrl: 'https://mixed.example.com',
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      provider: 'anthropic',
    });

    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => mockJsonResponse({ type: 'message' }));

    // Deliberately non-multimodal model (via explicit override) under the same site.
    await saveDroidByokConfig({
      baseUrl: 'https://mixed.example.com',
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6-text',
      provider: 'anthropic',
      supportsImageInput: false,
      reasoningLevels: ['none'],
      defaultReasoning: 'none',
    });

    const sites = await listDroidByokSites();
    expect(sites).toHaveLength(1);
    expect(sites[0].modelCount).toBe(2);
    // OR semantics: at least one model supports images → site reports true.
    expect(sites[0].supportsImageInput).toBe(true);
  });

  it('upsertDroidByokSite can bulk-apply capability overrides to every underlying entry', async () => {
    fetchMock.mockImplementation(async () => mockJsonResponse({ type: 'message' }));
    await saveDroidByokConfig({
      baseUrl: 'https://bulk.example.com',
      apiKey: 'sk-bulk',
      model: 'claude-sonnet-4-6',
      provider: 'anthropic',
    });
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => mockJsonResponse({ type: 'message' }));
    await saveDroidByokConfig({
      baseUrl: 'https://bulk.example.com',
      apiKey: 'sk-bulk',
      model: 'claude-haiku-4',
      provider: 'anthropic',
    });

    const siteId = buildDroidByokSiteId('https://bulk.example.com');

    await upsertDroidByokSite({
      id: siteId,
      baseUrl: 'https://bulk.example.com',
      provider: 'anthropic',
      capabilities: {
        supportsImageInput: false,
        reasoningLevels: ['off', 'low'],
        defaultReasoning: 'low',
      },
    });

    const entries = settingsFile?.customModels ?? [];
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry.supportsImageInput).toBe(false);
      expect(entry.reasoningLevels).toEqual(['off', 'low']);
      expect(entry.defaultReasoning).toBe('low');
    }

    // Site aggregate should now report no multimodal capability.
    const sites = await listDroidByokSites();
    const site = sites.find((s) => s.id === siteId);
    expect(site?.supportsImageInput).toBe(false);
  });
});
