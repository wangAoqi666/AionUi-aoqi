/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * m1-f1b — AcpSkillManager cache-integrity regression tests.
 *
 * Scrutiny round 1 surfaced two blocking bugs in the
 * `enabledSkills`-keyed singleton:
 *
 *   (a) BACKEND MISSING FROM CACHE KEY — droid/non-droid initialization
 *       order could either
 *         (i) skip `~/.factory/skills` scanning for droid (non-droid first,
 *             then droid reuses the cached `initialized=true` instance and
 *             bails out before evaluating `options.backend`), or
 *         (ii) leak droid-populated user skills into non-droid prompt flows
 *             (droid first, then non-droid reuses the cached instance and
 *             sees `this.skills` populated from the earlier unconditional
 *             scan).
 *       FIX: `getInstance` cache key must include backend so droid and
 *       non-droid flows get distinct initialization state.
 *
 *   (b) sdkSkills must SURVIVE cache-key changes. This file focuses on the
 *       backend-cache partitioning half; see `droidListSkills.test.ts` for
 *       the `enabledSkills`-driven cache-key change half of the same fix.
 *
 * Satisfies the m1-f1b expected behaviour: "≥2 cross-backend cases" +
 * preserves backward compatibility for legacy callers that don't thread the
 * backend hint.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fsPromises from 'fs/promises';
import path from 'path';
import os from 'os';

const pathsHoisted = vi.hoisted(() => ({
  skillsDir: '',
  builtinSkillsCopyDir: '',
  autoSkillsDir: '',
}));

vi.mock('@process/utils/initStorage', () => ({
  getSkillsDir: () => pathsHoisted.skillsDir,
  getBuiltinSkillsCopyDir: () => pathsHoisted.builtinSkillsCopyDir,
  getAutoSkillsDir: () => pathsHoisted.autoSkillsDir,
}));

vi.mock('@process/utils/mainLogger', () => ({
  mainLog: vi.fn(),
  mainWarn: vi.fn(),
  mainError: vi.fn(),
}));

vi.mock('@process/extensions', () => ({
  ExtensionRegistry: {
    getInstance: () => ({
      getSkills: () => [],
    }),
  },
}));

import { AcpSkillManager, type SdkSkill } from '@process/task/AcpSkillManager';
import { prepareFirstMessageWithSkillsIndex } from '@process/task/agentUtils';

async function writeSkill(dir: string, name: string, body: string): Promise<string> {
  const skillDir = path.join(dir, name);
  await fsPromises.mkdir(skillDir, { recursive: true });
  const filePath = path.join(skillDir, 'SKILL.md');
  await fsPromises.writeFile(filePath, body, 'utf-8');
  return filePath;
}

describe('AcpSkillManager — backend cache integrity (m1-f1b)', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    AcpSkillManager.resetInstance();
    tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'aionui-backend-cache-'));
    pathsHoisted.skillsDir = path.join(tmpRoot, 'user-skills');
    pathsHoisted.builtinSkillsCopyDir = path.join(tmpRoot, 'builtin-skills');
    pathsHoisted.autoSkillsDir = path.join(pathsHoisted.builtinSkillsCopyDir, '_builtin');
    await fsPromises.mkdir(pathsHoisted.skillsDir, { recursive: true });
    await fsPromises.mkdir(pathsHoisted.builtinSkillsCopyDir, { recursive: true });
    await fsPromises.mkdir(pathsHoisted.autoSkillsDir, { recursive: true });
  });

  afterEach(async () => {
    AcpSkillManager.resetInstance();
    await fsPromises.rm(tmpRoot, { recursive: true, force: true });
  });

  it('droid-first init, then non-droid reuse does NOT include droid-scanned user skills', async () => {
    // User has installed a custom skill under ~/.factory/skills/. Under the
    // droid backend (VAL-SKILLS-004) this MUST be auto-scanned even when
    // `enabledSkills` is empty. Under non-droid backends (VAL-SKILLS-005)
    // this skill must stay hidden unless enabledSkills lists it.
    await writeSkill(
      pathsHoisted.skillsDir,
      'user-skill-droid-first',
      `---\nname: user-skill-droid-first\ndescription: User custom skill\n---\n\nBody.\n`
    );

    // (1) Droid flow initializes first — should auto-scan user skills.
    const droidMgr = AcpSkillManager.getInstance(undefined, { backend: 'droid' });
    await droidMgr.discoverSkills(undefined, { backend: 'droid' });
    expect(droidMgr.getSkillsIndex().map((s) => s.name)).toContain('user-skill-droid-first');

    // (2) Non-droid flow follows — it MUST NOT see the droid-scanned
    //     user-custom skill. Before the fix the singleton cache was keyed
    //     on enabledSkills only, so both flows shared the same
    //     `this.skills` map and leaked the droid-only scan into claude/
    //     opencode prompts.
    const claudeMgr = AcpSkillManager.getInstance(undefined, { backend: 'claude' });
    await claudeMgr.discoverSkills(undefined, { backend: 'claude' });
    const claudeNames = claudeMgr.getSkillsIndex().map((s) => s.name);
    expect(claudeNames).not.toContain('user-skill-droid-first');
  });

  it('non-droid-first init, then droid call DOES scan ~/.factory/skills', async () => {
    await writeSkill(
      pathsHoisted.skillsDir,
      'user-skill-non-droid-first',
      `---\nname: user-skill-non-droid-first\ndescription: User custom skill\n---\n\nBody.\n`
    );

    // (1) Non-droid flow initializes first — enabledSkills is empty so
    //     user-custom skills are gated out (backward compatibility).
    const claudeMgr = AcpSkillManager.getInstance(undefined, { backend: 'claude' });
    await claudeMgr.discoverSkills(undefined, { backend: 'claude' });
    expect(claudeMgr.getSkillsIndex().map((s) => s.name)).not.toContain('user-skill-non-droid-first');

    // (2) Later droid call MUST still scan ~/.factory/skills. Before the
    //     fix the singleton's `initialized=true` flag short-circuited
    //     `discoverSkills` before it evaluated `options.backend`, so the
    //     droid scan never ran and BYOK "你有什么技能" came up empty.
    const droidMgr = AcpSkillManager.getInstance(undefined, { backend: 'droid' });
    await droidMgr.discoverSkills(undefined, { backend: 'droid' });
    expect(droidMgr.getSkillsIndex().map((s) => s.name)).toContain('user-skill-non-droid-first');
  });

  it('droid init with empty enabledSkills array (not undefined) is equivalent to undefined', async () => {
    // Guard against the `enabledSkills: []` shape (currently used by droid
    // conversations that explicitly clear their whitelist). The fix must
    // treat `[]` and `undefined` identically for cache-key purposes so
    // downstream droid prompts still see user-custom skills.
    await writeSkill(
      pathsHoisted.skillsDir,
      'user-skill-empty-array',
      `---\nname: user-skill-empty-array\ndescription: User custom skill\n---\n`
    );

    // First a claude call primes a cache entry with no backend-specific
    // initialization state for droid.
    const claudeMgr = AcpSkillManager.getInstance([], { backend: 'claude' });
    await claudeMgr.discoverSkills([], { backend: 'claude' });
    expect(claudeMgr.getSkillsIndex().map((s) => s.name)).not.toContain('user-skill-empty-array');

    const droidMgr = AcpSkillManager.getInstance([], { backend: 'droid' });
    await droidMgr.discoverSkills([], { backend: 'droid' });
    expect(droidMgr.getSkillsIndex().map((s) => s.name)).toContain('user-skill-empty-array');
  });

  it('droid- and non-droid-keyed singletons maintain distinct initialization state', async () => {
    await writeSkill(
      pathsHoisted.skillsDir,
      'distinct-state-skill',
      `---\nname: distinct-state-skill\ndescription: User custom skill\n---\n`
    );

    // Interleave discovery calls to assert the cache-key partition holds
    // beyond a single droid→non-droid flip. A droid scan, a claude no-op,
    // and a second droid re-query must each preserve (or re-derive) the
    // droid-specific skill set independently of the non-droid slot.
    const droid1 = AcpSkillManager.getInstance(undefined, { backend: 'droid' });
    await droid1.discoverSkills(undefined, { backend: 'droid' });
    expect(droid1.getSkillsIndex().map((s) => s.name)).toContain('distinct-state-skill');

    const claudeMgr = AcpSkillManager.getInstance(undefined, { backend: 'claude' });
    await claudeMgr.discoverSkills(undefined, { backend: 'claude' });
    expect(claudeMgr.getSkillsIndex().map((s) => s.name)).not.toContain('distinct-state-skill');

    const droid2 = AcpSkillManager.getInstance(undefined, { backend: 'droid' });
    await droid2.discoverSkills(undefined, { backend: 'droid' });
    expect(droid2.getSkillsIndex().map((s) => s.name)).toContain('distinct-state-skill');
  });

  it('legacy callers that omit the backend hint preserve historical cache behavior', async () => {
    // `GeminiAgentManager` and other callers that pre-date the backend hint
    // pass only `enabledSkills`. The fix must keep them on the SAME cache
    // slot they had before — namely the "no backend" slot — so their
    // memoization semantics remain identical and no accidental cache
    // churn regression surfaces.
    const a = AcpSkillManager.getInstance();
    const b = AcpSkillManager.getInstance();
    expect(b).toBe(a);

    const c = AcpSkillManager.getInstance(['only-skill']);
    expect(c).not.toBe(a);
    const d = AcpSkillManager.getInstance(['only-skill']);
    expect(d).toBe(c);
  });
});

/**
 * m1-f1c — SDK skills backend isolation (follow-up to m1-f1b).
 *
 * Scrutiny round-2 surfaced a BLOCKING defect: the module-level
 * `sharedSdkSkills: Map<string, SdkSkill>` hoisted in AcpSkillManager.ts
 * is NOT partitioned by backend. Any droid session's `syncSdkSkills()`
 * writes into the global map, and every subsequent `AcpSkillManager`
 * instance — including ones keyed for `claude`, `opencode`, `qwen`,
 * `iflow`, etc. — merges those droid SDK skills into `getSkillsIndex()`,
 * `hasAnySkills()`, `hasSkill()`, and `getSdkSkills()`. The existing
 * `backend !== 'droid'` gate at `AcpAgentManager.ts:705` only forces droid
 * INTO prompt injection; it does NOT prevent non-droid backends from also
 * entering `prepareFirstMessageWithSkillsIndex` (e.g. `customWorkspace=true`
 * or non-native backends) or the unconditional `buildStaleSkillsReminder`
 * path — both of which call `skillManager.getSkillsIndex()` which then
 * emits droid SDK skills into a non-droid prompt stream.
 *
 * The fix partitions the shared storage by backend key:
 *   `sharedSdkSkillsByBackend: Map<string, Map<string, SdkSkill>>`
 * so `setSdkSkills`, `clearSdkSkills`, `getSdkSkills`, `getSkillsIndex`,
 * `hasAnySkills`, and `hasSkill` all consult the instance's own
 * `this.backend` slot. DroidSdkAgent.syncSdkSkills threads
 * `{ backend: 'droid' }` at its AcpSkillManager.getInstance() call site so
 * the writes land in the droid slot.
 *
 * Test D coverage note: The optional bonus test that exercises
 * `AcpAgentManager.buildStaleSkillsReminder` directly is deferred — the
 * production path is already covered by Test B (which calls the real
 * `prepareFirstMessageWithSkillsIndex` helper that consumes the same
 * backend-keyed AcpSkillManager.getInstance contract) and constructing a
 * minimal AcpAgentManager with mocked IPC exceeds this feature's budget.
 */
describe('AcpSkillManager — SDK skills backend isolation (m1-f1c regression)', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    AcpSkillManager.resetInstance();
    tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'aionui-sdk-skills-backend-'));
    pathsHoisted.skillsDir = path.join(tmpRoot, 'user-skills');
    pathsHoisted.builtinSkillsCopyDir = path.join(tmpRoot, 'builtin-skills');
    pathsHoisted.autoSkillsDir = path.join(pathsHoisted.builtinSkillsCopyDir, '_builtin');
    await fsPromises.mkdir(pathsHoisted.skillsDir, { recursive: true });
    await fsPromises.mkdir(pathsHoisted.builtinSkillsCopyDir, { recursive: true });
    await fsPromises.mkdir(pathsHoisted.autoSkillsDir, { recursive: true });
  });

  afterEach(async () => {
    AcpSkillManager.resetInstance();
    await fsPromises.rm(tmpRoot, { recursive: true, force: true });
  });

  // ---- Test A: cross-backend isolation via direct API --------------------
  it('droid-scoped setSdkSkills MUST NOT leak into a non-droid keyed instance (Test A)', () => {
    // Arrange: droid session reports a single SDK skill.
    const droidMgr = AcpSkillManager.getInstance(undefined, { backend: 'droid' });
    const droidSdkSkill: SdkSkill = {
      name: 'sdk-droid-office-cli',
      description: 'Office CLI skill reported by Droid SDK',
      location: 'personal',
      filePath: '/home/user/.factory/skills/sdk-droid-office-cli/SKILL.md',
      kind: 'skill',
      enabled: true,
    };
    droidMgr.setSdkSkills([droidSdkSkill]);

    // Sanity precondition: droid slot sees its own write.
    expect(droidMgr.getSdkSkills().map((s) => s.name)).toEqual(['sdk-droid-office-cli']);

    // Act: a NON-droid keyed instance (opencode) must be fully partitioned.
    const opencodeMgr = AcpSkillManager.getInstance(undefined, { backend: 'opencode' });

    // Assert: every SDK-skill consumer method must see an empty droid-free
    // view. Before the fix, all four of these returned droid's skill because
    // `sharedSdkSkills` was a single module-level Map shared across backends.
    expect(opencodeMgr.getSdkSkills()).toEqual([]);
    expect(opencodeMgr.hasSkill('sdk-droid-office-cli')).toBe(false);
    expect(opencodeMgr.getSkillsIndex().map((entry) => entry.name)).not.toContain('sdk-droid-office-cli');
    expect(opencodeMgr.hasAnySkills()).toBe(false);
  });

  // ---- Test B: via the real prepareFirstMessageWithSkillsIndex helper ----
  it('prepareFirstMessageWithSkillsIndex with backend=opencode does NOT surface droid SDK skills (Test B)', async () => {
    // Arrange: droid session populates its SDK skill catalog through the
    // same `AcpSkillManager.getInstance(..., { backend: 'droid' })` slot
    // DroidSdkAgent writes into in production.
    const droidMgr = AcpSkillManager.getInstance(undefined, { backend: 'droid' });
    droidMgr.setSdkSkills([
      {
        name: 'sdk-droid-pptx',
        description: 'PowerPoint helpers reported by Droid SDK',
        location: 'builtin',
        filePath: '/opt/factory/skills/sdk-droid-pptx/SKILL.md',
        kind: 'skill',
        enabled: true,
      },
    ]);

    // Act: the next turn is a non-droid (opencode) conversation that still
    // goes through `prepareFirstMessageWithSkillsIndex` (either because the
    // backend lacks native skill support or uses a custom workspace — see
    // AcpAgentManager.ts:700-719). This is the EXACT code path the
    // scrutiny reviewer flagged in round-2.
    const injected = await prepareFirstMessageWithSkillsIndex('user msg from opencode', {
      presetContext: undefined,
      enabledSkills: ['opencode-only'],
      backend: 'opencode',
    });

    // Assert: the droid SDK skill name must NOT appear in the system
    // reminder / skills-index block emitted to the non-droid model.
    expect(injected).not.toContain('sdk-droid-pptx');

    // Negative-control sanity: the user request IS still carried through so
    // the test proves the real helper ran end-to-end (not a silent no-op).
    expect(injected).toContain('user msg from opencode');
  });

  // ---- Test C: positive regression — droid side still works -------------
  it('droid-keyed getInstance().getSkillsIndex() still contains the droid SDK skill (Test C)', () => {
    const droidWriter = AcpSkillManager.getInstance(undefined, { backend: 'droid' });
    droidWriter.setSdkSkills([
      {
        name: 'sdk-droid-office-cli',
        description: 'Office CLI skill reported by Droid SDK',
        location: 'personal',
        filePath: '/home/user/.factory/skills/sdk-droid-office-cli/SKILL.md',
        kind: 'skill',
        enabled: true,
      },
    ]);

    // A later droid-keyed `getInstance` call with a NON-EMPTY enabledSkills
    // whitelist (the real prompt-builder cache slot) MUST still observe the
    // droid SDK skill. This is the m1-f1b guarantee — backend-keyed slots
    // still carry SDK skills across `enabledSkills`-driven cache-key changes.
    const droidReader = AcpSkillManager.getInstance(['placeholder-user-skill'], { backend: 'droid' });
    const names = droidReader.getSkillsIndex().map((entry) => entry.name);
    expect(names).toContain('sdk-droid-office-cli');
    expect(droidReader.hasSkill('sdk-droid-office-cli')).toBe(true);
    expect(droidReader.hasAnySkills()).toBe(true);
    expect(droidReader.getSdkSkills().map((s) => s.name)).toContain('sdk-droid-office-cli');
  });
});
