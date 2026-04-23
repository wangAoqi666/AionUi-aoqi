# M4 IPC Exposure — Closure Matrix

Milestone: `m4-ipc-exposure` | Feature: `m4-f15-ipc-invariants-grep-sweep`
Baseline: `a9c69bce9` | Date: 2026-04-23

## VAL-IPC-016: Zero-Dead-Channel Assertion

All 7 IPC symbols have ≥1 `ipcBridge.acpConversation.<name>.invoke` hit in `src/renderer/`:

| #   | Symbol                | File                                      | Hits |
| --- | --------------------- | ----------------------------------------- | ---- |
| 1   | setEnabledToolIds     | components/agent/AllowedToolsSelector.tsx | 1    |
| 2   | addMcpServer          | hooks/mcp/useMcpServerCRUD.ts             | 1    |
| 3   | removeMcpServer       | hooks/mcp/useMcpServerCRUD.ts             | 1    |
| 4   | toggleMcpServer       | hooks/mcp/useMcpServerCRUD.ts             | 1    |
| 5   | listMcpServers        | hooks/mcp/useMcpServers.ts                | 1    |
| 6   | listMcpTools          | hooks/mcp/useMcpServers.ts                | 1    |
| 7   | authenticateMcpServer | hooks/mcp/useMcpOAuth.ts                  | 1    |

**Result: ✅ PASS** — 7/7 symbols invoked in renderer.

## VAL-IPC-017: Aggregate Test Count ≥28

| Test File                                | Cases  |
| ---------------------------------------- | ------ |
| acpAgentManagerMcpMethods.test.ts        | 26     |
| acpAgentManagerSetEnabledToolIds.test.ts | 8      |
| acpConversationBridgeMcp.test.ts         | 21     |
| droidEnabledToolIds.test.ts              | 10     |
| droidMcpManagement.test.ts               | 22     |
| **Total**                                | **87** |

**Result: ✅ PASS** — 87 test cases ≥ 28 threshold.

## VAL-IPC-018: Template Parity

| Check                                                        | Result     |
| ------------------------------------------------------------ | ---------- |
| No `import ... DroidSdkAgent` in renderer                    | ✅ 0 hits  |
| All 7 symbols use `ipcBridge.acpConversation.<name>.invoke`  | ✅ 7/7     |
| Bridge providers use `{ success: false, msg }` catch pattern | ✅ Present |

**Result: ✅ PASS** — Full template parity confirmed.

## Summary

All three IPC invariant assertions (VAL-IPC-016, VAL-IPC-017, VAL-IPC-018) pass.
Meta-test file: `tests/unit/ipcExposureCoverage.test.ts` (13 test cases, all green).
Full test suite: 381 files, 3682 tests passed.
