/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('modelProbe cli update lookup', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('prefers the fast dist-tags endpoint on the domestic mirror', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => ({
      ok: true,
      json: async () => ({ latest: '1.2.3' }),
    }));

    vi.stubGlobal('fetch', fetchMock);

    vi.doMock('@factory/droid-sdk', () => ({
      FACTORY_PROTOCOL_VERSION: '1.2.0',
      createSession: vi.fn(),
    }));
    vi.doMock('@/process/utils/shellEnv', () => ({
      getEnhancedEnv: vi.fn(() => process.env),
    }));
    vi.doMock('@/process/utils/mainLogger', () => ({
      mainLog: vi.fn(),
      mainWarn: vi.fn(),
    }));
    vi.doMock('@/process/agent/droid/cliRuntime', () => ({
      resolveWorkingDroidCli: vi.fn(() => ({
        execPath: 'droid',
        source: 'system',
        version: '0.99.0',
        cliPath: '/usr/local/bin/droid',
      })),
    }));

    const { checkDroidCliUpdate } = await import('@/process/agent/droid/modelProbe');
    const result = await checkDroidCliUpdate({ cwd: process.cwd() });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://registry.npmmirror.com/-/package/%40factory%2Fcli/dist-tags',
      expect.objectContaining({
        headers: { accept: 'application/json' },
      })
    );
    expect(result.latestVersion).toBe('1.2.3');
    expect(result.registry).toBe('https://registry.npmmirror.com');
  });

  it('falls back to the next endpoint when dist-tags returns no latest version', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/dist-tags')) {
        return {
          ok: true,
          json: async () => ({}),
        };
      }

      if (url.endsWith('/latest')) {
        return {
          ok: true,
          json: async () => ({ version: '1.2.4' }),
        };
      }

      return {
        ok: false,
        json: async () => ({}),
      };
    });

    vi.stubGlobal('fetch', fetchMock);

    vi.doMock('@factory/droid-sdk', () => ({
      FACTORY_PROTOCOL_VERSION: '1.2.0',
      createSession: vi.fn(),
    }));
    vi.doMock('@/process/utils/shellEnv', () => ({
      getEnhancedEnv: vi.fn(() => process.env),
    }));
    vi.doMock('@/process/utils/mainLogger', () => ({
      mainLog: vi.fn(),
      mainWarn: vi.fn(),
    }));
    vi.doMock('@/process/agent/droid/cliRuntime', () => ({
      resolveWorkingDroidCli: vi.fn(() => ({
        execPath: 'droid',
        source: 'system',
        version: '0.99.0',
        cliPath: '/usr/local/bin/droid',
      })),
    }));

    const { checkDroidCliUpdate } = await import('@/process/agent/droid/modelProbe');
    const result = await checkDroidCliUpdate({ cwd: process.cwd() });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://registry.npmmirror.com/%40factory%2Fcli/latest',
      expect.objectContaining({
        headers: { accept: 'application/json' },
      })
    );
    expect(result.latestVersion).toBe('1.2.4');
  });

  it('reuses the cached latest version across repeated checks', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ latest: '1.2.5' }),
    }));

    vi.stubGlobal('fetch', fetchMock);

    vi.doMock('@factory/droid-sdk', () => ({
      FACTORY_PROTOCOL_VERSION: '1.2.0',
      createSession: vi.fn(),
    }));
    vi.doMock('@/process/utils/shellEnv', () => ({
      getEnhancedEnv: vi.fn(() => process.env),
    }));
    vi.doMock('@/process/utils/mainLogger', () => ({
      mainLog: vi.fn(),
      mainWarn: vi.fn(),
    }));
    vi.doMock('@/process/agent/droid/cliRuntime', () => ({
      resolveWorkingDroidCli: vi.fn(() => ({
        execPath: 'droid',
        source: 'system',
        version: '0.99.0',
        cliPath: '/usr/local/bin/droid',
      })),
    }));

    const { checkDroidCliUpdate } = await import('@/process/agent/droid/modelProbe');

    await checkDroidCliUpdate({ cwd: process.cwd() });
    const fetchCallCountAfterFirstCheck = fetchMock.mock.calls.length;
    await checkDroidCliUpdate({ cwd: process.cwd() });

    expect(fetchCallCountAfterFirstCheck).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(fetchCallCountAfterFirstCheck);
  });
});
