/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SKILL P2-2: tool whitelist (`enabledToolIds`)
 *
 * Hard-constraint matrix (mirrors `DroidSdkAgentConfig.enabledToolIds` docblock):
 *   - `undefined` → MUST NOT be serialized into `createSession` options / `updateSettings`.
 *   - `[]`        → MUST be sent verbatim so the CLI enforces "disable all tools".
 *   - `[id, …]`   → MUST be sent verbatim (unknown ids surface at tool-use time).
 *
 * `setEnabledToolIds(null)` normalizes `null → undefined` and pushes the cleared
 * state down to a live session via `updateSettings`. Callers that set it before
 * a session exists will see the value picked up by the next `createSession` /
 * `resumeSession` call.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DroidSdkAgent } from '@/process/agent/droid/DroidSdkAgent';

const createSessionMock = vi.hoisted(() => vi.fn());
const resumeSessionMock = vi.hoisted(() => vi.fn());
const mainLogMock = vi.hoisted(() => vi.fn());
const mainWarnMock = vi.hoisted(() => vi.fn());

vi.mock('@factory/droid-sdk', () => ({
  createSession: createSessionMock,
  resumeSession: resumeSessionMock,
  ToolConfirmationOutcome: {
    ProceedOnce: 'proceed_once',
    ProceedAlways: 'proceed_always',
    ProceedAutoRunMedium: 'proceed_auto_run_medium',
    Cancel: 'cancel',
  },
  AutonomyLevel: {
    High: 'high',
    Medium: 'medium',
    Low: 'low',
    Off: 'off',
  },
  DroidInteractionMode: {
    Auto: 'auto',
    Spec: 'spec',
  },
}));

vi.mock('@process/utils/mainLogger', () => ({
  mainLog: mainLogMock,
  mainWarn: mainWarnMock,
}));

vi.mock('@process/utils/shellEnv', () => ({
  getEnhancedEnv: () => ({}),
}));

vi.mock('@process/agent/droid/cliRuntime', () => ({
  resolveWorkingDroidCli: vi.fn((execPath?: string | null) => ({
    execPath: execPath || 'droid',
    cliPath: execPath || 'droid',
    source: 'system',
    version: '1.0.0',
  })),
}));

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 'session-whitelist',
    updateSettings: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    interrupt: vi.fn(),
    stream: vi.fn(async function* () {}),
    ...overrides,
  };
}

describe('DroidSdkAgent enabledToolIds (SKILL P2-2 tool whitelist)', () => {
  beforeEach(() => {
    createSessionMock.mockReset();
    resumeSessionMock.mockReset();
    mainLogMock.mockReset();
    mainWarnMock.mockReset();
  });

  // ── createSession path (config-driven whitelist) ─────────────────────

  it('inlines `enabledToolIds` into createSession options when configured with a non-empty array', async () => {
    const session = makeSession();
    createSessionMock.mockResolvedValue(session);

    const agent = new DroidSdkAgent({
      id: 'conv-whitelist-array',
      workingDir: '/tmp',
      enabledToolIds: ['read_file', 'edit_file'],
      onStreamEvent: vi.fn(),
    });

    await agent.start();

    const options = createSessionMock.mock.calls[0]?.[0];
    expect(options).toEqual(
      expect.objectContaining({
        enabledToolIds: ['read_file', 'edit_file'],
      })
    );
    expect(agent.currentEnabledToolIds).toEqual(['read_file', 'edit_file']);
  });

  it('preserves an empty array (disable-all-tools intent) on createSession options', async () => {
    const session = makeSession();
    createSessionMock.mockResolvedValue(session);

    const agent = new DroidSdkAgent({
      id: 'conv-whitelist-empty',
      workingDir: '/tmp',
      enabledToolIds: [],
      onStreamEvent: vi.fn(),
    });

    await agent.start();

    const options = createSessionMock.mock.calls[0]?.[0];
    expect(options).toHaveProperty('enabledToolIds', []);
    expect(agent.currentEnabledToolIds).toEqual([]);
  });

  it('omits `enabledToolIds` from createSession options when not configured', async () => {
    const session = makeSession();
    createSessionMock.mockResolvedValue(session);

    const agent = new DroidSdkAgent({
      id: 'conv-whitelist-unset',
      workingDir: '/tmp',
      onStreamEvent: vi.fn(),
    });

    await agent.start();

    const options = createSessionMock.mock.calls[0]?.[0];
    expect(options).not.toHaveProperty('enabledToolIds');
    expect(agent.currentEnabledToolIds).toBeUndefined();
  });

  // ── setEnabledToolIds on a live session (updateSettings push) ────────

  it('setEnabledToolIds([a, b]) pushes the whitelist via updateSettings on a live session', async () => {
    const session = makeSession();
    createSessionMock.mockResolvedValue(session);

    const agent = new DroidSdkAgent({
      id: 'conv-update-array',
      workingDir: '/tmp',
      onStreamEvent: vi.fn(),
    });

    await agent.start();
    session.updateSettings.mockClear();

    const result = await agent.setEnabledToolIds(['read_file', 'grep']);
    expect(result.success).toBe(true);
    expect(session.updateSettings).toHaveBeenCalledTimes(1);
    expect(session.updateSettings).toHaveBeenCalledWith({ enabledToolIds: ['read_file', 'grep'] });
    expect(agent.currentEnabledToolIds).toEqual(['read_file', 'grep']);
  });

  it('setEnabledToolIds([]) pushes the empty array verbatim (disable-all-tools)', async () => {
    const session = makeSession();
    createSessionMock.mockResolvedValue(session);

    const agent = new DroidSdkAgent({
      id: 'conv-update-empty',
      workingDir: '/tmp',
      onStreamEvent: vi.fn(),
    });

    await agent.start();
    session.updateSettings.mockClear();

    const result = await agent.setEnabledToolIds([]);
    expect(result.success).toBe(true);
    expect(session.updateSettings).toHaveBeenCalledTimes(1);
    expect(session.updateSettings).toHaveBeenCalledWith({ enabledToolIds: [] });
    expect(agent.currentEnabledToolIds).toEqual([]);
  });

  it('setEnabledToolIds(null) normalizes to undefined and pushes a clear via updateSettings', async () => {
    // Pre-seed the session with a whitelist so the clear intent is observable.
    const session = makeSession();
    createSessionMock.mockResolvedValue(session);

    const agent = new DroidSdkAgent({
      id: 'conv-update-null',
      workingDir: '/tmp',
      enabledToolIds: ['read_file'],
      onStreamEvent: vi.fn(),
    });

    await agent.start();
    session.updateSettings.mockClear();

    const result = await agent.setEnabledToolIds(null);
    expect(result.success).toBe(true);
    expect(session.updateSettings).toHaveBeenCalledTimes(1);
    expect(session.updateSettings).toHaveBeenCalledWith({ enabledToolIds: undefined });
    expect(agent.currentEnabledToolIds).toBeUndefined();
  });

  it('setEnabledToolIds before session exists caches the value for the next createSession', async () => {
    // Do NOT call start() first — mimic the UI calling setEnabledToolIds at
    // construction time (e.g. from a preset) before any session is live.
    const agent = new DroidSdkAgent({
      id: 'conv-prestart',
      workingDir: '/tmp',
      onStreamEvent: vi.fn(),
    });

    const result = await agent.setEnabledToolIds(['read_file']);
    expect(result.success).toBe(true);
    expect(agent.currentEnabledToolIds).toEqual(['read_file']);

    // Now start the session; the cached whitelist must be picked up by
    // createSession options. Ensures the state is the single source of truth
    // regardless of call ordering (SetterBeforeStart vs ConfigAtConstruction).
    const session = makeSession();
    createSessionMock.mockResolvedValue(session);
    await agent.start();

    const options = createSessionMock.mock.calls[0]?.[0];
    expect(options).toEqual(
      expect.objectContaining({
        enabledToolIds: ['read_file'],
      })
    );
  });

  it('returns { success: false, error } when updateSettings rejects and keeps local state as the intended value', async () => {
    // Intentional contract: setEnabledToolIds never rolls back on failure
    // (see docblock). The UI is responsible for reconciling — this test
    // locks in that contract so a rollback cannot be silently added.
    const session = makeSession();
    createSessionMock.mockResolvedValue(session);

    const agent = new DroidSdkAgent({
      id: 'conv-update-fail',
      workingDir: '/tmp',
      onStreamEvent: vi.fn(),
    });

    await agent.start();
    session.updateSettings.mockClear();
    session.updateSettings.mockRejectedValueOnce(new Error('CLI rejected enabledToolIds'));

    const result = await agent.setEnabledToolIds(['read_file']);
    expect(result.success).toBe(false);
    expect(result.error).toContain('CLI rejected enabledToolIds');
    // Local state stays as the attempted value.
    expect(agent.currentEnabledToolIds).toEqual(['read_file']);
  });

  // ── Resume path (SDK 0.1.4 ResumeSessionOptions lacks enabledToolIds) ─

  it('pushes enabledToolIds via updateSettings on the resume path', async () => {
    const session = makeSession({ sessionId: 'session-resume-whitelist' });
    resumeSessionMock.mockResolvedValue(session);

    const agent = new DroidSdkAgent({
      id: 'conv-resume-whitelist',
      workingDir: '/tmp',
      acpSessionId: 'prior-session',
      enabledToolIds: ['read_file', 'write_file'],
      onStreamEvent: vi.fn(),
    });

    await agent.start();

    // Resume options object MUST NOT include enabledToolIds (SDK shape).
    const resumeOpts = resumeSessionMock.mock.calls[0]?.[1];
    expect(resumeOpts).not.toHaveProperty('enabledToolIds');
    // But a post-resume updateSettings call MUST have pushed it.
    const whitelistPush = session.updateSettings.mock.calls.find((call) =>
      Array.isArray((call[0] as Record<string, unknown>)?.enabledToolIds)
    );
    expect(whitelistPush).toBeDefined();
    expect(whitelistPush?.[0]).toEqual({ enabledToolIds: ['read_file', 'write_file'] });
  });

  it('does NOT push enabledToolIds on resume when the whitelist is unset', async () => {
    const session = makeSession({ sessionId: 'session-resume-unset' });
    resumeSessionMock.mockResolvedValue(session);

    const agent = new DroidSdkAgent({
      id: 'conv-resume-unset',
      workingDir: '/tmp',
      acpSessionId: 'prior-session',
      onStreamEvent: vi.fn(),
    });

    await agent.start();

    // No updateSettings call should carry enabledToolIds when config didn't
    // provide a whitelist and the user hasn't pushed one via the setter yet.
    const whitelistPushes = session.updateSettings.mock.calls.filter(
      (call) => (call[0] as Record<string, unknown>)?.enabledToolIds !== undefined
    );
    expect(whitelistPushes).toHaveLength(0);
  });
});
