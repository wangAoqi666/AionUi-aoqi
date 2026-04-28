/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mainLog, mainWarn } from '@process/utils/mainLogger';

export type DroidCliSource = 'bundled' | 'custom' | 'system';
export type DroidCliResolution = {
  execPath: string;
  execArgs?: string[];
  source: DroidCliSource;
  /**
   * `false` marks a candidate that can launch the CLI for one-shot commands
   * (e.g. `droid --version`) but CANNOT be used as the direct process target
   * for `@factory/droid-sdk`'s persistent JSON-RPC stream. Today this flag is
   * only `false` for the Windows `cmd.exe /d /s /c <shim>` fallback: cmd.exe's
   * CRLF translation, stdin EOF handling and ConPTY layer all break the SDK's
   * bidirectional stdio pipe, causing a 60 s `initialize_session` timeout.
   *
   * When `undefined` / `true` the candidate is safe for both version probing
   * AND SDK session creation. Consumers that spawn the SDK (`DroidSdkAgent`,
   * `probeDroidModelCatalog`, `probeDroidStatus`) MUST refuse
   * `pipeCompatible === false` candidates and surface a clear error so the
   * user can reinstall `@factory/cli` instead of waiting on silent timeouts.
   */
  pipeCompatible?: boolean;
};

/**
 * The exact argument sequence `@factory/droid-sdk`'s internal
 * `ProcessTransport.DEFAULT_EXEC_ARGS` uses when the caller does not pass
 * `execArgs` to `createSession` / `resumeSession`.
 *
 * Source of truth (must stay in sync): `@factory/droid-sdk` 0.1.4
 *   dist/index.cjs ≈ L1690
 *     `var DEFAULT_EXEC_ARGS = ["exec", "--input-format", "stream-jsonrpc",
 *      "--output-format", "stream-jsonrpc"];`
 *
 * The SDK's ProcessTransport constructor is:
 *   `this.execArgs = options.execArgs ? [...options.execArgs] : [...DEFAULT_EXEC_ARGS];`
 *
 * → Passing ANY non-empty `execArgs` fully OVERRIDES the default. If we only
 * send the launch prefix (e.g. `['<path to droid.js>']`), droid spawns
 * without `exec --input-format stream-jsonrpc ...` and starts its
 * interactive TUI instead of the JSON-RPC stream protocol. The SDK then
 * sits forever waiting for a response to `droid.initialize_session`,
 * surfacing as a 60 s `TimeoutError: Request droid.initialize_session
 * timed out after 60000ms`.
 *
 * Callers that produce an `execArgs` launch prefix (e.g. the Windows `node +
 * <js entrypoint>` normalization in this file) MUST tail-merge these args
 * via {@link composeSdkExecArgs} before passing them to the SDK.
 */
export const SDK_STREAM_JSONRPC_ARGS = [
  'exec',
  '--input-format',
  'stream-jsonrpc',
  '--output-format',
  'stream-jsonrpc',
] as const;

/**
 * Merge a launch-prefix execArgs array with the SDK's stream-jsonrpc args so
 * the spawned droid process actually speaks the protocol
 * `@factory/droid-sdk` expects. Returns `undefined` when there is no prefix
 * so the SDK falls back to its own internal `DEFAULT_EXEC_ARGS` (used on
 * Linux/Mac where the resolver hands over a native binary path and no prefix
 * is needed).
 *
 * Using `undefined` vs `[...]` matters: passing any array — even empty after
 * spread — overrides the SDK default. The `undefined` fast-path keeps the
 * existing Linux/Mac behavior byte-identical.
 *
 * USE SITES: `DroidSdkAgent.startSession` (createSession + resumeSession) and
 * `modelProbe.probeDroidStatus` / `probeDroidModelCatalog`. The version
 * probe in `cliRuntime.runDroidCliCommand` MUST NOT use this helper: it
 * appends its own command args (e.g. `--version`) and needs the bare prefix.
 */
export function composeSdkExecArgs(prefix: readonly string[] | undefined): string[] | undefined {
  if (!prefix || prefix.length === 0) {
    return undefined;
  }
  return [...prefix, ...SDK_STREAM_JSONRPC_ARGS];
}

function getBinaryName(): string {
  return process.platform === 'win32' ? 'droid.exe' : 'droid';
}

function getScriptShimName(): string {
  return 'droid';
}

function getNodeCommandName(): string {
  return process.platform === 'win32' ? 'node' : 'node';
}

const WINDOWS_CMD_SHELL_EXECUTABLE = 'cmd.exe';
// `/d` skips registry AutoRun, `/s` forces predictable quote stripping, `/c`
// runs the command and exits. With these switches cmd.exe will execute
// `<cmdpath> <args...>` reliably even when the path needs quoting (spaces,
// CJK characters, etc.).
const WINDOWS_CMD_SHELL_LAUNCH_SWITCHES = ['/d', '/s', '/c'] as const;

function buildWindowsCmdShellFallback(candidatePath: string, source: DroidCliSource): DroidCliResolution {
  return {
    execPath: WINDOWS_CMD_SHELL_EXECUTABLE,
    execArgs: [...WINDOWS_CMD_SHELL_LAUNCH_SWITCHES, candidatePath],
    source,
    // cmd.exe shell wrapper can launch the CLI but cannot serve as the SDK's
    // JSON-RPC pipe target. Flag it explicitly so upstream callers skip it.
    pipeCompatible: false,
  };
}

function stripUtf8Bom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Matches any quoted path inside a Windows cmd-shim (`.cmd`) that looks like
 * a JS entrypoint living under `node_modules/<pkg>/bin/droid[.js|.mjs|.cjs]`.
 *
 * The regex is deliberately permissive about the package name because
 * Factory publishes the CLI under TWO npm packages:
 *   - `@factory/cli` → shim body references `node_modules\@factory\cli\bin\droid`
 *   - `droid`        → shim body references `node_modules\droid\bin\droid`
 *     (alias package; same 0.108.0 release as `@factory/cli`, confirmed by
 *     `npm view droid` returning identical version + description on 2026-04-24)
 *
 * Other scenarios this handles by construction:
 *   - pnpm / yarn berry globals that nest the package one level deeper
 *   - A future bin layout that renames the entrypoint file (droid.js, main.js)
 *
 * What it deliberately does NOT match:
 *   - The `SET "_prog=%dp0%\node.exe"` assignment on the IF/ELSE branches
 *     (no `node_modules` segment → filtered out)
 *   - Bare `"%~dp0%\..."` quoted tokens that reference node.exe instead of
 *     the actual JS entrypoint.
 *
 * Accepts both `\` and `/` separators to stay tolerant of rewritten shims.
 */
const WINDOWS_CMD_SHIM_JS_ENTRYPOINT_REGEX = /node_modules[\\/][^"\r\n]*[\\/]bin[\\/]droid(?:\.[cm]?js)?$/iu;

/**
 * Loose regex used to locate the LINE containing the JS entrypoint. Matches
 * any reference to `node_modules/.../bin/droid` — we use the precise regex
 * above to select the specific quoted token on that line. Keeping the two
 * separate lets us distinguish a matching line (which may contain multiple
 * quoted strings like the IF/ELSE `%_prog%` branches) from the exact token
 * we want to hand off to Node spawn.
 */
const WINDOWS_CMD_SHIM_NODE_MODULES_LINE_REGEX = /node_modules[\\/]/iu;

function sha256PrefixHex(text: string, length = 12): string {
  return createHash('sha256').update(text, 'utf-8').digest('hex').slice(0, length);
}

/**
 * Diagnostic log for remote debugging. We print the first 500 characters of
 * the `.cmd` content (collapsed whitespace) along with a short SHA-256 prefix
 * so we can correlate a tester's log with a specific cmd-shim template.
 *
 * This is the fastest way to tell apart "standard npm shim with a broken
 * install" from "non-standard shim template we don't parse yet" without
 * asking the user to email us the raw file.
 */
function logCmdShimDiagnostic(cmdPath: string, content: string, resolvedScript: string | null): void {
  try {
    const preview = content.slice(0, 500).replace(/\s+/g, ' ').trim();
    mainLog('[DroidCliResolver]', 'Parsed Windows .cmd shim', {
      cmdPath,
      contentBytes: Buffer.byteLength(content, 'utf-8'),
      contentSha256Prefix: sha256PrefixHex(content),
      contentPreview: preview,
      resolvedScript,
    });
  } catch {
    // Never let logging throw — the resolver is on a startup hot path.
  }
}

function getRuntimeResourcesRoot(): string | null {
  const runtimeResourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (runtimeResourcesPath && existsSync(runtimeResourcesPath)) {
    return runtimeResourcesPath;
  }
  return null;
}

function normalizeCliResolutionKey(candidate: DroidCliResolution): string {
  return `${candidate.source}\n${candidate.execPath}\n${candidate.execArgs?.join('\n') || ''}`;
}

function isLikelyWindowsAbsolutePath(candidatePath: string): boolean {
  return /^[a-z]:\\/iu.test(candidatePath) || candidatePath.startsWith('\\\\');
}

function findExistingAncestorJoinedPath(baseDir: string, relativePath: string): string | null {
  if (!relativePath) {
    return null;
  }

  let currentDir = baseDir;
  while (true) {
    const candidate = path.resolve(currentDir, relativePath);
    if (existsSync(candidate)) {
      return candidate;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
  }
}

function pickFirstExistingPath(candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function jsExtensionVariantsOf(scriptPath: string): string[] {
  return [scriptPath, `${scriptPath}.js`, `${scriptPath}.mjs`, `${scriptPath}.cjs`];
}

function resolveWindowsCmdShimScriptPath(cmdPath: string): string | null {
  const cmdDir = path.dirname(cmdPath);
  // Try both known Factory-published package layouts before reading the shim:
  //   1. `@factory/cli` — canonical scoped package
  //   2. `droid`        — short alias package (npm view droid → 0.108.0,
  //                        identical description to @factory/cli on 2026-04-24)
  const factoryScopedShim = path.join(cmdDir, 'node_modules', '@factory', 'cli', 'bin', getScriptShimName());
  const droidAliasShim = path.join(cmdDir, 'node_modules', 'droid', 'bin', getScriptShimName());
  const standardHit = pickFirstExistingPath([
    ...jsExtensionVariantsOf(factoryScopedShim),
    ...jsExtensionVariantsOf(droidAliasShim),
  ]);
  if (standardHit) {
    return standardHit;
  }

  let content: string;
  try {
    content = stripUtf8Bom(readFileSync(cmdPath, 'utf-8'));
  } catch (error) {
    mainWarn('[DroidCliResolver]', 'Failed to read Windows .cmd shim for parsing', {
      cmdPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  const targetLine = content.split(/\r?\n/u).find((line) => WINDOWS_CMD_SHIM_NODE_MODULES_LINE_REGEX.test(line));
  if (!targetLine) {
    logCmdShimDiagnostic(cmdPath, content, null);
    return null;
  }

  // Iterate every quoted token on the matched line and pick the one that
  // looks like a real JS entrypoint (precise regex). This filters out:
  //   - the `SET "_prog=%dp0%\node.exe"` assignment (no `node_modules`)
  //   - any quoted flags/literal strings on the same line
  //   - mid-shim env-var references like "%PATHEXT:;.JS;=;%"
  // The `WINDOWS_CMD_SHIM_JS_ENTRYPOINT_REGEX` requires the token to end
  // with `bin/droid` (with optional .js/.mjs/.cjs), matching the real
  // cmd-shim layout for both `@factory/cli` and `droid` packages.
  const allQuotedTokens = Array.from(targetLine.matchAll(/"([^"\r\n]+)"/g)).map((match) => match[1]);
  const preciseMatch = allQuotedTokens.find((token) => WINDOWS_CMD_SHIM_JS_ENTRYPOINT_REGEX.test(token));
  // Fallback: if the precise regex misses (unusual entrypoint name or an
  // absolute path that doesn't end with `bin/droid`), accept the first
  // quoted token that simply contains `node_modules/`. Trust the spawn to
  // surface the real error rather than silently dropping to the cmd.exe
  // fallback and hanging the SDK for 60 s.
  const looseMatch = allQuotedTokens.find((token) => WINDOWS_CMD_SHIM_NODE_MODULES_LINE_REGEX.test(token));
  const quotedTarget = preciseMatch || looseMatch;
  if (!quotedTarget) {
    logCmdShimDiagnostic(cmdPath, content, null);
    return null;
  }

  const normalizedToken = quotedTarget.replace(/\//g, '\\');
  const hasCmdDirMacro = /^%~?dp0%?\\/iu.test(normalizedToken);
  const relativeToken = (hasCmdDirMacro ? normalizedToken.replace(/^%~?dp0%?\\/iu, '') : normalizedToken).replace(
    /\\/g,
    path.sep
  );
  const resolvedPath = hasCmdDirMacro
    ? path.resolve(cmdDir, relativeToken)
    : isLikelyWindowsAbsolutePath(normalizedToken)
      ? path.normalize(normalizedToken.replace(/\\/g, path.sep))
      : path.resolve(cmdDir, relativeToken);

  const directHit = pickFirstExistingPath(jsExtensionVariantsOf(resolvedPath));
  if (directHit) {
    logCmdShimDiagnostic(cmdPath, content, directHit);
    return directHit;
  }

  const relativeSegments = relativeToken.split(path.sep).filter(Boolean);
  while (relativeSegments[0] === '.' || relativeSegments[0] === '..') {
    relativeSegments.shift();
  }

  const ancestorRelative = relativeSegments.join(path.sep);
  const ancestorHit =
    findExistingAncestorJoinedPath(cmdDir, ancestorRelative) ||
    findExistingAncestorJoinedPath(cmdDir, `${ancestorRelative}.js`) ||
    findExistingAncestorJoinedPath(cmdDir, `${ancestorRelative}.mjs`) ||
    findExistingAncestorJoinedPath(cmdDir, `${ancestorRelative}.cjs`);
  if (ancestorHit) {
    logCmdShimDiagnostic(cmdPath, content, ancestorHit);
    return ancestorHit;
  }

  // Parse-and-trust: the parser extracted a plausible JS entrypoint path but
  // none of the existsSync variants matched (stale snapshot, nonstandard
  // install layout, hardlink target missing, etc.). Returning the parsed path
  // anyway lets Node's `spawn` surface the real ENOENT in milliseconds —
  // which is drastically better UX than the alternative: falling through to
  // the cmd.exe shell wrapper and suffering a 60 s `initialize_session`
  // timeout on every SDK session creation. The diagnostic log captures the
  // parsed path so we can tell apart "valid path but fs returns false" from
  // "parser picked the wrong token".
  logCmdShimDiagnostic(cmdPath, content, resolvedPath);
  return resolvedPath;
}

function toDroidCliResolution(candidatePath: string, source: DroidCliSource): DroidCliResolution {
  if (process.platform === 'win32') {
    const ext = path.extname(candidatePath).toLowerCase();
    if (ext === '.cmd' || ext === '.bat') {
      const scriptPath = resolveWindowsCmdShimScriptPath(candidatePath);
      if (scriptPath) {
        return {
          execPath: getNodeCommandName(),
          execArgs: [scriptPath],
          source,
          // node + JS entrypoint is safe for both version probe AND SDK
          // JSON-RPC stream. Declared explicitly so downstream callers don't
          // have to rely on the undefined-means-true default.
          pipeCompatible: true,
        };
      }

      // node:child_process.spawn cannot directly execute .cmd/.bat files on
      // Windows without `shell: true`, but @factory/droid-sdk spawns the CLI
      // without shell. When we can't normalize the shim into `node + js`, fall
      // back to invoking the script via cmd.exe so the SDK still has a
      // launchable executable. This is the only safety net for users whose
      // npm-installed @factory/cli has a moved/renamed JS entrypoint or whose
      // npm prefix differs from the standard layout. NOTE: marked
      // `pipeCompatible: false` — version probe uses it, SDK session does not.
      return buildWindowsCmdShellFallback(candidatePath, source);
    }

    if (!ext && path.basename(candidatePath).toLowerCase() === getScriptShimName()) {
      return {
        execPath: getNodeCommandName(),
        execArgs: [candidatePath],
        source,
        pipeCompatible: true,
      };
    }
  }

  return {
    execPath: candidatePath,
    source,
    pipeCompatible: true,
  };
}

function resolveProjectInstalledDroidCandidate(): { rawPath: string; resolution: DroidCliResolution } | null {
  const candidates =
    process.platform === 'win32'
      ? [
          path.join(process.cwd(), 'node_modules', '@factory', 'cli', 'bin', getScriptShimName()),
          path.join(process.cwd(), 'node_modules', '@factory', 'cli', 'bin', getBinaryName()),
        ]
      : [path.join(process.cwd(), 'node_modules', '@factory', 'cli', 'bin', getBinaryName())];

  const rawPath = candidates.find((candidate) => existsSync(candidate));
  if (!rawPath) {
    return null;
  }

  return {
    rawPath,
    resolution: toDroidCliResolution(rawPath, 'bundled'),
  };
}

function resolveInstalledSystemDroidCandidates(): DroidCliResolution[] {
  const homeDir = os.homedir();
  const rawCandidates =
    process.platform === 'win32'
      ? [
          path.join(process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'), 'npm', 'droid.cmd'),
          path.join(process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'), 'npm', 'droid.exe'),
          path.join(process.env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local'), 'pnpm', 'droid.cmd'),
          path.join(homeDir, '.volta', 'bin', 'droid.cmd'),
          path.join(homeDir, '.bun', 'bin', 'droid.exe'),
          process.env.SCOOP
            ? path.join(process.env.SCOOP, 'shims', 'droid.cmd')
            : path.join(homeDir, 'scoop', 'shims', 'droid.cmd'),
        ]
      : [
          '/opt/homebrew/bin/droid',
          '/usr/local/bin/droid',
          path.join(homeDir, '.npm-global', 'bin', 'droid'),
          path.join(homeDir, '.volta', 'bin', 'droid'),
          path.join(homeDir, '.bun', 'bin', 'droid'),
          path.join(homeDir, '.local', 'bin', 'droid'),
        ];

  const seen = new Set<string>();
  const candidates: DroidCliResolution[] = [];

  for (const rawCandidate of rawCandidates) {
    if (!existsSync(rawCandidate)) {
      continue;
    }

    const resolution = toDroidCliResolution(rawCandidate, 'system');
    const key = normalizeCliResolutionKey(resolution);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    candidates.push(resolution);
  }

  return candidates;
}

export function getBundledDroidDir(): string | null {
  const runtimeKey = `${process.platform}-${process.arch}`;
  const cwdBundledDir = path.join(process.cwd(), 'resources', 'bundled-droid', runtimeKey);
  const runtimeResourcesRoot = getRuntimeResourcesRoot();
  const candidates = [
    runtimeResourcesRoot ? path.join(runtimeResourcesRoot, 'bundled-droid', runtimeKey) : null,
    cwdBundledDir,
  ];

  for (const bundledDir of candidates) {
    if (bundledDir && existsSync(bundledDir)) {
      return bundledDir;
    }
  }

  return null;
}

export function resolveBundledDroidBinary(): string | null {
  const bundledDir = getBundledDroidDir();
  if (!bundledDir) {
    return null;
  }

  const binaryPath = path.join(bundledDir, getBinaryName());
  return existsSync(binaryPath) ? binaryPath : null;
}

export function resolveDroidCliCandidates(configuredCliPath?: string | null): DroidCliResolution[] {
  const trimmedCliPath = configuredCliPath?.trim();
  const bundledBinaryPath = resolveBundledDroidBinary();
  const projectInstalledCandidate = resolveProjectInstalledDroidCandidate();
  const candidates: DroidCliResolution[] = [];

  if (trimmedCliPath && trimmedCliPath !== 'droid') {
    if (bundledBinaryPath && path.resolve(trimmedCliPath) === path.resolve(bundledBinaryPath)) {
      return [{ execPath: bundledBinaryPath, source: 'bundled', pipeCompatible: true }];
    }

    if (projectInstalledCandidate && path.resolve(trimmedCliPath) === path.resolve(projectInstalledCandidate.rawPath)) {
      return [projectInstalledCandidate.resolution];
    }

    return [toDroidCliResolution(trimmedCliPath, 'custom')];
  }

  // Prefer system-installed droid first — bundled binaries have proven unreliable
  // on some Windows machines (e.g. Bun baseline illegal instruction). Users are
  // expected to install @factory/cli globally via the in-app initializer.
  candidates.push(...resolveInstalledSystemDroidCandidates());
  candidates.push({
    execPath: trimmedCliPath || 'droid',
    source: 'system',
    pipeCompatible: true,
  });

  if (bundledBinaryPath) {
    candidates.push({ execPath: bundledBinaryPath, source: 'bundled', pipeCompatible: true });
  }

  if (projectInstalledCandidate) {
    candidates.push(projectInstalledCandidate.resolution);
  }

  return candidates;
}

export function resolveDroidCliPath(configuredCliPath?: string | null): DroidCliResolution {
  return (
    resolveDroidCliCandidates(configuredCliPath)[0] || { execPath: 'droid', source: 'system', pipeCompatible: true }
  );
}
