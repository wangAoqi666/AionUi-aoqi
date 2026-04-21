/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * PPT Preview Bridge
 *
 * Manages officecli watch child processes for live PPT preview.
 * Each pptx file gets one watch process on a unique port.
 * The renderer loads http://localhost:<port> in a webview.
 *
 * Install / update / path resolution is delegated to the shared
 * `OfficeCliInstaller` service so PPT and Word/Excel bridges share exactly
 * one install pipeline.
 */

import { ipcBridge } from '@/common';
import type { IOfficeCliStatusPayload } from '@/common/adapter/ipcBridge';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import { getEnhancedEnv } from '@process/utils/shellEnv';
import {
  buildOfficecliFailureHint,
  installOfficecli,
  resolveOfficecliPath,
  scheduleOfficecliUpdateCheck,
  type OfficeCliInstallStatus,
} from '@process/bridge/services/OfficeCliInstaller';

interface WatchSession {
  process: ChildProcess;
  port: number;
  aborted: boolean;
}

// Track sessions by filePath — process is tracked immediately after spawn
const sessions = new Map<string, WatchSession>();
// Pending kill timers — delayed stop allows Strict Mode re-mount to reuse sessions
const pendingKills = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Find a free TCP port by binding to port 0.
 */
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('Failed to get port')));
      }
    });
    server.on('error', reject);
  });
}

/**
 * Wait until a TCP connection to localhost:port succeeds.
 */
function waitForPort(port: number, maxRetries = 20, interval = 100): Promise<void> {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    const tryConnect = () => {
      const socket = net.connect(port, '127.0.0.1');
      socket.on('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.on('error', () => {
        socket.destroy();
        attempt++;
        if (attempt >= maxRetries) {
          reject(new Error(`Port ${port} not ready after ${maxRetries} attempts`));
        } else {
          setTimeout(tryConnect, interval);
        }
      });
    };
    tryConnect();
  });
}

/**
 * Kill an existing session and remove it from the map.
 */
function killSession(filePath: string): void {
  const session = sessions.get(filePath);
  if (session) {
    session.aborted = true;
    session.process.kill();
    sessions.delete(filePath);
  }
}

/**
 * Forward installer status transitions to the bridge's IPC emitter. Maps the
 * installer state into the PPT bridge's `IOfficeCliStatusPayload` shape.
 */
function forwardInstallStatus(emit: (payload: IOfficeCliStatusPayload) => void): (status: OfficeCliInstallStatus) => void {
  return (status) => {
    if (status.state === 'installing') {
      emit({ state: 'installing' });
    }
    // 'installed' / 'idle' / 'failed' transitions don't translate directly —
    // the bridge emits `ready`/`error` from its own port-ready / spawn-error
    // branches so the hint metadata can be attached.
  };
}

/**
 * Resolve the executable path for the retry spawn. Falls back to bare
 * `'officecli'` when no absolute path was located so the retry still surfaces
 * a clean ENOENT instead of a `spawn <null>` crash.
 */
async function resolveSpawnTarget(): Promise<string> {
  const resolved = await resolveOfficecliPath();
  if (resolved && resolved !== 'officecli') {
    return resolved;
  }
  return 'officecli';
}

/**
 * Start an officecli watch process and wait for the server URL.
 * Reuses an existing healthy session if one is already running.
 * Auto-installs officecli on first use if not found.
 */
async function startWatch(filePath: string, retry = false): Promise<string> {
  // Resolve symlinks so the pipe name matches what officecli commands compute
  try {
    filePath = fs.realpathSync(filePath);
  } catch {
    // If realpath fails, use original path
  }

  // Cancel any pending delayed kill (Strict Mode re-mount)
  const pendingTimer = pendingKills.get(filePath);
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingKills.delete(filePath);
  }

  // Reuse existing session if process is still alive
  const existing = sessions.get(filePath);
  if (existing && !existing.aborted && existing.process.exitCode === null) {
    const url = `http://localhost:${existing.port}`;
    return url;
  }

  // Kill any existing/pending session for this file first
  killSession(filePath);

  const port = await findFreePort();

  ipcBridge.pptPreview.status.emit({ state: 'starting' });

  // First spawn uses bare `'officecli'` so missing binaries surface as ENOENT.
  // Retry uses `resolveSpawnTarget()` which still falls back to `'officecli'`
  // when nothing concrete was located, so the child-process layer is free to
  // surface its own error without needing a synthetic `spawn <null>` path.
  const executable = retry ? await resolveSpawnTarget() : 'officecli';
  const child = spawn(executable, ['watch', filePath, '--port', String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: getEnhancedEnv(),
    windowsHide: true,
  });

  // Track session immediately so stop can kill it
  const session: WatchSession = { process: child, port, aborted: false };
  sessions.set(filePath, session);

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        killSession(filePath);
        reject(new Error('officecli watch timed out'));
      }
    }, 15000);

    const settle = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (err) reject(err);
    };

    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      if (!settled && text.includes('Watch:')) {
        // Check if session was aborted while we waited for stdout
        if (session.aborted) {
          settle(new Error('Watch session was aborted'));
          return;
        }
        const url = `http://localhost:${port}`;
        waitForPort(port)
          .then(() => {
            if (session.aborted) {
              settle(new Error('Watch session was aborted'));
              return;
            }
            if (!settled) {
              settled = true;
              clearTimeout(timeout);
              resolve(url);
            }
          })
          .catch(() => {
            settle(new Error('officecli watch server did not become ready'));
            killSession(filePath);
          });
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      console.error('[pptPreview] officecli stderr:', data.toString().trim());
    });

    child.on('error', (err) => {
      console.error('[pptPreview] spawn error:', err.message);
      sessions.delete(filePath);
      if ((err as NodeJS.ErrnoException).code === 'ENOENT' && !retry) {
        // officecli not found — try auto-install then retry once.
        // Preemptively mark as settled + clear the outer timeout so a
        // concurrent `exit` event (real child processes emit both `error`
        // and `exit` for ENOENT) cannot hijack the final rejection reason
        // with "officecli exited with code null" before our install path
        // completes. The install path calls resolve/reject directly.
        settled = true;
        clearTimeout(timeout);
        const emit = (payload: IOfficeCliStatusPayload) => ipcBridge.pptPreview.status.emit(payload);
        void installOfficecli(forwardInstallStatus(emit)).then((ok) => {
          if (ok) {
            startWatch(filePath, true).then(resolve, reject);
            return;
          }
          const hint = buildOfficecliFailureHint(err);
          emit({
            state: 'error',
            message: 'officecli is not installed and auto-install failed',
            hintKey: hint.hintKey,
            manualCommand: hint.manualCommand,
          });
          reject(new Error('officecli is not installed and auto-install failed'));
        });
      } else {
        settle(new Error(`Failed to start officecli: ${err.message}`));
      }
    });

    child.on('exit', (code, signal) => {
      sessions.delete(filePath);
      if (session.aborted) {
        settle();
        return;
      }
      const reason = signal ? `signal ${signal}` : `code ${code}`;
      settle(new Error(`officecli exited with ${reason}`));
    });
  });
}

/**
 * Check if a port belongs to an active PPT preview session.
 * Used by the web server proxy route to validate proxy targets.
 */
export function isActivePreviewPort(port: number): boolean {
  for (const [, session] of sessions) {
    if (session.port === port && !session.aborted && session.process.exitCode === null) {
      return true;
    }
  }
  return false;
}

/**
 * Stop all running watch processes (called on app shutdown).
 */
export function stopAllWatchSessions(): void {
  for (const [filePath] of sessions) {
    killSession(filePath);
  }
}

export function initPptPreviewBridge(): void {
  // Background update check (non-blocking, at most once per day).
  // Delegated to the shared installer service; the installer internally
  // applies a 24-hour marker file + per-process idempotency guard.
  scheduleOfficecliUpdateCheck(
    forwardInstallStatus((payload) => ipcBridge.pptPreview.status.emit(payload))
  );

  ipcBridge.pptPreview.start.provider(async ({ filePath }) => {
    // Attach .catch() synchronously on the promise to ensure the rejection
    // handler is registered before microtask processing. The bridge framework's
    // internal promise chain does not propagate await's handlers, so bare
    // await/try-catch leaves rejections unhandled (Sentry ELECTRON-CW, ELECTRON-CT).
    const result = await startWatch(filePath)
      .then((url) => ({ url }))
      .catch((err: unknown) => {
        console.error('[pptPreview] start failed:', err);
        return { url: '', error: err instanceof Error ? err.message : String(err) };
      });
    return result;
  });

  ipcBridge.pptPreview.stop.provider(async ({ filePath }) => {
    try {
      filePath = fs.realpathSync(filePath);
    } catch {}
    // Delay kill to allow Strict Mode re-mount to reuse the session
    const timer = setTimeout(() => {
      pendingKills.delete(filePath);
      killSession(filePath);
    }, 500);
    pendingKills.set(filePath, timer);
  });
}
