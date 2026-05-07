---
name: droid-backend-worker
description: Main-process Droid SDK / IPC / services worker for Agent Factory. Owns src/process/** changes, Vitest node-project tests, DroidSdkAgent + AcpAgentManager + MCP + BYOK + skill-manager wiring. Writes backend unit tests, may spawn desktop-app-testing skill for end-to-end regression scenes (BYOK skill answering, CDP 9230).
---

# Droid Backend Worker

NOTE: Startup (read mission.md + AGENTS.md, `init.sh`, baseline tests) is handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for features under the following milestones/paths:

- **M1 Skills Pipeline** — all 4 features (`src/process/agent/droid/DroidSdkAgent.ts`, `src/process/task/AcpSkillManager.ts`, `AcpAgentManager.ts` skillsWatcher)
- **M4 IPC Exposure backend quartets + invariants** — MCP 6-method backend (`ipcBridge.ts`, `acpConversationBridge.ts`, `AcpAgentManager`), IPC grep sweep
- **M5 Quality fixes** — BYOK verifier + migration (`DroidByokService.ts`, `catalogRefresher`), Windows PS7 detector + CJK (`OfficeCliInstaller.ts`)
- Any feature with `skillName: droid-backend-worker` in `features.json`

## Required Skills

- **`droid-sdk-integration`** (project skill) — MUST invoke via Skill tool as the FIRST step on every feature. Carries the project-specific Droid SDK map + hard rules + common-tasks T1..T7 table. Ignore at your peril.
- **`desktop-app-testing`** (project skill) — invoke when the feature declares a manual CDP verification step (e.g., m1-f4 BYOK regression). Connect existing Electron on 127.0.0.1:9230. NEVER start/restart the desktop app.
- **`security-auditor`** (personal droid) — invoke via the Task tool when feature touches BYOK config, logs, or error messages that might carry apiKey material. Pre-commit for m5-f16 is mandatory.

## Work Procedure

### Step 0 — Load context (FIRST thing every feature)

1. Invoke the `droid-sdk-integration` skill via the Skill tool.
2. Read your assigned feature in `features.json` end-to-end.
3. Read the relevant assertions in `validation-contract.md` (all IDs in `fulfills`).
4. Read the actual source file(s) mentioned in the feature description via Read tool (never paraphrase).
5. If the feature references `@factory/droid-sdk` symbols, read `node_modules/@factory/droid-sdk/dist/index.d.ts` for the authoritative type signature.

If after step 4 the feature description contradicts the source, STOP and return to orchestrator.

### Step 1 — Write failing tests (RED)

In ONE tool call (Create or Edit), author the test file(s) mentioned in `expectedBehavior` / `verificationSteps`. Each case in the test file should correspond to at least one assertion ID in `fulfills`.

Run:

```bash
bun run test <path-to-test-file>
```

Confirm RED output. If tests are already green (phantom implementation), you have misread the feature — stop and verify source file state, then re-plan.

Use vitest hoisted-mocks pattern (see existing `tests/unit/AcpAgentManagerSkillInjection.test.ts` for reference). Mock DroidSession methods directly (not via DroidSdkAgent). Prefer deterministic fakes over spies.

#### Hard-learned test coverage lessons (from m1-skills scrutiny round 1)

1. **AcpSkillManager is cache-keyed by enabledSkills** — any SDK-skill injection feature MUST include a regression case that calls `prepareFirstMessageWithSkillsIndex` (or `buildStaleSkillsReminder`) with a NON-EMPTY `enabledSkills` array after the feature's syncSdkSkills / discovery path runs. The default `AcpSkillManager.getInstance()` (empty `enabledSkills`) is a different keyed instance than the one consumed by the real prompt builders. Testing only the default instance is a false-positive trap.
2. **Backend-sensitive discovery needs cross-backend cache-integrity coverage** — any discovery-path feature MUST test both init orders (droid-first-then-non-droid AND non-droid-first-then-droid) to prove that cached state from one backend does not leak into the other, and that a later backend-specific entry still re-discovers its own path. Include this whenever you touch `AcpSkillManager` / `GeminiAgentManager` / `agentUtils.ts` discovery entry points.
3. **Audit vi.mock('@process/utils/initStorage') sites before touching AcpAgentManager imports** — when adding a new import from `@process/utils/initStorage` into `AcpAgentManager.ts` (new skill-dir getters, new IPC getters, etc.), grep for `vi.mock.*initStorage` across `tests/` BEFORE implementing the production change. Extend every stale mock with the new getter return value. Do NOT paper over the stale-mock crash by wrapping production code in a defensive outer try/catch — that pattern hides bugs in production.

### Step 2 — Implement source change (GREEN)

In a SEPARATE tool call (Edit), apply the minimal source change to make tests pass. Follow these conventions:

- Hard Rules in mission `AGENTS.md` are non-negotiable — pay special attention to rules 1 (BYOK modelId preserved), 2 (new SDK events via mapper), 5 (resume-path parity), 7 (Node spawn only for CLI).
- Preserve existing `extractErrorMessage` 300-char trim for BYOK error paths.
- NEVER log `apiKey` / `api_key` / `Authorization: Bearer ...` payloads — use structured logger with redacted fields.
- Structured log key naming: `droid.<domain>.<event>` e.g., `droid.sync_sdk_skills.failed`, `droid.byok.verifier.cli_unreachable`, `droid.skills.parse_failed`.

Run tests again — confirm GREEN. Then run the full quality gate:

```bash
bun run lint:fix
bun run format
bunx tsc --noEmit
bun run test
```

All must pass. Fix any fallout before proceeding.

### Step 3 — Manual verification (if declared)

Features requiring desktop CDP verification (e.g., m1-f4) — invoke the `desktop-app-testing` skill. Connect CDP 9230, run the exact scenario in `verificationSteps`. Capture screenshots + DevTools console log + IPC network log under the mission's validation evidence directory.

Do NOT try to relaunch the app. If CDP is unreachable, stop and return to orchestrator.

#### Binary freshness pre-flight (from m1-f4b BLOCKED finding)

**BEFORE launching any CDP scenario**, verify the running Electron main bundle (`out/main/index.js`) actually contains the symbols your feature's commits introduced. The user's Electron app was often built hours ago and may predate your feature's implementation — running the scenario against a stale binary produces misleading evidence.

Pre-flight command: `rg -n '<unique-new-symbol>' out/main/index.js`. If 0 matches, the binary is stale; STOP and return to orchestrator with a `discoveredIssues` entry describing the missing symbol. Do NOT proceed with the scenario — the results will not reflect your commits. The orchestrator will ask the USER to rebuild + relaunch Electron (a worker-forbidden action).

Example symbols by feature:

- m1-f3 (skillsWatcher rebroadcast): `emitSkillsWatcherSlashCommandsUpdated`, `runSkillsRefreshPipeline`
- m1-f4 (bounded-token classifier): `containsBoundedToken`, `SUBAGENT_BOUNDED_TOKENS`
- m1-f1b (cache-key partitioning): `sharedSdkSkills` (module-level)

#### Event observation via electronAPI bridge (from m1-f4b finding)

`slash_commands_updated` and similar main→renderer broadcast events are marshalled through `ipcRenderer.on` by the preload bridge. A plain `window.addEventListener('slash_commands_updated', ...)` or console-only tap misses them entirely (no `CustomEvent` dispatch). Correct tap:

```js
// In renderer console via agent-browser evaluate:
window.__valEvents = [];
window.electronAPI.on('slash_commands_updated', (payload) => {
  window.__valEvents.push({ ts: Date.now(), payload });
});
// ... trigger the scenario ...
// ... poll window.__valEvents ...
```

Record this tap setup + the captured `__valEvents` snapshot in the console-log artifact under evidence/.

#### Evidence completeness rule (from m1-skills scrutiny round 1)

When a feature's `verificationSteps` or contract-assertion Evidence field explicitly lists multiple artifact types (screenshot, console-errors, network calls, IPC log), ALL listed artifact types MUST be captured and archived. Screenshots alone do NOT count as "followed procedure" when console or IPC evidence was also required. A worker that captures screenshots only while the contract requires screenshot+console+IPC MUST return with `whatWasLeftUndone` describing the missing artifacts — do NOT mark the feature complete.

Per-assertion artifact storage path:

```
.factory/validation/<milestone>/user-testing/evidence/<feature-id>/<VAL-ID>/
  ├── screenshot-<step>.png
  ├── console-<step>.log   (devtools console capture)
  └── ipc-<step>.json      (renderer→main IPC calls relevant to the scenario)
```

For VAL-SKILLS-013 (hot-reload) + VAL-SKILLS-014 (listSkills fallback) specifically: both require a visible `slash_commands_updated` emit in the renderer console log AND the resulting skill-set shift, not just a terminal reply screenshot.

### Step 4 — Commit

Write a focused commit:

```bash
git add -A  # (review with git diff --cached first)
git diff --cached   # grep for apiKey / Authorization: Bearer — if any, STOP
git commit -m "<type>(<scope>): <subject>"
```

Commit subject per project convention: English, imperative, no AI signatures.

Run `git status` to confirm clean. Then proceed to handoff.

### Step 5 — Prepare handoff

Fill out handoff fields per the Example Handoff below. Be concrete. Reference file:line for code changes. List every test case added by `{name, verifies: [VAL-*-ID]}`.

## Example Handoff

```json
{
  "salientSummary": "Hardened DroidSdkAgent.syncSdkSkills with structured diagnostics (failure counter + stable log key droid.sync_sdk_skills.failed) and always-emit slash_commands_updated. Added tests/unit/droidListSkills.test.ts with 4 cases; bun run test passes (3495 tests total). Also extended AcpSkillManagerSkillInjection test to assert SDK skills flow into prompt injection.",
  "whatWasImplemented": "src/process/agent/droid/DroidSdkAgent.ts#L1668-L1760: (1) both catch blocks now structured-log via the logger with key droid.sync_sdk_skills.failed + sessionId + err.message + err.name; (2) added private syncSdkSkillsFailureCount counter (non-persistent, process-lifetime) exposed via new public getDiagnosticsSnapshot(); (3) success and error paths both emit onStreamEvent({type:'slash_commands_updated', data:{source:'droid-sdk', sdkSkills|error}}) exactly once; (4) session without listSkills silently no-ops. AcpSkillManager.getSdkSkills() now populated on success — prepareFirstMessageWithSkillsIndex includes them. Bug report snapshot surfaces syncSdkSkillsFailureCount.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {
        "command": "bun run test tests/unit/droidListSkills.test.ts",
        "exitCode": 0,
        "observation": "4 passed, 0 failed — cases: emits slash_commands_updated ... / records structured failure ... / no-ops when listSkills is undefined / prompt injection includes SDK-reported skills"
      },
      { "command": "bunx tsc --noEmit", "exitCode": 0, "observation": "No type errors across src/process/." },
      { "command": "bun run lint", "exitCode": 0, "observation": "oxlint passes — 0 warnings / 0 errors." },
      {
        "command": "bun run test",
        "exitCode": 0,
        "observation": "3495 passed, 0 failed (+4 from baseline 3491; no regressions)."
      }
    ],
    "interactiveChecks": []
  },
  "tests": {
    "added": [
      {
        "file": "tests/unit/droidListSkills.test.ts",
        "cases": [
          {
            "name": "emits slash_commands_updated with merged sdkSkills when listSkills resolves",
            "verifies": ["VAL-SKILLS-001"]
          },
          {
            "name": "records structured failure + still emits slash_commands_updated when listSkills rejects",
            "verifies": ["VAL-SKILLS-002"]
          },
          { "name": "no-ops when session.listSkills is undefined", "verifies": ["VAL-SKILLS-003"] },
          {
            "name": "prompt injection includes SDK-reported skills after syncSdkSkills",
            "verifies": ["VAL-SKILLS-011"]
          }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

Beyond the standard cases:

- Backend source structure differs materially from the description (the audit may have shifted since capture). Do not paper over — surface the delta.
- A test case is impossible to write without stubbing internal SDK state not exposed by the SDK surface. Propose surfacing the state via a small SDK adapter addition and return.
- You find a hard-rule violation in existing code (e.g., `where.exe` used for CLI path). Flag via `discoveredIssues` but DO NOT fix it in this feature.
- `bun run test` runs into an unrelated timeout / flake that is not fixable inside this feature. Return with a `discoveredIssues` entry describing the flake + the specific test name.
- You need to touch `~/.factory/` system paths (you almost certainly should not). If the feature truly requires it (only m5-f16 BYOK verifier has read-only access justification), re-read `AGENTS.md` boundaries and only proceed if your read is clearly within scope.
