/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * OfficeCli Installer Service
 *
 * Single source of truth for locating, installing, and update-checking the
 * external `officecli` binary used by the Office watch bridges (Word, Excel,
 * PPT). Extracted from the duplicated install helpers previously embedded in
 * `officeWatchBridge.ts` and `pptPreviewBridge.ts`.
 *
 * Behavior:
 * - Multi-path resolution tries `PATH` (via `which`/`where`) first and then
 *   falls back to a platform-specific list of well-known absolute paths.
 * - Install runs are deduped through an in-process mutex so concurrent callers
 *   share one attempt, and respect a 5-minute cooldown after the most recent
 *   failure (no disk persistence — process restart clears the cooldown).
 * - Background update check uses the `.officecli-update-check` marker under
 *   the app data directory; `scheduleOfficecliUpdateCheck` is idempotent per
 *   process (tracked by a module-scope flag).
 *
 * This module never imports `electron`; it reads the data directory via
 * `getPlatformServices()` and is safe to load from main-process bridges.
 */

import { spawn, execSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getPlatformServices } from '@/common/platform';
import { getEnhancedEnv } from '@process/utils/shellEnv';

export type OfficeCliInstallStatus = {
  state: 'idle' | 'installing' | 'installed' | 'failed';
  message?: string;
  lastAttemptAt?: number;
};

export type OfficeCliHintPlatform = 'darwin' | 'linux' | 'win32' | 'other';

export interface OfficeCliFailureHint {
  platform: OfficeCliHintPlatform;
  hintKey: string;
  manualCommand: string;
  manualInstallUrl: string;
}

export type OfficeCliStatusListener = (status: OfficeCliInstallStatus) => void;

/** Cooldown applied after a failed install attempt. */
export const OFFICECLI_FAILURE_COOLDOWN_MS = 5 * 60 * 1000;

/** URL of the OfficeCli project; shown in the UI's manual install guide. */
export const OFFICECLI_MANUAL_INSTALL_URL = 'https://github.com/iOfficeAI/OfficeCli';

const MANUAL_COMMAND_UNIX = 'curl -fsSL https://raw.githubusercontent.com/iOfficeAI/OfficeCli/main/install.sh | bash';
const MANUAL_COMMAND_WIN =
  'powershell -NoProfile -Command "irm https://raw.githubusercontent.com/iOfficeAI/OfficeCli/main/install.ps1 | iex"';

const UPDATE_CHECK_MARKER = '.officecli-update-check';
const UPDATE_CHECK_TTL_MS = 24 * 60 * 60 * 1000;
const INSTALL_TIMEOUT_MS = 120_000;
const RESOLVE_PATH_TIMEOUT_MS = 2_000;

/** Resolved absolute paths cache — cleared whenever an install runs. */
let resolveCache: string | null | undefined;

/** In-flight install promise so concurrent callers share one attempt. */
let pendingInstall: Promise<boolean> | null = null;

/** Epoch (ms) of the most recent failed install attempt; drives the cooldown. */
let lastFailureAt: number | null = null;

/** Latest reported status for `getStatus()` consumers. */
let currentStatus: OfficeCliInstallStatus = { state: 'idle' };

/** Guards `scheduleOfficecliUpdateCheck` to one fire per process. */
let hasScheduledUpdateCheck = false;

/**
 * Expand leading `~` / Windows `%VAR%` tokens in a path candidate.
 * Unknown `%VAR%` references are left intact — callers must check `existsSync`.
 */
function expandPathTokens(candidate: string): string {
  let expanded = candidate;
  if (expanded.startsWith('~')) {
    expanded = path.join(os.homedir(), expanded.slice(1));
  }
  expanded = expanded.replace(/%([^%]+)%/g, (match, name: string) => {
    const value = process.env[name];
    return value ?? match;
  });
  return expanded;
}

/**
 * Return the list of absolute-path candidates to probe for `officecli` on the
 * current platform. Order: highest-confidence locations first.
 */
function getCandidatePaths(): string[] {
  const home = os.homedir();
  if (process.platform === 'win32') {
    const userProfile = process.env.USERPROFILE ?? home;
    const localAppData = process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local');
    const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
    return [
      path.join(userProfile, '.officecli', 'bin', 'officecli.exe'),
      path.join(localAppData, 'OfficeCli', 'bin', 'officecli.exe'),
      path.join(programFiles, 'OfficeCli', 'officecli.exe'),
    ].map(expandPathTokens);
  }
  return [
    path.join(home, '.local', 'bin', 'officecli'),
    path.join(home, '.deno', 'bin', 'officecli'),
    '/usr/local/bin/officecli',
    '/opt/homebrew/bin/officecli',
    '/usr/bin/officecli',
  ].map(expandPathTokens);
}

/**
 * Probe `PATH` for a working `officecli` binary. Uses `which`/`where` via
 * `execSync` with a 2-second timeout; falls back to `null` on any failure so
 * callers can attempt the candidate list instead.
 */
function probePathLookup(): string | null {
  const probeCmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    const output = execSync(`${probeCmd} officecli`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: RESOLVE_PATH_TIMEOUT_MS,
      env: getEnhancedEnv(),
      windowsHide: true,
    })
      .trim()
      .split(/\r?\n/)[0];
    if (output && fs.existsSync(output)) {
      return output;
    }
  } catch {
    // PATH lookup failed; caller continues to the fallback list.
  }
  return null;
}

/**
 * Resolve the officecli binary path.
 *
 * Returns `'officecli'` when the binary is discoverable via `PATH`; otherwise
 * returns the first existing absolute path from the platform-specific
 * candidate list; otherwise returns `null`.
 */
export async function resolveOfficecliPath(): Promise<string | null> {
  if (resolveCache !== undefined) {
    return resolveCache;
  }

  const pathLookup = probePathLookup();
  if (pathLookup) {
    resolveCache = 'officecli';
    return resolveCache;
  }

  for (const candidate of getCandidatePaths()) {
    try {
      if (fs.existsSync(candidate)) {
        resolveCache = candidate;
        return candidate;
      }
    } catch {
      // ignore — keep scanning the remaining candidates
    }
  }

  resolveCache = null;
  return null;
}

/**
 * Exposed for tests — drop the cached resolution and install mutex so
 * subsequent calls re-probe.
 */
export function __resetOfficeCliInstallerForTests(): void {
  resolveCache = undefined;
  pendingInstall = null;
  lastFailureAt = null;
  currentStatus = { state: 'idle' };
  hasScheduledUpdateCheck = false;
}

function setStatus(listener: OfficeCliStatusListener | undefined, next: OfficeCliInstallStatus): void {
  currentStatus = next;
  if (listener) {
    try {
      listener(next);
    } catch (err) {
      console.error('[OfficeCliInstaller] Status listener threw:', err);
    }
  }
}

/**
 * Classify a Windows install failure stderr payload. We look for the two
 * strings PowerShell surfaces when ExecutionPolicy blocks the install script.
 */
function isWindowsExecutionPolicyError(stderr: string): boolean {
  if (!stderr) return false;
  const lower = stderr.toLowerCase();
  return lower.includes('execution of scripts is disabled') || lower.includes('unauthorizedaccess');
}

/**
 * Run the platform install command. Returns `{ ok, stderr }` so the caller
 * can map Windows-specific failures to structured hints.
 */
function runInstallCommand(): { ok: boolean; stderr: string } {
  try {
    if (process.platform === 'win32') {
      execSync(MANUAL_COMMAND_WIN, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: INSTALL_TIMEOUT_MS });
    } else {
      execSync(MANUAL_COMMAND_UNIX, { stdio: ['ignore', 'pipe', 'pipe'], timeout: INSTALL_TIMEOUT_MS });
      try {
        execSync('xattr -cr ~/.local/bin/officecli && codesign -s - --force ~/.local/bin/officecli', {
          stdio: 'pipe',
        });
      } catch {
        // Non-fatal — macOS quarantine/codesign may not apply on all platforms.
      }
    }
    return { ok: true, stderr: '' };
  } catch (err) {
    const stderr = extractStderr(err);
    console.error('[OfficeCliInstaller] Install failed:', err instanceof Error ? err.message : String(err));
    return { ok: false, stderr };
  }
}

function extractStderr(err: unknown): string {
  if (!err || typeof err !== 'object') return '';
  const candidate = err as { stderr?: Buffer | string; message?: string };
  if (candidate.stderr) {
    return typeof candidate.stderr === 'string' ? candidate.stderr : candidate.stderr.toString('utf-8');
  }
  return candidate.message ?? '';
}

/**
 * Run the install script. Callers share the same underlying promise through
 * an in-process mutex; repeated failures are gated by a 5-minute cooldown.
 *
 * Returns `true` on success. A `false` result during the cooldown window sets
 * `currentStatus.message = 'cooldown'` so the viewer can surface the
 * cooldown hint without re-triggering installs.
 */
export function installOfficecli(onStatus?: OfficeCliStatusListener): Promise<boolean> {
  if (pendingInstall) {
    return pendingInstall;
  }

  if (lastFailureAt !== null && Date.now() - lastFailureAt < OFFICECLI_FAILURE_COOLDOWN_MS) {
    const status: OfficeCliInstallStatus = {
      state: 'failed',
      message: 'cooldown',
      lastAttemptAt: lastFailureAt,
    };
    setStatus(onStatus, status);
    return Promise.resolve(false);
  }

  pendingInstall = (async () => {
    const attemptedAt = Date.now();
    setStatus(onStatus, { state: 'installing', lastAttemptAt: attemptedAt });

    const { ok, stderr } = runInstallCommand();
    // Drop the path cache so callers re-probe after the install command runs.
    resolveCache = undefined;

    if (!ok) {
      lastFailureAt = Date.now();
      const messageBits: string[] = [];
      if (process.platform === 'win32' && isWindowsExecutionPolicyError(stderr)) {
        messageBits.push('windowsExecutionPolicy');
      }
      if (stderr) {
        messageBits.push(stderr.trim().slice(0, 200));
      }
      setStatus(onStatus, {
        state: 'failed',
        message: messageBits.join('|') || 'install-failed',
        lastAttemptAt: attemptedAt,
      });
      return false;
    }

    // Install command completed successfully. We do NOT re-probe the resolved
    // binary here — the caller's retry spawn will surface a second ENOENT
    // faster than a redundant `which` + stat sweep, and avoiding the probe
    // keeps tests that only mock `execSync`/`realpathSync` (not `existsSync`)
    // working unchanged.
    lastFailureAt = null;
    setStatus(onStatus, { state: 'installed', lastAttemptAt: attemptedAt });
    return true;
  })().finally(() => {
    pendingInstall = null;
  });

  return pendingInstall;
}

/**
 * Read the current installer status. Used by IPC handlers exposed from
 * `initOfficeCliBridge`.
 */
export function getOfficecliStatus(): OfficeCliInstallStatus {
  return { ...currentStatus };
}

function getUpdateMarkerPath(): string | null {
  try {
    const dataDir = getPlatformServices().paths.getDataDir();
    return path.join(dataDir, UPDATE_CHECK_MARKER);
  } catch {
    return null;
  }
}

function getLatestRemoteVersion(): string | null {
  try {
    const effective = execSync(`curl -fsSL -o /dev/null -w "%{url_effective}" ${OFFICECLI_MANUAL_INSTALL_URL}/releases/latest`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10_000,
      windowsHide: true,
    }).trim();
    const tail = effective.split('/').pop() ?? '';
    const remote = tail.replace(/^v/, '').trim();
    return remote.length > 0 ? remote : null;
  } catch {
    return null;
  }
}

function getLocalOfficecliVersion(): string | null {
  try {
    const output = execSync('officecli --version', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000,
      windowsHide: true,
    }).trim();
    return output.length > 0 ? output : null;
  } catch {
    return null;
  }
}

function runUpdateCheckAsync(markerPath: string, onStatus?: OfficeCliStatusListener): void {
  setTimeout(() => {
    try {
      const stat = fs.statSync(markerPath);
      if (Date.now() - stat.mtimeMs < UPDATE_CHECK_TTL_MS) {
        return;
      }
    } catch {
      // Marker not present — first run, continue with the check.
    }

    try {
      fs.writeFileSync(markerPath, '');
    } catch {
      // Non-fatal — update check is best-effort.
    }

    const local = getLocalOfficecliVersion();
    if (!local) return;
    const remote = getLatestRemoteVersion();
    if (!remote || remote === local) return;

    void installOfficecli(onStatus);
  }, 5000);
}

/**
 * Fire-and-forget background update check. The first call within a process
 * schedules the check; subsequent calls are no-ops. On disk, the check is
 * additionally gated by a 24-hour marker file so multiple process starts
 * per day don't repeat the network work.
 *
 * `onStatus` forwards transitions (e.g. `installing`) to the caller's IPC
 * emitter so the UI can surface the ongoing update attempt.
 */
export function scheduleOfficecliUpdateCheck(onStatus?: OfficeCliStatusListener): void {
  if (hasScheduledUpdateCheck) return;
  hasScheduledUpdateCheck = true;

  const markerPath = getUpdateMarkerPath();
  if (!markerPath) {
    // Platform services not registered — bail silently; the bridges can still
    // trigger manual installs, update check is best-effort.
    return;
  }

  runUpdateCheckAsync(markerPath, onStatus);
}

/**
 * Build a structured failure hint for the viewer. Inspects the error stderr
 * (if any) to detect Windows ExecutionPolicy blocking, and always returns a
 * platform-appropriate `hintKey` + `manualCommand`.
 */
export function buildOfficecliFailureHint(error: unknown): OfficeCliFailureHint {
  const platform: OfficeCliHintPlatform =
    process.platform === 'darwin'
      ? 'darwin'
      : process.platform === 'linux'
        ? 'linux'
        : process.platform === 'win32'
          ? 'win32'
          : 'other';

  if (platform === 'win32') {
    const stderr = extractStderr(error);
    if (isWindowsExecutionPolicyError(stderr)) {
      return {
        platform,
        hintKey: 'preview.officecli.hints.windowsExecutionPolicy',
        manualCommand: MANUAL_COMMAND_WIN,
        manualInstallUrl: OFFICECLI_MANUAL_INSTALL_URL,
      };
    }
    return {
      platform,
      hintKey: 'preview.officecli.hints.windowsGeneric',
      manualCommand: MANUAL_COMMAND_WIN,
      manualInstallUrl: OFFICECLI_MANUAL_INSTALL_URL,
    };
  }

  return {
    platform,
    hintKey: platform === 'darwin' ? 'preview.officecli.hints.darwin' : 'preview.officecli.hints.linux',
    manualCommand: MANUAL_COMMAND_UNIX,
    manualInstallUrl: OFFICECLI_MANUAL_INSTALL_URL,
  };
}

/**
 * Spawn an `officecli watch` child process using the resolved binary path.
 * Bridges rely on this helper so they don't need to duplicate path resolution
 * or env-enhancement logic; a `null` result signals the caller should fall
 * back to install + retry.
 */
export async function spawnOfficecliWatch(filePath: string, args: readonly string[]): Promise<ChildProcess | null> {
  const resolved = await resolveOfficecliPath();
  if (!resolved) {
    return null;
  }
  const executable = resolved === 'officecli' ? 'officecli' : resolved;
  return spawn(executable, ['watch', filePath, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: getEnhancedEnv(),
    windowsHide: true,
  });
}
