/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * m1-f2 — AcpSkillManager.discoverSkills droid-backend unconditional scan.
 *
 * Covers assertions:
 *   - VAL-SKILLS-004: under droid backend, `discoverSkills(undefined)` and
 *     `discoverSkills([])` both include `~/.factory/skills/<custom>` entries.
 *   - VAL-SKILLS-005: under non-droid backend, the enabledSkills gate is
 *     preserved so user-custom skills are NOT auto-loaded when the caller
 *     did not explicitly enable them (backward compatibility).
 *   - VAL-SKILLS-015: malformed SKILL.md frontmatter must not poison
 *     discovery — a structured `droid.skills.parse_failed` log is emitted
 *     with `{path, reason}`, the broken file is excluded, and valid sibling
 *     skills are still indexed. `getSkillsIndex()` remains queryable.
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

const mainWarnMock = vi.hoisted(() => vi.fn());
const mainLogMock = vi.hoisted(() => vi.fn());
const mainErrorMock = vi.hoisted(() => vi.fn());

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

vi.mock('@process/extensions', () => ({
  ExtensionRegistry: {
    getInstance: () => ({
      getSkills: () => [],
    }),
  },
}));

import { AcpSkillManager } from '@process/task/AcpSkillManager';

async function writeSkill(dir: string, name: string, body: string): Promise<string> {
  const skillDir = path.join(dir, name);
  await fsPromises.mkdir(skillDir, { recursive: true });
  const filePath = path.join(skillDir, 'SKILL.md');
  await fsPromises.writeFile(filePath, body, 'utf-8');
  return filePath;
}

describe('AcpSkillManager.discoverSkills — droid backend unconditional scan', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    mainWarnMock.mockReset();
    mainLogMock.mockReset();
    mainErrorMock.mockReset();
    AcpSkillManager.resetInstance();

    tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'aionui-skills-'));
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

  it('scans user skills dir unconditionally under droid backend even when enabledSkills is empty (VAL-SKILLS-004)', async () => {
    await writeSkill(
      pathsHoisted.skillsDir,
      'office-cli',
      `---\nname: office-cli\ndescription: Office CLI helper\n---\n\nBody content.\n`
    );

    const manager = AcpSkillManager.getInstance();
    await manager.discoverSkills(undefined, { backend: 'droid' });

    const names = manager.getSkillsIndex().map((s) => s.name);
    expect(names).toContain('office-cli');
    expect(manager.hasSkill('office-cli')).toBe(true);
  });

  it('scans user skills dir unconditionally under droid backend when enabledSkills is an empty array (VAL-SKILLS-004)', async () => {
    await writeSkill(
      pathsHoisted.skillsDir,
      'office-cli',
      `---\nname: office-cli\ndescription: Office CLI helper\n---\n`
    );

    const manager = AcpSkillManager.getInstance([]);
    await manager.discoverSkills([], { backend: 'droid' });

    const names = manager.getSkillsIndex().map((s) => s.name);
    expect(names).toContain('office-cli');
  });

  it('preserves enabledSkills gating for non-droid backends (VAL-SKILLS-005)', async () => {
    await writeSkill(
      pathsHoisted.skillsDir,
      'office-cli',
      `---\nname: office-cli\ndescription: Office CLI helper\n---\n`
    );

    const manager = AcpSkillManager.getInstance();
    await manager.discoverSkills(undefined, { backend: 'claude' });

    const names = manager.getSkillsIndex().map((s) => s.name);
    expect(names).not.toContain('office-cli');
  });

  it('preserves enabledSkills gating when no backend hint is provided (backward compatibility)', async () => {
    await writeSkill(
      pathsHoisted.skillsDir,
      'office-cli',
      `---\nname: office-cli\ndescription: Office CLI helper\n---\n`
    );

    const manager = AcpSkillManager.getInstance();
    await manager.discoverSkills(undefined);

    const names = manager.getSkillsIndex().map((s) => s.name);
    expect(names).not.toContain('office-cli');
  });

  it('respects explicit enabledSkills list under non-droid backend', async () => {
    await writeSkill(
      pathsHoisted.skillsDir,
      'allowed-skill',
      `---\nname: allowed-skill\ndescription: Allowed skill\n---\n`
    );
    await writeSkill(pathsHoisted.skillsDir, 'gated-skill', `---\nname: gated-skill\ndescription: Gated skill\n---\n`);

    const manager = AcpSkillManager.getInstance(['allowed-skill']);
    await manager.discoverSkills(['allowed-skill'], { backend: 'claude' });

    const names = manager.getSkillsIndex().map((s) => s.name);
    expect(names).toContain('allowed-skill');
    expect(names).not.toContain('gated-skill');
  });

  it('malformed SKILL.md frontmatter emits droid.skills.parse_failed and is skipped while valid siblings stay indexed (VAL-SKILLS-015)', async () => {
    // Malformed: unclosed double quote in name value.
    const brokenPath = await writeSkill(
      pathsHoisted.skillsDir,
      'broken',
      `---\nname: "oops unclosed\ndescription: Broken skill\n---\n\nBody text.\n`
    );
    await writeSkill(
      pathsHoisted.skillsDir,
      'office-cli',
      `---\nname: office-cli\ndescription: Office CLI helper\n---\n\nBody.\n`
    );

    const manager = AcpSkillManager.getInstance();
    await manager.discoverSkills(undefined, { backend: 'droid' });

    const names = manager.getSkillsIndex().map((s) => s.name);
    expect(names).toContain('office-cli');
    expect(names).not.toContain('broken');

    const parseFailedCalls = mainWarnMock.mock.calls.filter(
      (call) => typeof call[1] === 'string' && call[1] === 'droid.skills.parse_failed'
    );
    expect(parseFailedCalls.length).toBeGreaterThanOrEqual(1);

    const payload = parseFailedCalls[0][2] as { path?: string; reason?: string } | undefined;
    expect(payload).toBeDefined();
    expect(payload?.path).toBe(brokenPath);
    expect(typeof payload?.reason).toBe('string');
    expect(String(payload?.reason).length).toBeGreaterThan(0);
  });

  it('malformed frontmatter with unclosed single quote is also skipped (VAL-SKILLS-015)', async () => {
    await writeSkill(pathsHoisted.skillsDir, 'broken-single', `---\nname: 'still-unclosed\ndescription: broken\n---\n`);
    await writeSkill(pathsHoisted.skillsDir, 'valid', `---\nname: valid\ndescription: Valid skill\n---\n`);

    const manager = AcpSkillManager.getInstance();
    await manager.discoverSkills(undefined, { backend: 'droid' });

    const names = manager.getSkillsIndex().map((s) => s.name);
    expect(names).toContain('valid');
    expect(names).not.toContain('broken-single');

    expect(mainWarnMock.mock.calls.some((call) => call[1] === 'droid.skills.parse_failed')).toBe(true);
  });

  it('getSkillsIndex remains queryable without throw after a parse failure (VAL-SKILLS-015)', async () => {
    await writeSkill(pathsHoisted.skillsDir, 'broken', `---\nname: "unterminated\ndescription: oops\n---\n`);

    const manager = AcpSkillManager.getInstance();
    await manager.discoverSkills(undefined, { backend: 'droid' });

    expect(() => manager.getSkillsIndex()).not.toThrow();
    expect(Array.isArray(manager.getSkillsIndex())).toBe(true);
  });
});
