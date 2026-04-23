/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Covers the P0-1 (session.listSkills) + P0-4 (subagent surface) integration
 * described in `.factory/skills/droid-sdk-integration/references/gaps-and-guidance.md`.
 *
 * m1-f1 locks in the structured-diagnostics contract (VAL-SKILLS-001..003 +
 * VAL-SKILLS-011):
 *   - `DroidSdkAgent.startSession()` calls `session.listSkills()` exactly once.
 *   - Returned `SkillInfo[]` is merged into `AcpSkillManager` as SDK skills
 *     AND surfaced in `getSkillsIndex()` so `prepareFirstMessageWithSkillsIndex`
 *     and `buildStaleSkillsReminder` can inject them into prompts.
 *   - A `listSkills()` rejection must NOT break `startSession()` — the
 *     failure must be observable via a stable structured log key
 *     `droid.sync_sdk_skills.failed` and a process-lifetime failure counter
 *     exposed through `getDiagnosticsSnapshot()`.
 *   - Every call to `syncSdkSkills()` must emit `slash_commands_updated`
 *     exactly once (success: sdkSkills populated; failure: empty +
 *     structured error). Sessions lacking `listSkills` short-circuit without
 *     emitting any event or bumping the counter (absence ≠ failure).
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
  DecompSessionType: {
    Ask: 'ask',
    Spec: 'spec',
    Plan: 'plan',
    Orchestrator: 'orchestrator',
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

type SlashCommandsUpdatedEvent = {
  type: 'slash_commands_updated';
  conversation_id: string;
  msg_id: string;
  data: {
    source: string;
    sessionId?: string | null;
    sdkSkills?: Array<{ name: string; kind?: string; description?: string; location?: string }>;
    error?: string;
  };
};

function getSlashCommandsEvents(onStreamEvent: ReturnType<typeof vi.fn>): SlashCommandsUpdatedEvent[] {
  return onStreamEvent.mock.calls
    .map((call) => call[0] as { type?: string } | undefined)
    .filter((event): event is SlashCommandsUpdatedEvent => event?.type === 'slash_commands_updated');
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

  it('emits slash_commands_updated with merged sdkSkills when listSkills resolves (VAL-SKILLS-001)', async () => {
    const returnedSkills = [
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
    ];
    const listSkills = vi.fn().mockResolvedValue({ skills: returnedSkills });
    const session = buildSession({ listSkills });
    createSessionMock.mockResolvedValue(session);

    const onStreamEvent = vi.fn();
    const agent = new DroidSdkAgent({
      id: 'conv-list-skills-2',
      workingDir: '/tmp',
      onStreamEvent,
    });

    await agent.start();

    // (1) skills merged into AcpSkillManager.
    // m1-f1c — SDK skills are now partitioned by backend in
    // `sharedSdkSkillsByBackend`. DroidSdkAgent.syncSdkSkills writes into
    // the droid slot, so the test must read back via `{ backend: 'droid' }`
    // to observe those writes.
    const manager = AcpSkillManager.getInstance(undefined, { backend: 'droid' });
    const sdkSkills = manager.getSdkSkills();
    expect(sdkSkills).toHaveLength(returnedSkills.length);
    expect(sdkSkills.map((s) => s.name).toSorted()).toEqual(['pdf-reader', 'pptx-tools']);
    expect(manager.hasSkill('pptx-tools')).toBe(true);
    expect(manager.hasAnySkills()).toBe(true);

    // (2) exactly one slash_commands_updated event with correct shape
    const slashEvents = getSlashCommandsEvents(onStreamEvent);
    expect(slashEvents).toHaveLength(1);
    const [successEvent] = slashEvents;
    expect(successEvent.conversation_id).toBe('conv-list-skills-2');
    expect(successEvent.data.source).toBe('droid-sdk');
    expect(successEvent.data.sdkSkills).toBeDefined();
    expect(successEvent.data.sdkSkills).toHaveLength(returnedSkills.length);
    expect(successEvent.data.sdkSkills!.map((s) => s.name).toSorted()).toEqual(['pdf-reader', 'pptx-tools']);
    expect(successEvent.data.error).toBeUndefined();

    // (3) failure counter remains at zero on happy path
    expect(agent.getDiagnosticsSnapshot().syncSdkSkillsFailureCount).toBe(0);
  });

  it('records structured failure + still emits slash_commands_updated when listSkills rejects (VAL-SKILLS-002)', async () => {
    const listSkills = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('list-skills blew up'), { name: 'ListSkillsRpcError' }));
    const session = buildSession({ listSkills });
    createSessionMock.mockResolvedValue(session);

    const onStreamEvent = vi.fn();
    const agent = new DroidSdkAgent({
      id: 'conv-list-skills-3',
      workingDir: '/tmp',
      onStreamEvent,
    });

    // (1) startSession must NOT throw and the agent must remain connected.
    await expect(agent.start()).resolves.toBeUndefined();
    expect(agent.isConnected).toBe(true);
    expect(listSkills).toHaveBeenCalledTimes(1);

    // (2) a structured log entry with stable key droid.sync_sdk_skills.failed
    //     MUST be emitted, carrying sessionId + error name + error message.
    const structuredCalls = mainWarnMock.mock.calls.filter((call) => call[1] === 'droid.sync_sdk_skills.failed');
    expect(structuredCalls).toHaveLength(1);
    const [, , payload] = structuredCalls[0] as unknown as [
      string,
      string,
      { sessionId: string | null; message: string; name: string },
    ];
    expect(payload).toBeDefined();
    expect(payload.sessionId).toBe('session-list-skills');
    expect(payload.message).toContain('list-skills blew up');
    expect(payload.name).toBe('ListSkillsRpcError');

    // (3) failure counter MUST observe the failure (diagnostics getter).
    expect(agent.getDiagnosticsSnapshot().syncSdkSkillsFailureCount).toBe(1);

    // (4) slash_commands_updated MUST be emitted exactly once with the
    //     failure shape: source=droid-sdk, error non-empty, sdkSkills=[].
    const slashEvents = getSlashCommandsEvents(onStreamEvent);
    expect(slashEvents).toHaveLength(1);
    const [failureEvent] = slashEvents;
    expect(failureEvent.conversation_id).toBe('conv-list-skills-3');
    expect(failureEvent.data.source).toBe('droid-sdk');
    expect(failureEvent.data.sdkSkills).toEqual([]);
    expect(typeof failureEvent.data.error).toBe('string');
    expect(failureEvent.data.error!.length).toBeGreaterThan(0);
    expect(failureEvent.data.error).toContain('list-skills blew up');

    // (5) no SDK skills leaked into the shared manager on failure.
    expect(AcpSkillManager.getInstance().getSdkSkills()).toEqual([]);

    // (6) no top-level 'error' stream event was emitted — listSkills failure
    //     must stay quiet as far as the UI is concerned.
    const errorEvents = onStreamEvent.mock.calls.filter(
      ([streamEvent]) => (streamEvent as { type?: string } | undefined)?.type === 'error'
    );
    expect(errorEvents).toHaveLength(0);
  });

  it('no-ops when session.listSkills is undefined (VAL-SKILLS-003)', async () => {
    const session = buildSession(); // no listSkills method
    createSessionMock.mockResolvedValue(session);

    const onStreamEvent = vi.fn();
    const agent = new DroidSdkAgent({
      id: 'conv-list-skills-5',
      workingDir: '/tmp',
      onStreamEvent,
    });

    await expect(agent.start()).resolves.toBeUndefined();

    // (1) no SDK skills leak into the shared manager.
    expect(AcpSkillManager.getInstance().getSdkSkills()).toEqual([]);

    // (2) absence is NOT failure — the counter stays at zero.
    expect(agent.getDiagnosticsSnapshot().syncSdkSkillsFailureCount).toBe(0);

    // (3) no slash_commands_updated emission (nothing to broadcast).
    const slashEvents = getSlashCommandsEvents(onStreamEvent);
    expect(slashEvents).toHaveLength(0);

    // (4) no structured failure log emitted either.
    const structuredFailures = mainWarnMock.mock.calls.filter((call) => call[1] === 'droid.sync_sdk_skills.failed');
    expect(structuredFailures).toHaveLength(0);
  });

  it('prompt injection includes SDK-reported skills after syncSdkSkills (VAL-SKILLS-011)', async () => {
    const listSkills = vi.fn().mockResolvedValue({
      skills: [
        {
          name: 'office-cli',
          description: 'Interact with Office files via CLI',
          location: 'personal',
          filePath: '/home/user/.factory/skills/office-cli/SKILL.md',
          enabled: true,
        },
        {
          name: 'pptx-tools',
          description: 'PowerPoint helpers',
          location: 'personal',
          filePath: '/home/user/.factory/skills/pptx-tools/SKILL.md',
          enabled: true,
        },
      ],
    });
    const session = buildSession({ listSkills });
    createSessionMock.mockResolvedValue(session);

    const agent = new DroidSdkAgent({
      id: 'conv-list-skills-6',
      workingDir: '/tmp',
      onStreamEvent: vi.fn(),
    });

    await agent.start();

    // SDK skills must be observable via the manager so downstream prompt
    // builders (prepareFirstMessageWithSkillsIndex, buildStaleSkillsReminder)
    // pick them up when the next user prompt is assembled.
    // m1-f1c — read back via `{ backend: 'droid' }` since SDK skills are
    // now partitioned by backend in `sharedSdkSkillsByBackend`.
    const manager = AcpSkillManager.getInstance(undefined, { backend: 'droid' });
    const sdkSkills = manager.getSdkSkills();
    expect(sdkSkills.map((s) => s.name).toSorted()).toEqual(['office-cli', 'pptx-tools']);

    // `getSkillsIndex()` — the function called by both prompt builders —
    // MUST include the SDK-reported skill names so the prompt text will
    // list them as available skills for the model.
    const skillsIndex = manager.getSkillsIndex();
    const indexNames = skillsIndex.map((entry) => entry.name);
    expect(indexNames).toContain('office-cli');
    expect(indexNames).toContain('pptx-tools');

    // `buildSkillsIndexText` is the exact function `prepareFirstMessageWithSkillsIndex`
    // uses to render the skills-index block into the system-reminder. Import
    // it here and assert the rendered text carries both SDK skill names so
    // the next turn's system prompt can introduce them to the model.
    const { buildSkillsIndexText } = await import('@/process/task/AcpSkillManager');
    const rendered = buildSkillsIndexText(skillsIndex);
    expect(rendered).toContain('office-cli');
    expect(rendered).toContain('pptx-tools');
    expect(rendered).toContain('[Available Skills]');
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

    // m1-f1c — SDK skills are now partitioned by backend; read back via
    // `{ backend: 'droid' }` because DroidSdkAgent.syncSdkSkills writes
    // into the droid slot.
    const byName = new Map(
      AcpSkillManager.getInstance(undefined, { backend: 'droid' })
        .getSdkSkills()
        .map((s) => [s.name, s])
    );
    expect(byName.get('research-subagent')?.kind).toBe('subagent');
    expect(byName.get('custom-droid-reviewer')?.kind).toBe('subagent');
    expect(byName.get('pptx')?.kind).toBe('skill');

    // Skills index should surface the subagent marker so the prompt / UI can
    // tell the caller which skills are custom-droid / subagent (P0-4 UX).
    const index = AcpSkillManager.getInstance(undefined, { backend: 'droid' }).getSkillsIndex();
    const indexByName = new Map(index.map((entry) => [entry.name, entry.description]));
    expect(indexByName.get('research-subagent')).toContain('[subagent]');
    expect(indexByName.get('pptx')).not.toContain('[subagent]');
  });

  // ---------------------------------------------------------------------
  // m1-f4 — classifySdkSkill word-boundary / segment match (VAL-SKILLS-008..010)
  //
  // Before m1-f4 the classifier used naive `haystack.includes('agent')` and
  // `haystack.includes('droid')` substring checks, which false-positively
  // flagged any skill whose path lived under the `agent-factory/` project
  // directory — including the user-installed `office-cli` skill the BYOK
  // regression in VAL-SKILLS-012 depends on. The fix replaces those
  // substring checks with:
  //   (1) structured `info.kind === 'subagent'` when the SDK provides it;
  //   (2) word-boundary / path-segment matching of `subagent`,
  //       `custom-droid`, `custom_droid` (never the bare tokens `agent` or
  //       `droid`) against the skill name and filePath;
  //   (3) anything else falls through to `'skill'`.
  // ---------------------------------------------------------------------

  it('does not classify skills located under agent-factory project paths as subagents (VAL-SKILLS-008)', async () => {
    const listSkills = vi.fn().mockResolvedValue({
      skills: [
        {
          name: 'office-cli',
          description: 'Interact with Office files via CLI',
          location: 'personal',
          // The path carries the literal `agent-factory` segment because
          // the user cloned this repository into that directory. Under the
          // old naive `includes('agent')` check this was misclassified as
          // a subagent and silently demoted in the prompt index.
          filePath: '/Users/wayz/Desktop/我的云盘/git_repo/agent-factory/skills/office-cli/SKILL.md',
          enabled: true,
        },
        {
          name: 'pptx-tools',
          description: 'PowerPoint helpers',
          location: 'personal',
          filePath: '/home/user/agent-factory/skills/pptx-tools/SKILL.md',
          enabled: true,
        },
      ],
    });
    const session = buildSession({ listSkills });
    createSessionMock.mockResolvedValue(session);

    const agent = new DroidSdkAgent({
      id: 'conv-list-skills-val-skills-008',
      workingDir: '/tmp',
      onStreamEvent: vi.fn(),
    });

    await agent.start();

    // m1-f1c — read back via `{ backend: 'droid' }` since SDK skills are
    // partitioned by backend in `sharedSdkSkillsByBackend`.
    const byName = new Map(
      AcpSkillManager.getInstance(undefined, { backend: 'droid' })
        .getSdkSkills()
        .map((s) => [s.name, s])
    );
    expect(byName.get('office-cli')?.kind).toBe('skill');
    expect(byName.get('pptx-tools')?.kind).toBe('skill');

    // Downstream prompt text must NOT carry `[subagent]` for these skills.
    const indexByName = new Map(
      AcpSkillManager.getInstance(undefined, { backend: 'droid' })
        .getSkillsIndex()
        .map((entry) => [entry.name, entry.description])
    );
    expect(indexByName.get('office-cli')).not.toContain('[subagent]');
    expect(indexByName.get('pptx-tools')).not.toContain('[subagent]');
  });

  it('classifies SDK skills with subagent/custom-droid segment or structured kind as subagent (VAL-SKILLS-009)', async () => {
    const listSkills = vi.fn().mockResolvedValue({
      skills: [
        // (1) Name carries a `-subagent` word boundary.
        {
          name: 'my-subagent',
          description: 'Bespoke research subagent',
          location: 'personal',
          filePath: '/home/user/.factory/skills/my-subagent/SKILL.md',
        },
        // (2) filePath has an exact path segment `subagent`.
        {
          name: 'helper',
          description: 'Helper skill filed under a /subagent/ directory',
          location: 'project',
          filePath: '/repo/.factory/skills/subagent/helper/SKILL.md',
        },
        // (3) filePath has an exact path segment `custom-droid`.
        {
          name: 'reviewer',
          description: 'Reviewer filed under /custom-droid/',
          location: 'personal',
          filePath: '/home/user/.factory/custom-droid/reviewer/SKILL.md',
        },
        // (4) filePath has an exact path segment `custom_droid` (underscore).
        {
          name: 'auditor',
          description: 'Auditor filed under /custom_droid/',
          location: 'project',
          filePath: '/repo/.factory/custom_droid/auditor/SKILL.md',
        },
        // (5) Structured `kind: 'subagent'` payload from SDK (passthrough
        //     field). Name and path alone carry no subagent signal — the
        //     structured flag alone must be honoured.
        {
          name: 'neutral-name',
          description: 'Neutral name + path, but SDK tags it as subagent',
          location: 'project',
          filePath: '/repo/.factory/skills/neutral-name/SKILL.md',
          kind: 'subagent',
        },
      ],
    });
    const session = buildSession({ listSkills });
    createSessionMock.mockResolvedValue(session);

    const agent = new DroidSdkAgent({
      id: 'conv-list-skills-val-skills-009',
      workingDir: '/tmp',
      onStreamEvent: vi.fn(),
    });

    await agent.start();

    // m1-f1c — read back via `{ backend: 'droid' }` since SDK skills are
    // partitioned by backend in `sharedSdkSkillsByBackend`.
    const byName = new Map(
      AcpSkillManager.getInstance(undefined, { backend: 'droid' })
        .getSdkSkills()
        .map((s) => [s.name, s])
    );
    expect(byName.get('my-subagent')?.kind).toBe('subagent');
    expect(byName.get('helper')?.kind).toBe('subagent');
    expect(byName.get('reviewer')?.kind).toBe('subagent');
    expect(byName.get('auditor')?.kind).toBe('subagent');
    expect(byName.get('neutral-name')?.kind).toBe('subagent');
  });

  it('uses segment/word-boundary match rather than naive substring (VAL-SKILLS-010)', async () => {
    // The regression set for VAL-SKILLS-010 — each of these names / paths
    // was classified as `'subagent'` by the old naive substring check
    // (they all contain `agent` or `droid` as a substring somewhere) but
    // MUST be classified as `'skill'` under the word-boundary / segment
    // rule because none of them carry `subagent` / `custom-droid` /
    // `custom_droid` as a bounded token.
    const listSkills = vi.fn().mockResolvedValue({
      skills: [
        {
          name: 'managed-skill',
          description: 'Not a subagent — plain skill nested under /management/',
          location: 'project',
          filePath: '/repo/.factory/management/managed-skill/SKILL.md',
        },
        {
          name: 'droidflyer',
          description: 'Ships drone routes — not a subagent',
          location: 'personal',
          filePath: '/home/user/.factory/skills/droidflyer/SKILL.md',
        },
        {
          name: 'droid-skill-agent-of-truth',
          description: 'Oracle-style skill — name has droid/agent substrings but is NOT a subagent',
          location: 'project',
          filePath: '/repo/.factory/skills/droid-skill-agent-of-truth/SKILL.md',
        },
        {
          name: 'agent-coordinator',
          description: 'Coordinates multiple agents — but is itself a skill, not a subagent',
          location: 'project',
          filePath: '/repo/.factory/skills/agent-coordinator/SKILL.md',
        },
      ],
    });
    const session = buildSession({ listSkills });
    createSessionMock.mockResolvedValue(session);

    const agent = new DroidSdkAgent({
      id: 'conv-list-skills-val-skills-010',
      workingDir: '/tmp',
      onStreamEvent: vi.fn(),
    });

    await agent.start();

    // m1-f1c — read back via `{ backend: 'droid' }` since SDK skills are
    // partitioned by backend in `sharedSdkSkillsByBackend`.
    const byName = new Map(
      AcpSkillManager.getInstance(undefined, { backend: 'droid' })
        .getSdkSkills()
        .map((s) => [s.name, s])
    );
    expect(byName.get('managed-skill')?.kind).toBe('skill');
    expect(byName.get('droidflyer')?.kind).toBe('skill');
    expect(byName.get('droid-skill-agent-of-truth')?.kind).toBe('skill');
    expect(byName.get('agent-coordinator')?.kind).toBe('skill');

    // Skill-index descriptions must NOT be prefixed with `[subagent]` for
    // any of the above — the prompt-injected text the model sees for the
    // next turn would otherwise falsely advertise them as subagents.
    const indexByName = new Map(
      AcpSkillManager.getInstance(undefined, { backend: 'droid' })
        .getSkillsIndex()
        .map((entry) => [entry.name, entry.description])
    );
    expect(indexByName.get('managed-skill')).not.toContain('[subagent]');
    expect(indexByName.get('droidflyer')).not.toContain('[subagent]');
    expect(indexByName.get('droid-skill-agent-of-truth')).not.toContain('[subagent]');
    expect(indexByName.get('agent-coordinator')).not.toContain('[subagent]');
  });

  // ---------------------------------------------------------------------
  // m1-f1b — SDK skills MUST survive cache-key changes.
  //
  // Scrutiny round 1 blocker: `DroidSdkAgent.syncSdkSkills` writes into
  // the default-keyed AcpSkillManager singleton (`getInstance()` with no
  // enabledSkills), but `prepareFirstMessageWithSkillsIndex` and
  // `buildStaleSkillsReminder` later query via a DIFFERENT cache-keyed
  // singleton driven by the conversation's `enabledSkills` list. Before
  // the fix the SDK-reported skills silently vanished from the prompt
  // injection path once the caller configured a non-empty enabledSkills.
  //
  // The fix persists sdkSkills outside the enabledSkills-keyed singleton
  // (module-level storage consulted by every keyed instance's injection
  // query), so each of the two prompt builders still observes the SDK
  // skill set regardless of which cache key their caller happens to land
  // on.
  // ---------------------------------------------------------------------

  it('prepareFirstMessageWithSkillsIndex with non-empty enabledSkills INCLUDES sdkSkills after syncSdkSkills resolves (m1-f1b)', async () => {
    const listSkills = vi.fn().mockResolvedValue({
      skills: [
        {
          name: 'sdk-reported-office-cli',
          description: 'Office CLI skill reported by Droid SDK',
          location: 'personal',
          filePath: '/home/user/.factory/skills/sdk-reported-office-cli/SKILL.md',
          enabled: true,
        },
      ],
    });
    const session = buildSession({ listSkills });
    createSessionMock.mockResolvedValue(session);

    const agent = new DroidSdkAgent({
      id: 'conv-list-skills-f1b-prepare',
      workingDir: '/tmp',
      onStreamEvent: vi.fn(),
    });
    await agent.start();

    // Simulate the exact cache-keyed fetch that
    // `prepareFirstMessageWithSkillsIndex` (agentUtils.ts:110-113) performs
    // when the owning droid conversation has a NON-EMPTY `enabledSkills`
    // configured. Before the fix this instance's sdkSkills map was empty
    // because it was a different cache-key singleton than the one
    // DroidSdkAgent wrote to in syncSdkSkills.
    const manager = AcpSkillManager.getInstance(['placeholder-user-skill'], { backend: 'droid' });
    const index = manager.getSkillsIndex();
    expect(index.map((entry) => entry.name)).toContain('sdk-reported-office-cli');

    // Exercise the real renderer used in prepareFirstMessageWithSkillsIndex
    // to prove the SDK skill would actually land in the injected system
    // reminder text.
    const { buildSkillsIndexText } = await import('@/process/task/AcpSkillManager');
    const rendered = buildSkillsIndexText(index);
    expect(rendered).toContain('sdk-reported-office-cli');
    expect(rendered).toContain('[Available Skills]');

    // hasSkill must agree with the index query so the agent can tell the
    // skill exists when the model requests [LOAD_SKILL: ...]. Older broken
    // paths would answer `false` here after the cache-key change.
    expect(manager.hasSkill('sdk-reported-office-cli')).toBe(true);
    expect(manager.hasAnySkills()).toBe(true);
  });

  it('buildStaleSkillsReminder with non-empty enabledSkills includes sdkSkills (m1-f1b)', async () => {
    const listSkills = vi.fn().mockResolvedValue({
      skills: [
        {
          name: 'sdk-reported-pptx',
          description: 'PowerPoint helpers reported by Droid SDK',
          location: 'builtin',
          filePath: '/opt/factory/skills/sdk-reported-pptx/SKILL.md',
          enabled: true,
        },
      ],
    });
    const session = buildSession({ listSkills });
    createSessionMock.mockResolvedValue(session);

    const agent = new DroidSdkAgent({
      id: 'conv-list-skills-f1b-stale',
      workingDir: '/tmp',
      onStreamEvent: vi.fn(),
    });
    await agent.start();

    // Simulate `AcpAgentManager.buildStaleSkillsReminder` (L1763) — same
    // `enabledSkills`-keyed getInstance pattern used by the droid
    // skillsWatcher re-emit path. A non-empty enabledSkills must NOT
    // cause the manager to forget the SDK-reported skill.
    const manager = AcpSkillManager.getInstance(['another-enabled-skill'], { backend: 'droid' });
    const index = manager.getSkillsIndex();
    expect(index.map((entry) => entry.name)).toContain('sdk-reported-pptx');

    const { buildSkillsIndexText } = await import('@/process/task/AcpSkillManager');
    const rendered = buildSkillsIndexText(index);
    expect(rendered).toContain('sdk-reported-pptx');
    expect(rendered).toContain('[Available Skills]');
  });
});
