# Desktop CDP Mission Validation Evidence

Session: `c59b68986bf5` | Date: 2026-04-23 | CDP: 127.0.0.1:9230
Electron: AionUi-Dev/0.1.6 | Model: agentsapi-claude-opus-4-6-thinking [BYOK]

## Assertions Exercised

### VAL-CROSS-002: Mission Mode toggle → DroidSdkAgent session settings — PASSED

**Steps:**

1. Connected to CDP 9230 (Electron running in dev mode)
2. Opened existing droid conversation in "大师课 09-01" workspace
3. Clicked mode selector showing "全自动" (Full Auto)
4. Selected "任务" (Mission) from the dropdown menu
5. Observed MissionPanel appear with "• Idle" and "No features yet"
6. Sent task "列出当前目录的文件" — agent responded correctly in Mission mode
7. Mode indicator confirmed as "权限 · 任务"

**Evidence files:**

- `01-mode-dropdown-open.png` — Mode dropdown showing available modes including "任务"
- `02-mission-mode-selected.png` — After selecting Mission mode, mode indicator shows "任务"
- `03-mission-mode-response.png` — Agent response with MissionPanel visible showing "Idle"

**Verdict:** The AgentModeSelector correctly switches to Mission mode, `getSessionSettingsForMode('mission')` injects `decompSessionType: DecompSessionType.Orchestrator`, and the MissionPanel renders in the UI. The Droid processes messages with Mission mode active.

---

### VAL-CROSS-009: Hot-switching mission mode mid-conversation — PASSED

**Steps:**

1. From active Mission mode conversation (with prior messages), clicked mode selector
2. Attempted switch to "全自动" (Full Auto / YOLO) — safety dialog appeared correctly
3. Cancelled YOLO dialog, switched to "自动" (Auto) instead
4. MissionPanel disappeared, mode indicator changed to "权限 · 自动"
5. Conversation history preserved, no crash, no error
6. Switched back to "任务" (Mission) mode
7. MissionPanel reappeared with "• Idle" state
8. Sent follow-up message "你好，能听到我吗？" — received response "你好，能听到。有什么可以帮你的？"
9. No console errors throughout entire flow

**Evidence files:**

- `04-hot-switch-to-auto.png` — After switching from Mission to Auto mode, conversation intact
- `04b-yolo-confirm-dialog.png` — Safety dialog when attempting Full Auto / YOLO mode
- `05-hot-switch-back-to-mission.png` — After switching back to Mission, MissionPanel restored
- `07-subsequent-message-accepted.png` — Follow-up message accepted and answered correctly

**Verdict:** Bi-directional hot-switching (Mission ↔ Auto) mid-conversation works without crash or state leak. MissionPanel correctly appears/disappears with mode changes. Subsequent messages are accepted and processed correctly after mode switches.

---

### VAL-MISSION-013: End-to-end mission decomposition flow — BLOCKED

**Steps:**

1. In Mission mode, sent complex task "创建一个包含 3 个端点的 Hello Web Server，包含首页、关于页面和API接口"
2. Observed "Processing." badge with count "1" and thinking state
3. Stop button (■) visible during processing (screenshot 06)
4. MissionPanel showed "• Idle" / "No features yet" throughout
5. Droid CLI handled task inline without triggering full Orchestrator decomposition
6. Task completed successfully with inline response (no features/workers spawned)
7. Subsequent message accepted — state recovery confirmed

**Block reason:** Full mission decomposition (with feature list, worker_started/completed events, progress ticks) requires the Droid CLI's Orchestrator to decide the task warrants decomposition. Both tasks sent ("列出当前目录的文件" and "创建一个包含 3 个端点的 Hello Web Server") were handled inline by the Droid agent without decomposition. The UI mechanisms (MissionPanel rendering, state display, stop button) are confirmed working, but **exercising the full decomposition flow depends on Droid CLI runtime behavior that cannot be controlled from the client side**.

**Evidence files:**

- `06-mission-processing-active.png` — Processing state with stop button visible
- `06b-mission-completed-response.png` — Completed inline response (no decomposition)

**What was verified:**

- ✅ MissionPanel renders correctly in Mission mode
- ✅ "Processing." state badge appears during task processing
- ✅ Stop button (■) visible during active processing
- ✅ State recovery after task completion (subsequent message accepted)
- ❌ Full Orchestrator decomposition with features/workers not triggered (external dependency)
