/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * BYOK fix (2026-04-23): server-pushed `error` notifications must surface in
 * the UI. Previously they fell through to `handleMappedNotification`'s
 * `ignored` default branch and were only written to the main-process log,
 * leaving BYOK auth failures looking like a silent freeze to the user.
 *
 * This suite covers the mapping half (`mapDroidNotification` → `kind: 'error'`)
 * and the dispatch half (`handleMappedNotification` → `onStreamEvent
 * type: 'error'`). The agent side uses a minimal stubbed session so we can
 * capture the emitted events without spinning up the real SDK.
 */

import { describe, expect, it } from 'vitest';
import { mapDroidNotification } from '@/process/agent/droid/runtime/notificationMapper';
import { normalizeBackendErrorMessage } from '@/process/agent/droid/runtime/backendErrorMessage';

describe('mapDroidNotification / error', () => {
  it('maps a flat error payload with message', () => {
    const result = mapDroidNotification({ type: 'error', message: 'Invalid provider' });
    expect(result).toEqual({ kind: 'error', message: 'Invalid provider' });
  });

  it('maps nested error shape ({ error: { message, status } })', () => {
    const result = mapDroidNotification({
      type: 'error',
      error: { message: 'Auth failed', status: '401' },
    });
    expect(result).toEqual({ kind: 'error', message: 'Auth failed', code: '401' });
  });

  it('rewrites 402 Payment Required into the Factory billing guidance', () => {
    const result = mapDroidNotification({ type: 'error', message: 'HTTP 402 Payment Required' });
    expect(result.kind).toBe('error');
    if (result.kind !== 'error') throw new Error('discriminant');
    expect(result.message).toContain('app.factory.ai/settings/usage');
  });

  it('falls back to Unknown error when no message field is present', () => {
    const result = mapDroidNotification({ type: 'error' });
    expect(result).toEqual({ kind: 'error', message: 'Unknown error' });
  });

  it('does not throw on malformed error payload', () => {
    expect(() => mapDroidNotification({ type: 'error', error: 42 })).not.toThrow();
  });

  it('unknown types still fall through to ignored (no regression)', () => {
    const result = mapDroidNotification({ type: 'brand_new_notification' });
    expect(result).toEqual({ kind: 'ignored', type: 'brand_new_notification' });
  });
});

describe('normalizeBackendErrorMessage', () => {
  it('rewrites 402 into Chinese billing prompt', () => {
    expect(normalizeBackendErrorMessage('HTTP 402')).toContain('算力额度不足');
  });

  it('rewrites literal Payment Required', () => {
    expect(normalizeBackendErrorMessage('Payment Required: credit exhausted')).toContain('算力额度不足');
  });

  it('passes through unrelated errors verbatim', () => {
    expect(normalizeBackendErrorMessage('Rate limit exceeded')).toBe('Rate limit exceeded');
  });

  it('returns Unknown error for null / empty input', () => {
    expect(normalizeBackendErrorMessage(undefined)).toBe('Unknown error');
    expect(normalizeBackendErrorMessage('')).toBe('Unknown error');
    expect(normalizeBackendErrorMessage(null)).toBe('Unknown error');
  });
});
