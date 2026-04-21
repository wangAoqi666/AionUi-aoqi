/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Covers the P0-2 notification mapping surface described in
 * `.factory/skills/droid-sdk-integration/references/gaps-and-guidance.md`.
 *
 * Responsibilities under test:
 *   - `mapDroidNotification` resolves all 4 known types correctly
 *     (session_title_updated / settings_updated / mcp_status_changed / mcp_auth_required)
 *   - Unknown notification types map to `{ kind: 'ignored', type }` rather than throwing
 *   - Malformed / partial payloads must not throw
 *   - Both full JSON-RPC envelopes and already-unwrapped payloads are accepted
 */

import { describe, expect, it } from 'vitest';
import { mapDroidNotification, type NotificationMappedResult } from '@/process/agent/droid/runtime/notificationMapper';

describe('mapDroidNotification', () => {
  it('maps session_title_updated payload', () => {
    const result = mapDroidNotification({
      type: 'session_title_updated',
      title: 'Refactor auth flow',
    });
    expect(result).toEqual<NotificationMappedResult>({
      kind: 'session_title',
      title: 'Refactor auth flow',
    });
  });

  it('maps settings_updated payload including modelId and reasoningEffort', () => {
    const result = mapDroidNotification({
      type: 'settings_updated',
      settings: {
        modelId: 'custom:my-byok-[BYOK]-0',
        reasoningEffort: 'high',
        interactionMode: 'spec',
        autonomyLevel: 'low',
        specModeModelId: null,
      },
    });
    expect(result.kind).toBe('settings_updated');
    if (result.kind !== 'settings_updated') throw new Error('discriminant');
    expect(result.changed.modelId).toBe('custom:my-byok-[BYOK]-0');
    expect(result.changed.reasoningEffort).toBe('high');
    expect(result.changed.interactionMode).toBe('spec');
    expect(result.changed.autonomyLevel).toBe('low');
    expect(result.changed.specModeModelId).toBeNull();
  });

  it('maps mcp_status_changed payload with server list and summary', () => {
    const result = mapDroidNotification({
      type: 'mcp_status_changed',
      servers: [
        {
          name: 'filesystem',
          status: 'connected',
          source: 'user',
          isManaged: true,
          toolCount: 7,
          serverType: 'stdio',
          hasAuthTokens: false,
        },
        {
          name: 'github',
          status: 'failed',
          source: 'team',
          isManaged: true,
          error: 'auth required',
          toolCount: 0,
        },
      ],
      summary: { total: 2, connected: 1, connecting: 0, failed: 1, disabled: 0 },
    });
    expect(result.kind).toBe('mcp_status');
    if (result.kind !== 'mcp_status') throw new Error('discriminant');
    expect(result.servers).toHaveLength(2);
    expect(result.servers[0]).toMatchObject({
      name: 'filesystem',
      status: 'connected',
      toolCount: 7,
      serverType: 'stdio',
      isManaged: true,
    });
    expect(result.servers[1]).toMatchObject({
      name: 'github',
      status: 'failed',
      error: 'auth required',
      toolCount: 0,
    });
    expect(result.summary).toEqual({
      total: 2,
      connected: 1,
      connecting: 0,
      failed: 1,
      disabled: 0,
    });
  });

  it('maps mcp_auth_required payload', () => {
    const result = mapDroidNotification({
      type: 'mcp_auth_required',
      serverName: 'notion',
      authUrl: 'https://notion.so/oauth?state=abc',
      message: 'Please authenticate with Notion to continue.',
      state: 'abc',
    });
    expect(result).toEqual<NotificationMappedResult>({
      kind: 'mcp_auth_required',
      serverName: 'notion',
      authUrl: 'https://notion.so/oauth?state=abc',
      message: 'Please authenticate with Notion to continue.',
      state: 'abc',
    });
  });

  it('returns ignored for unknown notification types', () => {
    const result = mapDroidNotification({ type: 'tool_progress_update', ts: 1 });
    expect(result).toEqual<NotificationMappedResult>({
      kind: 'ignored',
      type: 'tool_progress_update',
    });
  });

  it('does not throw on missing fields', () => {
    expect(() => mapDroidNotification({ type: 'session_title_updated' })).not.toThrow();
    const titleResult = mapDroidNotification({ type: 'session_title_updated' });
    expect(titleResult).toEqual<NotificationMappedResult>({
      kind: 'session_title',
      title: '',
    });

    const emptySettings = mapDroidNotification({ type: 'settings_updated' });
    expect(emptySettings.kind).toBe('settings_updated');
    if (emptySettings.kind !== 'settings_updated') throw new Error('discriminant');
    expect(emptySettings.changed).toEqual({});

    const emptyMcp = mapDroidNotification({ type: 'mcp_status_changed' });
    expect(emptyMcp.kind).toBe('mcp_status');
    if (emptyMcp.kind !== 'mcp_status') throw new Error('discriminant');
    expect(emptyMcp.servers).toEqual([]);
    expect(emptyMcp.summary).toBeUndefined();

    const emptyAuth = mapDroidNotification({ type: 'mcp_auth_required' });
    expect(emptyAuth.kind).toBe('mcp_auth_required');
    if (emptyAuth.kind !== 'mcp_auth_required') throw new Error('discriminant');
    expect(emptyAuth.serverName).toBe('');
    expect(emptyAuth.authUrl).toBeUndefined();
  });

  it('does not throw on null / non-object inputs', () => {
    expect(mapDroidNotification(null)).toEqual<NotificationMappedResult>({
      kind: 'ignored',
      type: '<unknown>',
    });
    expect(mapDroidNotification(undefined)).toEqual<NotificationMappedResult>({
      kind: 'ignored',
      type: '<unknown>',
    });
    expect(mapDroidNotification('not-an-object')).toEqual<NotificationMappedResult>({
      kind: 'ignored',
      type: '<unknown>',
    });
    expect(mapDroidNotification(42)).toEqual<NotificationMappedResult>({
      kind: 'ignored',
      type: '<unknown>',
    });
  });

  it('accepts full JSON-RPC envelope shape ({ params: { notification: payload } })', () => {
    const result = mapDroidNotification({
      jsonrpc: '2.0',
      method: 'droid.session_notification',
      params: {
        notification: {
          type: 'session_title_updated',
          title: 'Envelope test',
        },
      },
    });
    expect(result).toEqual<NotificationMappedResult>({
      kind: 'session_title',
      title: 'Envelope test',
    });
  });

  it('accepts half-unwrapped envelope ({ notification: payload })', () => {
    const result = mapDroidNotification({
      notification: {
        type: 'mcp_auth_required',
        serverName: 'slack',
        authUrl: 'https://slack.com/oauth',
      },
    });
    expect(result.kind).toBe('mcp_auth_required');
    if (result.kind !== 'mcp_auth_required') throw new Error('discriminant');
    expect(result.serverName).toBe('slack');
    expect(result.authUrl).toBe('https://slack.com/oauth');
  });

  it('filters out invalid server entries inside mcp_status_changed', () => {
    const result = mapDroidNotification({
      type: 'mcp_status_changed',
      servers: [
        null,
        'garbage',
        42,
        { name: 'valid', status: 'connected' },
        { name: 'missing-status' }, // becomes { status: 'unknown' }
      ],
    });
    expect(result.kind).toBe('mcp_status');
    if (result.kind !== 'mcp_status') throw new Error('discriminant');
    expect(result.servers).toHaveLength(2);
    expect(result.servers[0]).toMatchObject({ name: 'valid', status: 'connected' });
    expect(result.servers[1]).toMatchObject({ name: 'missing-status', status: 'unknown' });
  });

  // ── P2-1 mission / decomp notifications ─────────────────────────────

  it('maps mission_state_changed payload', () => {
    const result = mapDroidNotification({
      type: 'mission_state_changed',
      state: 'running',
      missionId: 'mission-42',
    });
    expect(result).toEqual<NotificationMappedResult>({
      kind: 'mission_state',
      state: 'running',
      missionId: 'mission-42',
    });
  });

  it('tolerates missing state on mission_state_changed', () => {
    const result = mapDroidNotification({ type: 'mission_state_changed' });
    expect(result.kind).toBe('mission_state');
    if (result.kind !== 'mission_state') throw new Error('discriminant');
    expect(result.state).toBe('');
    expect(result.missionId).toBeUndefined();
  });

  it('maps mission_features_changed payload with structured features', () => {
    const result = mapDroidNotification({
      type: 'mission_features_changed',
      missionId: 'mission-features-1',
      features: [
        {
          id: 'feat-a',
          description: 'Add login form',
          status: 'in_progress',
          skillName: 'frontend',
          preconditions: ['auth-configured', 123],
          expectedBehavior: ['user sees login form'],
          verificationSteps: ['npm test -- login'],
          fulfills: ['PRD-1'],
          milestone: 'M1',
          workerSessionIds: ['worker-1', 2],
          currentWorkerSessionId: 'worker-1',
          completedWorkerSessionId: null,
        },
        {
          description: 'no id — must be filtered',
          status: 'pending',
        },
        null,
        'bogus',
        {
          id: 'feat-b',
          status: 'completed',
          completedWorkerSessionId: 'worker-42',
          currentWorkerSessionId: null,
        },
      ],
    });
    expect(result.kind).toBe('mission_features');
    if (result.kind !== 'mission_features') throw new Error('discriminant');
    expect(result.missionId).toBe('mission-features-1');
    expect(result.features).toHaveLength(2);
    expect(result.features[0]).toMatchObject({
      id: 'feat-a',
      description: 'Add login form',
      status: 'in_progress',
      skillName: 'frontend',
      preconditions: ['auth-configured'],
      expectedBehavior: ['user sees login form'],
      verificationSteps: ['npm test -- login'],
      fulfills: ['PRD-1'],
      milestone: 'M1',
      workerSessionIds: ['worker-1'],
      currentWorkerSessionId: 'worker-1',
      completedWorkerSessionId: null,
    });
    expect(result.features[1]).toMatchObject({
      id: 'feat-b',
      status: 'completed',
      completedWorkerSessionId: 'worker-42',
      currentWorkerSessionId: null,
    });
  });

  it('maps mission_progress_entry payload with progress log flatten', () => {
    const result = mapDroidNotification({
      type: 'mission_progress_entry',
      missionId: 'mission-progress-1',
      progressLog: [
        {
          type: 'mission_run_started',
          timestamp: '2026-04-22T00:00:00.000Z',
          message: 'Run started',
        },
        {
          type: 'worker_started',
          timestamp: '2026-04-22T00:01:00.000Z',
          workerSessionId: 'w1',
          featureId: 'feat-a',
        },
        null,
        'bad',
        {
          type: 'worker_completed',
          timestamp: '2026-04-22T00:02:00.000Z',
          workerSessionId: 'w1',
          featureId: 'feat-a',
          handoff: { salientSummary: 'Login implemented' },
        },
      ],
    });
    expect(result.kind).toBe('mission_progress');
    if (result.kind !== 'mission_progress') throw new Error('discriminant');
    expect(result.missionId).toBe('mission-progress-1');
    expect(result.progressLog).toHaveLength(3);
    expect(result.progressLog[0]).toMatchObject({ type: 'mission_run_started', text: 'Run started' });
    expect(result.progressLog[1]).toMatchObject({ type: 'worker_started', workerSessionId: 'w1', featureId: 'feat-a' });
    expect(result.progressLog[2]).toMatchObject({
      type: 'worker_completed',
      workerSessionId: 'w1',
      featureId: 'feat-a',
      text: 'Login implemented',
    });
    // `entry` is the last progress log entry for quick UI consumption
    expect(result.entry).toMatchObject({ type: 'worker_completed', text: 'Login implemented' });
  });

  it('returns empty entry when mission_progress_entry has no progressLog', () => {
    const result = mapDroidNotification({ type: 'mission_progress_entry' });
    expect(result.kind).toBe('mission_progress');
    if (result.kind !== 'mission_progress') throw new Error('discriminant');
    expect(result.progressLog).toEqual([]);
    expect(result.entry).toEqual({});
  });

  it('maps mission_heartbeat payload and parses timestamp into epoch ms', () => {
    const result = mapDroidNotification({
      type: 'mission_heartbeat',
      timestamp: '2026-04-22T00:00:00.000Z',
      missionId: 'mission-hb-1',
    });
    expect(result.kind).toBe('mission_heartbeat');
    if (result.kind !== 'mission_heartbeat') throw new Error('discriminant');
    expect(result.timestamp).toBe('2026-04-22T00:00:00.000Z');
    expect(result.at).toBe(Date.parse('2026-04-22T00:00:00.000Z'));
    expect(result.missionId).toBe('mission-hb-1');
  });

  it('tolerates missing timestamp on mission_heartbeat', () => {
    const result = mapDroidNotification({ type: 'mission_heartbeat' });
    expect(result.kind).toBe('mission_heartbeat');
    if (result.kind !== 'mission_heartbeat') throw new Error('discriminant');
    expect(result.timestamp).toBeUndefined();
    expect(result.at).toBeUndefined();
  });

  it('maps mission_worker_started payload', () => {
    const result = mapDroidNotification({
      type: 'mission_worker_started',
      workerSessionId: 'worker-99',
      featureId: 'feat-x',
      spawnId: 'spawn-1',
      missionId: 'mission-ws-1',
    });
    expect(result).toEqual<NotificationMappedResult>({
      kind: 'mission_worker_started',
      workerSessionId: 'worker-99',
      featureId: 'feat-x',
      spawnId: 'spawn-1',
      missionId: 'mission-ws-1',
    });
  });

  it('maps mission_worker_completed payload', () => {
    const result = mapDroidNotification({
      type: 'mission_worker_completed',
      workerSessionId: 'worker-99',
      featureId: 'feat-x',
      exitCode: 0,
      successState: 'completed_successfully',
      handoff: { salientSummary: 'Worker finished' },
      missionId: 'mission-wc-1',
    });
    expect(result.kind).toBe('mission_worker_completed');
    if (result.kind !== 'mission_worker_completed') throw new Error('discriminant');
    expect(result.workerSessionId).toBe('worker-99');
    expect(result.featureId).toBe('feat-x');
    expect(result.exitCode).toBe(0);
    expect(result.successState).toBe('completed_successfully');
    expect(result.result).toBe('Worker finished');
    expect(result.missionId).toBe('mission-wc-1');
  });

  it('tolerates missing worker fields on mission_worker_completed', () => {
    const result = mapDroidNotification({ type: 'mission_worker_completed' });
    expect(result.kind).toBe('mission_worker_completed');
    if (result.kind !== 'mission_worker_completed') throw new Error('discriminant');
    expect(result.workerSessionId).toBeUndefined();
    expect(result.featureId).toBeUndefined();
    expect(result.exitCode).toBeUndefined();
    expect(result.successState).toBeUndefined();
    expect(result.result).toBeUndefined();
  });

  it('accepts mission notifications via JSON-RPC envelope', () => {
    const result = mapDroidNotification({
      jsonrpc: '2.0',
      method: 'droid.session_notification',
      params: {
        notification: {
          type: 'mission_state_changed',
          state: 'orchestrator_turn',
          missionId: 'mission-envelope',
        },
      },
    });
    expect(result).toEqual<NotificationMappedResult>({
      kind: 'mission_state',
      state: 'orchestrator_turn',
      missionId: 'mission-envelope',
    });
  });
});
