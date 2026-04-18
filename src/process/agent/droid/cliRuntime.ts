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
  options?: RunDroidCliCommandOptions
): CliCommandResult {
  try {
    return {
      output: normalizeCliOutput(
        execFileSync(execPath, args, {
          encoding: 'utf-8',
          timeout: 5000,
          env: getDroidCliCommandEnv(options),
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

export function resolveWorkingDroidCli(configuredCliPath?: string | null): WorkingDroidCliResult {
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
