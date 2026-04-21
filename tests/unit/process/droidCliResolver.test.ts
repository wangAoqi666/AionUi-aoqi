/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('droid cli resolver', () => {
  const originalCwd = process.cwd;
  const originalResourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    Object.defineProperty(process, 'cwd', { value: originalCwd });
    (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath = originalResourcesPath;
  });

  it('keeps the system droid command first and includes the bundled binary as a fallback', async () => {
    const bundledBinary = '/app/resources/bundled-droid/darwin-arm64/droid';
    (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath = '/app/resources';

    vi.doMock('node:fs', () => ({
      existsSync: vi.fn(
        (targetPath: string) =>
          targetPath === '/app/resources' ||
          targetPath === '/app/resources/bundled-droid/darwin-arm64' ||
          targetPath === bundledBinary
      ),
    }));

    const { resolveDroidCliCandidates } = await import('@/process/agent/droid/cliResolver');

    expect(resolveDroidCliCandidates()).toEqual([
      {
        execPath: 'droid',
        source: 'system',
      },
      {
        execPath: bundledBinary,
        source: 'bundled',
      },
    ]);
  });

  it('uses the project resources bundle as the fallback binary when runtime resources do not contain droid', async () => {
    const cwdPath = '/workspace/project';
    const bundledBinary = '/workspace/project/resources/bundled-droid/darwin-arm64/droid';
    (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath =
      '/Applications/Electron.app/Contents/Resources';
    Object.defineProperty(process, 'cwd', { value: () => cwdPath });

    vi.doMock('node:fs', () => ({
      existsSync: vi.fn(
        (targetPath: string) =>
          targetPath === '/Applications/Electron.app/Contents/Resources' ||
          targetPath === '/workspace/project/resources/bundled-droid/darwin-arm64' ||
          targetPath === bundledBinary
      ),
    }));

    const { resolveDroidCliCandidates } = await import('@/process/agent/droid/cliResolver');

    expect(resolveDroidCliCandidates()).toEqual([
      {
        execPath: 'droid',
        source: 'system',
      },
      {
        execPath: bundledBinary,
        source: 'bundled',
      },
    ]);
  });

  it('preserves an explicit custom cli path', async () => {
    vi.doMock('node:fs', () => ({
      existsSync: vi.fn(() => false),
    }));

    const { resolveDroidCliPath } = await import('@/process/agent/droid/cliResolver');

    expect(resolveDroidCliPath('/custom/tools/droid')).toEqual({
      execPath: '/custom/tools/droid',
      source: 'custom',
    });
  });

  it('uses the project-installed droid binary as a fallback when no bundled binary exists', async () => {
    const installedBinary = `${originalCwd()}/node_modules/@factory/cli/bin/droid`;

    vi.doMock('node:fs', () => ({
      existsSync: vi.fn((targetPath: string) => targetPath === installedBinary),
    }));

    const { resolveDroidCliCandidates } = await import('@/process/agent/droid/cliResolver');

    expect(resolveDroidCliCandidates()).toEqual([
      {
        execPath: 'droid',
        source: 'system',
      },
      {
        execPath: installedBinary,
        source: 'bundled',
      },
    ]);
  });

  it('falls back to the system droid command when no bundle or custom path exists', async () => {
    vi.doMock('node:fs', () => ({
      existsSync: vi.fn(() => false),
    }));

    const { resolveDroidCliPath } = await import('@/process/agent/droid/cliResolver');

    expect(resolveDroidCliPath()).toEqual({
      execPath: 'droid',
      source: 'system',
    });
  });
});
