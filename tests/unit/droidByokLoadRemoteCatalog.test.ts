/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * BYOK fix (2026-04-23): `loadRemoteCatalog` now probes every candidate
 * endpoint via `Promise.allSettled` and prefers the first response whose
 * `models.length > 0`. This removes the "need multiple clicks" bug where the
 * first endpoint to resolve could win with an empty payload and short-circuit
 * the others.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockProcessConfigGet, mockProcessConfigSet, mockGetFactoryRootDir, mockReadFile, mockWriteFile, mockMkdir } =
  vi.hoisted(() => ({
    mockReadFile: vi.fn(async () => {
      const error = new Error('ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      throw error;
    }),
    mockWriteFile: vi.fn(),
    mockMkdir: vi.fn(),
    mockProcessConfigGet: vi.fn(async () => ({})),
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

import { fetchDroidByokModels } from '@/process/bridge/services/DroidByokService';

type FetchSpec = {
  ok: boolean;
  status?: number;
  body: unknown;
  delayMs?: number;
};

const jsonResponse = (spec: FetchSpec): Response =>
  ({
    ok: spec.ok,
    status: spec.status ?? (spec.ok ? 200 : 500),
    headers: { get: () => 'application/json' },
    json: async () => spec.body,
    text: async () => JSON.stringify(spec.body),
  }) as Response;

describe('fetchDroidByokModels / loadRemoteCatalog (Promise.allSettled)', () => {
  const baseUrl = 'https://proxy.example.com/v1';
  const apiKey = 'sk-test';
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProcessConfigGet.mockResolvedValue({});
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('prefers the fulfilled endpoint with non-empty models even when an empty one resolves first', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      // Empty 200 resolves immediately; a later non-empty endpoint should still win.
      if (url.endsWith('/v1/models')) {
        return jsonResponse({ ok: true, body: { data: [] } });
      }
      if (url.endsWith('/v1beta/models')) {
        return jsonResponse({
          ok: true,
          body: {
            data: [
              { id: 'gpt-5-codex', supported_endpoint_types: ['openai-response'] },
              { id: 'claude-opus-4-1', supported_endpoint_types: ['anthropic'] },
            ],
          },
        });
      }
      return jsonResponse({ ok: true, body: { data: [] } });
    });

    const catalog = await fetchDroidByokModels({ baseUrl, apiKey, refresh: true });
    expect(catalog.models.map((m) => m.model)).toEqual(['claude-opus-4-1', 'gpt-5-codex']);
  });

  it('returns an empty catalog when every fulfilled endpoint is empty (does NOT throw)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, body: { data: [] } }));
    const catalog = await fetchDroidByokModels({ baseUrl, apiKey, refresh: true });
    expect(catalog.models).toEqual([]);
  });

  it('throws only when every endpoint rejects', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: false, status: 401, body: { error: { message: 'bad key' } } }));
    await expect(fetchDroidByokModels({ baseUrl, apiKey, refresh: true })).rejects.toThrow(/bad key|HTTP 401/i);
  });

  it('does not cache empty catalogs (so the next refresh re-probes)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, body: { data: [] } }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, body: { data: [] } }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, body: { data: [] } }));
    const first = await fetchDroidByokModels({ baseUrl, apiKey, refresh: true });
    expect(first.models).toEqual([]);

    // Second call (without refresh) MUST re-issue requests because the empty
    // catalog was not cached.
    fetchMock.mockResolvedValue(
      jsonResponse({
        ok: true,
        body: { data: [{ id: 'gpt-5-codex', supported_endpoint_types: ['openai-response'] }] },
      })
    );
    const second = await fetchDroidByokModels({ baseUrl, apiKey });
    expect(second.models.map((m) => m.model)).toEqual(['gpt-5-codex']);
  });
});
