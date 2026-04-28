/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Startup probe coordinator.
 *
 * Runs non-critical startup tasks (Droid catalog probe, ACP detector, etc.)
 * after the main window is ready, with individual timeouts so a hung probe
 * never blocks the UI. Results are pushed back to the renderer via the
 * `application.startupProbeStatus` IPC emitter so the UI can show status
 * without blocking the first paint.
 *
 * 后台启动探测调度器：窗口就绪后再运行非关键探测任务，每个任务独立超时；
 * 结果通过 IPC 推送给 renderer，避免阻塞主功能。
 */

import { ipcBridge } from '@/common';

export type StartupProbeStatus = 'running' | 'done' | 'error' | 'timeout';

export interface StartupProbeEvent {
  name: string;
  status: StartupProbeStatus;
  durationMs?: number;
  error?: string;
}

export interface StartupProbeSpec<T = unknown> {
  name: string;
  timeoutMs?: number;
  run: () => Promise<T>;
  onResult?: (value: T) => void;
  onError?: (error: unknown) => void;
}

const DEFAULT_PROBE_TIMEOUT_MS = 8000;

let startupProbesScheduled = false;

function emitStatus(event: StartupProbeEvent): void {
  try {
    ipcBridge.application.startupProbeStatus.emit(event);
  } catch {
    // Emission is best-effort — renderer may not be ready yet.
  }
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Wrap an async function with a timeout. If the timer fires first, the
 * promise rejects with a `timeout` error. The underlying task is NOT
 * cancelled — Node doesn't support that without AbortSignal support in
 * the task itself. The task is expected to be idempotent / best-effort.
 *
 * 给异步任务包一层超时；超时仅让调用方提前放弃，不会强制中止底层任务。
 */
export function withTimeout<T>(fn: () => Promise<T>, timeoutMs: number, label = 'task'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`[timeout] ${label} exceeded ${timeoutMs}ms`));
    }, timeoutMs);
    // timer.unref so a hung probe doesn't prevent app quit
    try {
      timer.unref?.();
    } catch {
      /* setTimeout may not return a Timer object in non-Node runtimes */
    }
    fn().then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 * Run a single probe with timeout + IPC status push + error swallowing.
 * Always resolves — errors are logged and emitted, never thrown.
 *
 * 运行单个探测：自带超时、IPC 状态推送、错误吞咽；永不 reject，调用方无需 try/catch。
 */
export async function runStartupProbe<T>(spec: StartupProbeSpec<T>): Promise<void> {
  const timeoutMs = spec.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const startedAt = performance.now();
  emitStatus({ name: spec.name, status: 'running' });

  try {
    const value = await withTimeout(spec.run, timeoutMs, spec.name);
    const durationMs = Math.round(performance.now() - startedAt);
    spec.onResult?.(value);
    emitStatus({ name: spec.name, status: 'done', durationMs });
  } catch (error) {
    const durationMs = Math.round(performance.now() - startedAt);
    const message = formatError(error);
    const isTimeout = message.startsWith('[timeout]');
    spec.onError?.(error);
    console.warn(`[StartupProbes] ${spec.name} ${isTimeout ? 'timed out' : 'failed'} (${durationMs}ms):`, message);
    emitStatus({
      name: spec.name,
      status: isTimeout ? 'timeout' : 'error',
      durationMs,
      error: message,
    });
  }
}

/**
 * Schedule a batch of probes to run **serially** after the caller signals
 * the window is ready. Serial execution avoids resource contention on
 * slower machines (e.g. Windows) where parallel CLI probes would starve
 * each other. Calling this more than once is a no-op so callers can safely
 * wire it into both `did-finish-load` and a fallback timer.
 *
 * 串行调度一批探测，避免慢机器上并行探测互相抢资源；
 * 多次调用会被幂等忽略，便于在 did-finish-load 与兜底定时器上重复绑定。
 */
export function scheduleStartupProbes(probes: StartupProbeSpec[]): void {
  if (startupProbesScheduled) {
    return;
  }
  startupProbesScheduled = true;
  void (async () => {
    for (const probe of probes) {
      await runStartupProbe(probe);
    }
  })();
}

/**
 * Reset the scheduled flag (test helper / unusual recovery paths only).
 */
export function resetStartupProbesScheduled(): void {
  startupProbesScheduled = false;
}
