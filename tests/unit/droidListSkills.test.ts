/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Covers the P0-1 (session.listSkills) + P0-4 (subagent surface) integration
 * described in `.factory/skills/droid-sdk-integration/references/gaps-and-guidance.md`.
 *
 * Responsibilities under test:
 *   - `DroidSdkAgent.startSession()` calls `session.listSkills()` exactly once.
 *   - Returned `SkillInfo[]` is merged into `AcpSkillManager` as SDK skills.
 *   - A `listSkills()` failure must not break `startSession()` (graceful fallback).
 *   - SDK skills whose name/location/filePath hints at a custom-droid / subagent
 *     are classified as `kind: 'subagent'`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DroidSdkAgent } from '@/process/agent/droid/DroidSdkAgent';
import { AcpSkillManager } from '@/process/task/AcpSkillManager';

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

function buildSession(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    sessionId: 'session-list-skills',
    updateSettings: vi.fn(),
    close: vi.fn(),
    interrupt: vi.fn(),
    stream: vi.fn(async function* () {}),
    ...overrides,
  };
}

describe('DroidSdkAgent — session.listSkills integration', () => {
  beforeEach(() => {
    createSessionMock.mockReset();
    resumeSessionMock.mockReset();
    mainLogMock.mockReset();
    mainWarnMock.mockReset();
    AcpSkillManager.resetInstance();
  });

  afterEach(() => {
    AcpSkillManager.resetInstance();
  });

  it('calls session.listSkills exactly once after startSession succeeds', async () => {
    const listSkills = vi.fn().mockResolvedValue({ skills: [] });
    const session = buildSession({ listSkills });
    createSessionMock.mockResolvedValue(session);

    const agent = new DroidSdkAgent({
      id: 'conv-list-skills-1',
      workingDir: '/tmp',
      onStreamEvent: vi.fn(),
    });

    await agent.start();

    expect(listSkills).toHaveBeenCalledTimes(1);
  });

  it('merges returned SkillInfo[] into AcpSkillManager as SDK skills', async () => {
    const listSkills = vi.fn().mockResolvedValue({
      skills: [
        {
          name: 'pptx-tools',
          description: 'PowerPoint helpers',
          location: 'personal',
          filePath: '/home/user/.factory/skills/pptx-tools/SKILL.md',
          enabled: true,
        },
        {
          name: 'pdf-reader',
          description: 'Read PDF files',
          location: 'builtin',
          filePath: '/opt/factory/skills/pdf-reader/SKILL.md',
          enabled: true,
        },
      ],
    });
    const session = buildSession({ listSkills });
    createSessionMock.mockResolvedValue(session);

    const onStreamEvent = vi.fn();
    const agent = new DroidSdkAgent({
      id: 'conv-list-skills-2',
      workingDir: '/tmp',
      onStreamEvent,
    });

    await agent.start();

    const manager = AcpSkillManager.getInstance();
    const sdkSkills = manager.getSdkSkills();

    expect(sdkSkills).toHaveLength(2);
    expect(sdkSkills.map((s) => s.name).toSorted()).toEqual(['pdf-reader', 'pptx-tools']);
    expect(manager.hasSkill('pptx-tools')).toBe(true);
    expect(manager.hasAnySkills()).toBe(true);

    // Every skill must carry a `kind`. Because the test data contains no
    // subagent-style hints, both entries classify as regular `skill`.
    expect(sdkSkills.every((skill) => skill.kind === 'skill')).toBe(true);

    // Verify the Droid agent emits slash_commands_updated carrying the SDK
    // skills list (consumers: frontend slash-menu / skills panel).
    const slashEvent = onStreamEvent.mock.calls.find(
      ([event]) => (event as { type?: string } | undefined)?.type === 'slash_commands_updated'
    );
    expect(slashEvent).toBeDefined();
    const data = (slashEvent![0] as { data: { source: string; sdkSkills: Array<{ name: string; kind: string }> } })
      .data;
    expect(data.source).toBe('droid-sdk');
    expect(data.sdkSkills.map((s) => s.name).toSorted()).toEqual(['pdf-reader', 'pptx-tools']);
  });

  it('keeps startSession successful when listSkills throws', async () => {
    const listSkills = vi.fn().mockRejectedValue(new Error('list-skills blew up'));
    const session = buildSession({ listSkills });
    createSessionMock.mockResolvedValue(session);

    const onStreamEvent = vi.fn();
    const agent = new DroidSdkAgent({
      id: 'conv-list-skills-3',
      workingDir: '/tmp',
      onStreamEvent,
    });

    await expect(agent.start()).resolves.toBeUndefined();
    expect(agent.isConnected).toBe(true);
    expect(listSkills).toHaveBeenCalledTimes(1);

    // AcpSkillManager must not carry stale SDK skills after a listSkills failure.
    expect(AcpSkillManager.getInstance().getSdkSkills()).toEqual([]);

    // No slash_commands_updated event should have been emitted on failure.
    const slashEvents = onStreamEvent.mock.calls.filter(
      ([event]) => (event as { type?: string } | undefined)?.type === 'slash_commands_updated'
    );
    expect(slashEvents).toHaveLength(0);

    // The error should be logged as a warning, not an error event to the UI.
    expect(mainWarnMock).toHaveBeenCalled();
    const errorEvents = onStreamEvent.mock.calls.filter(
      ([event]) => (event as { type?: string } | undefined)?.type === 'error'
    );
    expect(errorEvents).toHaveLength(0);
  });

  it('classifies subagent-like skills as kind="subagent" (P0-4)', async () => {
    const listSkills = vi.fn().mockResolvedValue({
      skills: [
        {
          name: 'research-subagent',
          description: 'Deep research sub-agent',
          location: 'project',
          filePath: '/repo/.factory/skills/research-subagent/SKILL.md',
        },
        {
          name: 'custom-droid-reviewer',
          description: 'Custom droid that reviews PRs',
          location: 'personal',
          filePath: '/home/user/.factory/skills/custom-droid-reviewer/SKILL.md',
        },
        {
          name: 'agent-coordinator',
          description: 'Coordinates multiple agents',
          location: 'project',
          filePath: '/repo/.factory/skills/agent-coordinator/SKILL.md',
        },
        {
          name: 'pptx',
          description: 'Make slides',
          location: 'builtin',
          filePath: '/opt/factory/skills/pptx/SKILL.md',
        },
      ],
    });
    const session = buildSession({ listSkills });
    createSessionMock.mockResolvedValue(session);

    const onStreamEvent = vi.fn();
    const agent = new DroidSdkAgent({
      id: 'conv-list-skills-4',
      workingDir: '/tmp',
      onStreamEvent,
    });

    await agent.start();

    const byName = new Map(
      AcpSkillManager.getInstance()
        .getSdkSkills()
        .map((s) => [s.name, s])
    );
    expect(byName.get('research-subagent')?.kind).toBe('subagent');
    expect(byName.get('custom-droid-reviewer')?.kind).toBe('subagent');
    expect(byName.get('agent-coordinator')?.kind).toBe('subagent');
    expect(byName.get('pptx')?.kind).toBe('skill');

    // Skills index should surface the subagent marker so the prompt / UI can
    // tell the caller which skills are custom-droid / subagent (P0-4 UX).
    const index = AcpSkillManager.getInstance().getSkillsIndex();
    const indexByName = new Map(index.map((entry) => [entry.name, entry.description]));
    expect(indexByName.get('research-subagent')).toContain('[subagent]');
    expect(indexByName.get('pptx')).not.toContain('[subagent]');
  });

  it('tolerates a session without listSkills (older mock / backport)', async () => {
    const session = buildSession(); // no listSkills method
    createSessionMock.mockResolvedValue(session);

    const agent = new DroidSdkAgent({
      id: 'conv-list-skills-5',
      workingDir: '/tmp',
      onStreamEvent: vi.fn(),
    });

    await expect(agent.start()).resolves.toBeUndefined();
    expect(AcpSkillManager.getInstance().getSdkSkills()).toEqual([]);
  });
});
