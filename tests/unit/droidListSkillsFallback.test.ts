/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * m1-f4b / VAL-SKILLS-014 — listSkills rejection fallback (integration-level).
 *
 * Motivation:
 *   VAL-SKILLS-014 states that when a live Droid SDK session's
 *   `listSkills()` rejects at runtime, the Droid-backed skill pipeline MUST
 *   degrade gracefully: the renderer never crashes, a structured
 *   `droid.sync_sdk_skills.failed` log is emitted, a
 *   `slash_commands_updated` event goes out with `sdkSkills: []` + a
 *   non-empty `error` string, AcpSkillManager.getSdkSkills() stays empty,
 *   AND the filesystem-backed skills that live under `~/.factory/skills/`
 *   stay visible through the same AcpSkillManager instance so the next
 *   `prepareFirstMessageWithSkillsIndex` injection still surfaces at
 *   least two distinct real skill names to the model.
 *
 *   Forcing the rejection path from the CDP side is not tractable (there
 *   is no public surface to poison `session.listSkills()` inside the live
 *   Electron process without touching the user's SDK install). So this
 *   test is a hoisted-mocks integration suite against `@factory/droid-sdk`
 *   that stitches together the real `DroidSdkAgent`, the real
 *   `AcpSkillManager`, the real `agentUtils.prepareFirstMessageWithSkillsIndex`
 *   renderer, and a tmpdir-backed `~/.factory/skills/` layout with two
 *   genuine `SKILL.md` files (one per location). It covers:
 *
 *   (a) no process crash — agent.start() resolves.
 *   (b) structured log `droid.sync_sdk_skills.failed` emitted with
 *       error.message + error.name + sessionId.
 *   (c) `slash_commands_updated` fires exactly once with
 *       `{ source: 'droid-sdk', error: <non-empty string>, sdkSkills: [] }`.
 *   (d) `AcpSkillManager.getSdkSkills()` remains empty but the
 *       filesystem-scanned skill list still contains ≥2 entries.
 *   (e) The first subsequent `prepareFirstMessageWithSkillsIndex(...)`
 *       injection output under `backend: 'droid'` STILL carries ≥2 distinct
 *       real skill names pulled from the tmpdir filesystem scan.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fsPromises from 'fs/promises';
import path from 'path';
import os from 'os';

// --- Hoisted fakes ----------------------------------------------------------

const pathsHoisted = vi.hoisted(() => ({
  skillsDir: '',
  builtinSkillsCopyDir: '',
  autoSkillsDir: '',
}));

const createSessionMock = vi.hoisted(() => vi.fn());
const resumeSessionMock = vi.hoisted(() => vi.fn());
const mainLogMock = vi.hoisted(() => vi.fn());
const mainWarnMock = vi.hoisted(() => vi.fn());
const mainErrorMock = vi.hoisted(() => vi.fn());

// Mock the SDK surface — createSession returns a session that rejects
// `listSkills()`. Everything else mirrors the enums DroidSdkAgent imports.
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

// Redirect every `~/.factory/skills/` / builtin / autoSkills lookup into
// temp directories so we can populate them with real SKILL.md files. Both
// AcpSkillManager (direct consumer) AND agentUtils.prepareFirstMessageWithSkillsIndex
// (indirect consumer via `buildSkillsIndexText`) share this mock.
vi.mock('@process/utils/initStorage', () => ({
  getSkillsDir: () => pathsHoisted.skillsDir,
  getBuiltinSkillsCopyDir: () => pathsHoisted.builtinSkillsCopyDir,
  getAutoSkillsDir: () => pathsHoisted.autoSkillsDir,
}));

vi.mock('@process/utils/mainLogger', () => ({
  mainLog: mainLogMock,
  mainWarn: mainWarnMock,
  mainError: mainErrorMock,
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

vi.mock('@process/extensions', () => ({
  ExtensionRegistry: {
    getInstance: () => ({
      getSkills: () => [],
    }),
  },
}));

// Real modules (no mocks):
// - @process/agent/droid/DroidSdkAgent
// - @process/task/AcpSkillManager
// - @process/task/agentUtils
import { DroidSdkAgent } from '@/process/agent/droid/DroidSdkAgent';
import { AcpSkillManager } from '@/process/task/AcpSkillManager';
import { prepareFirstMessageWithSkillsIndex } from '@/process/task/agentUtils';

// --- Fixtures ---------------------------------------------------------------

function buildSession(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    sessionId: 'session-list-skills-fallback',
    updateSettings: vi.fn(),
    close: vi.fn(),
    interrupt: vi.fn(),
    stream: vi.fn(async function* () {}),
    ...overrides,
  };
}

async function writeSkill(dir: string, name: string, frontmatter: string): Promise<string> {
  const skillDir = path.join(dir, name);
  await fsPromises.mkdir(skillDir, { recursive: true });
  const filePath = path.join(skillDir, 'SKILL.md');
  await fsPromises.writeFile(filePath, frontmatter, 'utf-8');
  return filePath;
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

// --- Test suite -------------------------------------------------------------

describe('VAL-SKILLS-014 — listSkills rejection falls back to filesystem-scanned skills', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    createSessionMock.mockReset();
    resumeSessionMock.mockReset();
    mainLogMock.mockReset();
    mainWarnMock.mockReset();
    mainErrorMock.mockReset();
    AcpSkillManager.resetInstance();

    tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'aionui-listskills-fallback-'));
    pathsHoisted.skillsDir = path.join(tmpRoot, 'user-skills');
    pathsHoisted.builtinSkillsCopyDir = path.join(tmpRoot, 'builtin-skills');
    pathsHoisted.autoSkillsDir = path.join(pathsHoisted.builtinSkillsCopyDir, '_builtin');
    await fsPromises.mkdir(pathsHoisted.skillsDir, { recursive: true });
    await fsPromises.mkdir(pathsHoisted.builtinSkillsCopyDir, { recursive: true });
    await fsPromises.mkdir(pathsHoisted.autoSkillsDir, { recursive: true });

    // Seed two real filesystem skills that the fallback scan MUST surface.
    await writeSkill(
      pathsHoisted.skillsDir,
      'office-cli',
      `---\nname: office-cli\ndescription: Office CLI helper (fallback baseline skill)\n---\n\nBody.\n`
    );
    await writeSkill(
      pathsHoisted.skillsDir,
      'pptx-tools',
      `---\nname: pptx-tools\ndescription: PowerPoint helpers (fallback baseline skill)\n---\n\nBody.\n`
    );
  });

  afterEach(async () => {
    AcpSkillManager.resetInstance();
    await fsPromises.rm(tmpRoot, { recursive: true, force: true });
  });

  it('rejects listSkills without crashing, logs structured failure, and filesystem scan still surfaces ≥2 skills (VAL-SKILLS-014)', async () => {
    const listSkillsRejection = Object.assign(new Error('sdk channel timeout'), {
      name: 'ListSkillsRpcError',
    });
    const listSkills = vi.fn().mockRejectedValue(listSkillsRejection);
    const session = buildSession({ listSkills });
    createSessionMock.mockResolvedValue(session);

    const onStreamEvent = vi.fn();
    const agent = new DroidSdkAgent({
      id: 'conv-val-skills-014',
      workingDir: '/tmp',
      onStreamEvent,
    });

    // (a) No process crash — startSession resolves even though listSkills rejects.
    await expect(agent.start()).resolves.toBeUndefined();
    expect(agent.isConnected).toBe(true);
    expect(listSkills).toHaveBeenCalledTimes(1);

    // (b) Structured log with stable key and payload shape.
    const structuredCalls = mainWarnMock.mock.calls.filter((call) => call[1] === 'droid.sync_sdk_skills.failed');
    expect(structuredCalls).toHaveLength(1);
    const [, , payload] = structuredCalls[0] as unknown as [
      string,
      string,
      { sessionId: string | null; message: string; name: string },
    ];
    expect(payload.sessionId).toBe('session-list-skills-fallback');
    expect(payload.message).toContain('sdk channel timeout');
    expect(payload.name).toBe('ListSkillsRpcError');

    // Observable failure counter on the diagnostics getter is incremented.
    expect(agent.getDiagnosticsSnapshot().syncSdkSkillsFailureCount).toBe(1);

    // (c) slash_commands_updated emitted once with the fail-shape.
    const slashEvents = getSlashCommandsEvents(onStreamEvent);
    expect(slashEvents).toHaveLength(1);
    const [failureEvent] = slashEvents;
    expect(failureEvent.conversation_id).toBe('conv-val-skills-014');
    expect(failureEvent.data.source).toBe('droid-sdk');
    expect(failureEvent.data.sdkSkills).toEqual([]);
    expect(typeof failureEvent.data.error).toBe('string');
    expect(failureEvent.data.error!.length).toBeGreaterThan(0);
    expect(failureEvent.data.error).toContain('sdk channel timeout');

    // (d) SDK skills remain empty, filesystem-scanned skills visible via the
    //     droid-keyed manager (same cache slot consumed by the real prompt
    //     builder). Fallback requires ≥2 distinct real skill names.
    const manager = AcpSkillManager.getInstance([], { backend: 'droid' });
    await manager.discoverSkills([], { backend: 'droid' });
    expect(manager.getSdkSkills()).toEqual([]);

    const filesystemNames = manager
      .getSkillsIndex()
      .map((entry) => entry.name)
      .filter((name): name is string => typeof name === 'string' && name.length > 0);
    const distinctFilesystemNames = Array.from(new Set(filesystemNames));
    expect(distinctFilesystemNames.length).toBeGreaterThanOrEqual(2);
    expect(filesystemNames).toContain('office-cli');
    expect(filesystemNames).toContain('pptx-tools');

    // (e) The real prompt-injection renderer MUST carry ≥2 distinct real
    //     skill names into the system-reminder text that the next turn's
    //     first message will stream to the model. This is the exact
    //     function `AcpAgentManager.sendMessage` calls on the first droid
    //     turn — it MUST still populate an [Available Skills] block with
    //     both seeded skills despite the SDK failure above.
    const injected = await prepareFirstMessageWithSkillsIndex('你有什么技能', {
      presetContext: undefined,
      enabledSkills: [],
      backend: 'droid',
    });
    expect(injected).toContain('[Assistant Rules');
    expect(injected).toContain('[Available Skills]');
    expect(injected).toContain('office-cli');
    expect(injected).toContain('pptx-tools');

    // The injected preamble MUST carry at least 2 distinct skill names by
    // matching against the filesystem baseline names.
    const mentionedBaselineNames = ['office-cli', 'pptx-tools'].filter((name) => injected.includes(name));
    expect(new Set(mentionedBaselineNames).size).toBeGreaterThanOrEqual(2);

    // Negative check: the user request is still appended unchanged at the
    // tail of the injected preamble (the model sees the real question).
    expect(injected).toContain('你有什么技能');

    // Negative check: no `error` stream events were emitted — failure stays
    // silent to the UI, only the structured warn + slash_commands_updated
    // carry it.
    const errorEvents = onStreamEvent.mock.calls.filter(
      ([streamEvent]) => (streamEvent as { type?: string } | undefined)?.type === 'error'
    );
    expect(errorEvents).toHaveLength(0);
  });

  it('second startSession invocation does not duplicate the failure counter or slash broadcast (idempotence under repeated boot)', async () => {
    // This covers the "fallback stays graceful even on reconnect" path —
    // useful because user-testing validator may need to retry a start.
    const listSkills = vi.fn().mockRejectedValue(new Error('still broken'));
    const session1 = buildSession({ listSkills });
    const session2 = buildSession({ listSkills });
    createSessionMock.mockResolvedValueOnce(session1).mockResolvedValueOnce(session2);

    const onStreamEvent = vi.fn();
    const agent = new DroidSdkAgent({
      id: 'conv-val-skills-014-reboot',
      workingDir: '/tmp',
      onStreamEvent,
    });

    await expect(agent.start()).resolves.toBeUndefined();
    await expect(agent.start()).resolves.toBeUndefined();

    // The second start() is a no-op (session already live) so listSkills is
    // only called once. Both the failure counter and the slash_commands_updated
    // emission must reflect exactly one failure cycle, not two.
    expect(listSkills).toHaveBeenCalledTimes(1);
    expect(agent.getDiagnosticsSnapshot().syncSdkSkillsFailureCount).toBe(1);

    const slashEvents = getSlashCommandsEvents(onStreamEvent);
    expect(slashEvents).toHaveLength(1);
    expect(slashEvents[0].data.source).toBe('droid-sdk');
    expect(slashEvents[0].data.sdkSkills).toEqual([]);

    // Filesystem fallback stays intact across reboots.
    const manager = AcpSkillManager.getInstance([], { backend: 'droid' });
    await manager.discoverSkills([], { backend: 'droid' });
    const names = manager.getSkillsIndex().map((entry) => entry.name);
    expect(names).toContain('office-cli');
    expect(names).toContain('pptx-tools');
  });
});
