/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFileSync } from 'node:child_process';
import { getEnhancedEnv } from '@process/utils/shellEnv';
import { resolveDroidCliCandidates, type DroidCliResolution, type DroidCliSource } from './cliResolver';

export type CliCommandResult = {
  output: string | null;
  error?: string;
};

export type WorkingDroidCliResult = DroidCliResolution & {
  version: string | null;
  cliPath: string | null;
  error?: string;
};

type ExecFileSyncError = Error & {
  stdout?: string | Buffer | null;
};

type RunDroidCliCommandOptions = {
  source?: DroidCliSource;
};

/**
 * Windows `droid` is usually an npm-installed `.cmd` shim that re-spawns node +
 * cli.js. Cold start (Defender scan, cmd.exe chain, network telemetry on slow
 * Chinese networks) can easily exceed 5 seconds. We probe with 15s on first
 * call and cache the result for the rest of the process lifetime to avoid
 * re-running the expensive sync probe during every startSession.
 */
const DROID_CLI_VERSION_PROBE_TIMEOUT_MS = 15000;
const workingCliCache = new Map<string, WorkingDroidCliResult>();

function buildCacheKey(configuredCliPath?: string | null): string {
  return configuredCliPath?.trim() || '__default__';
}

export function resetDroidCliRuntimeCache(): void {
  workingCliCache.clear();
}

function normalizeCliOutput(output: string): string {
  return (
    output
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find(Boolean) || output.trim()
  );
}

function getDroidCliCommandEnv(options?: RunDroidCliCommandOptions): Record<string, string> {
  return getEnhancedEnv(undefined, {
    includeBundledDroidInPath: options?.source !== 'system',
  });
}

export function runDroidCliCommand(
  execPath: string,
  args: string[],
  options?: RunDroidCliCommandOptions & { timeoutMs?: number }
): CliCommandResult {
  try {
    return {
      output: normalizeCliOutput(
        execFileSync(execPath, args, {
          encoding: 'utf-8',
          timeout: options?.timeoutMs ?? DROID_CLI_VERSION_PROBE_TIMEOUT_MS,
          env: getDroidCliCommandEnv(options),
          // On Windows, npm-installed droid is a `.cmd` shim. Without
          // windowsHide, cmd.exe briefly flashes a console window every
          // probe — also making the spawn slightly more expensive.
          windowsHide: true,
        }).trim()
      ),
    };
  } catch (error) {
    const errorOutput =
      error && typeof error === 'object' && 'stdout' in error ? (error as ExecFileSyncError).stdout : null;
    const partialOutput =
      typeof errorOutput === 'string'
        ? errorOutput
        : errorOutput instanceof Buffer
          ? errorOutput.toString('utf-8')
          : null;

    return {
      output: partialOutput ? normalizeCliOutput(partialOutput) : null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function isPlaceholderCliOutput(output: string | null): boolean {
  return Boolean(output && /placeholder/i.test(output));
}

function prioritizeCliCandidates(
  candidates: DroidCliResolution[],
  configuredCliPath?: string | null
): DroidCliResolution[] {
  const trimmedCliPath = configuredCliPath?.trim();
  if (trimmedCliPath && trimmedCliPath !== 'droid') {
    return candidates;
  }

  const systemCandidate = candidates.find((candidate) => candidate.source === 'system');
  if (!systemCandidate) {
    return candidates;
  }

  return [systemCandidate, ...candidates.filter((candidate) => candidate !== systemCandidate)];
}

function probeWorkingDroidCli(configuredCliPath?: string | null): WorkingDroidCliResult {
  const candidates = prioritizeCliCandidates(resolveDroidCliCandidates(configuredCliPath), configuredCliPath);
  const fallbackCandidate = candidates[0] || { execPath: 'droid', source: 'system' };
  let lastError: string | undefined;

  for (const candidate of candidates) {
    const versionResult = runDroidCliCommand(candidate.execPath, ['--version'], {
      source: candidate.source,
    });

    if (versionResult.output && !isPlaceholderCliOutput(versionResult.output)) {
      // NOTE: Do NOT shell out to `where` / `which` here to resolve a pretty
      // absolute path. On non-UTF-8 Windows code pages (e.g. CP936 for
      // Simplified Chinese), `where.exe` emits paths in the system ANSI code
      // page while Node decodes them as UTF-8 — producing mojibake such as
      // `C:\Users\????\bin\droid.exe`. That broken string then flows into
      // spawn() and fails with ENOENT. Leaving `execPath` as the bare name
      // lets Windows' `CreateProcessW` (and POSIX exec) do the PATH lookup
      // natively in Unicode, which handles CJK user directories correctly.
      return {
        ...candidate,
        version: versionResult.output,
        cliPath: candidate.source === 'system' ? null : candidate.execPath,
      };
    }

    lastError =
      (isPlaceholderCliOutput(versionResult.output) ? 'Bundled droid binary is a placeholder' : versionResult.error) ||
      lastError;
  }

  return {
    ...fallbackCandidate,
    version: null,
    cliPath: fallbackCandidate.source === 'system' ? null : fallbackCandidate.execPath,
    ...(lastError ? { error: lastError } : {}),
  };
}

/**
 * Resolve the working droid CLI. Result is cached for the lifetime of the main
 * process to avoid repeated `execFileSync droid --version` on Windows where
 * each probe pays a 3–10 second cold-start penalty (Defender scan, cmd.exe
 * shim, telemetry). Callers that need a fresh probe can call
 * {@link resetDroidCliRuntimeCache} first.
 */
export function resolveWorkingDroidCli(configuredCliPath?: string | null): WorkingDroidCliResult {
  const cacheKey = buildCacheKey(configuredCliPath);
  const cached = workingCliCache.get(cacheKey);
  if (cached && cached.version) {
    return cached;
  }

  const result = probeWorkingDroidCli(configuredCliPath);
  // Only cache successful probes. A failed probe may be due to transient
  // issues (AV scan, network blip) and should be retried next time.
  if (result.version) {
    workingCliCache.set(cacheKey, result);
  }
  return result;
}
