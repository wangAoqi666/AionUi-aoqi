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

      if (execPath === 'which' && args[0] === 'droid') {
        return '/usr/local/bin/droid';
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
      execPath: '/usr/local/bin/droid',
      source: 'system',
      version: '0.99.0',
      cliPath: '/usr/local/bin/droid',
    });
  });

  it('prefers an installed system droid before the bundled fallback', async () => {
    const execFileSyncMock = vi.fn((execPath: string, args: string[], options?: { env?: NodeJS.ProcessEnv }) => {
      if (execPath === 'droid' && args[0] === '--version') {
        expect(options?.env?.PATH?.startsWith('/bundled')).toBe(false);
        return '0.99.0';
      }

      if (execPath === 'which' && args[0] === 'droid') {
        expect(options?.env?.PATH?.startsWith('/bundled')).toBe(false);
        return '/usr/local/bin/droid';
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
      execPath: '/usr/local/bin/droid',
      source: 'system',
      version: '0.99.0',
      cliPath: '/usr/local/bin/droid',
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

        if (execPath === 'which' && args[0] === 'droid') {
          return '/Users/test/.local/bin/droid';
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
      execPath: '/Users/test/.local/bin/droid',
      source: 'system',
      version: '0.99.0',
      cliPath: '/Users/test/.local/bin/droid',
    });
  });
});
