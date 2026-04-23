---
name: release-worker
description: Final-release worker for Agent Factory 0.1.7 — owns dead-ternary cleanup in DroidByokService, version bump in package.json, CHANGELOG.md 0.1.7 section, security scan via security-auditor subagent, squash-amend into a single atomic commit on dev, and the mission-closure matrix. Runs ONCE at the very end of the mission.
---

# Release Worker

NOTE: Startup (read mission.md + AGENTS.md, `init.sh`, baseline tests) is handled by `worker-base`. This skill defines the WORK PROCEDURE for the single release feature (m5-f18).

## When to Use This Skill

- ONLY for `m5-f18-dead-ternary-version-bump-changelog-release`.
- Every other feature (M1..M4, m5-f16, m5-f17) MUST already be merged on `dev` branch at the mission baseline `cbeaab34`. If the feature list still has pending non-release entries, STOP and return to orchestrator — release is premature.

## Required Skills

- **`security-auditor`** (personal droid) — MUST invoke via Task tool for the full diff `cbeaab34..HEAD` before the final commit. Reports on apiKey / Authorization: Bearer / PII leakage in logs, IPC, or error messages.
- **`droid-sdk-integration`** (project skill) — for the dead-ternary fix context.

## Work Procedure

### Step 0 — Pre-flight

Invoke `droid-sdk-integration` skill.

Read the full `validation-state.json`. Count `status: "passed"` entries. If < 87, STOP and return to orchestrator — the release gate is not met.

Read `features.json`. Confirm every feature except `m5-f18-dead-ternary-version-bump-changelog-release` has `status: "completed"` or `"cancelled"`. If any other feature is pending/in_progress/failed, STOP.

Run baseline sanity:

```bash
cd /Users/wayz/Desktop/我的云盘/git_repo/AionUi-aoqi
git rev-parse --abbrev-ref HEAD    # must be `dev`
git log --oneline cbeaab34..HEAD    # capture commit count, commits list
git status --porcelain              # must be empty
```

If not on dev, or working tree dirty, STOP.

### Step 1 — Dead ternary cleanup (VAL-QUALITY-005)

1. Read `src/process/bridge/services/DroidByokService.ts` around line 270.
2. Confirm the exact pattern matches the audit note: ternary whose both branches evaluate to `false`. In practice it's often `matchPattern(modelId, /o1-preview|o1-pro/) ? false : false`.
3. Replace with plain literal `supportsImageInput: false`.
4. Run the existing `inferByokModelCapabilities` tests: `bun run test -- droidByok` — confirm o1-preview + o1-pro cases still pass with `supportsImageInput===false`.
5. Grep confirms the fix: `rg -n 'o1-preview\|o1-pro' src/process/bridge/services/DroidByokService.ts` returns 0 matches.

Commit:

```bash
git add src/process/bridge/services/DroidByokService.ts
git diff --cached
git commit -m "refactor(byok): collapse dead ternary at DroidByokService:270 to literal false"
```

### Step 2 — Version bump (VAL-QUALITY-009)

1. Edit `package.json`: change exactly one line `"version": "0.1.6"` → `"version": "0.1.7"`. No other edits.
2. Confirm: `jq -r .version package.json` prints `0.1.7`.
3. Confirm: `git diff HEAD~0 -- package.json` shows only the version line change.

Commit:

```bash
git add package.json
git commit -m "chore(release): bump version to 0.1.7"
```

### Step 3 — CHANGELOG (VAL-QUALITY-010)

1. Read `CHANGELOG.md`. Locate `## [0.1.6]` heading.
2. Insert ABOVE it a new section `## [0.1.7]` with six required sub-headers exactly:

```markdown
## [0.1.7]

### Skills Pipeline Integrity (M1)

- `src/process/agent/droid/DroidSdkAgent.ts` `syncSdkSkills` — structured diagnostics, failure counter exposed via diagnostics snapshot, always emits `slash_commands_updated`. VAL-SKILLS-001..003, VAL-SKILLS-011.
- `src/process/task/AcpSkillManager.ts` `discoverSkills` — droid-backend branch scans `~/.factory/skills/` unconditionally; malformed SKILL.md excluded with `droid.skills.parse_failed` log, siblings preserved. VAL-SKILLS-004, 005, 015.
- `AcpAgentManager` `skillsWatcher` — now re-syncs SDK skills + broadcasts `slash_commands_updated` on any of 3 watched roots (user, builtin, autoSkills). VAL-SKILLS-006, 007.
- `DroidSdkAgent.classifySdkSkill` — word-boundary / last-segment match + structured `kind` preference. Fixes `agent-factory`-path false positive. VAL-SKILLS-008..010, 012..014.

### Mission Mode UX (M2)

- `src/renderer/utils/model/agentModes.ts` — `AGENT_MODES.droid` appended with Mission entry; 6-locale i18n for `agentMode.mission`. VAL-MISSION-001, 002, 006.
- `DroidSdkAgent.getSessionSettingsForMode('mission')` unit-covered; routes to `DecompSessionType.Orchestrator`. VAL-MISSION-005.
- `AgentModeSelector` rendered on 3 surfaces; click → `ipcBridge.acpConversation.setMode.invoke({conversationId, mode:'mission'})`; no real-YOLO confirm gate triggered. VAL-MISSION-003, 004.
- New `MissionPanel.tsx` consuming 6 mission\_\* events (mission_state / features / progress / heartbeat / worker_started / worker_completed) through `useAcpMessage.ts` BEFORE the default branch. Bounded progress log N=100; listener-leak-free across mode toggles; cancel returns to base state. VAL-MISSION-007..015, VAL-CROSS-002, 009.

### Stream Event Renderer Wiring (M3)

- `useAcpMessage.ts` — 4 new cases (session_title, settings_updated, mcp_status, mcp_auth) all placed BEFORE default; per-conversation filtering; none toggle turn state. VAL-STREAM-001..013, VAL-CROSS-004.
- `useDroidMcpLiveStatus` hook merges `mcp_status` payload by server.name into `useMcpServers` state; real-time toolCount re-render.
- Global `mcp_auth` listener wires Arco `Notification.info` with optional "Open Auth URL" action → `shell.openExternal`.
- Remount reconcile: subscription cleanup pairs + `turnFinishedRef` reseed.

### IPC Exposure: Tools & MCP (M4)

- `ipcBridge.acpConversation.setEnabledToolIds` — UI "Allowed Tools" multiselect (null / [] / [id,…]); non-droid guard surfaces localized Message.error. VAL-IPC-001..004.
- 6 new `acp.*-mcp-*` channels + providers + `AcpAgentManager` wrappers (addMcpServer, removeMcpServer, toggleMcpServer, listMcpServers, listMcpTools, authenticateMcpServer). Concurrent add/remove race-safe via internal mutex. VAL-IPC-005..010, 012, 019.
- MCP panel live-syncs via `acp.list-mcp-servers`; config-write alone no longer sufficient — matched live-session invoke with rollback/error surfacing. VAL-IPC-013..015.
- `useMcpOAuth` + authenticateMcpServer flow: authUrl passthrough → `shell.openExternal`; `mcp_auth state:'success'` completes loop within one tick. VAL-IPC-011, 020, VAL-CROSS-003.
- Grep-enforced zero-dead-channel sweep + per-wrapper 4-axis test coverage. VAL-IPC-016..018.

### Quality Fixes (M5)

- `src/process/bridge/services/DroidByokService.ts` — new `verifyByokCapabilitiesAgainstCli()` with ok / missing / conflict / unreachable paths, wired into `catalogRefresher` after every BYOK CRUD flush (debounce + cooldown respected). Structured `capabilities_unverified` + `capability-drift` IPC events. 0.1.6→0.1.7 settings migration preserves BYOK apiKey + MCP entries byte-for-byte. VAL-QUALITY-001..004, 013, VAL-CROSS-010.
- `src/process/bridge/services/OfficeCliInstaller.ts` — `isWindowsExecutionPolicyError()` expanded to cover `about_Execution_Policies` URL anchor + `PSSecurityException` class name + multi-language stderr (EN / zh-CN / ja-JP). Optional `Get-ExecutionPolicy` pre-check. CJK path + GBK stderr handled via fallback decoder. VAL-QUALITY-006..008, 014.
- `DroidByokService.ts:270` dead ternary replaced with `supportsImageInput: false` literal. VAL-QUALITY-005.

### Testing

- 6+ new test files added across `tests/unit/` (node + dom projects). Baseline from 0.1.6 preserved (3491) — total ≥3497.
- `bun run test`, `bunx tsc --noEmit`, `bun run lint`, `bun run format:check`, `bun run i18n:types`, `node scripts/check-i18n.js`, `prek run --from-ref cbeaab34 --to-ref HEAD` all green.
```

Update specific file/function names to match actual changes as you amend (workers may have picked different names).

3. Verify headers: `rg -n '^## \[0\.1\.7\]' CHANGELOG.md` → exactly 1; confirm line number < `## [0.1.6]` line.
4. Verify 6 sub-headers: `rg -n '^### ' CHANGELOG.md | head` includes all 6 required sub-headers.

Commit:

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): add 0.1.7 section summarising M1-M5 closure"
```

### Step 4 — Security scan (VAL-QUALITY-011)

Run the grep-level scan:

```bash
rg -n "apiKey|api_key|x-api-key|authorization: Bearer" $(git diff cbeaab34 --name-only | rg -v '^tests/' | rg -v '.md$')
```

For each hit: read the context, confirm it is either (a) a stable identifier name (not a value log), (b) a redaction statement, or (c) an existing 300-char-trim pattern.

Then invoke `security-auditor` custom droid via the Task tool with a prompt like:

```
Goal: review the diff `cbeaab34..HEAD` for Agent Factory 0.1.7 release — any high/critical security issues around BYOK apiKey handling, MCP OAuth URL passing, shell.openExternal usage, or new IPC channel guards.

Context (repo paths):
- Repo: /Users/wayz/Desktop/我的云盘/git_repo/AionUi-aoqi
- Baseline: git commit cbeaab34 (0.1.6)
- Current: HEAD (0.1.7 in progress)
- Relevant files: `git diff --name-only cbeaab34..HEAD`
- Explicit constraint: NO apiKey / Authorization: Bearer value must be logged, IPC-passed, or appear in error messages (existing `extractErrorMessage` 300-char trim in process/utils is the correct sanitiser)

Expected output: a structured finding list (severity, file:line, description, suggested fix). Return only analysis — do not edit files.
```

If the subagent reports high/critical findings, STOP — re-route to a remediation feature at the TOP of features.json and return to orchestrator.

If findings are info/low only, summarise and proceed.

### Step 5 — Full green gate (VAL-CROSS-007)

Run ALL of the following in sequence, each must exit 0:

```bash
bun run lint:fix && bun run format
bunx tsc --noEmit
bun run test --reporter=json > /tmp/mission-test.json
# confirm: jq '.numTotalTests' /tmp/mission-test.json >= 3497 and jq '.numFailedTests' === 0
bun run lint
bun run format:check
bun run i18n:types
node scripts/check-i18n.js
prek run --from-ref cbeaab34 --to-ref HEAD
```

If any fails, STOP — the mission is not releasable yet. Return with specific failure.

### Step 6 — Squash/amend into atomic commit (VAL-QUALITY-012 + VAL-CROSS-006)

The mission's entire history on `dev` above `cbeaab34` becomes ONE commit.

```bash
git log --oneline cbeaab34..HEAD    # note the count N
git reset --soft cbeaab34           # keep working tree; drop commits
git status                          # all changes staged
```

Review staged diff one more time for sensitive data:

```bash
git diff --cached --stat | head -50
git diff --cached | rg -n 'apiKey|api_key|x-api-key|authorization: Bearer|Co-Authored-By|Generated with' && echo "STOP — sensitive marker present" || echo "clean"
```

Then the atomic commit:

```bash
git commit -m "$(cat <<'EOF'
feat(droid): systematic SDK integration closure + Mission Mode + IPC exposure 0.1.7

M1 Skills Pipeline — syncSdkSkills diagnostics, AcpSkillManager droid-path unconditional scan, skillsWatcher rebroadcast, classifySdkSkill word-boundary; BYOK skill-answering regression closed.
M2 Mission Mode UX — agentMode catalog + i18n, AgentModeSelector visibility + setMode IPC, MissionPanel + useAcpMessage 6 mission_* cases (BEFORE default).
M3 Stream Event Wiring — session_title / settings_updated / mcp_status / mcp_auth consumers; useDroidMcpLiveStatus hook; remount reconcile.
M4 IPC Exposure — setEnabledToolIds end-to-end + 6 MCP IPC quartets (add/remove/toggle/list-servers/list-tools/authenticate); grep-enforced zero-dead-channel sweep.
M5 Quality — BYOK verifier (ok/missing/conflict/unreachable) wired to catalogRefresher; Windows PS7+ multi-language execution-policy detector + CJK path; dead ternary cleanup; 0.1.6→0.1.7 migration preserves BYOK+MCP state.

87 validation-contract assertions passed. 6+ new test files. Full test + typecheck + lint + format + i18n + prek all green.
EOF
)"
```

Confirm invariants:

```bash
git log --oneline cbeaab34..HEAD | wc -l          # must be 1
git log --format=%s cbeaab34..HEAD                 # subject regex: ^(feat|chore|release)(\([a-z-]+\))?: .*0\.1\.7
git log --format=%B cbeaab34..HEAD | rg -n 'Co-Authored-By|Generated with' && echo "STOP" || echo "clean"
git log origin/dev..HEAD --oneline | wc -l         # >=1 (not pushed)
git rev-parse --abbrev-ref HEAD                    # dev
```

All must match expectations. DO NOT `git push`.

### Step 7 — Closure matrix (VAL-CROSS-008)

Create `/Users/wayz/Desktop/我的云盘/git_repo/AionUi-aoqi/.factory/validation/mission-closure-matrix.md`:

Layout: a table with 4 columns — (1) Feature ID + description summary, (2) Test files (paths + case names), (3) Manual verification ledger (screenshot path or CDP log line if applicable), (4) VAL-\* assertions closed.

Populate from the handoffs gathered across M1..M5 workers — use the handoff files under `.factory/validation/<milestone>/` if present, otherwise read each feature's `tests.added` back from git history + `verification` output.

Commit the matrix (if outside the single atomic commit, amend):

```bash
git add .factory/validation/mission-closure-matrix.md
git commit --amend --no-edit
```

### Step 8 — Handoff

Fill `salientSummary` with the release summary line (version string, commit sha, test count, 87/87). `interactiveChecks` lists every grep / git command observation.

## Example Handoff

```json
{
  "salientSummary": "Released 0.1.7 as single atomic commit <sha> on dev. All 87 validation assertions passed. Dead ternary at DroidByokService:270 collapsed. CHANGELOG 0.1.7 section + 6 sub-headers written. security-auditor subagent reports no high/critical findings. Full gate green: test 3501 passed / tsc clean / lint clean / format clean / i18n 6 locales complete / prek clean.",
  "whatWasImplemented": "Release artifacts: package.json 0.1.6→0.1.7; CHANGELOG.md new ## [0.1.7] section above ## [0.1.6] with 6 sub-headers; DroidByokService.ts:270 ternary replaced with literal `supportsImageInput: false`; .factory/validation/mission-closure-matrix.md authored listing 18 features × test files × manual ledger × VAL-* closure. Squash: git reset --soft cbeaab34 + amended atomic commit with the standard M1..M5 summary body (no AI signatures).",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      { "command": "jq -r .version package.json", "exitCode": 0, "observation": "0.1.7" },
      {
        "command": "rg -n '^## \\[0\\.1\\.7\\]' CHANGELOG.md",
        "exitCode": 0,
        "observation": "2 matches (header + index); first match line 3 above 0.1.6 header at line 120"
      },
      {
        "command": "rg -n 'o1-preview\\|o1-pro' src/process/bridge/services/DroidByokService.ts",
        "exitCode": 1,
        "observation": "0 matches — ternary removed"
      },
      { "command": "git log --oneline cbeaab34..HEAD | wc -l", "exitCode": 0, "observation": "       1" },
      {
        "command": "bun run test --reporter=json > /tmp/mission-test.json && jq -r '.numTotalTests, .numFailedTests' /tmp/mission-test.json",
        "exitCode": 0,
        "observation": "numTotalTests=3501, numFailedTests=0"
      },
      { "command": "bunx tsc --noEmit", "exitCode": 0, "observation": "clean" },
      { "command": "bun run lint && bun run format:check", "exitCode": 0, "observation": "clean" },
      {
        "command": "bun run i18n:types && node scripts/check-i18n.js",
        "exitCode": 0,
        "observation": "6 locales complete; no missing keys"
      },
      { "command": "prek run --from-ref cbeaab34 --to-ref HEAD", "exitCode": 0, "observation": "passed" }
    ],
    "interactiveChecks": [
      {
        "action": "security-auditor subagent review of cbeaab34..HEAD diff",
        "observed": "0 high / 0 critical. 2 info-level (log-line verbosity in DroidSdkAgent non-sensitive). Reviewed; accepted."
      },
      {
        "action": "git log --format=%B cbeaab34..HEAD | rg -n 'Co-Authored-By|Generated with'",
        "observed": "no matches — no AI signature"
      }
    ]
  },
  "tests": {
    "added": []
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Any non-release feature still pending / failed in features.json.
- Any `status: "pending"` or `"failed"` assertion in `validation-state.json`.
- `bun run test` regresses — STOP immediately; some earlier feature broke CI.
- Security-auditor reports high/critical — do not commit; create fix feature at top and return.
- The squash leaves residual non-feature commits (WIP, debug dumps) — do not mask; surface.
- `prek` reports formatting / lint issues that could not be auto-fixed cleanly (conflicts with earlier commits).
