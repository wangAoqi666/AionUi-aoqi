/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Covers the P2-1 mission / decomp orchestration surface described in
 * `.factory/skills/droid-sdk-integration/references/gaps-and-guidance.md`.
 *
 * Responsibilities under test:
 *   - `sessionMode: 'mission'` routes the session into Orchestrator decomp type
 *   - `decompMissionId` is forwarded to the SDK session via the updateSettings
 *     cast pattern (since `CreateSessionOptions` / `UpdateSessionSettingsRequestParams`
 *     don't expose the field publicly)
 *   - Non-mission modes MUST NOT carry decomp fields (no leaks)
 *   - Mission notifications (state / features / progress / heartbeat / worker_*)
 *     are dispatched onto `onStreamEvent` with the correct `type` string and
 *     data shape
 *   - `setMode('mission')` on a live non-mission session pushes the decomp
 *     fields via a separate updateSettings call (not merged with the typed
 *     interactionMode/autonomyLevel payload)
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
    Orchestrator: 'orchestrator',
    Worker: 'worker',
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

describe('DroidSdkAgent — mission / decomp mode (P2-1)', () => {
  beforeEach(() => {
    createSessionMock.mockReset();
    resumeSessionMock.mockReset();
    mainLogMock.mockReset();
    mainWarnMock.mockReset();
  });

  it('starts a session in mission mode and pushes Orchestrator + missionId via updateSettings', async () => {
    const session = {
      sessionId: 'session-mission-1',
      updateSettings: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      interrupt: vi.fn(),
      stream: vi.fn(async function* () {}),
    };
    createSessionMock.mockResolvedValue(session);

    const agent = new DroidSdkAgent({
      id: 'conv-mission-1',
      workingDir: '/tmp',
      sessionMode: 'mission',
      decompMissionId: 'mission-abc',
      onStreamEvent: vi.fn(),
    });

    await agent.start();

    // createSession is called with the typed subset (interactionMode/autonomyLevel).
    // `decompSessionType` is stripped before going into CreateSessionOptions — the
    // SDK wrapper would silently drop it anyway, so we push via updateSettings.
    const options = createSessionMock.mock.calls[0]?.[0];
    expect(options).toEqual(
      expect.objectContaining({
        interactionMode: 'auto',
        autonomyLevel: 'medium',
      })
    );
    expect(options).not.toHaveProperty('decompSessionType');
    expect(options).not.toHaveProperty('decompMissionId');

    // The post-init updateSettings call MUST push the decomp fields.
    const decompPush = session.updateSettings.mock.calls.find(
      (call) => (call[0] as Record<string, unknown>)?.decompSessionType !== undefined
    );
    expect(decompPush).toBeDefined();
    expect(decompPush?.[0]).toEqual({
      decompSessionType: 'orchestrator',
      decompMissionId: 'mission-abc',
    });
  });

  it('starts a session in mission mode without decompMissionId and only pushes decompSessionType', async () => {
    const session = {
      sessionId: 'session-mission-no-id',
      updateSettings: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      interrupt: vi.fn(),
      stream: vi.fn(async function* () {}),
    };
    createSessionMock.mockResolvedValue(session);

    const agent = new DroidSdkAgent({
      id: 'conv-mission-no-id',
      workingDir: '/tmp',
      sessionMode: 'mission',
      onStreamEvent: vi.fn(),
    });

    await agent.start();

    const decompPush = session.updateSettings.mock.calls.find(
      (call) => (call[0] as Record<string, unknown>)?.decompSessionType !== undefined
    );
    expect(decompPush).toBeDefined();
    const decompPayload = decompPush?.[0] as Record<string, unknown>;
    expect(decompPayload).toEqual({
      decompSessionType: 'orchestrator',
    });
    // Explicitly assert we did NOT send decompMissionId when it wasn't provided
    expect(decompPayload.decompMissionId).toBeUndefined();
  });

  it('non-mission modes do NOT push decomp fields to the session', async () => {
    const session = {
      sessionId: 'session-default-no-decomp',
      updateSettings: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      interrupt: vi.fn(),
      stream: vi.fn(async function* () {}),
    };
    createSessionMock.mockResolvedValue(session);

    const agent = new DroidSdkAgent({
      id: 'conv-default',
      workingDir: '/tmp',
      // default mode, missionId intentionally set to ensure it's ignored
      // outside mission mode (hard rule: decompMissionId alone must NOT
      // activate mission mode).
      decompMissionId: 'should-be-ignored',
      onStreamEvent: vi.fn(),
    });

    await agent.start();

    const options = createSessionMock.mock.calls[0]?.[0];
    expect(options).not.toHaveProperty('decompSessionType');
    expect(options).not.toHaveProperty('decompMissionId');

    const decompPush = session.updateSettings.mock.calls.find(
      (call) => (call[0] as Record<string, unknown>)?.decompSessionType !== undefined
    );
    expect(decompPush).toBeUndefined();
  });

  it('setMode("mission") on a live non-mission session pushes decomp fields (including missionId via follow-up call)', async () => {
    const session = {
      sessionId: 'session-setmode-mission',
      updateSettings: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      interrupt: vi.fn(),
      stream: vi.fn(async function* () {}),
    };
    createSessionMock.mockResolvedValue(session);

    const agent = new DroidSdkAgent({
      id: 'conv-setmode-mission',
      workingDir: '/tmp',
      decompMissionId: 'mission-switched',
      onStreamEvent: vi.fn(),
    });
    await agent.start();
    session.updateSettings.mockClear();

    const result = await agent.setMode('mission');
    expect(result.success).toBe(true);

    // First call: the full mode settings pushed through as a single payload —
    // `decompSessionType` rides alongside interactionMode/autonomyLevel via
    // structural typing passthrough (same pattern as `skipPermissionsUnsafe`
    // in yolo mode).
    const modeCall = session.updateSettings.mock.calls[0];
    expect(modeCall).toBeDefined();
    expect(modeCall?.[0]).toEqual({
      interactionMode: 'auto',
      autonomyLevel: 'medium',
      decompSessionType: 'orchestrator',
    });

    // Follow-up call: the dedicated decomp helper pushes decompSessionType +
    // decompMissionId together. This is needed because the modeSettings path
    // doesn't carry the missionId — that lives on `config.decompMissionId`.
    const decompCall = session.updateSettings.mock.calls.find(
      (call) => (call[0] as Record<string, unknown>)?.decompMissionId !== undefined
    );
    expect(decompCall).toBeDefined();
    expect(decompCall?.[0]).toEqual({
      decompSessionType: 'orchestrator',
      decompMissionId: 'mission-switched',
    });
  });

  it('setMode("mission") without decompMissionId only pushes the mode payload (no follow-up decomp call)', async () => {
    const session = {
      sessionId: 'session-setmode-mission-no-id',
      updateSettings: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      interrupt: vi.fn(),
      stream: vi.fn(async function* () {}),
    };
    createSessionMock.mockResolvedValue(session);

    const agent = new DroidSdkAgent({
      id: 'conv-setmode-mission-no-id',
      workingDir: '/tmp',
      // No decompMissionId
      onStreamEvent: vi.fn(),
    });
    await agent.start();
    session.updateSettings.mockClear();

    const result = await agent.setMode('mission');
    expect(result.success).toBe(true);

    // Single call: mode settings carry decompSessionType but no missionId.
    expect(session.updateSettings).toHaveBeenCalledTimes(1);
    expect(session.updateSettings).toHaveBeenCalledWith({
      interactionMode: 'auto',
      autonomyLevel: 'medium',
      decompSessionType: 'orchestrator',
    });
  });

  it('dispatches mission_state notifications to onStreamEvent', async () => {
    let capturedCallback: ((notification: Record<string, unknown>) => void) | null = null;
    const session = {
      sessionId: 'session-mission-state',
      updateSettings: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      interrupt: vi.fn(),
      stream: vi.fn(async function* () {}),
      onNotification: vi.fn((cb: (notification: Record<string, unknown>) => void) => {
        capturedCallback = cb;
        return vi.fn();
      }),
    };
    createSessionMock.mockResolvedValue(session);

    const onStreamEvent = vi.fn();
    const agent = new DroidSdkAgent({
      id: 'conv-mission-state',
      workingDir: '/tmp',
      sessionMode: 'mission',
      onStreamEvent,
    });

    await agent.start();
    expect(capturedCallback).toBeTypeOf('function');

    capturedCallback!({
      type: 'mission_state_changed',
      state: 'running',
      missionId: 'mission-xyz',
    });

    expect(onStreamEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'mission_state',
        conversation_id: 'conv-mission-state',
        data: expect.objectContaining({
          sessionId: 'session-mission-state',
          state: 'running',
          missionId: 'mission-xyz',
        }),
      })
    );
  });

  it('dispatches mission_features, mission_progress, mission_heartbeat, and mission_worker_* events', async () => {
    let capturedCallback: ((notification: Record<string, unknown>) => void) | null = null;
    const session = {
      sessionId: 'session-mission-events',
      updateSettings: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      interrupt: vi.fn(),
      stream: vi.fn(async function* () {}),
      onNotification: vi.fn((cb: (notification: Record<string, unknown>) => void) => {
        capturedCallback = cb;
        return vi.fn();
      }),
    };
    createSessionMock.mockResolvedValue(session);

    const onStreamEvent = vi.fn();
    const agent = new DroidSdkAgent({
      id: 'conv-mission-events',
      workingDir: '/tmp',
      sessionMode: 'mission',
      onStreamEvent,
    });

    await agent.start();

    // Clear onStreamEvent calls made during startSession (e.g. logs) so the
    // assertions below only consider our synthetic notifications.
    onStreamEvent.mockClear();

    // mission_features_changed
    capturedCallback!({
      type: 'mission_features_changed',
      features: [{ id: 'feat-1', status: 'in_progress' }],
      missionId: 'mission-events',
    });
    expect(onStreamEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'mission_features',
        data: expect.objectContaining({
          features: [expect.objectContaining({ id: 'feat-1', status: 'in_progress' })],
          missionId: 'mission-events',
        }),
      })
    );

    // mission_progress_entry
    onStreamEvent.mockClear();
    capturedCallback!({
      type: 'mission_progress_entry',
      progressLog: [{ type: 'mission_run_started', message: 'start', timestamp: '2026-04-22T00:00:00.000Z' }],
      missionId: 'mission-events',
    });
    expect(onStreamEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'mission_progress',
        data: expect.objectContaining({
          missionId: 'mission-events',
          entry: expect.objectContaining({ type: 'mission_run_started', text: 'start' }),
          progressLog: expect.arrayContaining([expect.objectContaining({ type: 'mission_run_started' })]),
        }),
      })
    );

    // mission_heartbeat
    onStreamEvent.mockClear();
    capturedCallback!({
      type: 'mission_heartbeat',
      timestamp: '2026-04-22T00:05:00.000Z',
      missionId: 'mission-events',
    });
    expect(onStreamEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'mission_heartbeat',
        data: expect.objectContaining({
          timestamp: '2026-04-22T00:05:00.000Z',
          at: Date.parse('2026-04-22T00:05:00.000Z'),
          missionId: 'mission-events',
        }),
      })
    );

    // mission_worker_started
    onStreamEvent.mockClear();
    capturedCallback!({
      type: 'mission_worker_started',
      workerSessionId: 'worker-1',
      featureId: 'feat-1',
      spawnId: 'spawn-1',
      missionId: 'mission-events',
    });
    expect(onStreamEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'mission_worker_started',
        data: expect.objectContaining({
          workerSessionId: 'worker-1',
          featureId: 'feat-1',
          spawnId: 'spawn-1',
          missionId: 'mission-events',
        }),
      })
    );

    // mission_worker_completed
    onStreamEvent.mockClear();
    capturedCallback!({
      type: 'mission_worker_completed',
      workerSessionId: 'worker-1',
      featureId: 'feat-1',
      exitCode: 0,
      successState: 'completed_successfully',
      handoff: { salientSummary: 'Done' },
      missionId: 'mission-events',
    });
    expect(onStreamEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'mission_worker_completed',
        data: expect.objectContaining({
          workerSessionId: 'worker-1',
          featureId: 'feat-1',
          exitCode: 0,
          successState: 'completed_successfully',
          result: 'Done',
          missionId: 'mission-events',
        }),
      })
    );
  });

  it('swallows errors from applyDecompSettingsToSession so startup never breaks', async () => {
    const session = {
      sessionId: 'session-mission-reject',
      // First updateSettings call (decomp push) rejects → best-effort swallow
      updateSettings: vi.fn().mockRejectedValueOnce(new Error('old CLI rejects decomp')),
      close: vi.fn(),
      interrupt: vi.fn(),
      stream: vi.fn(async function* () {}),
    };
    createSessionMock.mockResolvedValue(session);

    const agent = new DroidSdkAgent({
      id: 'conv-mission-reject',
      workingDir: '/tmp',
      sessionMode: 'mission',
      decompMissionId: 'mission-reject',
      onStreamEvent: vi.fn(),
    });

    // start() must NOT throw even though updateSettings rejects — hard rule P2-1.
    await expect(agent.start()).resolves.toBeUndefined();
    expect(session.updateSettings).toHaveBeenCalled();
    expect(mainWarnMock).toHaveBeenCalledWith(
      '[DroidSdkAgent]',
      'applyDecompSettingsToSession failed; session will remain non-mission',
      expect.stringContaining('old CLI rejects decomp')
    );
  });
});
