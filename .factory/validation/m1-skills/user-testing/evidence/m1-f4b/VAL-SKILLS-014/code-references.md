# VAL-SKILLS-014 — code references

Integration test file: `tests/unit/droidListSkillsFallback.test.ts`

## Production paths exercised by the test (lines in current tree)

- `src/process/agent/droid/DroidSdkAgent.ts`
  - `syncSdkSkills()` emits the structured log `droid.sync_sdk_skills.failed`,
    increments `this.syncSdkSkillsFailureCount`, and still emits
    `slash_commands_updated` with `source: 'droid-sdk'`, `sdkSkills: []`,
    and a non-empty `error` string when `session.listSkills()` rejects.
    See the error branch around `DroidSdkAgent.ts` (search for
    `droid.sync_sdk_skills.failed`).
  - `getDiagnosticsSnapshot().syncSdkSkillsFailureCount` exposes the
    observable counter the test asserts.
  - Idempotence: a second `start()` is a no-op because the session is
    already alive, so `listSkills()` runs once and both the counter and
    the slash broadcast stay at 1.

- `src/process/task/AcpSkillManager.ts`
  - `AcpSkillManager.getInstance([], { backend: 'droid' })` partitions
    the cache by backend (m1-f1b) so the droid-keyed instance scans
    `getSkillsDir()` unconditionally even when `enabledSkills` is empty.
  - `getSdkSkills()` remains `[]` while `getSkillsIndex()` returns the
    filesystem-scanned baseline (office-cli + pptx-tools from the
    tmpdir-backed `~/.factory/skills/`).

- `src/process/task/agentUtils.ts`
  - `prepareFirstMessageWithSkillsIndex(text, { enabledSkills: [], backend: 'droid' })`
    builds the injected preamble with `[Available Skills]` populated
    from the droid-keyed AcpSkillManager, i.e. the first subsequent
    outgoing user prompt still surfaces ≥ 2 distinct real skill names
    pulled from the filesystem fallback.

## Assertions covered

(a) No process crash — `agent.start()` resolves.
(b) Structured log `droid.sync_sdk_skills.failed` with error.message + name + sessionId.
(c) `slash_commands_updated` with `source: 'droid-sdk'`, `sdkSkills: []`,
and a non-empty `error` string.
(d) `AcpSkillManager.getSdkSkills()` empty; filesystem-scanned skills
≥ 2 (office-cli + pptx-tools).
(e) The next `prepareFirstMessageWithSkillsIndex(...)` injection for the
droid backend still carries ≥ 2 distinct real skill names.

## Why this is an integration test rather than a CDP scenario

Forcing `session.listSkills()` to reject in the live Electron is not
tractable from the CDP side — the rejection has to be injected at the
`@factory/droid-sdk` import boundary inside the main process, which
is not reachable by `agent-browser`. The scenario intent is preserved
by composing the real `DroidSdkAgent` + real `AcpSkillManager` + real
`agentUtils.prepareFirstMessageWithSkillsIndex` under a vitest
hoisted-mock layout that redirects `@factory/droid-sdk` and
`@process/utils/initStorage` at the import boundary — exactly the same
way the production code paths see them under test.
