/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFileSync } from 'node:child_process';
import { getEnhancedEnv } from '@process/utils/shellEnv';
import { mainLog, mainWarn } from '@process/utils/mainLogger';
import type { DroidCliDiagnostic } from '@/common/types/acpTypes';
import { resolveDroidCliCandidates, type DroidCliResolution, type DroidCliSource } from './cliResolver';

export type CliCommandResult = {
  output: string | null;
  error?: string;
};

export type WorkingDroidCliResult = DroidCliResolution & {
  version: string | null;
  cliPath: string | null;
  error?: string;
  diagnostic?: DroidCliDiagnostic;
};

type ExecFileSyncError = Error & {
  stdout?: string | Buffer | null;
};

type RunDroidCliCommandOptions = {
  source?: DroidCliSource;
  execArgs?: string[];
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
const MISSING_PLATFORM_BINARY_PATTERN =
  /(Could not find the droid binary for|@factory\/cli-(?:win32|darwin|linux)-[^\s'"`]+|Cannot find module ['"]@factory\/cli-(?:win32|darwin|linux)-[^'"]+)/iu;
const CLI_NOT_FOUND_PATTERN =
  /(spawnSync [^\r\n]+ ENOENT|\bENOENT\b|is not recognized as an internal or external command|command not found|not found\b)/iu;
const PROBE_TIMEOUT_PATTERN = /(ETIMEDOUT|timed out|initialize_session.*timed out)/iu;
const DROID_CLI_DIAGNOSTIC_PRIORITY: Record<DroidCliDiagnostic['code'], number> = {
  'missing-platform-binary': 4,
  'cli-not-found': 3,
  'probe-timeout': 2,
  'cmd-shim-pipe-incompatible': 1,
  unknown: 0,
};

function buildCacheKey(configuredCliPath?: string | null): string {
  return configuredCliPath?.trim() || '__default__';
}

export function resetDroidCliRuntimeCache(): void {
  workingCliCache.clear();
}

function classifyDroidCliDiagnosticCode(detail: string): DroidCliDiagnostic['code'] | undefined {
  if (!detail) {
    return undefined;
  }
  if (MISSING_PLATFORM_BINARY_PATTERN.test(detail)) {
    return 'missing-platform-binary';
  }
  if (CLI_NOT_FOUND_PATTERN.test(detail)) {
    return 'cli-not-found';
  }
  if (PROBE_TIMEOUT_PATTERN.test(detail)) {
    return 'probe-timeout';
  }
  return undefined;
}

export function createDroidCliDiagnostic(
  error: unknown,
  stage: DroidCliDiagnostic['stage']
): DroidCliDiagnostic | undefined {
  const detail = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const code = classifyDroidCliDiagnosticCode(detail);
  return code ? { code, stage, detail } : undefined;
}

export function createCmdShimPipeIncompatibleDiagnostic(detail: string): DroidCliDiagnostic {
  return {
    code: 'cmd-shim-pipe-incompatible',
    stage: 'preflight',
    detail,
  };
}

export function pickMostRelevantDroidCliDiagnostic(
  diagnostics: Array<DroidCliDiagnostic | null | undefined>
): DroidCliDiagnostic | undefined {
  return diagnostics
    .filter((diagnostic): diagnostic is DroidCliDiagnostic => Boolean(diagnostic))
    .toSorted((left, right) => DROID_CLI_DIAGNOSTIC_PRIORITY[right.code] - DROID_CLI_DIAGNOSTIC_PRIORITY[left.code])[0];
}

export function resolvePreferredDroidCliDiagnostic(
  sessionDiagnostic: DroidCliDiagnostic | undefined,
  preflightDiagnostic: DroidCliDiagnostic | undefined
): DroidCliDiagnostic | undefined {
  if (sessionDiagnostic) {
    return pickMostRelevantDroidCliDiagnostic([sessionDiagnostic, preflightDiagnostic]);
  }
  if (preflightDiagnostic && preflightDiagnostic.code !== 'probe-timeout') {
    return preflightDiagnostic;
  }
  return undefined;
}

export function toDroidCliDiagnosticUserMessage(
  diagnostic: DroidCliDiagnostic | undefined,
  fallbackMessage: string
): string {
  if (!diagnostic) {
    return fallbackMessage;
  }

  switch (diagnostic.code) {
    case 'missing-platform-binary':
      return `The Windows Droid CLI install is incomplete because its platform binary package is missing. Reinstall or update @factory/cli, then retry. (${diagnostic.detail})`;
    case 'cli-not-found':
      return `Droid CLI is not installed or is not available on PATH for this Windows account. Reinstall or repair @factory/cli, then retry. (${diagnostic.detail})`;
    case 'probe-timeout':
      return `Droid CLI is starting too slowly on Windows. Retry after it warms up; if this keeps happening, reinstall/update @factory/cli and check antivirus or filesystem latency. (${diagnostic.detail})`;
    case 'cmd-shim-pipe-incompatible':
      return fallbackMessage;
    default:
      return fallbackMessage;
  }
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
    const fullArgs = [...(options?.execArgs || []), ...args];
    return {
      output: normalizeCliOutput(
        execFileSync(execPath, fullArgs, {
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
  const sourceBiased =
    trimmedCliPath && trimmedCliPath !== 'droid'
      ? candidates
      : (() => {
          const systemCandidate = candidates.find((candidate) => candidate.source === 'system');
          if (!systemCandidate) {
            return candidates;
          }
          return [systemCandidate, ...candidates.filter((candidate) => candidate !== systemCandidate)];
        })();

  // Two-stage priority:
  // 1. pipe-compatible candidates first — these can BOTH answer `--version`
  //    AND serve as the SDK's JSON-RPC pipe target for `createSession`.
  // 2. non-pipe-compatible (cmd.exe shell wrapper) last — only used as a
  //    last resort so we can still report the CLI version to the user; any
  //    downstream SDK caller must refuse these candidates (see
  //    DroidSdkAgent.startSession / modelProbe.ts).
  const pipeCompatible = sourceBiased.filter((candidate) => candidate.pipeCompatible !== false);
  const nonPipeCompatible = sourceBiased.filter((candidate) => candidate.pipeCompatible === false);
  return [...pipeCompatible, ...nonPipeCompatible];
}

function probeWorkingDroidCli(configuredCliPath?: string | null): WorkingDroidCliResult {
  const candidates = prioritizeCliCandidates(resolveDroidCliCandidates(configuredCliPath), configuredCliPath);
  const fallbackCandidate = candidates[0] || { execPath: 'droid', source: 'system' };
  let lastError: string | undefined;
  const candidateDiagnostics: DroidCliDiagnostic[] = [];

  mainLog('[DroidCliRuntime]', 'Probing droid CLI candidates', {
    configuredCliPath: configuredCliPath || null,
    candidateCount: candidates.length,
    candidates: candidates.map((candidate) => ({
      source: candidate.source,
      execPath: candidate.execPath,
      execArgs: candidate.execArgs,
    })),
  });

  for (const candidate of candidates) {
    const versionResult = runDroidCliCommand(candidate.execPath, ['--version'], {
      source: candidate.source,
      execArgs: candidate.execArgs,
    });

    if (versionResult.output && !isPlaceholderCliOutput(versionResult.output)) {
      mainLog('[DroidCliRuntime]', 'Selected working droid CLI candidate', {
        source: candidate.source,
        execPath: candidate.execPath,
        execArgs: candidate.execArgs,
        pipeCompatible: candidate.pipeCompatible !== false,
        version: versionResult.output,
      });
      if (candidate.pipeCompatible === false) {
        mainWarn(
          '[DroidCliRuntime]',
          'Selected candidate is NOT pipe-compatible (cmd.exe shell wrapper). Version probe works, but SDK createSession will be refused. Reinstall @factory/cli so the JS entrypoint is discoverable.',
          {
            source: candidate.source,
            execPath: candidate.execPath,
            execArgs: candidate.execArgs,
          }
        );
      }
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
        ...(candidate.pipeCompatible === false
          ? {
              diagnostic: createCmdShimPipeIncompatibleDiagnostic(
                `Selected ${candidate.execPath} ${candidate.execArgs?.join(' ') || ''}`.trim()
              ),
            }
          : {}),
      };
    }

    const candidateError = isPlaceholderCliOutput(versionResult.output)
      ? 'Bundled droid binary is a placeholder'
      : versionResult.error;
    const diagnostic = createDroidCliDiagnostic(candidateError, 'preflight');
    mainWarn('[DroidCliRuntime]', 'Droid CLI candidate probe failed', {
      source: candidate.source,
      execPath: candidate.execPath,
      execArgs: candidate.execArgs,
      output: versionResult.output,
      error: candidateError,
      diagnosticCode: diagnostic?.code,
    });
    if (diagnostic) {
      candidateDiagnostics.push(diagnostic);
    }
    lastError = candidateError || lastError;
  }

  const diagnostic = pickMostRelevantDroidCliDiagnostic(candidateDiagnostics);

  mainWarn('[DroidCliRuntime]', 'All droid CLI candidates failed; returning fallback without version', {
    source: fallbackCandidate.source,
    execPath: fallbackCandidate.execPath,
    execArgs: fallbackCandidate.execArgs,
    error: lastError,
    diagnosticCode: diagnostic?.code,
  });

  return {
    ...fallbackCandidate,
    version: null,
    cliPath: fallbackCandidate.source === 'system' ? null : fallbackCandidate.execPath,
    ...(lastError ? { error: lastError } : {}),
    ...(diagnostic ? { diagnostic } : {}),
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
