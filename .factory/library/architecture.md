# Architecture — Agent Factory 0.1.6 (mission baseline)

High-level map of the processes, components, data flows, and invariants workers must preserve. Read BEFORE touching any cross-process boundary.

---

## Three-process model

```
[Renderer Process]            [Main / Node Process]                      [Worker Forks]
  src/renderer/        <--->   src/process/                     <--->    src/process/worker/
    React + Arco UI              Electron main + IPC + SDK                 long-running tasks

                                     |
                                     v
                           @factory/droid-sdk@0.1.4
                                     |
                                     v
                                Factory Droid CLI
                                (local / spawned)
```

**IPC bridge**: `src/preload.ts` wires `ipcBridge.*` proxies. Every cross-process call goes through it — no renderer code may `import` main-process files.

**Path aliases** (enforced):

- `@/*` → `src/*`
- `@process/*` → `src/process/*`
- `@renderer/*`→ `src/renderer/*`
- `@worker/*` → `src/process/worker/*`

---

## Droid main-process subsystem (in scope for this mission)

```
AcpAgentManager.ts  (src/process/task/)
  ├── data.backend === 'droid' → DroidSdkAgent
  │       ├── startSession / resumeSession / stream
  │       ├── syncSdkSkills() → AcpSkillManager ∪ slash_commands_updated event
  │       ├── classifySdkSkill() → 'skill' | 'subagent'
  │       ├── setMode() → getSessionSettingsForMode() → session.updateSettings
  │       ├── setEnabledToolIds() → session-scoped tool whitelist
  │       ├── add/remove/toggle/listMcpServer/listMcpTools/authenticateMcpServer
  │       └── onNotification handlers (session_title, settings_updated,
  │             mcp_status, mcp_auth, mission_state, mission_features,
  │             mission_progress, mission_heartbeat, mission_worker_started,
  │             mission_worker_completed)
  ├── AcpSkillManager (src/process/task/)
  │       ├── discoverSkills() — scans ~/.factory/skills + builtin + autoSkills
  │       ├── invalidate() / getSkillsIndex() / getSdkSkills()
  │       └── skillsWatcher (fs.watch on 3 roots, 500ms debounce)
  └── messageMapper.ts — DroidMessage → IResponseMessage (SWITCH-add-case for new events)
```

**Services layer** (BYOK / CLI):

```
src/process/bridge/services/
  ├── DroidByokService.ts
  │     ├── inferByokModelCapabilities() — pattern-based local inference
  │     ├── flushFactoryCatalogRefresh() — 500ms debounce + 2s cooldown
  │     └── verifyByokCapabilitiesAgainstCli()   [NEW in 0.1.7]
  └── OfficeCliInstaller.ts
        └── isWindowsExecutionPolicyError() — multi-lang stderr signal set
```

**IPC boundary** (`src/preload.ts` / `src/process/bridge/acpConversationBridge.ts`):

- Template quartet: channel (ipcBridge.ts) → provider (acpConversationBridge.ts) → manager wrapper (AcpAgentManager.ts) → renderer hook caller.
- Existing template: `setSkipPermissionsUnsafe` — read it before adding any new quartet.
- All new channel names use kebab-case `acp.<verb>-<noun>`.

---

## Droid renderer subsystem (in scope)

```
src/renderer/
  ├── utils/model/agentModes.ts   — catalog per backend (driod, qwen, claude, ...)
  │
  ├── pages/conversation/platforms/acp/
  │     ├── useAcpMessage.ts       — central event switch for ALL stream events
  │     │     switch(type) {                  ← MUST match BEFORE default
  │     │       case 'text_chunk': ...
  │     │       case 'tool_call': ...
  │     │       case 'finish': ...
  │     │       case 'mission_state': ...       [NEW]
  │     │       case 'mission_features': ...    [NEW]
  │     │       case 'mission_progress': ...    [NEW]
  │     │       case 'mission_heartbeat': ...   [NEW]
  │     │       case 'mission_worker_started': [NEW]
  │     │       case 'mission_worker_completed': [NEW]
  │     │       case 'session_title': ...       [NEW]
  │     │       case 'settings_updated': ...    [NEW]
  │     │       case 'mcp_status': ...          [NEW]
  │     │       case 'mcp_auth': ...            [NEW]
  │     │       default: /* legacy auto-recover → running=true */
  │     │     }
  │     ├── AcpSendBox.tsx        — compact AgentModeSelector pill
  │     ├── ChatLayout.tsx        — header AgentModeSelector pill
  │     └── (NEW) MissionPanel.tsx + hooks
  │
  ├── pages/guid/*                — first-conversation picker (GuidActionRow: onModeSelect)
  │
  ├── components/AgentModeSelector  — 3 render surfaces share this component
  │
  ├── hooks/mcp/
  │     ├── useMcpServers        — merged config + live session state
  │     ├── useMcpServerCRUD     — add/remove/toggle UI handlers
  │     ├── useMcpOperations     — list/tool/auth operations
  │     ├── useMcpOAuth          — OAuth flow state
  │     └── (NEW) useDroidMcpLiveStatus — consumes mcp_status by server.name
  │
  └── services/i18n/locales/{en-US,zh-CN,zh-TW,ja-JP,ko-KR,tr-TR}/
          ├── agentMode.json       [add 'mission' key]
          ├── mcp.json              [add 6 error keys]
          └── ...
```

**Renderer rules** (do NOT violate):

1. No raw HTML interactives (`<button>`, `<input>`, `<select>`, `<textarea>`) — use Arco components.
2. No hardcoded colors — UnoCSS semantic tokens or CSS Modules + CSS vars.
3. No `any` types; prefer `type` over `interface`.
4. All user-facing text via `t('<key>')`; every key present in every locale.
5. `useEffect` subscriptions paired with `.off`/`removeEventListener` in cleanup.

---

## Data flow: stream event from SDK to UI

```
  @factory/droid-sdk session.stream(...)
        │
        │  session.onNotification(callback, filter?)
        │
        ▼
  DroidSdkAgent.onNotification handlers
        │
        │   converts SDK payload to stream event shape
        │
        ▼
  DroidMessageMapper.mapMessage (switch-add-case)
        │
        ▼
  AcpAgentManager's emit layer (onStreamEvent → IPC)
        │
        │   ipcBridge.acpConversation.onMessage (renderer subscribe)
        │
        ▼
  useAcpMessage.ts switch(message.type)    ← NEW CASE HERE (before default)
        │
        │   filter by message.conversation_id
        │
        ▼
  Component state / store / side effect (conversation.update, Notification, MissionPanel)
```

**Invariants:**

- Non-turn events (session*title, settings_updated, mcp*\_, mission\_\_) never call `addOrUpdateMessage`, `setRunning(true)`, or `setAiProcessing(true)`.
- Events filtered by `conversation_id` at the handler level.
- Mission events must be CASE-matched BEFORE `default:` to prevent the legacy auto-recover behaviour.

---

## BYOK lifecycle

```
User saves BYOK config in Settings UI
  │
  ▼
ipcBridge → byok-crud-save → DroidByokService.save()
  │
  ▼
inferByokModelCapabilities(modelId)   — local pattern inference
  │
  ▼
settings.local.json updated   [ConfigStorage write]
  │
  ▼
flushFactoryCatalogRefresh()   [500ms debounce + 2s cooldown]
  │
  ▼
refreshFactoryDroidCatalog()   — queries CLI availableModels
  │
  ▼  [NEW in 0.1.7]
verifyByokCapabilitiesAgainstCli()
  ├── ok: []          — CLI confirms capability
  ├── missing: []     — CLI lacks this model entirely
  ├── conflict: []    — CLI says different capability (e.g., noImageSupport)
  └── unreachable: bool  — CLI ENOENT / timeout / not-found
  │
  ▼
onStreamEvent: capabilities_unverified | capability-drift   — non-blocking UI notification
```

**BYOK hard rule**: the stored value ALWAYS wins at runtime. Verifier produces warnings, NEVER rewrites settings.local.json.

---

## Skills injection on first message

```
user sends first message in a droid conversation
  │
  ▼
AcpAgentManager.sendMessage  (backend === 'droid' path)
  │
  ▼
prepareFirstMessageWithSkillsIndex(message, skillsIndex)
  │
  │   attaches a hidden system-reminder listing SDK-known skills
  │
  ▼
DroidSdkAgent.sendMessageInternal → session.stream
```

**Rule**: the skill-index injection path MUST include SDK-reported skills (from `listSkills()`) after M1 fixes. That's the regression repair.

---

## MCP lifecycle (M4)

```
User adds MCP server in UI
  │
  ├── Writes mcp.config via ConfigStorage  [config-truth]
  │
  └── ipcBridge.acpConversation.addMcpServer.invoke  [live-session truth — NEW]
        │
        ▼
      AcpAgentManager.addMcpServer(params)  (droid-guard)
        │
        ▼
      DroidSdkAgent.addMcpServer  →  session.addMcpServer
        │
        ▼
      SDK emits mcp_status notification
        │
        ▼
      useDroidMcpLiveStatus merges by server.name into useMcpServers state
```

**Config-truth alone is insufficient.** Workers must invoke the live-session IPC path for every CRUD action. See VAL-IPC-014.

---

## Release invariants (M5)

- `git rev-parse --abbrev-ref HEAD` = `dev`
- `git log --oneline cbeaab34..HEAD | wc -l` = exactly `1`
- Single commit has subject matching `^(feat|chore|release)(\([a-z-]+\))?: .*0\.1\.7`
- No AI signatures in message body
- Not pushed (`git log origin/dev..HEAD --oneline | wc -l` ≥ 1)
- `package.json.version === "0.1.7"`
- `CHANGELOG.md` has `## [0.1.7]` above `## [0.1.6]` with 6 required sub-headers

---

## What NOT to touch

| Scope                                                          | Reason                                            |
| -------------------------------------------------------------- | ------------------------------------------------- |
| `src/process/agent/{qwen,gemini,opencode,iflow,codex,cursor}/` | Out of scope                                      |
| `src/renderer/pages/` not on Mission / MCP / BYOK / Skills     | Out of scope                                      |
| `~/.factory/settings.local.json`                               | User BYOK creds                                   |
| `~/.factory/memories.md`, `~/.factory/rules/`                  | User agent metadata                               |
| `.factory/memories.md` (project)                               | Project memory                                    |
| `out/`, `dist/`, `node_modules/`                               | Build artifacts                                   |
| Electron process PID                                           | User owns it — NEVER restart                      |
| `Feat/Release` commits by another worker (mid-mission)         | Release worker orchestrates the squash at the end |
