# Mission Closure Matrix — Droid SDK 深度集成闭环 0.1.7

Baseline: `cbeaab34` | Target: `0.1.7` | Date: 2026-04-23

## Feature Ledger

| #   | Feature ID                                                | Milestone        | Status         | Test File(s)                                                                                                                                          | Verification                                                             |
| --- | --------------------------------------------------------- | ---------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1   | m1-f1-sync-sdk-skills-diagnostics                         | M1 Skills        | ✅ completed   | `tests/unit/acpSkillManagerDroidScan.test.ts`                                                                                                         | Unit: scanDroidSkillsOnce calls listSkills + classifySdkSkill            |
| 2   | m1-f2-skill-manager-droid-unconditional-discovery         | M1 Skills        | ✅ completed   | `tests/unit/acpSkillManagerDroidScan.test.ts`                                                                                                         | Unit: droid backend triggers scan unconditionally on startup             |
| 3   | m1-f3-skills-watcher-rebroadcast                          | M1 Skills        | ✅ completed   | `tests/unit/acpSkillsWatcher.test.ts`                                                                                                                 | Unit: fs.watch → debounce → rescan → broadcast; teardown guard           |
| 4   | m1-f4-classify-skill-word-boundary-and-e2e-regression     | M1 Skills        | ✅ completed   | `tests/unit/droidListSkillsFallback.test.ts`                                                                                                          | Unit: word-boundary regex prevents architect→architecture false positive |
| 5   | m1-f1b-skill-manager-cache-integrity                      | M1 Skills        | ✅ completed   | `tests/unit/acpSkillManagerBackendCache.test.ts`                                                                                                      | Unit: backend-partitioned cache isolation                                |
| 6   | m1-f4b-desktop-scenario-evidence-completion               | M1 Skills        | ✅ completed   | (CDP evidence)                                                                                                                                        | Desktop: CDP scenario validation via agent-browser                       |
| 7   | m1-f1c-skill-manager-sdk-skills-backend-partition         | M1 Skills        | ✅ completed   | `tests/unit/acpSkillManagerBackendCache.test.ts`                                                                                                      | Unit: sharedSdkSkillsByBackend partitioned map                           |
| 8   | m1-f1d-handle-stream-event-slash-commands-whitelist       | M1 Skills        | ✅ completed   | `tests/unit/AcpAgentManagerSlashCommandsBootstrap.test.ts`                                                                                            | Unit: slash_commands_updated bypasses bootstrap guard                    |
| 9   | m2-f5-mission-mode-catalog-and-i18n                       | M2 Mission UX    | ✅ completed   | `tests/unit/renderer/agentModeSelector.dom.test.tsx`                                                                                                  | DOM: Mission mode appears in selector, i18n keys verified                |
| 10  | m2-f6-mission-mode-ui-visibility-and-setmode-wire         | M2 Mission UX    | ✅ completed   | `tests/unit/renderer/agentModeSelector.dom.test.tsx`                                                                                                  | DOM: setMode('mission') wires to SDK sessionMode                         |
| 11  | m2-f7-mission-panel-and-useacpmessage-6-events            | M2 Mission UX    | ✅ completed   | `tests/unit/renderer/MissionPanel.dom.test.tsx`                                                                                                       | DOM: 6 mission events render milestone/feature progress                  |
| 12  | m3-f8-session-title-event-consumer                        | M3 Stream Events | ✅ completed   | `tests/unit/process/settingsMigration.test.ts`                                                                                                        | Unit: session_title event updates conversation title                     |
| 13  | m3-f9-settings-updated-event-consumer-and-byok-cross-flow | M3 Stream Events | ✅ completed   | `tests/unit/process/settingsMigration.test.ts`                                                                                                        | Unit: settings_updated → catalogRefresher with debounce                  |
| 14  | m3-f10-mcp-status-live-state-hook                         | M3 Stream Events | ✅ completed   | `tests/unit/renderer/useDroidMcpLiveStatus.dom.test.tsx`                                                                                              | DOM: mcp_status maps to connected/disconnected/error                     |
| 15  | m3-f11-mcp-auth-notification-and-stream-invariants        | M3 Stream Events | ✅ completed   | `tests/unit/renderer/mcpAuthListener.dom.test.tsx`                                                                                                    | DOM: mcp_auth fires Notification with authUrl                            |
| 16  | m4-f12-set-enabled-tool-ids-end-to-end                    | M4 IPC Exposure  | ✅ completed   | `tests/unit/acpAgentManagerSetEnabledToolIds.test.ts`, `tests/integration/setEnabledToolIds.test.ts`, `tests/unit/renderer/allowedTools.dom.test.tsx` | Unit+Integration+DOM: UI→IPC→SDK three-state semantic                    |
| 17  | m4-f13-mcp-six-method-ipc-quartets-backend                | M4 IPC Exposure  | ✅ completed   | `tests/unit/acpAgentManagerMcpMethods.test.ts`, `tests/unit/acpConversationBridgeMcp.test.ts`                                                         | Unit: 6 MCP methods IPC→guard→SDK with mutex                             |
| 18  | m4-f14-mcp-panel-live-sync-and-oauth                      | M4 IPC Exposure  | ✅ completed   | `tests/unit/renderer/mcpPanel.dom.test.tsx`, `tests/unit/renderer/useMcpOAuth.dom.test.tsx`                                                           | DOM: MCP panel renders live status + OAuth flow                          |
| —   | m4-f15-ipc-invariants-grep-sweep                          | M4 IPC Exposure  | ✅ completed   | `tests/unit/ipcExposureCoverage.test.ts`                                                                                                              | Meta-test: grep ensures all IPC channels registered                      |
| —   | m5-f16-byok-verifier-and-migration                        | M5 Quality       | ✅ completed   | `tests/unit/process/settingsMigration.test.ts`                                                                                                        | Unit: verifyByokCapabilitiesAgainstCli + migration                       |
| —   | m5-f17-windows-ps7-detector-and-cjk                       | M5 Quality       | ✅ completed   | (existing officecli tests)                                                                                                                            | Unit: PS7+ 4-signal detector + GBK fallback                              |
| —   | m5-f17b-skill-injection-test-mock-tighten                 | M5 Quality       | ✅ completed   | `tests/unit/acpSkillsWatcher.test.ts`                                                                                                                 | Unit: mock tightening + post-teardown guard                              |
| —   | m5-f18-dead-ternary-version-bump-changelog-release        | M5 Release       | ✅ in-progress | `tests/unit/process/bridge/droidByokCapabilities.test.ts`                                                                                             | Dead ternary → literal false; o1-preview/o1-pro tests pass               |

## Validation Assertions Ledger

| Assertion ID         | Description                                                            | Status               |
| -------------------- | ---------------------------------------------------------------------- | -------------------- |
| VAL-SKILLS-001       | SDK listSkills() called on droid startup                               | ✅ passed            |
| VAL-SKILLS-002       | classifySdkSkill word-boundary correctness                             | ✅ passed            |
| VAL-SKILLS-003       | SkillsWatcher debounce + rebroadcast                                   | ✅ passed            |
| VAL-SKILLS-004       | Backend cache partition isolation                                      | ✅ passed            |
| VAL-SKILLS-005       | listSkills fallback on error                                           | ✅ passed            |
| VAL-SKILLS-006       | slash_commands_updated whitelist bypass                                | ✅ passed            |
| VAL-SKILLS-007..015  | Skills pipeline additional invariants                                  | ✅ passed            |
| VAL-MISSION-001..005 | Mission mode catalog, UI, panel, events                                | ✅ passed            |
| VAL-STREAM-001..008  | Stream event consumers (session_title, settings, mcp_status, mcp_auth) | ✅ passed            |
| VAL-IPC-001..008     | IPC exposure (setEnabledToolIds, 6 MCP methods, panel, OAuth)          | ✅ passed            |
| VAL-QUALITY-001      | All tests pass (≥ 3479)                                                | ⏳ pending (gate f)  |
| VAL-QUALITY-002      | tsc --noEmit exit 0                                                    | ⏳ pending (gate f)  |
| VAL-QUALITY-003      | lint exit 0                                                            | ⏳ pending (gate f)  |
| VAL-QUALITY-004      | format:check exit 0                                                    | ⏳ pending (gate f)  |
| VAL-QUALITY-005      | Dead ternary replaced in DroidByokService.ts                           | ✅ verified          |
| VAL-QUALITY-006      | i18n:types + check-i18n exit 0                                         | ⏳ pending (gate f)  |
| VAL-QUALITY-007      | prek exit 0                                                            | ⏳ pending (gate f)  |
| VAL-QUALITY-008      | extractErrorMessage 300-char trim preserved                            | ✅ verified          |
| VAL-QUALITY-009      | package.json version = 0.1.7                                           | ✅ verified          |
| VAL-QUALITY-010      | CHANGELOG ## [0.1.7] with 6 sub-headers                                | ✅ verified          |
| VAL-QUALITY-011      | Security scan clean (0 high/critical)                                  | ✅ verified          |
| VAL-QUALITY-012      | Single atomic commit on dev                                            | ⏳ pending (step e)  |
| VAL-QUALITY-013      | ≥ 6 new test files                                                     | ✅ 18 new test files |
| VAL-QUALITY-014      | Closure matrix written                                                 | ✅ this file         |
| VAL-CROSS-005        | Commit subject matches regex                                           | ⏳ pending (step e)  |
| VAL-CROSS-006        | Commit body references M1-M5                                           | ⏳ pending (step e)  |
| VAL-CROSS-007        | No AI signatures in commit                                             | ⏳ pending (step e)  |
| VAL-CROSS-008        | Closure matrix exists                                                  | ✅ this file         |
| VAL-CROSS-010        | git log origin/dev..HEAD ≥ 1                                           | ⏳ pending (step e)  |

## Test Files Added (18 total)

1. `tests/unit/acpSkillManagerDroidScan.test.ts`
2. `tests/unit/acpSkillManagerBackendCache.test.ts`
3. `tests/unit/acpSkillsWatcher.test.ts`
4. `tests/unit/droidListSkillsFallback.test.ts`
5. `tests/unit/AcpAgentManagerSlashCommandsBootstrap.test.ts`
6. `tests/unit/renderer/agentModeSelector.dom.test.tsx`
7. `tests/unit/renderer/MissionPanel.dom.test.tsx`
8. `tests/unit/process/settingsMigration.test.ts`
9. `tests/unit/acpAgentManagerSetEnabledToolIds.test.ts`
10. `tests/unit/acpAgentManagerMcpMethods.test.ts`
11. `tests/unit/acpConversationBridgeMcp.test.ts`
12. `tests/integration/setEnabledToolIds.test.ts`
13. `tests/unit/renderer/allowedTools.dom.test.tsx`
14. `tests/unit/renderer/mcpPanel.dom.test.tsx`
15. `tests/unit/renderer/useDroidMcpLiveStatus.dom.test.tsx`
16. `tests/unit/renderer/useMcpOAuth.dom.test.tsx`
17. `tests/unit/renderer/mcpAuthListener.dom.test.tsx`
18. `tests/unit/ipcExposureCoverage.test.ts`

## Security Audit

- **Auditor**: security-auditor subagent
- **Result**: ZERO critical/high findings
- **Medium**: 1 pre-existing finding (openExternal URL scheme not restricted — not introduced by this diff)
- **extractErrorMessage**: 300-char trim confirmed at DroidByokService.ts
- **No secrets/keys exposed**: All apiKey references are runtime variables, never logged
