# m1-f4b — Desktop scenario evidence (VAL-SKILLS-013 + VAL-SKILLS-014)

Feature: `m1-f4b-desktop-scenario-evidence-completion`
Final worker session: `ca62cd05-1b9c-496e-88e5-3f7ffbd48702`
Run window: 2026-04-22 14:18 – 17:22 local (UTC+08) — split across
two worker sessions (prior `7bbe8fb7` BLOCKED on stale Electron
binary, this session re-ran after user rebuilt).

## Scope

Close the two evidence gaps flagged by m1-skills scrutiny round 1
against m1-f4: the hot-reload scenario (VAL-SKILLS-013) and the
`listSkills`-rejection fallback (VAL-SKILLS-014).

## Outcome

| Assertion      | Outcome                                                                                                                                                                 | Evidence                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VAL-SKILLS-013 | **Closed (success).** Skills-watcher broadcast fires on renderer within <1 s of SKILL.md add AND remove; verified across 2 independent cycles on fresh Electron binary. | `VAL-SKILLS-013/README.md` + `VAL-SKILLS-013/screenshot-baseline.png` + `VAL-SKILLS-013/screenshot-after-add.png` + `VAL-SKILLS-013/screenshot-after-remove.png` + `VAL-SKILLS-013/console-baseline.log` + `VAL-SKILLS-013/console-after-add.log` + `VAL-SKILLS-013/console-after-remove.log` + `VAL-SKILLS-013/ipc-baseline.json` + `VAL-SKILLS-013/ipc-after-add.json` + `VAL-SKILLS-013/ipc-after-remove.json` |
| VAL-SKILLS-014 | **Closed (success).** Integration-level vitest suite (2 cases, both green under `bun run test tests/unit/droidListSkillsFallback.test.ts`).                             | `VAL-SKILLS-014/test-output.log` + `VAL-SKILLS-014/code-references.md`                                                                                                                                                                                                                                                                                                                                            |

## Environment snapshot at final capture

- CDP 9230 reachable; Electron PID ≠ 79644 (the stale process from
  the prior worker session); new process started after user's
  rebuild. Bundle `out/main/index.js` mtime `Apr 22 15:11:10 2026`
  contains all 20 required m1-f3/m1-f4/m1-f1b symbols.
- Vite renderer on `http://localhost:5173` live.
- BYOK model `agentsapi-claude-opus-4-6-thinking [BYOK]` present.
- Source tree HEAD: `d51516546 chore(mission): codify m1-f4b
binary-freshness + electronAPI.on observation lessons`.
- `tests/unit/droidListSkillsFallback.test.ts` green (2 cases, 28 ms)
  — output archived.

## Timing matrix (VAL-SKILLS-013)

| Cycle                   | tAdd → Δadd (ms)          | tRemove → Δremove (ms)    | Under 5 s? |
| ----------------------- | ------------------------- | ------------------------- | ---------- |
| 1 (17:06:37 / 17:19:29) | 17:06:37.559 → **623 ms** | 17:19:29.578 → **759 ms** | ✓ / ✓      |
| 2 (17:21:45 / 17:21:48) | 17:21:45.737 → **939 ms** | 17:21:48.254 → **669 ms** | ✓ / ✓      |

Full breakdown in `VAL-SKILLS-013/README.md`.

## Cleanup

- Every probe directory created during worker sessions
  (`__val_probe_v{2..5}__`, `__val_tmp_skill_1776832998__`,
  `__val_tmp_skill_1776839085__`, `__val_tmp_skill_1776848797__`
  renamed to `val-skills-013-probe-1776848797`, and cycle-2 probe
  `val-skills-013-probe-1776849705`) has been moved to
  `/tmp/m1-f4b-trash/` — never `rm -rf`'d per mission guardrails.
  `~/.factory/skills/` contains no VAL-SKILLS-013 artifacts after
  worker exit.
- Prior worker's `BLOCKED.md` moved to
  `/tmp/m1-f4b-trash/obsolete-docs/` (superseded by
  `VAL-SKILLS-013/README.md`).
- Stray `screenshot-baseline.png` that ended up in the repo root
  during an aborted relative-path capture also moved to
  `/tmp/m1-f4b-trash/`.
- CDP helper scripts `/tmp/cdp-val-013-eval.mjs` and
  `/tmp/cdp-val-013-cycle.mjs` left in `/tmp` for future
  re-runs but NOT committed (one-off mission tooling).
- No desktop app start/stop; no `pkill`; CDP session was an existing
  open one on port 9230 (declared in `.factory/services.yaml`).

## Binary-freshness lesson codified

Prior worker's BLOCKED finding (stale bundle) is now codified in
`.factory/library/user-testing.md` as a mandatory pre-flight step
for any backend CDP scenario. See commit `d51516546` and the
`droid-backend-worker` skill's "Binary freshness pre-flight" and
"Event observation via electronAPI bridge" sections.

## No remaining blockers

Both VAL-SKILLS-013 and VAL-SKILLS-014 are now closed. No further
user intervention required for m1-skills scrutiny round 1 evidence
completion.
