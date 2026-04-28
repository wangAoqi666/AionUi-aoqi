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
  getFactoryModels,
  setDroidModelCatalog,
  resetDroidModelCatalog,
  type FactoryModel,
} from '@/common/config/factoryModels';
import {
  rebuildDroidCatalogFromRefs,
  removeDroidByokConfig,
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

describe('DroidByokService — delete propagates into the in-memory Factory catalog', () => {
  let settingsFile: FactorySettings | undefined;
  let processConfigValue: Record<string, unknown>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    resetDroidModelCatalog();
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
    resetDroidModelCatalog();
  });

  const seedAnthropicModel = async (model: string, baseUrl = 'https://api.example.com', apiKey = 'sk-test') => {
    fetchMock.mockImplementation(async () => mockJsonResponse({ type: 'message' }));
    const config = await saveDroidByokConfig({
      baseUrl,
      apiKey,
      model,
      displayName: `${model} [BYOK]`,
      provider: 'anthropic',
    });
    fetchMock.mockReset();
    return config;
  };

  it('prunes stale custom entries that no longer appear in byokModelRefs', async () => {
    const first = await seedAnthropicModel('claude-sonnet-4-6');
    const second = await seedAnthropicModel('claude-haiku-4');

    // Simulate what the CLI probe would do: seed the catalog with BOTH custom
    // entries using CLI-style `custom:<displayName>` ids (NOT sha1 ref ids)
    // + one built-in model whose metadata must be preserved.
    const builtin: FactoryModel = {
      id: 'claude-sonnet-4-builtin',
      name: 'Built-in Claude',
      modelProvider: 'anthropic',
      sourceModelId: 'claude-sonnet-4-builtin',
      reasoningLevels: ['none'],
      defaultReasoning: 'none',
    };
    const custom1: FactoryModel = {
      id: `custom:${first.displayName.replace(/\s+/g, '-')}`,
      name: first.displayName,
      modelProvider: 'anthropic',
      sourceModelId: first.model,
      isCustom: true,
      reasoningLevels: ['none'],
      defaultReasoning: 'none',
    };
    const custom2: FactoryModel = {
      id: `custom:${second.displayName.replace(/\s+/g, '-')}`,
      name: second.displayName,
      modelProvider: 'anthropic',
      sourceModelId: second.model,
      isCustom: true,
      reasoningLevels: ['none'],
      defaultReasoning: 'none',
    };
    setDroidModelCatalog([builtin, custom1, custom2]);

    expect(getFactoryModels().map((model) => model.id)).toEqual([builtin.id, custom1.id, custom2.id]);

    // User deletes the second model.
    await removeDroidByokConfig(second.id);

    // In-memory catalog still has the stale entry until we reconcile.
    // (In production, catalogRefresher calls rebuildDroidCatalogFromRefs after
    // flushFactoryCatalogRefresh; here we call it directly.)
    await rebuildDroidCatalogFromRefs();

    const ids = getFactoryModels().map((model) => model.id);
    expect(ids).toContain(builtin.id);
    // The CLI-issued custom:… id for the first model must survive the rebuild.
    expect(ids).toContain(custom1.id);
    expect(ids).not.toContain(custom2.id);
  });

  it('does NOT synthesize fallback entries — only CLI-probed models are trusted', async () => {
    const added = await seedAnthropicModel('claude-sonnet-4-6');

    // Probe missed this ref — the catalog only has built-ins.
    // Unlike the old behavior, we must NOT synthesize a fake entry because
    // its id would not match what the CLI expects and would cause 400 errors.
    const builtin: FactoryModel = {
      id: 'claude-sonnet-4-builtin',
      name: 'Built-in Claude',
      modelProvider: 'anthropic',
      sourceModelId: 'claude-sonnet-4-builtin',
      reasoningLevels: ['none'],
      defaultReasoning: 'none',
    };
    setDroidModelCatalog([builtin]);

    await rebuildDroidCatalogFromRefs();

    const catalog = getFactoryModels();
    const ids = catalog.map((model) => model.id);
    expect(ids).toContain(builtin.id);
    // The BYOK ref should NOT appear because CLI hasn't probed it yet.
    // Its sha1 ref id must not be in the catalog.
    expect(ids).not.toContain(added.id);
    // No custom entries at all — the probe didn't surface any.
    expect(catalog.filter((m) => m.isCustom)).toHaveLength(0);
  });
});
