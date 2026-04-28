/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@process/utils/mainLogger', () => ({
  mainLog: vi.fn(),
  mainWarn: vi.fn(),
  mainError: vi.fn(),
}));

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

  it('prepends resolver execArgs when probing a node-launched cli shim', async () => {
    const execFileSyncMock = vi.fn((execPath: string, args: string[]) => {
      if (execPath === 'node') {
        expect(args).toEqual(['/Users/test/AppData/Roaming/npm/node_modules/@factory/cli/bin/droid', '--version']);
        return '1.2.3';
      }

      throw new Error(`unexpected command: ${execPath} ${args.join(' ')}`);
    });

    vi.doMock('node:child_process', () => ({
      execFileSync: execFileSyncMock,
    }));

    vi.doMock('@/process/utils/shellEnv', () => ({
      getEnhancedEnv: vi.fn((_customEnv?: Record<string, string>, options?: { includeBundledDroidInPath?: boolean }) =>
        options?.includeBundledDroidInPath === false ? { PATH: '/usr/local/bin:/bin' } : { PATH: '/bundled:/bin' }
      ),
    }));

    vi.doMock('@/process/agent/droid/cliResolver', () => ({
      resolveDroidCliCandidates: vi.fn(() => [
        {
          execPath: 'node',
          execArgs: ['/Users/test/AppData/Roaming/npm/node_modules/@factory/cli/bin/droid'],
          source: 'system',
        },
      ]),
    }));

    const { resolveWorkingDroidCli } = await import('@/process/agent/droid/cliRuntime');

    expect(resolveWorkingDroidCli()).toEqual({
      execPath: 'node',
      execArgs: ['/Users/test/AppData/Roaming/npm/node_modules/@factory/cli/bin/droid'],
      source: 'system',
      version: '1.2.3',
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

  it('prefers a pipe-compatible candidate over a cmd.exe shell wrapper even when both work for --version', async () => {
    // Regression guard for the v0.108.0 tester log where `cmd.exe /c droid.cmd`
    // was selected as the working candidate (it passes --version), and the
    // SDK then hung 60 s on `droid.initialize_session`. The runtime must
    // probe pipe-compatible candidates FIRST and only fall back to cmd.exe
    // when no native candidate succeeds.
    const execFileSyncMock = vi.fn((execPath: string, args: string[]) => {
      if (execPath === 'node' && args[0] === '/Users/test/AppData/Roaming/npm/node_modules/@factory/cli/bin/droid') {
        return '0.108.0';
      }
      if (execPath === 'cmd.exe') {
        return '0.108.0';
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
      // Candidates are intentionally ordered with cmd.exe FIRST to verify
      // the two-pass prioritization logic inside cliRuntime — a naive
      // implementation would accept cmd.exe on the first hit.
      resolveDroidCliCandidates: vi.fn(() => [
        {
          execPath: 'cmd.exe',
          execArgs: ['/d', '/s', '/c', 'C:/Users/test/AppData/Roaming/npm/droid.cmd'],
          source: 'system',
          pipeCompatible: false,
        },
        {
          execPath: 'node',
          execArgs: ['/Users/test/AppData/Roaming/npm/node_modules/@factory/cli/bin/droid'],
          source: 'system',
          pipeCompatible: true,
        },
      ]),
    }));

    const { resolveWorkingDroidCli } = await import('@/process/agent/droid/cliRuntime');

    const resolved = resolveWorkingDroidCli();

    expect(resolved.execPath).toBe('node');
    expect(resolved.pipeCompatible).toBe(true);
    expect(resolved.version).toBe('0.108.0');
    expect(execFileSyncMock).not.toHaveBeenCalledWith('cmd.exe', expect.anything(), expect.anything());
  });

  it('falls back to the cmd.exe wrapper (flagged NOT pipe-compatible) when no native candidate answers --version', async () => {
    // If every pipe-compatible candidate fails, the runtime still returns
    // the cmd.exe wrapper so the UI can show the CLI version — but carries
    // `pipeCompatible: false` forward so downstream SDK callers refuse to
    // use it for createSession.
    vi.doMock('node:child_process', () => ({
      execFileSync: vi.fn((execPath: string) => {
        if (execPath === 'node') {
          throw new Error('ENOENT: script not found');
        }
        if (execPath === 'cmd.exe') {
          return '0.108.0';
        }
        throw new Error(`unexpected command: ${execPath}`);
      }),
    }));

    vi.doMock('@/process/utils/shellEnv', () => ({
      getEnhancedEnv: vi.fn(() => process.env),
    }));

    vi.doMock('@/process/agent/droid/cliResolver', () => ({
      resolveDroidCliCandidates: vi.fn(() => [
        {
          execPath: 'node',
          execArgs: ['C:/Users/test/AppData/Roaming/npm/node_modules/@factory/cli/bin/droid'],
          source: 'system',
          pipeCompatible: true,
        },
        {
          execPath: 'cmd.exe',
          execArgs: ['/d', '/s', '/c', 'C:/Users/test/AppData/Roaming/npm/droid.cmd'],
          source: 'system',
          pipeCompatible: false,
        },
      ]),
    }));

    const { resolveWorkingDroidCli } = await import('@/process/agent/droid/cliRuntime');

    const resolved = resolveWorkingDroidCli();

    expect(resolved.execPath).toBe('cmd.exe');
    expect(resolved.pipeCompatible).toBe(false);
    expect(resolved.version).toBe('0.108.0');
    expect(resolved.diagnostic?.code).toBe('cmd-shim-pipe-incompatible');
  });

  it('classifies missing Windows platform binaries distinctly from PATH failures', async () => {
    vi.doMock('node:child_process', () => ({
      execFileSync: vi.fn(() => {
        throw new Error('Could not find the droid binary for win32-x64 (missing @factory/cli-win32-x64)');
      }),
    }));

    vi.doMock('@/process/utils/shellEnv', () => ({
      getEnhancedEnv: vi.fn(() => process.env),
    }));

    vi.doMock('@/process/agent/droid/cliResolver', () => ({
      resolveDroidCliCandidates: vi.fn(() => [{ execPath: 'droid', source: 'system' }]),
    }));

    const { resolveWorkingDroidCli } = await import('@/process/agent/droid/cliRuntime');

    const resolved = resolveWorkingDroidCli();

    expect(resolved.version).toBeNull();
    expect(resolved.error).toContain('win32-x64');
    expect(resolved.diagnostic?.code).toBe('missing-platform-binary');
  });

  it('classifies PATH ENOENT failures as cli-not-found', async () => {
    vi.doMock('node:child_process', () => ({
      execFileSync: vi.fn(() => {
        throw new Error('spawnSync droid ENOENT');
      }),
    }));

    vi.doMock('@/process/utils/shellEnv', () => ({
      getEnhancedEnv: vi.fn(() => process.env),
    }));

    vi.doMock('@/process/agent/droid/cliResolver', () => ({
      resolveDroidCliCandidates: vi.fn(() => [{ execPath: 'droid', source: 'system' }]),
    }));

    const { resolveWorkingDroidCli } = await import('@/process/agent/droid/cliRuntime');

    const resolved = resolveWorkingDroidCli();

    expect(resolved.version).toBeNull();
    expect(resolved.diagnostic?.code).toBe('cli-not-found');
  });

  it('classifies timeout failures as probe-timeout when no version text is returned', async () => {
    vi.doMock('node:child_process', () => ({
      execFileSync: vi.fn(() => {
        throw new Error('spawnSync node ETIMEDOUT');
      }),
    }));

    vi.doMock('@/process/utils/shellEnv', () => ({
      getEnhancedEnv: vi.fn(() => process.env),
    }));

    vi.doMock('@/process/agent/droid/cliResolver', () => ({
      resolveDroidCliCandidates: vi.fn(() => [
        {
          execPath: 'node',
          execArgs: ['C:/Users/test/AppData/Roaming/npm/node_modules/droid/bin/droid'],
          source: 'system',
        },
      ]),
    }));

    const { resolveWorkingDroidCli } = await import('@/process/agent/droid/cliRuntime');

    const resolved = resolveWorkingDroidCli();

    expect(resolved.version).toBeNull();
    expect(resolved.diagnostic?.code).toBe('probe-timeout');
  });
});
