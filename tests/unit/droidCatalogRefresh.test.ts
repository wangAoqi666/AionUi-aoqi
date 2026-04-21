/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Covers the P1-3 Factory catalog hot-refresh behaviour described in
 * `.factory/skills/droid-sdk-integration/references/gaps-and-guidance.md`:
 *
 *   - `scheduleFactoryCatalogRefresh(reason)` debounces multiple rapid triggers
 *     into a single `refreshFactoryDroidCatalog()` call (default 500ms window).
 *   - `scheduleFactoryCatalogRefresh('settings-updated')` enforces a 2s cooldown
 *     after the previous successful refresh so that the SDK-echoed
 *     `settings_updated` notification cannot create an infinite refresh loop.
 *   - `flushFactoryCatalogRefresh(reason)` bypasses the debounce, cancels the
 *     pending timer, and triggers a refresh immediately (used by BYOK CRUD IPC
 *     handlers so the newly-saved model is visible in the main-process catalog
 *     before the renderer re-queries it).
 *   - Errors inside `refreshFactoryDroidCatalog()` are always swallowed +
 *     warn-logged; the public API (schedule / flush) never rethrows.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const refreshFactoryDroidCatalogMock = vi.hoisted(() => vi.fn<() => Promise<unknown[]>>());
const mainLogMock = vi.hoisted(() => vi.fn());
const mainWarnMock = vi.hoisted(() => vi.fn());

vi.mock('@process/utils/initStorage', () => ({
  refreshFactoryDroidCatalog: refreshFactoryDroidCatalogMock,
}));

vi.mock('@process/utils/mainLogger', () => ({
  mainLog: mainLogMock,
  mainWarn: mainWarnMock,
}));

import {
  __resetCatalogRefresherForTests,
  flushFactoryCatalogRefresh,
  scheduleFactoryCatalogRefresh,
} from '@process/agent/droid/catalogRefresher';

describe('catalogRefresher — debounce + cooldown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    refreshFactoryDroidCatalogMock.mockReset();
    mainLogMock.mockReset();
    mainWarnMock.mockReset();
    __resetCatalogRefresherForTests();
    refreshFactoryDroidCatalogMock.mockResolvedValue([]);
  });

  afterEach(() => {
    __resetCatalogRefresherForTests();
    vi.useRealTimers();
  });

  it('debounces multiple rapid schedule calls into a single refresh', async () => {
    scheduleFactoryCatalogRefresh('byok-crud-save');
    scheduleFactoryCatalogRefresh('byok-crud-save');
    scheduleFactoryCatalogRefresh('byok-crud-save');

    expect(refreshFactoryDroidCatalogMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(0); // flush pending microtasks from the scheduled refresh

    expect(refreshFactoryDroidCatalogMock).toHaveBeenCalledTimes(1);
  });

  it('honours a custom debounce delay', async () => {
    scheduleFactoryCatalogRefresh('custom-delay', 100);

    expect(refreshFactoryDroidCatalogMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(0);

    expect(refreshFactoryDroidCatalogMock).toHaveBeenCalledTimes(1);
  });

  it('skips a settings-updated schedule if it lands within the cooldown window', async () => {
    // First refresh completes → lastRefreshAt is set to "now"
    await flushFactoryCatalogRefresh('initial');
    expect(refreshFactoryDroidCatalogMock).toHaveBeenCalledTimes(1);

    // A subsequent SDK echo within the 2s cooldown is dropped
    scheduleFactoryCatalogRefresh('settings-updated');
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(0);
    expect(refreshFactoryDroidCatalogMock).toHaveBeenCalledTimes(1);

    // Any cooldown-skip is logged so developers can see it in debug logs
    expect(
      mainLogMock.mock.calls.some(
        ([tag, message]) => tag === '[catalogRefresher]' && message === 'skipping settings-updated within cooldown'
      )
    ).toBe(true);
  });

  it('allows settings-updated schedule after the cooldown has elapsed', async () => {
    await flushFactoryCatalogRefresh('initial');
    expect(refreshFactoryDroidCatalogMock).toHaveBeenCalledTimes(1);

    // Move past the 2s cooldown
    await vi.advanceTimersByTimeAsync(2001);

    scheduleFactoryCatalogRefresh('settings-updated');
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(0);

    expect(refreshFactoryDroidCatalogMock).toHaveBeenCalledTimes(2);
  });

  it('does not apply the cooldown to non-settings-updated reasons', async () => {
    await flushFactoryCatalogRefresh('initial');
    expect(refreshFactoryDroidCatalogMock).toHaveBeenCalledTimes(1);

    // BYOK CRUD paths are user-initiated and must always refresh, regardless
    // of the last refresh timestamp.
    scheduleFactoryCatalogRefresh('byok-crud-save');
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(0);

    expect(refreshFactoryDroidCatalogMock).toHaveBeenCalledTimes(2);
  });

  it('swallows errors thrown by refreshFactoryDroidCatalog and only logs a warn', async () => {
    refreshFactoryDroidCatalogMock.mockRejectedValueOnce(new Error('probe failed'));

    scheduleFactoryCatalogRefresh('byok-crud-save');
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(0);
    // settle the rejected-promise .catch() chain
    await Promise.resolve();

    expect(refreshFactoryDroidCatalogMock).toHaveBeenCalledTimes(1);
    expect(
      mainWarnMock.mock.calls.some(([tag, message]) => tag === '[catalogRefresher]' && message === 'refresh failed')
    ).toBe(true);
  });

  it('flushFactoryCatalogRefresh cancels the pending debounced timer and refreshes immediately', async () => {
    scheduleFactoryCatalogRefresh('byok-crud-save');
    expect(refreshFactoryDroidCatalogMock).not.toHaveBeenCalled();

    const flushPromise = flushFactoryCatalogRefresh('byok-crud-save');
    // flush kicks off the refresh synchronously (no timer needed)
    await flushPromise;

    expect(refreshFactoryDroidCatalogMock).toHaveBeenCalledTimes(1);

    // Advancing past the original debounce window must not trigger another
    // refresh — the timer was cancelled.
    await vi.advanceTimersByTimeAsync(1000);
    expect(refreshFactoryDroidCatalogMock).toHaveBeenCalledTimes(1);
  });

  it('reuses the in-flight promise when two flushes race', async () => {
    let resolveRefresh: ((value: unknown[]) => void) | undefined;
    refreshFactoryDroidCatalogMock.mockImplementationOnce(
      () =>
        new Promise<unknown[]>((resolve) => {
          resolveRefresh = resolve;
        })
    );

    const first = flushFactoryCatalogRefresh('byok-crud-save');
    const second = flushFactoryCatalogRefresh('byok-crud-save');

    // Only one upstream call should be outstanding
    expect(refreshFactoryDroidCatalogMock).toHaveBeenCalledTimes(1);

    resolveRefresh?.([]);
    await first;
    await second;

    expect(refreshFactoryDroidCatalogMock).toHaveBeenCalledTimes(1);
  });

  it('updates lastRefreshAt on successful flush so the subsequent settings-updated is cooled down', async () => {
    // BYOK save flushes
    await flushFactoryCatalogRefresh('byok-crud-save');
    expect(refreshFactoryDroidCatalogMock).toHaveBeenCalledTimes(1);

    // Immediately afterwards, the SDK echoes `settings_updated` — this is the
    // exact "death loop" scenario the cooldown is designed to break.
    scheduleFactoryCatalogRefresh('settings-updated');
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(0);

    expect(refreshFactoryDroidCatalogMock).toHaveBeenCalledTimes(1);
  });

  it('does not enter the cooldown path when no successful refresh has been recorded', async () => {
    // First-ever settings_updated notification before any other refresh — it
    // should proceed normally (cooldown only applies once lastRefreshAt > 0).
    scheduleFactoryCatalogRefresh('settings-updated');
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(0);

    expect(refreshFactoryDroidCatalogMock).toHaveBeenCalledTimes(1);
  });

  it('resets all module state via __resetCatalogRefresherForTests', async () => {
    await flushFactoryCatalogRefresh('byok-crud-save');
    expect(refreshFactoryDroidCatalogMock).toHaveBeenCalledTimes(1);

    __resetCatalogRefresherForTests();

    // Without the reset, this schedule would be suppressed by the cooldown —
    // after reset lastRefreshAt is back to 0 so it proceeds.
    scheduleFactoryCatalogRefresh('settings-updated');
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(0);

    expect(refreshFactoryDroidCatalogMock).toHaveBeenCalledTimes(2);
  });
});
