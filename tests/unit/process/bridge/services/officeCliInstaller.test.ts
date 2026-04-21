/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tests for the shared `OfficeCliInstaller` service. The service owns:
 *   - Multi-path resolution for the `officecli` binary (PATH + platform
 *     candidates)
 *   - Install mutex + 5-minute failure cooldown
 *   - Background update check (idempotent per-process + 24h marker TTL)
 *   - Structured failure hint builder (Windows ExecutionPolicy detection)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- Hoisted mocks ---

const {
  execSyncMock,
  existsSyncMock,
  statSyncMock,
  writeFileSyncMock,
  getDataDirMock,
} = vi.hoisted(() => ({
  execSyncMock: vi.fn(),
  existsSyncMock: vi.fn((_p: string) => false),
  statSyncMock: vi.fn(),
  writeFileSyncMock: vi.fn(),
  getDataDirMock: vi.fn(() => '/mock/data'),
}));

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  execSync: (...args: unknown[]) => execSyncMock(...args),
}));

vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => existsSyncMock(...(args as [string])),
  statSync: (...args: unknown[]) => statSyncMock(...args),
  writeFileSync: (...args: unknown[]) => writeFileSyncMock(...args),
  default: {
    existsSync: (...args: unknown[]) => existsSyncMock(...(args as [string])),
    statSync: (...args: unknown[]) => statSyncMock(...args),
    writeFileSync: (...args: unknown[]) => writeFileSyncMock(...args),
  },
}));

vi.mock('@process/utils/shellEnv', () => ({
  getEnhancedEnv: vi.fn(() => ({ PATH: '/usr/bin' })),
}));

vi.mock('@/common/platform', () => ({
  getPlatformServices: vi.fn(() => ({
    paths: {
      getDataDir: getDataDirMock,
    },
  })),
}));

type InstallerModule = typeof import('../../../../../src/process/bridge/services/OfficeCliInstaller');

let installer: InstallerModule;

async function loadInstaller(): Promise<InstallerModule> {
  const mod = await import('../../../../../src/process/bridge/services/OfficeCliInstaller');
  mod.__resetOfficeCliInstallerForTests();
  return mod;
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  existsSyncMock.mockImplementation(() => false);
  // Default: `which officecli` returns nothing (binary missing on PATH)
  execSyncMock.mockReturnValue('');
  installer = await loadInstaller();
});

afterEach(() => {
  installer.__resetOfficeCliInstallerForTests();
});

describe('OfficeCliInstaller / resolveOfficecliPath', () => {
  it('returns "officecli" when the binary is resolvable via PATH', async () => {
    execSyncMock.mockReset();
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.includes('which') || cmd.includes('where')) {
        return '/usr/local/bin/officecli\n';
      }
      return '';
    });
    existsSyncMock.mockImplementation((p: string) => p === '/usr/local/bin/officecli');

    const resolved = await installer.resolveOfficecliPath();
    expect(resolved).toBe('officecli');
  });

  it('falls back to the first existing candidate path when PATH lookup fails', async () => {
    execSyncMock.mockImplementation(() => {
      throw new Error('which: no officecli in $PATH');
    });
    // Pretend the Deno install path is the one that exists on disk.
    existsSyncMock.mockImplementation((p: string) => p.endsWith('/.deno/bin/officecli'));

    const resolved = await installer.resolveOfficecliPath();
    expect(resolved).toMatch(/\.deno\/bin\/officecli$/);
  });

  it('returns null when PATH and all candidates fail', async () => {
    execSyncMock.mockImplementation(() => {
      throw new Error('no officecli');
    });
    existsSyncMock.mockImplementation(() => false);

    const resolved = await installer.resolveOfficecliPath();
    expect(resolved).toBeNull();
  });
});

describe('OfficeCliInstaller / installOfficecli', () => {
  it('emits installing → installed on success and reports "installed" status', async () => {
    execSyncMock.mockReturnValue('');

    const statuses: string[] = [];
    const ok = await installer.installOfficecli((s) => statuses.push(s.state));

    expect(ok).toBe(true);
    expect(statuses[0]).toBe('installing');
    expect(statuses[statuses.length - 1]).toBe('installed');
    expect(installer.getOfficecliStatus().state).toBe('installed');
  });

  it('deduplicates concurrent callers through the in-process mutex', async () => {
    execSyncMock.mockReturnValue('');

    // Two synchronous calls before any awaits run — the second must observe
    // the first's pending promise and share it. Both resolve to the same
    // `true` result without invoking the install command twice.
    const first = installer.installOfficecli();
    const second = installer.installOfficecli();
    expect(first).toBe(second);

    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(true);
    expect(b).toBe(true);
    const installCalls = execSyncMock.mock.calls.filter(([cmd]) =>
      typeof cmd === 'string' && cmd.includes('install.sh | bash')
    );
    expect(installCalls.length).toBe(1);
  });

  it('enters the 5-minute failure cooldown after an install failure', async () => {
    execSyncMock.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('install.sh | bash')) {
        throw Object.assign(new Error('network down'), { stderr: 'network down' });
      }
      return '';
    });

    const firstStatuses: string[] = [];
    const first = await installer.installOfficecli((s) => firstStatuses.push(s.state));
    expect(first).toBe(false);
    expect(firstStatuses).toContain('failed');

    const secondStatuses: Array<{ state: string; message?: string }> = [];
    const second = await installer.installOfficecli((s) =>
      secondStatuses.push({ state: s.state, message: s.message })
    );
    expect(second).toBe(false);
    // Cooldown path: installer never re-runs the install command, just surfaces
    // a `failed` status tagged with `cooldown` so the UI can render the hint.
    expect(secondStatuses[0]?.message).toBe('cooldown');
  });

  it('clears the cooldown on a subsequent successful install', async () => {
    let shouldFail = true;
    execSyncMock.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('install.sh | bash')) {
        if (shouldFail) throw new Error('boom');
        return '';
      }
      return '';
    });

    await installer.installOfficecli();
    expect(installer.getOfficecliStatus().state).toBe('failed');

    // Reset cooldown window so the installer actually re-runs the command.
    installer.__resetOfficeCliInstallerForTests();
    shouldFail = false;

    const ok = await installer.installOfficecli();
    expect(ok).toBe(true);
    expect(installer.getOfficecliStatus().state).toBe('installed');
  });
});

describe('OfficeCliInstaller / buildOfficecliFailureHint', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('returns the Windows ExecutionPolicy hint when stderr matches', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const err = Object.assign(new Error('PowerShell failed'), {
      stderr: Buffer.from('execution of scripts is disabled on this system'),
    });
    const hint = installer.buildOfficecliFailureHint(err);
    expect(hint.platform).toBe('win32');
    expect(hint.hintKey).toBe('preview.officecli.hints.windowsExecutionPolicy');
    expect(hint.manualCommand).toMatch(/powershell/);
  });

  it('returns the generic Windows hint when stderr does not match ExecutionPolicy', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const err = new Error('random');
    const hint = installer.buildOfficecliFailureHint(err);
    expect(hint.platform).toBe('win32');
    expect(hint.hintKey).toBe('preview.officecli.hints.windowsGeneric');
  });

  it('returns the darwin / linux hint on Unix platforms', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const darwinHint = installer.buildOfficecliFailureHint(new Error('nope'));
    expect(darwinHint.platform).toBe('darwin');
    expect(darwinHint.hintKey).toBe('preview.officecli.hints.darwin');

    Object.defineProperty(process, 'platform', { value: 'linux' });
    const linuxHint = installer.buildOfficecliFailureHint(new Error('nope'));
    expect(linuxHint.platform).toBe('linux');
    expect(linuxHint.hintKey).toBe('preview.officecli.hints.linux');
  });
});

describe('OfficeCliInstaller / scheduleOfficecliUpdateCheck', () => {
  it('is idempotent — subsequent calls do not re-arm the timer', async () => {
    vi.useFakeTimers();
    try {
      statSyncMock.mockReturnValue({ mtimeMs: Date.now() });
      installer.scheduleOfficecliUpdateCheck();
      installer.scheduleOfficecliUpdateCheck();

      await vi.advanceTimersByTimeAsync(6000);
      // Only one timer was scheduled — statSync is probed once.
      expect(statSyncMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('skips the update when the marker file is fresh (<24h old)', async () => {
    vi.useFakeTimers();
    try {
      statSyncMock.mockReturnValue({ mtimeMs: Date.now() - 1000 });
      installer.scheduleOfficecliUpdateCheck();
      await vi.advanceTimersByTimeAsync(6000);
      // Only the marker stat was done — the version probe never ran.
      expect(execSyncMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('triggers install when remote version differs from local', async () => {
    vi.useFakeTimers();
    try {
      statSyncMock.mockReturnValue({ mtimeMs: Date.now() - 25 * 60 * 60 * 1000 });
      execSyncMock.mockReset();
      execSyncMock
        .mockReturnValueOnce('1.0.17') // officecli --version
        .mockReturnValueOnce('https://github.com/iOfficeAI/OfficeCli/releases/tag/v1.0.18') // remote URL
        .mockReturnValue(''); // install command(s)

      const statuses: string[] = [];
      installer.scheduleOfficecliUpdateCheck((s) => statuses.push(s.state));
      await vi.advanceTimersByTimeAsync(6000);
      // Microtasks from the async installOfficecli call still need to drain.
      await vi.advanceTimersByTimeAsync(0);

      expect(statuses).toContain('installing');
    } finally {
      vi.useRealTimers();
    }
  });
});
