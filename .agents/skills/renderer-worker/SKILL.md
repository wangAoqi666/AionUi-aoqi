---
name: renderer-worker
description: Renderer-process React / hooks / i18n worker for Agent Factory. Owns src/renderer/** changes, Vitest jsdom-project DOM tests, AgentModeSelector + MissionPanel + useAcpMessage + MCP panel + useMcpOAuth. Writes DOM tests with React Testing Library, verifies i18n in all 6 locales, and performs manual desktop-CDP verification.
---

# Renderer Worker

NOTE: Startup (read mission.md + AGENTS.md, `init.sh`, baseline tests) is handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for features touching `src/renderer/**`:

- **M2 Mission Mode UX** — all 3 features (catalog entry, AgentModeSelector visibility, MissionPanel + useAcpMessage 6 cases)
- **M3 Stream Events** — all 4 features (session_title, settings_updated, mcp_status, mcp_auth + stream invariants)
- **M4 IPC Exposure UI side** — setEnabledToolIds UI, MCP panel live sync + OAuth
- Any feature with `skillName: renderer-worker` in `features.json`

## Required Skills

- **`droid-sdk-integration`** (project skill) — MUST invoke first. Maps the ACP SendBox / MissionPanel / useAcpMessage layer and lists the hard rules.
- **`desktop-app-testing`** (project skill) — invoke for manual CDP scenarios declared in features (m2-f7, m3-f9, m4-f12, m4-f14). Connect existing Electron 127.0.0.1:9230. NEVER start/restart the desktop app.
- **`browser-navigation`** (personal project skill) — optional, for DOM state diffing during CDP scenarios.
- **`ui-ux-pro-max`** (personal skill) — optional, consult when designing new UI (MissionPanel, Allowed Tools multiselect) to stay aligned with Arco design + semantic tokens.

## Work Procedure

### Step 0 — Load context

1. Invoke `droid-sdk-integration` skill.
2. Read feature description in `features.json` and all assertions in `validation-contract.md` referenced by `fulfills`.
3. Read the relevant renderer source files (useAcpMessage.ts, AgentModeSelector.tsx, AcpSendBox.tsx, MissionPanel.tsx if exists, useMcp\*, etc.).
4. Read existing Vitest DOM test to match hoisted-mocks pattern: `tests/unit/renderer/useAcpMessage.dom.test.tsx` or any sibling `.dom.test.tsx` file.

### Step 1 — Write failing DOM tests (RED)

Create the new test file with all declared cases as `it(...)` blocks. Use React Testing Library + `@testing-library/user-event`. Mock `ipcBridge.acpConversation.*` / `ipcBridge.conversation.update` / `Notification.info` from `@arco-design/web-react` via hoisted mocks.

Run:

```bash
bun run test <path-to-.dom.test.tsx>
```

Confirm RED.

**DO NOT use raw HTML interactive elements (`<button>`, `<input>`, `<select>`).** Use `@arco-design/web-react` components — Arco renders them through the design system.

**DO NOT hardcode colors or sizes.** Use UnoCSS semantic tokens or CSS Modules + CSS variables. No `#xxxxxx` hex literals in renderer code (lint will catch).

### Step 2 — Implement (GREEN)

Edit the renderer source. Conventions:

- Hooks live next to their component (e.g., `useDroidMcpLiveStatus.ts` near MCP panel).
- Component files use PascalCase (`MissionPanel.tsx`). Hooks camelCase with `use` prefix.
- Testids: `data-testid="mission-panel"`, `data-testid="mission-panel-state"`, etc. — exact match required by tests.
- i18n keys: ALL user-facing strings must use `t(key)` from the i18n provider. Register keys in every locale (`src/renderer/services/i18n/locales/{en-US,zh-CN,zh-TW,ja-JP,ko-KR,tr-TR}/*.json`).
- `useAcpMessage.ts` new cases MUST be added BEFORE the `default:` branch. Each handler MUST filter by `message.conversation_id === conversation_id`. Non-turn events MUST NOT call `addOrUpdateMessage`, `setRunning(true)`, `setAiProcessing(true)` unless they genuinely represent turn progress.
- `useEffect` hooks: every `.on` / `addEventListener` must have a matching `.off` / `removeEventListener` in the cleanup function. Lint + VAL-STREAM-013 + VAL-MISSION-015 assert zero leaks.

Run test again — GREEN. Then quality gate:

```bash
bun run lint:fix
bun run format
bunx tsc --noEmit
bun run test
bun run i18n:types
node scripts/check-i18n.js
```

All must pass.

### Step 3 — Manual CDP verification (if declared)

For features with `desktop-app-testing` scenarios:

1. Invoke `desktop-app-testing` skill.
2. `agent-browser connect 9230`
3. `agent-browser screenshot --annotate && agent-browser snapshot -i -C`
4. Drive the scenario in feature `verificationSteps`.
5. After every navigation / dialog / stream event, re-screenshot + re-snapshot.
6. Archive screenshots + DevTools console to mission evidence dir: `/Users/wayz/.factory/missions/59de60c4-cfc9-4fe6-80c1-889502a429ed/validation-evidence/<feature-id>/`.
7. Record observations in handoff `interactiveChecks` field with concrete `{action, observed}` pairs.

If CDP is unreachable, STOP — do NOT start the desktop app.

### Step 4 — Commit

```bash
git add -A
git diff --cached
git commit -m "feat(renderer): <subject>"
```

No AI signatures. Subject describes WHAT the user sees change.

### Step 5 — Handoff

Fill out handoff fields per the Example Handoff below.

## Example Handoff

```json
{
  "salientSummary": "Added `agentMode.mission` catalog entry in src/renderer/utils/model/agentModes.ts plus 6-locale i18n keys and the droid-specific agentModes.test.ts lock test (6 entries, Mission last). Extended tests/unit/droidMissionMode.test.ts to cover getSessionSettingsForMode('mission') returning DecompSessionType.Orchestrator end-to-end through AcpAgentManager.setMode. bun run test passes 3498 tests; i18n checks clean.",
  "whatWasImplemented": "src/renderer/utils/model/agentModes.ts:73-80 — appended {value:'mission', label:'Mission', description:'Decomposes task into sub-missions'} to AGENT_MODES.droid. Locales updated: src/renderer/services/i18n/locales/{en-US,zh-CN,zh-TW,ja-JP,ko-KR,tr-TR}/agentMode.json each gained a `mission` key with locale-appropriate copy (en='Mission', zh-CN='任务模式', etc.). src/renderer/services/i18n/i18n-keys.d.ts regenerated via `bun run i18n:types`. tests/unit/agentModes.test.ts droid describe-block updated with values.toEqual lock + the it('exposes mission as an available decomposition mode') case. tests/unit/droidMissionMode.test.ts asserts DroidSdkAgent.getSessionSettingsForMode('mission') === {interactionMode: DroidInteractionMode.Auto, autonomyLevel: AutonomyLevel.Medium, decompSessionType: DecompSessionType.Orchestrator} and that AcpAgentManager.setMode('mission') reaches session.updateSettings with the orchestrator settings.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {
        "command": "bun run test -- agentModes droidMissionMode",
        "exitCode": 0,
        "observation": "agentModes.test.ts: 4 passing (+1 lock). droidMissionMode.test.ts: 2 passing."
      },
      { "command": "bun run i18n:types", "exitCode": 0, "observation": "types regenerated; no drift." },
      {
        "command": "node scripts/check-i18n.js",
        "exitCode": 0,
        "observation": "All 6 locales complete; no missing keys."
      },
      { "command": "bunx tsc --noEmit", "exitCode": 0, "observation": "clean." },
      { "command": "bun run lint", "exitCode": 0, "observation": "clean." },
      {
        "command": "bun run test",
        "exitCode": 0,
        "observation": "3498 passed, 0 failed — +7 cases from baseline 3491."
      }
    ],
    "interactiveChecks": []
  },
  "tests": {
    "added": [
      {
        "file": "tests/unit/agentModes.test.ts",
        "cases": [
          { "name": "droid exposes Mission as the 6th mode", "verifies": ["VAL-MISSION-001", "VAL-MISSION-002"] },
          { "name": "exposes mission as an available decomposition mode", "verifies": ["VAL-MISSION-002"] }
        ]
      },
      {
        "file": "tests/unit/droidMissionMode.test.ts",
        "cases": [
          {
            "name": "getSessionSettingsForMode mission routes to DecompSessionType.Orchestrator",
            "verifies": ["VAL-MISSION-005"]
          },
          {
            "name": "AcpAgentManager.setMode mission forwards orchestrator settings to session.updateSettings",
            "verifies": ["VAL-MISSION-005"]
          }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- A DOM test needs a component API that hasn't been shipped by a prior feature — stop, surface the dependency.
- `useAcpMessage.ts` has conflicting existing case that contradicts a feature addition — surface and return.
- A required `ipcBridge.acpConversation.<method>` channel is missing from the preload bridge — this is a backend-worker dependency; return to orchestrator with the specific missing channel.
- Desktop app CDP 9230 is unreachable and the feature requires manual verification — return.
- `node scripts/check-i18n.js` reports a pre-existing locale gap unrelated to your feature — surface as `discoveredIssues` with file/key, do not fix.
- You need to introduce a new Arco component version or UI library — stop and consult ui-ux-pro-max skill first.
