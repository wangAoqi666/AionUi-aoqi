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

describe('droid cli resolver', () => {
  const originalCwd = process.cwd;
  const originalPlatform = process.platform;
  const originalResourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const originalAppData = process.env.APPDATA;
  const originalLocalAppData = process.env.LOCALAPPDATA;
  const originalScoop = process.env.SCOOP;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    Object.defineProperty(process, 'cwd', { value: originalCwd });
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath = originalResourcesPath;
    process.env.APPDATA = originalAppData;
    process.env.LOCALAPPDATA = originalLocalAppData;
    process.env.SCOOP = originalScoop;
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
      readFileSync: vi.fn(() => ''),
    }));

    const { resolveDroidCliCandidates } = await import('@/process/agent/droid/cliResolver');

    expect(resolveDroidCliCandidates()).toEqual([
      {
        execPath: 'droid',
        source: 'system',
        pipeCompatible: true,
      },
      {
        execPath: bundledBinary,
        source: 'bundled',
        pipeCompatible: true,
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
      readFileSync: vi.fn(() => ''),
    }));

    const { resolveDroidCliCandidates } = await import('@/process/agent/droid/cliResolver');

    expect(resolveDroidCliCandidates()).toEqual([
      {
        execPath: 'droid',
        source: 'system',
        pipeCompatible: true,
      },
      {
        execPath: bundledBinary,
        source: 'bundled',
        pipeCompatible: true,
      },
    ]);
  });

  it('ignores manifest-only fast-build bundle directories that do not contain a droid binary', async () => {
    const runtimeKey = `darwin-${process.arch}`;
    const bundledDir = `/app/resources/bundled-droid/${runtimeKey}`;
    (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath = '/app/resources';

    vi.doMock('node:fs', () => ({
      existsSync: vi.fn(
        (targetPath: string) =>
          targetPath === '/app/resources' || targetPath === bundledDir || targetPath === `${bundledDir}/manifest.json`
      ),
      readFileSync: vi.fn(() => ''),
    }));

    const { resolveDroidCliCandidates } = await import('@/process/agent/droid/cliResolver');

    expect(resolveDroidCliCandidates()).toEqual([
      {
        execPath: 'droid',
        source: 'system',
        pipeCompatible: true,
      },
    ]);
  });

  it('preserves an explicit custom cli path', async () => {
    vi.doMock('node:fs', () => ({
      existsSync: vi.fn(() => false),
      readFileSync: vi.fn(() => ''),
    }));

    const { resolveDroidCliPath } = await import('@/process/agent/droid/cliResolver');

    expect(resolveDroidCliPath('/custom/tools/droid')).toEqual({
      execPath: '/custom/tools/droid',
      source: 'custom',
      pipeCompatible: true,
    });
  });

  it('normalizes an explicit Windows cmd shim into node plus the JS entrypoint', async () => {
    const customCmd = '/Users/test/AppData/Roaming/npm/droid.cmd';
    const customShim = '/Users/test/AppData/Roaming/npm/node_modules/@factory/cli/bin/droid';
    process.env.APPDATA = '/Users/test/AppData/Roaming';
    Object.defineProperty(process, 'platform', { value: 'win32' });

    vi.doMock('node:fs', () => ({
      existsSync: vi.fn((targetPath: string) => targetPath === customShim),
      readFileSync: vi.fn(() => ''),
    }));

    const { resolveDroidCliPath } = await import('@/process/agent/droid/cliResolver');

    expect(resolveDroidCliPath(customCmd)).toEqual({
      execPath: 'node',
      execArgs: [customShim],
      source: 'custom',
      pipeCompatible: true,
    });
  });

  it('uses the project-installed droid binary as a fallback when no bundled binary exists', async () => {
    const installedBinary = `${originalCwd()}/node_modules/@factory/cli/bin/droid`;

    vi.doMock('node:fs', () => ({
      existsSync: vi.fn((targetPath: string) => targetPath === installedBinary),
      readFileSync: vi.fn(() => ''),
    }));

    const { resolveDroidCliCandidates } = await import('@/process/agent/droid/cliResolver');

    expect(resolveDroidCliCandidates()).toEqual([
      {
        execPath: 'droid',
        source: 'system',
        pipeCompatible: true,
      },
      {
        execPath: installedBinary,
        source: 'bundled',
        pipeCompatible: true,
      },
    ]);
  });

  it('prepends discovered Windows global droid shims before the bare system command', async () => {
    const runtimeKey = `win32-${process.arch}`;
    const bundledBinary = `/app/resources/bundled-droid/${runtimeKey}/droid.exe`;
    const npmShim = '/Users/test/AppData/Roaming/npm/node_modules/@factory/cli/bin/droid';
    const pnpmCmd = '/Users/test/AppData/Local/pnpm/droid.cmd';
    const pnpmShim = '/Users/test/pnpm/global/node_modules/@factory/cli/bin/droid';
    process.env.APPDATA = '/Users/test/AppData/Roaming';
    process.env.LOCALAPPDATA = '/Users/test/AppData/Local';
    process.env.SCOOP = '/Users/test/scoop';
    (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath = '/app/resources';
    Object.defineProperty(process, 'platform', { value: 'win32' });

    vi.doMock('node:fs', () => ({
      existsSync: vi.fn(
        (targetPath: string) =>
          targetPath === '/app/resources' ||
          targetPath === bundledBinary ||
          targetPath === `/app/resources/bundled-droid/${runtimeKey}` ||
          targetPath === '/Users/test/AppData/Roaming/npm/droid.cmd' ||
          targetPath === npmShim ||
          targetPath === pnpmCmd ||
          targetPath === pnpmShim
      ),
      readFileSync: vi.fn((targetPath: string) => {
        if (targetPath === pnpmCmd) {
          return `@SETLOCAL\r\n"%~dp0\\..\\..\\pnpm\\global\\node_modules\\@factory\\cli\\bin\\droid" %*\r\n`;
        }
        return '';
      }),
    }));

    const { resolveDroidCliCandidates } = await import('@/process/agent/droid/cliResolver');

    expect(resolveDroidCliCandidates()).toEqual([
      {
        execPath: 'node',
        execArgs: [npmShim],
        source: 'system',
        pipeCompatible: true,
      },
      {
        execPath: 'node',
        execArgs: [pnpmShim],
        source: 'system',
        pipeCompatible: true,
      },
      {
        execPath: 'droid',
        source: 'system',
        pipeCompatible: true,
      },
      {
        execPath: bundledBinary,
        source: 'bundled',
        pipeCompatible: true,
      },
    ]);
  });

  it('composeSdkExecArgs tail-merges the SDK stream-jsonrpc args onto a launch prefix and returns undefined for empty input', async () => {
    // Direct unit test for the helper that sits between the resolver and the
    // SDK's ProcessTransport. This is the only layer where we can force the
    // spawned droid into `exec --input-format stream-jsonrpc --output-format
    // stream-jsonrpc` mode when our launch prefix is `node + <js-entrypoint>`.
    //
    // - Empty / undefined prefix ⇒ undefined (SDK keeps its own DEFAULT_EXEC_ARGS;
    //   do NOT accidentally break the POSIX native-binary path that already
    //   works on Linux/Mac).
    // - Non-empty prefix ⇒ [<prefix...>, 'exec', '--input-format',
    //   'stream-jsonrpc', '--output-format', 'stream-jsonrpc'].
    vi.doMock('node:fs', () => ({
      existsSync: vi.fn(() => false),
      readFileSync: vi.fn(() => ''),
    }));

    const { composeSdkExecArgs, SDK_STREAM_JSONRPC_ARGS } = await import('@/process/agent/droid/cliResolver');

    expect(SDK_STREAM_JSONRPC_ARGS).toEqual([
      'exec',
      '--input-format',
      'stream-jsonrpc',
      '--output-format',
      'stream-jsonrpc',
    ]);

    expect(composeSdkExecArgs(undefined)).toBeUndefined();
    expect(composeSdkExecArgs([])).toBeUndefined();

    expect(composeSdkExecArgs(['C:/Users/qwq/AppData/Roaming/npm/node_modules/droid/bin/droid'])).toEqual([
      'C:/Users/qwq/AppData/Roaming/npm/node_modules/droid/bin/droid',
      'exec',
      '--input-format',
      'stream-jsonrpc',
      '--output-format',
      'stream-jsonrpc',
    ]);

    // Non-mutation guard: the original prefix array must not be mutated when
    // callers reuse the same DroidCliResolution for version probes + SDK
    // session args.
    const prefix = ['/path/to/droid.js'];
    composeSdkExecArgs(prefix);
    expect(prefix).toEqual(['/path/to/droid.js']);
  });

  it('falls back to the system droid command when no bundle or custom path exists', async () => {
    vi.doMock('node:fs', () => ({
      existsSync: vi.fn(() => false),
      readFileSync: vi.fn(() => ''),
    }));

    const { resolveDroidCliPath } = await import('@/process/agent/droid/cliResolver');

    expect(resolveDroidCliPath()).toEqual({
      execPath: 'droid',
      source: 'system',
      pipeCompatible: true,
    });
  });

  it('falls back to cmd.exe (marked NOT pipe-compatible) when a Windows .cmd shim does not reference the JS entrypoint', async () => {
    // Reproduces the production bug where the npm shim survives but
    // node_modules/@factory/cli/bin/droid is missing AND the shim content
    // doesn't match our parser at all (non-standard template, empty stub,
    // corrupted file). Only then do we fall back to cmd.exe — and it MUST
    // be flagged `pipeCompatible: false` so downstream SDK callers refuse
    // to use it for createSession (which would otherwise time out 60s on
    // `droid.initialize_session` because cmd.exe breaks JSON-RPC pipes).
    const customCmd = 'C:/Users/qwq/AppData/Roaming/npm/droid.cmd';
    process.env.APPDATA = 'C:/Users/qwq/AppData/Roaming';
    Object.defineProperty(process, 'platform', { value: 'win32' });

    vi.doMock('node:fs', () => ({
      existsSync: vi.fn((targetPath: string) => targetPath === customCmd),
      readFileSync: vi.fn(() => '@SETLOCAL\r\n@ECHO this stub does not reference the JS entrypoint\r\n'),
    }));

    const { resolveDroidCliPath } = await import('@/process/agent/droid/cliResolver');

    expect(resolveDroidCliPath(customCmd)).toEqual({
      execPath: 'cmd.exe',
      execArgs: ['/d', '/s', '/c', customCmd],
      source: 'custom',
      pipeCompatible: false,
    });
  });

  it('accepts a Windows JS entrypoint with a .js extension when the bin file is renamed', async () => {
    // Some packagers (or future @factory/cli releases) ship the entrypoint as
    // bin/droid.js instead of bin/droid. The resolver must still produce
    // `node + <jsPath>` so the SDK can spawn it without a shell.
    const customCmd = 'C:/Users/test/AppData/Roaming/npm/droid.cmd';
    const customShimJs = 'C:/Users/test/AppData/Roaming/npm/node_modules/@factory/cli/bin/droid.js';
    process.env.APPDATA = 'C:/Users/test/AppData/Roaming';
    Object.defineProperty(process, 'platform', { value: 'win32' });

    vi.doMock('node:fs', () => ({
      existsSync: vi.fn((targetPath: string) => targetPath === customShimJs),
      readFileSync: vi.fn(() => ''),
    }));

    const { resolveDroidCliPath } = await import('@/process/agent/droid/cliResolver');

    expect(resolveDroidCliPath(customCmd)).toEqual({
      execPath: 'node',
      execArgs: [customShimJs],
      source: 'custom',
      pipeCompatible: true,
    });
  });

  it('resolves a Windows cmd shim from the `droid` alias package via standard lookup', async () => {
    // Regression guard for the v0.108.0 Windows rebuild #2 tester log:
    // users who run `npm i -g droid` (alias package, same 0.108.0 release
    // as @factory/cli per npm registry on 2026-04-24) get a shim whose
    // body references `node_modules\droid\bin\droid` — NOT the scoped
    // `@factory/cli` path. The resolver must accept the alias layout so
    // it normalizes into `node + <aliasPath>` (pipe-compatible) instead
    // of falling through to the 60 s cmd.exe timeout.
    const customCmd = '/Users/qwq/AppData/Roaming/npm/droid.cmd';
    const aliasShim = '/Users/qwq/AppData/Roaming/npm/node_modules/droid/bin/droid';
    process.env.APPDATA = '/Users/qwq/AppData/Roaming';
    Object.defineProperty(process, 'platform', { value: 'win32' });

    vi.doMock('node:fs', () => ({
      existsSync: vi.fn((targetPath: string) => targetPath === customCmd || targetPath === aliasShim),
      readFileSync: vi.fn(() => ''),
    }));

    const { resolveDroidCliPath } = await import('@/process/agent/droid/cliResolver');

    expect(resolveDroidCliPath(customCmd)).toEqual({
      execPath: 'node',
      execArgs: [aliasShim],
      source: 'custom',
      pipeCompatible: true,
    });
  });

  it('parse-and-trusts the `droid` alias shim body when existsSync never confirms the entrypoint', async () => {
    // Tester SHA prefix `ae5ac079fab9` (330 bytes) — standard npm cmd-shim
    // template pointing at the alias package. Even if the on-disk JS
    // entrypoint is invisible to existsSync (AV scan / snapshot lag /
    // hardlink stat failure), the parser MUST extract the alias path and
    // hand it to node so spawn surfaces a fast ENOENT rather than
    // silently dropping through to the cmd.exe wrapper.
    const customCmd = '/Users/qwq/AppData/Roaming/npm/droid.cmd';
    const expectedScript = '/Users/qwq/AppData/Roaming/npm/node_modules/droid/bin/droid';
    process.env.APPDATA = '/Users/qwq/AppData/Roaming';
    Object.defineProperty(process, 'platform', { value: 'win32' });

    const shimBody = [
      '@ECHO off',
      'GOTO start',
      ':find_dp0',
      'SET dp0=%~dp0',
      'EXIT /b',
      ':start',
      'SETLOCAL',
      'CALL :find_dp0',
      'IF EXIST "%dp0%\\node.exe" (',
      '  SET "_prog=%dp0%\\node.exe"',
      ') ELSE (',
      '  SET "_prog=node"',
      '  SET PATHEXT=%PATHEXT:;.JS;=;%',
      ')',
      '',
      'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\droid\\bin\\droid" %*',
      '',
    ].join('\r\n');

    vi.doMock('node:fs', () => ({
      existsSync: vi.fn((targetPath: string) => targetPath === customCmd),
      readFileSync: vi.fn(() => shimBody),
    }));

    const { resolveDroidCliPath } = await import('@/process/agent/droid/cliResolver');

    expect(resolveDroidCliPath(customCmd)).toEqual({
      execPath: 'node',
      execArgs: [expectedScript],
      source: 'custom',
      pipeCompatible: true,
    });
  });

  it('parse-and-trusts the extracted JS entrypoint even when the file system cannot confirm it exists', async () => {
    // Regression guard for the v0.108.0 tester log: cmd.exe fallback was
    // being picked because `existsSync` returned false for the npm standard
    // shim layout path — but the real entrypoint WAS there (likely a stale
    // snapshot / AV scan / hardlink indirection hid it from fs.statSync).
    //
    // The parser extracts `%~dp0\node_modules\@factory\cli\bin\droid` from
    // the shim content and resolves it to `<cmdDir>/node_modules/@factory/cli/bin/droid`.
    // Even though the fs mock never returns true for that path, we MUST
    // return `node + <resolved>` so Node's spawn can surface a fast ENOENT
    // instead of the SDK hanging 60 s in `initialize_session` through the
    // cmd.exe shell wrapper.
    //
    // NOTE: we use POSIX-style paths even though the test fakes
    // `process.platform = 'win32'` because the `path` module is still loaded
    // with the host separator. This matches the other Windows-platform tests
    // in this file (see "normalizes an explicit Windows cmd shim...").
    const customCmd = '/Users/qwq/AppData/Roaming/npm/droid.cmd';
    const expectedScript = '/Users/qwq/AppData/Roaming/npm/node_modules/@factory/cli/bin/droid';
    process.env.APPDATA = '/Users/qwq/AppData/Roaming';
    Object.defineProperty(process, 'platform', { value: 'win32' });

    // Standard npm-generated cmd-shim body that references the bin path via
    // the `%~dp0` macro. The exact path on disk is never reported existsSync,
    // forcing parse-and-trust.
    const shimBody = [
      '@ECHO OFF',
      'GOTO start',
      ':find_dp0',
      'SET dp0=%~dp0',
      'EXIT /b',
      ':start',
      'SETLOCAL',
      'CALL :find_dp0',
      '',
      'IF EXIST "%dp0%\\node.exe" (',
      '  "%dp0%\\node.exe"  "%dp0%\\node_modules\\@factory\\cli\\bin\\droid" %*',
      ') ELSE (',
      '  @SETLOCAL',
      '  @SET PATHEXT=%PATHEXT:;.JS;=;%',
      '  node  "%dp0%\\node_modules\\@factory\\cli\\bin\\droid" %*',
      ')',
      '',
    ].join('\r\n');

    vi.doMock('node:fs', () => ({
      existsSync: vi.fn((targetPath: string) => targetPath === customCmd),
      readFileSync: vi.fn(() => shimBody),
    }));

    const { resolveDroidCliPath } = await import('@/process/agent/droid/cliResolver');

    const resolved = resolveDroidCliPath(customCmd);

    expect(resolved).toEqual({
      execPath: 'node',
      execArgs: [expectedScript],
      source: 'custom',
      pipeCompatible: true,
    });
  });
});
