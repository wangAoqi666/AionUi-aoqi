/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SKILL P2-4: bug report submission (`DroidClient.submitBugReport`)
 *
 * Hard-constraint matrix (mirrors `DroidSdkAgent.submitBugReport` docblock):
 *   - `clientLogs` MUST NEVER be attached on the wire (privacy).
 *   - Metadata (App version, SDK version, platform/arch, optional sessionId)
 *     MUST be packed into `userComment` verbatim.
 *   - `includeSessionId` defaults to `true`; only `false` suppresses session id.
 *   - Transport/SDK errors MUST be captured as a structured `{ success: false, error }`
 *     result; callers NEVER see a thrown Error.
 *
 * We reach `DroidClient.submitBugReport` through a private `_client` field on
 * `DroidSession`; the SDK 0.1.4 public session surface does not expose the
 * method directly. This test locks in that structural cast so a silent SDK
 * upgrade cannot turn the feature off without also updating the test.
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
  DecompSessionType: {
    Ask: 'ask',
    Spec: 'spec',
    Plan: 'plan',
  },
}));

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn(() => '/tmp'),
    getVersion: vi.fn(() => '9.9.9-test'),
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
  // Mirror the SDK's DroidSession shape enough for the agent's internals,
  // plus a stubbed `_client` carrying `submitBugReport` to match the
  // SessionWithInternalClient structural cast.
  const submitBugReport = vi.fn(async () => ({ bugReportId: 'bug-report-abc123' }));
  return {
    sessionId: 'session-bug-report',
    updateSettings: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    interrupt: vi.fn(),
    stream: vi.fn(async function* () {}),
    _client: { submitBugReport },
    ...overrides,
  } as Record<string, unknown> & {
    _client: { submitBugReport: ReturnType<typeof vi.fn> };
  };
}

describe('DroidSdkAgent submitBugReport (SKILL P2-4 bug report submission)', () => {
  beforeEach(() => {
    createSessionMock.mockReset();
    resumeSessionMock.mockReset();
    mainLogMock.mockReset();
    mainWarnMock.mockReset();
  });

  // ── Happy path ───────────────────────────────────────────────────────

  it('forwards title/description to the SDK as `userComment` with metadata and session id', async () => {
    const session = makeSession();
    createSessionMock.mockResolvedValue(session);

    const agent = new DroidSdkAgent({
      id: 'conv-bug-happy',
      workingDir: '/tmp',
      onStreamEvent: vi.fn(),
    });

    await agent.start();

    const result = await agent.submitBugReport({
      title: 'Droid stalls on /compact',
      description: 'Reproduction: run /compact twice in a row; second run never finishes.',
    });

    expect(result).toEqual({ success: true, reportId: 'bug-report-abc123' });
    expect(session._client.submitBugReport).toHaveBeenCalledTimes(1);
    const callArgs = session._client.submitBugReport.mock.calls[0]?.[0];
    expect(callArgs).toBeDefined();
    // `clientLogs` must NEVER be attached (privacy rule P2-4).
    expect(callArgs).not.toHaveProperty('clientLogs');
    // userComment carries the packed title + description + metadata block.
    expect(typeof callArgs?.userComment).toBe('string');
    expect(callArgs?.userComment).toContain('Title: Droid stalls on /compact');
    expect(callArgs?.userComment).toContain('Reproduction: run /compact twice in a row');
    expect(callArgs?.userComment).toContain('App version: 9.9.9-test');
    expect(callArgs?.userComment).toContain('Platform:');
    expect(callArgs?.userComment).toContain('Arch:');
    expect(callArgs?.userComment).toContain('Session ID: session-bug-report');
  });

  it('omits the session id from `userComment` when `includeSessionId` is false', async () => {
    const session = makeSession();
    createSessionMock.mockResolvedValue(session);

    const agent = new DroidSdkAgent({
      id: 'conv-bug-opt-out',
      workingDir: '/tmp',
      onStreamEvent: vi.fn(),
    });

    await agent.start();

    const result = await agent.submitBugReport({
      title: 'Generic issue',
      description: 'Not session-specific — feedback on UX.',
      includeSessionId: false,
    });

    expect(result.success).toBe(true);
    const callArgs = session._client.submitBugReport.mock.calls[0]?.[0];
    expect(callArgs).toBeDefined();
    expect(callArgs?.userComment).not.toContain('Session ID');
    expect(callArgs?.userComment).not.toContain('session-bug-report');
    // clientLogs still absent regardless of includeSessionId.
    expect(callArgs).not.toHaveProperty('clientLogs');
  });

  it('attaches the session id by default when `includeSessionId` is unset', async () => {
    // Mirrors the renderer Modal default state (checkbox checked).
    const session = makeSession({ sessionId: 'session-default-attach' });
    createSessionMock.mockResolvedValue(session);

    const agent = new DroidSdkAgent({
      id: 'conv-bug-default',
      workingDir: '/tmp',
      onStreamEvent: vi.fn(),
    });
    await agent.start();

    await agent.submitBugReport({
      title: 'Default attach test',
      description: 'No includeSessionId passed — default is true.',
    });

    const callArgs = session._client.submitBugReport.mock.calls[0]?.[0];
    expect(callArgs?.userComment).toContain('Session ID: session-default-attach');
  });

  // ── Failure paths ────────────────────────────────────────────────────

  it('returns a structured failure when the session has not been started yet', async () => {
    // Do NOT call start() — mimic the renderer attempting a submit before
    // the worker has finished spinning up the Droid session.
    const agent = new DroidSdkAgent({
      id: 'conv-bug-no-session',
      workingDir: '/tmp',
      onStreamEvent: vi.fn(),
    });

    const result = await agent.submitBugReport({
      title: 'Early submit',
      description: 'Submit before session is ready.',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/session.*not.*initial/i);
  });

  it('returns a structured failure when the SDK session lacks a `_client.submitBugReport`', async () => {
    // Simulate an older SDK (or a mocked session from a channel integration)
    // that never wired up `_client.submitBugReport`. The agent MUST fail
    // fast without attempting to reach a standalone DroidClient transport.
    const session = makeSession({ _client: {} });
    createSessionMock.mockResolvedValue(session);

    const agent = new DroidSdkAgent({
      id: 'conv-bug-old-sdk',
      workingDir: '/tmp',
      onStreamEvent: vi.fn(),
    });
    await agent.start();

    const result = await agent.submitBugReport({
      title: 'Old SDK',
      description: 'Should be rejected cleanly.',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/submitBugReport.*not.*supported/i);
  });

  it('captures SDK-level errors as `{ success: false, error }` (never throws)', async () => {
    const session = makeSession();
    session._client.submitBugReport.mockRejectedValueOnce(new Error('transport closed'));
    createSessionMock.mockResolvedValue(session);

    const agent = new DroidSdkAgent({
      id: 'conv-bug-sdk-error',
      workingDir: '/tmp',
      onStreamEvent: vi.fn(),
    });
    await agent.start();

    const result = await agent.submitBugReport({
      title: 'Network issue',
      description: 'Connection dropped in the middle.',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('transport closed');
  });

  it('rewrites 402/Payment Required SDK errors into a user-actionable Factory top-up message', async () => {
    const session = makeSession();
    session._client.submitBugReport.mockRejectedValueOnce(
      new Error('HTTP 402 Payment Required — Factory usage limit reached')
    );
    createSessionMock.mockResolvedValue(session);

    const agent = new DroidSdkAgent({
      id: 'conv-bug-402',
      workingDir: '/tmp',
      onStreamEvent: vi.fn(),
    });
    await agent.start();

    const result = await agent.submitBugReport({
      title: 'Trying to submit',
      description: 'Hit quota limit mid-request.',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/算力额度不足/);
  });

  // ── Return-value normalisation ───────────────────────────────────────

  it('omits `reportId` from the happy-path return value when the SDK does not echo a bugReportId', async () => {
    const session = makeSession();
    session._client.submitBugReport.mockResolvedValueOnce({}); // no bugReportId
    createSessionMock.mockResolvedValue(session);

    const agent = new DroidSdkAgent({
      id: 'conv-bug-no-id',
      workingDir: '/tmp',
      onStreamEvent: vi.fn(),
    });
    await agent.start();

    const result = await agent.submitBugReport({
      title: 'No-id path',
      description: 'SDK returned nothing meaningful.',
    });

    expect(result).toEqual({ success: true });
    expect(result).not.toHaveProperty('reportId');
  });
});
