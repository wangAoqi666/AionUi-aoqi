/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('droid cli runtime', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('falls back to the next candidate when the first cli wrapper is broken', async () => {
    const execFileSyncMock = vi.fn((execPath: string, args: string[]) => {
      if (execPath === '/project/node_modules/@factory/cli/bin/droid' && args[0] === '--version') {
        throw new Error('missing optional dependency');
      }

      if (execPath === 'droid' && args[0] === '--version') {
        return '0.99.0';
      }

      throw new Error(`unexpected command: ${execPath} ${args.join(' ')}`);
    });

    vi.doMock('node:child_process', () => ({
      execFileSync: execFileSyncMock,
    }));

    vi.doMock('@/process/utils/shellEnv', () => ({
      getEnhancedEnv: vi.fn(() => process.env),
    }));

    vi.doMock('@/process/agent/droid/cliResolver', () => ({
      resolveDroidCliCandidates: vi.fn(() => [
        { execPath: '/project/node_modules/@factory/cli/bin/droid', source: 'bundled' },
        { execPath: 'droid', source: 'system' },
      ]),
    }));

    const { resolveWorkingDroidCli } = await import('@/process/agent/droid/cliRuntime');

    expect(resolveWorkingDroidCli()).toEqual({
      execPath: 'droid',
      source: 'system',
      version: '0.99.0',
      cliPath: null,
    });

    expect(execFileSyncMock).not.toHaveBeenCalledWith('which', expect.anything(), expect.anything());
    expect(execFileSyncMock).not.toHaveBeenCalledWith('where', expect.anything(), expect.anything());
  });

  it('prefers an installed system droid before the bundled fallback', async () => {
    const execFileSyncMock = vi.fn((execPath: string, args: string[], options?: { env?: NodeJS.ProcessEnv }) => {
      if (execPath === 'droid' && args[0] === '--version') {
        expect(options?.env?.PATH?.startsWith('/bundled')).toBe(false);
        return '0.99.0';
      }

      if (execPath === '/bundled/droid' && args[0] === '--version') {
        return '0.99.0-bundled';
      }

      throw new Error(`unexpected command: ${execPath} ${args.join(' ')}`);
    });

    vi.doMock('node:child_process', () => ({
      execFileSync: execFileSyncMock,
    }));

    vi.doMock('@/process/utils/shellEnv', () => ({
      getEnhancedEnv: vi.fn((_customEnv?: Record<string, string>, options?: { includeBundledDroidInPath?: boolean }) =>
        options?.includeBundledDroidInPath === false
          ? { PATH: '/usr/local/bin:/bin' }
          : { PATH: '/bundled:/usr/local/bin:/bin' }
      ),
    }));

    vi.doMock('@/process/agent/droid/cliResolver', () => ({
      resolveDroidCliCandidates: vi.fn(() => [
        { execPath: '/bundled/droid', source: 'bundled' },
        { execPath: 'droid', source: 'system' },
      ]),
    }));

    const { resolveWorkingDroidCli } = await import('@/process/agent/droid/cliRuntime');

    expect(resolveWorkingDroidCli()).toEqual({
      execPath: 'droid',
      source: 'system',
      version: '0.99.0',
      cliPath: null,
    });
  });

  it('preserves a custom path failure instead of silently falling back', async () => {
    vi.doMock('node:child_process', () => ({
      execFileSync: vi.fn(() => {
        throw new Error('permission denied');
      }),
    }));

    vi.doMock('@/process/utils/shellEnv', () => ({
      getEnhancedEnv: vi.fn(() => process.env),
    }));

    vi.doMock('@/process/agent/droid/cliResolver', () => ({
      resolveDroidCliCandidates: vi.fn(() => [{ execPath: '/custom/droid', source: 'custom' }]),
    }));

    const { resolveWorkingDroidCli } = await import('@/process/agent/droid/cliRuntime');

    expect(resolveWorkingDroidCli('/custom/droid')).toEqual({
      execPath: '/custom/droid',
      source: 'custom',
      version: null,
      cliPath: '/custom/droid',
      error: 'permission denied',
    });
  });

  it('ignores a placeholder bundled binary and accepts a timed-out system cli if it already printed a version', async () => {
    const timeoutError = Object.assign(new Error('spawnSync droid ETIMEDOUT'), {
      stdout: Buffer.from('0.99.0\n'),
    });

    vi.doMock('node:child_process', () => ({
      execFileSync: vi.fn((execPath: string, args: string[]) => {
        if (execPath === '/resources/bundled-droid/darwin-arm64/droid' && args[0] === '--version') {
          return 'Placeholder v0.0.1 - please reinstall @factory/cli';
        }

        if (execPath === 'droid' && args[0] === '--version') {
          throw timeoutError;
        }

        throw new Error(`unexpected command: ${execPath} ${args.join(' ')}`);
      }),
    }));

    vi.doMock('@/process/utils/shellEnv', () => ({
      getEnhancedEnv: vi.fn(() => process.env),
    }));

    vi.doMock('@/process/agent/droid/cliResolver', () => ({
      resolveDroidCliCandidates: vi.fn(() => [
        { execPath: '/resources/bundled-droid/darwin-arm64/droid', source: 'bundled' },
        { execPath: 'droid', source: 'system' },
      ]),
    }));

    const { resolveWorkingDroidCli } = await import('@/process/agent/droid/cliRuntime');

    expect(resolveWorkingDroidCli()).toEqual({
      execPath: 'droid',
      source: 'system',
      version: '0.99.0',
      cliPath: null,
    });
  });

  it('keeps the bare exec name on Chinese Windows so CreateProcessW handles CJK user dirs (regression: mojibake ENOENT)', async () => {
    // Simulates a 中文 Windows username like `C:\Users\张三\bin\droid.exe`.
    // If the runtime ever shells out to `where droid`, Node decodes CP936
    // stdout as UTF-8 and returns a mojibake path (`C:\Users\????\bin\droid.exe`)
    // that later breaks `spawn()` with ENOENT. This test pins the contract:
    // we must NEVER shell out to `where` / `which`, so the bare `droid`
    // survives into spawn() and Windows CreateProcessW resolves it natively.
    const execFileSyncMock = vi.fn((execPath: string, args: string[]) => {
      if (execPath === 'droid' && args[0] === '--version') {
        return '0.99.0';
      }

      if (execPath === 'where' || execPath === 'which') {
        throw new Error(`runtime must not shell out to ${execPath} (CJK codepage hazard)`);
      }

      throw new Error(`unexpected command: ${execPath} ${args.join(' ')}`);
    });

    vi.doMock('node:child_process', () => ({
      execFileSync: execFileSyncMock,
    }));

    vi.doMock('@/process/utils/shellEnv', () => ({
      getEnhancedEnv: vi.fn(() => process.env),
    }));

    vi.doMock('@/process/agent/droid/cliResolver', () => ({
      resolveDroidCliCandidates: vi.fn(() => [{ execPath: 'droid', source: 'system' }]),
    }));

    const { resolveWorkingDroidCli } = await import('@/process/agent/droid/cliRuntime');

    const resolved = resolveWorkingDroidCli();

    expect(resolved.execPath).toBe('droid');
    expect(resolved.source).toBe('system');
    expect(resolved.version).toBe('0.99.0');
    expect(resolved.cliPath).toBeNull();
    expect(execFileSyncMock).not.toHaveBeenCalledWith('where', expect.anything(), expect.anything());
    expect(execFileSyncMock).not.toHaveBeenCalledWith('which', expect.anything(), expect.anything());
  });
});
