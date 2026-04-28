/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * BYOK fix (2026-04-23): `migrateLegacyGoogleProvider` rewrites legacy
 * `provider: 'google'` entries to the Factory-supported
 * `generic-chat-completion-api` provider. Test suite verifies:
 *
 *   1. customModels entries are rewritten (provider + baseUrl)
 *   2. byokModelRefs are rewritten and the sha1 id is recomputed
 *   3. byokSiteLabels move from the old site id to the new one
 *   4. Idempotency — a second run is a no-op
 *   5. `AIONUI_BYOK_LEGACY=1` short-circuits the migration
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type FactorySettings = { customModels?: Array<Record<string, unknown>> };

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
  migrateLegacyGoogleProvider,
  buildDroidByokSiteId,
  buildLegacyDroidByokSiteId,
} from '@/process/bridge/services/DroidByokService';

describe('migrateLegacyGoogleProvider', () => {
  let settingsFile: FactorySettings | undefined;
  let acpConfig: Record<string, unknown>;
  const originalLegacyEnv = process.env.AIONUI_BYOK_LEGACY;

  beforeEach(() => {
    vi.clearAllMocks();
    settingsFile = undefined;
    acpConfig = {};
    delete process.env.AIONUI_BYOK_LEGACY;

    mockReadFile.mockImplementation(async () => {
      if (settingsFile === undefined) {
        const error = new Error('ENOENT') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      }
      return JSON.stringify(settingsFile);
    });
    mockWriteFile.mockImplementation(async (_path: string, content: string) => {
      settingsFile = JSON.parse(content) as FactorySettings;
    });
    mockMkdir.mockResolvedValue(undefined);
    mockProcessConfigGet.mockImplementation(async (key: string) => {
      if (key === 'acp.config') return acpConfig;
      return undefined;
    });
    mockProcessConfigSet.mockImplementation(async (key: string, value: Record<string, unknown>) => {
      if (key === 'acp.config') acpConfig = value;
    });
  });

  afterEach(() => {
    if (originalLegacyEnv === undefined) {
      delete process.env.AIONUI_BYOK_LEGACY;
    } else {
      process.env.AIONUI_BYOK_LEGACY = originalLegacyEnv;
    }
  });

  it('rewrites customModels, refs, and site labels from google → generic-chat-completion-api', async () => {
    settingsFile = {
      customModels: [
        {
          model: 'gemini-2.5-pro',
          displayName: 'Gemini 2.5 Pro [BYOK]',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
          apiKey: 'gk-1',
          provider: 'google',
        },
      ],
    };
    const oldSiteId = buildLegacyDroidByokSiteId('google' as never, 'https://generativelanguage.googleapis.com/v1beta');
    acpConfig = {
      droid: {
        byokModelRefs: [
          {
            id: 'stale-id',
            model: 'gemini-2.5-pro',
            baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
            provider: 'google',
          },
        ],
        byokSiteLabels: [{ id: oldSiteId, label: 'My Gemini' }],
      },
    };

    await migrateLegacyGoogleProvider();

    expect(settingsFile?.customModels?.[0]).toMatchObject({
      provider: 'generic-chat-completion-api',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    });

    const droid = acpConfig.droid as Record<string, unknown>;
    const refs = droid.byokModelRefs as Array<Record<string, string>>;
    expect(refs[0].provider).toBe('generic-chat-completion-api');
    expect(refs[0].baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta/openai');
    expect(refs[0].id).not.toBe('stale-id');
    expect(refs[0].id).toHaveLength(16);

    const newSiteId = buildDroidByokSiteId('https://generativelanguage.googleapis.com/v1beta/openai');
    const labels = droid.byokSiteLabels as Array<Record<string, string>>;
    expect(labels[0].id).toBe(newSiteId);
    expect(labels[0].label).toBe('My Gemini');

    expect(droid.droidByokGoogleMigrationVersion).toBe(1);
  });

  it('is idempotent — a second run does not write again', async () => {
    acpConfig = { droid: { droidByokGoogleMigrationVersion: 1 } };
    await migrateLegacyGoogleProvider();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('is a no-op when AIONUI_BYOK_LEGACY=1', async () => {
    process.env.AIONUI_BYOK_LEGACY = '1';
    settingsFile = {
      customModels: [
        {
          model: 'gemini-2.5-pro',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
          apiKey: 'gk-1',
          provider: 'google',
        },
      ],
    };
    await migrateLegacyGoogleProvider();
    // Settings untouched (no customModels rewrite)
    expect(settingsFile.customModels?.[0].provider).toBe('google');
    // Migration marker not written
    expect(
      (acpConfig as { droid?: { droidByokGoogleMigrationVersion?: number } }).droid?.droidByokGoogleMigrationVersion
    ).toBeUndefined();
  });

  it('does not touch entries whose provider is already supported', async () => {
    settingsFile = {
      customModels: [
        {
          model: 'claude-sonnet-4-5',
          baseUrl: 'https://api.anthropic.com',
          apiKey: 'sk-ant',
          provider: 'anthropic',
        },
      ],
    };
    await migrateLegacyGoogleProvider();
    expect(settingsFile.customModels?.[0].provider).toBe('anthropic');
    expect(settingsFile.customModels?.[0].baseUrl).toBe('https://api.anthropic.com');
  });
});
