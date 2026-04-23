# SDK `listSkills()` Live-Refresh Feasibility Note

> **Author**: m1-f4b follow-up investigation
> **Date**: 2026-04-23
> **Status**: Not feasible without SDK upstream change

## Background

During m1-f4b validation (VAL-SKILLS-013), we observed that
`session.listSkills()` consistently returns a stable 101-entry set regardless
of live filesystem additions/removals under `~/.factory/skills/`. A probe
skill written by the CDP scenario was detected by the filesystem watcher and
correctly surfaced through `slash_commands_updated` IPC, but the SDK's own
`listSkills()` result did not change mid-session.

## Root-Cause Analysis

### Where skills are resolved

The `@factory/droid-sdk` package (v1.x) exposes `listSkills()` at two levels:

1. **`DroidSession.listSkills()`**
   (`node_modules/@factory/droid-sdk/dist/index.js:3172`)
   Delegates directly to `this._client.listSkills()`.

2. **`DroidClient.listSkills()`**
   (`node_modules/@factory/droid-sdk/dist/index.js:2366`)
   Sends a `droid.list_skills` JSON-RPC request to the Droid CLI backend
   process via `this._engine.sendRequest("droid.list_skills", {})`.

### No client-side cache in the SDK

The SDK does **not** maintain any internal cache of skills. Every
`listSkills()` call is a fresh JSON-RPC round-trip to the Droid CLI process.
There is no memoization, no TTL cache, no `_skillsCache` field, and no
public or private invalidation API — because there is nothing to invalidate
on the SDK side.

### The cache lives in the Droid CLI backend

The stable 101-entry observation originates from the **Droid CLI server
process** (the spawned `factory-cli` binary), not the SDK client. The CLI
reads the skills directories at session initialization time and serves a
snapshot for the lifetime of that session. The CLI does not expose a
JSON-RPC method to invalidate or re-scan its internal skills list, nor does
it watch the filesystem for changes after session init.

## SDK Public API Surface

Examined exports from `@factory/droid-sdk/dist/index.d.ts`:

- `DroidSession`: `listSkills()` → `Promise<ListSkillsResult>` (RPC call)
- `DroidClient`: `listSkills()` → `Promise<ListSkillsResult>` (RPC call)
- `ProtocolEngine`: `sendRequest(method, params)` — raw JSON-RPC transport

None of these expose a cache invalidation, session-restart, or re-scan
trigger. The `DroidServerMethod` enum has no `REFRESH_SKILLS` or equivalent.

## Options Considered

### Option 1: Adapter-level cache wrapper in `AcpSkillManager`

We already have `AcpSkillManager.setSdkSkills()` which replaces the cached
SDK skills array whenever `DroidSdkAgent.syncSdkSkills()` succeeds. This
is our adapter-level cache — it works correctly for the filesystem-discovered
skills. The problem is that `syncSdkSkills()` calls `session.listSkills()`,
which returns the same stale snapshot from the CLI backend.

A wrapper here cannot help because the upstream data source is stale.

### Option 2: Re-create session on filesystem change

We could destroy and re-create the `DroidSession` (and thus the CLI process)
on every skills-watcher event. This would force the CLI to re-scan skills.
However:

- It would drop the entire conversation context.
- It would tear down MCP server connections.
- It would cause visible latency (session init is 2-5 seconds).
- It violates the principle that the watcher should be transparent to users.

**Verdict**: Not feasible.

### Option 3: Request upstream `droid.refresh_skills` RPC method

The clean fix is for the Droid CLI to support a `droid.refresh_skills` (or
`droid.invalidate_skills_cache`) server method that triggers an internal
re-scan of skills directories without restarting the session. This would
allow our adapter to call it from `runSkillsRefreshPipeline()` after the
filesystem watcher fires.

**Verdict**: Requires upstream SDK/CLI change. File as feature request.

## Current Workaround

Our existing architecture handles this gracefully:

1. `startSkillsWatcher()` detects filesystem changes via `fs.watch`.
2. `runSkillsRefreshPipeline()` calls `AcpSkillManager.invalidate()` +
   `DroidSdkAgent.syncSdkSkills()`.
3. `syncSdkSkills()` calls `session.listSkills()` — which returns the
   (stale) CLI snapshot, and writes it into `AcpSkillManager`.
4. `AcpSkillManager.discoverSkills()` independently scans the filesystem,
   so newly added/removed skills ARE reflected in the `slash_commands_updated`
   IPC event and the prompt injection index.

The only gap is that the SDK-reported skills count stays at the session-init
snapshot. This has no user-visible impact because:

- The slash-command menu uses the combined (filesystem + SDK) skill set.
- The prompt injection uses `buildStaleSkillsReminder()` which re-reads disk.
- Only the `sdkSkillsCount` field in the IPC payload stays frozen.

## Verdict

**Not feasible without upstream SDK/CLI change.** The 101-entry stability is
a server-side snapshot, not a client-side cache. No ≤30 LOC adapter fix can
work because the data source itself is stale.

### Recommended action

File a feature request on `@factory/droid-sdk` or the Droid CLI for a
`droid.refresh_skills` server method. Until then, our filesystem-based
discovery path (`AcpSkillManager.discoverSkills()`) correctly surfaces
live-added/removed skills to both UI and prompt injection.
