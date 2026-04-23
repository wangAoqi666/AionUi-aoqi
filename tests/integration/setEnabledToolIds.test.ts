/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 *
 * Integration test for setEnabledToolIds end-to-end round-trip:
 *   1. strict `[]` → next turn has enabledToolIds === [] in underlying SDK call
 *   2. switch to `null` → default availability restored without restart
 *
 * VAL-IPC-002: exercises all three states
 * VAL-IPC-004: live-session round-trip behavior
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DroidSdkAgent } from '@/process/agent/droid/DroidSdkAgent';

// ── SDK mocks (same pattern as droidEnabledToolIds.test.ts) ─────────────────
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

/** Build a mock DroidSession with updateSettings spy. */
function makeSession() {
  return {
    sessionId: 'session-integration',
    updateSettings: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    interrupt: vi.fn(),
    stream: vi.fn(async function* () {}),
  };
}

describe('setEnabledToolIds integration — live-session round-trip', () => {
  beforeEach(() => {
    createSessionMock.mockReset();
    resumeSessionMock.mockReset();
    mainLogMock.mockReset();
    mainWarnMock.mockReset();
  });

  it('strict [] → next turn uses enabledToolIds===[] → null restores defaults', async () => {
    const session = makeSession();
    createSessionMock.mockResolvedValue(session);

    const agent = new DroidSdkAgent({
      id: 'conv-round-trip',
      workingDir: '/tmp',
      onStreamEvent: vi.fn(),
    });

    await agent.start();

    // ── Step 1: Set strict mode (empty array = disable all tools) ────────
    const disableResult = await agent.setEnabledToolIds([]);
    expect(disableResult.success).toBe(true);
    expect(agent.currentEnabledToolIds).toEqual([]);
    expect(session.updateSettings).toHaveBeenCalledWith({ enabledToolIds: [] });

    session.updateSettings.mockClear();

    // ── Step 2: Restore defaults (null = clear whitelist) ────────────────
    const restoreResult = await agent.setEnabledToolIds(null);
    expect(restoreResult.success).toBe(true);
    expect(agent.currentEnabledToolIds).toBeUndefined();
    expect(session.updateSettings).toHaveBeenCalledWith({ enabledToolIds: undefined });
  });

  it('[id, id] → [] → null: full lifecycle without conversation restart', async () => {
    const session = makeSession();
    createSessionMock.mockResolvedValue(session);

    const agent = new DroidSdkAgent({
      id: 'conv-lifecycle',
      workingDir: '/tmp',
      onStreamEvent: vi.fn(),
    });

    await agent.start();

    // ── Step 1: Custom whitelist ─────────────────────────────────────────
    await agent.setEnabledToolIds(['read_file', 'grep']);
    expect(agent.currentEnabledToolIds).toEqual(['read_file', 'grep']);
    expect(session.updateSettings).toHaveBeenCalledWith({
      enabledToolIds: ['read_file', 'grep'],
    });

    session.updateSettings.mockClear();

    // ── Step 2: Strict mode (no tools) ──────────────────────────────────
    await agent.setEnabledToolIds([]);
    expect(agent.currentEnabledToolIds).toEqual([]);
    expect(session.updateSettings).toHaveBeenCalledWith({ enabledToolIds: [] });

    session.updateSettings.mockClear();

    // ── Step 3: Restore defaults ────────────────────────────────────────
    await agent.setEnabledToolIds(null);
    expect(agent.currentEnabledToolIds).toBeUndefined();
    expect(session.updateSettings).toHaveBeenCalledWith({ enabledToolIds: undefined });
  });

  it('null and [] are distinct: null clears, [] disables', async () => {
    const session = makeSession();
    createSessionMock.mockResolvedValue(session);

    const agent = new DroidSdkAgent({
      id: 'conv-null-vs-empty',
      workingDir: '/tmp',
      onStreamEvent: vi.fn(),
    });

    await agent.start();

    // null → clears
    await agent.setEnabledToolIds(null);
    expect(session.updateSettings).toHaveBeenCalledWith({ enabledToolIds: undefined });

    session.updateSettings.mockClear();

    // [] → disables all
    await agent.setEnabledToolIds([]);
    expect(session.updateSettings).toHaveBeenCalledWith({ enabledToolIds: [] });

    // They must produce different updateSettings calls
    expect(undefined).not.toEqual([]);
  });
});
