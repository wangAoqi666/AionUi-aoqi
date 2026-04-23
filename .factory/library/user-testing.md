# User Testing Surface — Mission 0.1.7

The single canonical guide for how user-testing validators run assertions against this mission.

---

## Surfaces

### Surface 1 — Desktop Electron App (CDP 9230)

- **URL / endpoint**: `http://127.0.0.1:9230` (CDP) and `http://localhost:5173` (Vite renderer)
- **Ownership**: USER — never start/stop.
- **How to connect**: `agent-browser connect 9230` (requires `agent-browser` v0.17+; pre-installed at `/Users/wayz/.factory/bin/agent-browser`).
- **Resource cost**: SHARED — one window, one Droid session per conversation, one renderer state tree.
- **Concurrency**: **max 1 validator at a time**. Parallel UI-driven assertions will interfere.
- **Isolation strategy**: between assertions, either (a) create a fresh conversation (cheapest), or (b) revoke + re-add the BYOK config, or (c) switch to a known-clean conversation. Full app restart is OFF-LIMITS.
- **Recovery**: if CDP becomes unresponsive, STOP and return to orchestrator — do not relaunch.

**Recipes** (canonical):

```bash
# Pre-flight
lsof -nP -iTCP -sTCP:LISTEN | rg "5173|5174|9230|25809"
agent-browser connect 9230

# Fresh snapshot + screenshot
agent-browser screenshot --annotate && agent-browser snapshot -i -C

# Send a message (example)
agent-browser click @<input-ref> && agent-browser wait 500
agent-browser focus @<input-ref> && agent-browser keyboard inserttext "你有什么技能"
agent-browser click @<send-ref> && agent-browser wait 10000
agent-browser screenshot --annotate && agent-browser snapshot -i -C
```

Full runbook: `.factory/skills/desktop-app-testing` (project skill).

### Surface 2 — Vitest unit + DOM test harness

- **Non-ASCII repo-path workaround (2026-04-22)**: on this macOS workspace, launching esbuild directly from the repo path can die with `SIGKILL` / `The service was stopped: write EPIPE` while loading `vitest.config.ts`. Work around it by copying `node_modules/@esbuild/darwin-arm64/bin/esbuild` to an ASCII-only temp path (for example `/tmp/esbuild-ascii`), `chmod +x` that copy, and exporting `ESBUILD_BINARY_PATH=/tmp/esbuild-ascii` before `bun run test`.
- **How to run**: `bun run test` (full) or `bun run test <path>` (targeted). This matches the current `.factory/services.yaml` command and avoids the deprecated Vitest CLI `--poolOptions.threads.maxThreads=4` form that older notes referenced.
- **Projects**: `node` (backend, `tests/unit/*.test.ts`) and `jsdom` (renderer, `tests/unit/**/*.dom.test.tsx`).
- **Concurrency**: parallel via the Vitest thread pool, following the checked-in config/runtime defaults.
- **Test count baseline at `cbeaab34`**: 3491. Mission target: +≥6 new test files, total ≥ 3497.

### Surface 3 — Static CI checks

| Check       | Command                                      | Purpose                        |
| ----------- | -------------------------------------------- | ------------------------------ |
| Typecheck   | `bunx tsc --noEmit`                          | TS correctness                 |
| Lint        | `bun run lint`                               | oxlint                         |
| Format      | `bun run format:check`                       | oxfmt                          |
| i18n types  | `bun run i18n:types`                         | Regenerate + assert types      |
| i18n check  | `node scripts/check-i18n.js`                 | All 6 locales complete         |
| prek        | `prek run --from-ref cbeaab34 --to-ref HEAD` | CI-equivalent pre-commit sweep |
| Grep checks | `rg -n '<pattern>' <scope>`                  | VAL-IPC-016..018 + security    |

---

## Assertion → Surface Mapping

From `validation-contract.md` Tool fields:

| Tool / surface            | Count | Examples                                                                           |
| ------------------------- | ----- | ---------------------------------------------------------------------------------- |
| unit-test (node)          | ~42   | VAL-SKILLS-001..011, VAL-IPC-003/005..010/012/017..019, VAL-QUALITY-001..014       |
| dom-test (jsdom)          | ~26   | VAL-MISSION-003/004/007..015, VAL-STREAM-001..013, VAL-IPC-001/002/011/014/015/020 |
| integration-test          | ~5    | VAL-IPC-004/013/019, VAL-CROSS-010                                                 |
| desktop-app-testing (CDP) | ~9    | VAL-SKILLS-012..014, VAL-MISSION-013, VAL-CROSS-001..004/009                       |
| grep (static)             | ~8    | VAL-IPC-016..018, VAL-QUALITY-005/009/010/012, VAL-CROSS-005/006/008               |
| curl+jq (release check)   | ~2    | VAL-QUALITY-009, VAL-CROSS-005                                                     |

---

## Pre-Flight Checks Before Running User-Testing Validator

1. `curl -sSf http://127.0.0.1:9230/json/version` — CDP reachable.
2. `lsof -nP -iTCP:5173 -sTCP:LISTEN` — Vite renderer running.
3. For assertions that validate a **main-process fix** in the user-managed Electron dev app, compare the live Electron PID start time with the target fix commit time (for example `ps -p <pid> -o lstart=` vs `git show -s --format=%cI <commit>`). If the process predates the fix and workers are not allowed to relaunch Electron, treat the assertion as **blocked by stale app state** rather than a product regression.
4. Confirm `@factory/droid-sdk` version at `node_modules/@factory/droid-sdk/package.json` is `0.1.4`.
5. `~/.factory/skills/` contains at least two installed skills. Current machine snapshot during m1 scrutiny confirms `docx`, `pptx`, `morph-ppt`, `star-office-helper`, `pdf`, and `xlsx`; `office-cli` is **not** present as a standalone skill directory, so validators must use the live directory listing rather than an `office-cli`-only baseline.
6. A BYOK entry matching `custom:agentsapi-claude-opus-4-6-thinking` or similar `[BYOK]` label is present in user's `settings.local.json` (read-only view — infer from AcpModelSelector dropdown on the desktop). If absent, user-testing validator for VAL-SKILLS-012..014 + VAL-CROSS-001/009 is BLOCKED — surface to orchestrator.

---

## Isolation and Cleanup Between Assertions

For UI-driven assertions on shared Electron window:

- **Prefer fresh conversation per assertion** — low overhead, state-clean.
- **Delete any temp skill files created** (e.g., VAL-SKILLS-013's `__val_tmp_skill__/SKILL.md`) before declaring pass.
- **Leave the window state neutral** — no open modals, no dangling messages, no unsent input drafts — so the next validator starts clean.

For backend tests:

- vitest itself handles isolation (fresh module registry per test file by default).
- Mocks of `@factory/droid-sdk` MUST use the hoisted pattern at the import boundary — do not share mock state across test files.

---

## Evidence Storage

Archive validator evidence under:

```
/Users/wayz/Desktop/我的云盘/git_repo/AionUi-aoqi/.factory/validation/<milestone>/user-testing/evidence/
  ├── <VAL-ID>/
  │     ├── screenshot-<step>.png
  │     ├── console-<step>.log
  │     └── ipc-<step>.json
```

Reference these paths in `validation-state.json` via evidence pointers once an assertion passes. (Schema TBD by the user-testing validator template — adhere to whatever the existing framework specifies; if none, plain file-path references.)

---

## Known Quirks / Constraints

- Mission decomposition relies on real Factory Droid CLI — extremely short prompts produce rapid state transitions that can be hard to observe. Use "small but genuinely decomposable" prompts (e.g., `创建一个包含 3 个端点的 Hello Web Server`) per VAL-MISSION-013 + VAL-CROSS-002.
- Windows PS7 detector cannot be truly reproduced on macOS — covered entirely via mocks (en / zh-CN / ja-JP stderr strings).
- CDP 9230 auth & OAuth flows (MCP-auth-via-Droid) require a pre-authenticated Droid session in the user's app — if user's session has expired, user-testing for VAL-IPC-010/011/020/VAL-CROSS-003 is BLOCKED — surface to orchestrator.
- React DevTools profiler readings for VAL-CROSS-002 (<60 re-renders/sec MissionPanel) rely on the user having DevTools open; if validator cannot open DevTools remotely via CDP, approximate via dispatched event count \* render timestamp diff in code.

## Scenario runbook — VAL-SKILLS-013 (skills hot-reload)

The canonical CDP procedure for this assertion, refined by m1-f4b round 1:

1. **Pre-flight sanity** on the running binary. Before touching the probe filesystem, verify the current Electron main bundle actually carries the m1-f3 `runSkillsRefreshPipeline` + `emitSkillsWatcherSlashCommandsUpdated` emit:

   ```bash
   rg -n "emitSkillsWatcherSlashCommandsUpdated|runSkillsRefreshPipeline" out/main/index.js
   ```

   If both symbols are missing, the binary is pre-m1-f3 and VAL-SKILLS-013 cannot be proved — STOP and return to orchestrator with a BLOCKED evidence bundle asking the user to rebuild+relaunch. Do **not** restart Electron from the worker.

2. **Install the event tap** in the renderer before opening the probe conversation — the `slash_commands_updated` broadcast arrives through the existing `window.electronAPI.on` bridge, not through the page DOM, so a plain DevTools console listener will miss it:

   ```js
   window.__valEvents = window.__valEvents || [];
   window.electronAPI.on((ev) => {
     try {
       const parsed = typeof ev.value === 'string' ? JSON.parse(ev.value) : ev.value;
       const d = parsed && parsed.data;
       if (d && d.type === 'slash_commands_updated') {
         window.__valEvents.push({
           ts: Date.now(),
           source: d.data && d.data.source,
           sdkSkillsCount: Array.isArray(d.data && d.data.sdkSkills) ? d.data.sdkSkills.length : undefined,
           error: d.data && d.data.error,
           conversation_id: d.conversation_id,
         });
         console.log(
           '[VAL-TAP] slash_commands_updated',
           JSON.stringify(window.__valEvents[window.__valEvents.length - 1])
         );
       }
     } catch {}
   });
   ```

   Re-inject the tap after any route change (the `新会话` button redirects to `/guid` which unmounts the previous window globals).

3. **Baseline message** must be sent FIRST — `startSkillsWatcher()` is only installed after the first outgoing message in a conversation (`AcpAgentManager.ts` L737-739). Sending `你有什么技能` on a fresh droid conversation bootstraps the watcher.

4. **Write the probe SKILL.md** at `~/.factory/skills/__val_tmp_skill_<epoch>__/SKILL.md` with a distinctive marker. Within ~1.5 s the debounced pipeline should fire and `window.__valEvents` should contain the watcher broadcast with `source === "skills-watcher"`.

5. **Cleanup by MOVE, not DELETE.** Mission workers are blocked from destructive deletes; move the probe to `/tmp/<mission-id>-trash/` so nothing is irreversible. Orchestrator or user drops the trash later.

## Artifact-completeness rule (from m1-f4b review)

For VAL-SKILLS-013 and any assertion whose Evidence field names multiple artifact types (screenshot + console + network/IPC): archive ALL of them (`screenshot-<step>.png`, `console-<step>.log`, `ipc-<step>.json`) AND drop a top-level `README.md` or `BLOCKED.md` in the feature's evidence folder explaining the capture context. Screenshot-only evidence is NOT sufficient under the m1-skills scrutiny round 1 policy.

---

## Concurrency Mode (canonical)

**Max concurrent user-testing validators: 1**.

Backend unit tests may run in parallel (Vitest default behavior).

## Flow Validator Guidance: unit-test

- Stay inside the checked-out repo and do **not** start or stop Electron, Vite, or any long-running service.
- Use targeted Vitest commands for the assigned assertion set first; only widen scope if a targeted run exposes a cross-file dependency.
- Treat the repo as read-only except for writing the assigned flow report and evidence artifacts under `.factory/validation/<milestone>/user-testing/`.
- Keep evidence concrete: capture the exact command output that proves each assertion and archive it as `test-output.log` or a similarly named artifact inside the assigned evidence directory.
- If a test fails because of a shared-environment problem (for example, a missing fixture or broken import), stop and report it as a blocker instead of editing production code.

## Flow Validator Guidance: desktop-app-testing

- Use the existing user-managed Electron app on CDP `127.0.0.1:9230`; never relaunch, quit, or rebuild it.
- Use `agent-browser`/desktop-CDP automation with the assigned non-default session id only, and close that session before finishing.
- Desktop validation is a shared single-window resource: run only one UI flow at a time, create a fresh conversation when possible, and leave the app in a neutral state (no open modals, no unsent drafts).
- Capture the full evidence bundle required by the contract for every assertion: screenshot **and** console/IPC artifacts where required. Screenshot-only proof is insufficient.
- Temporary filesystem probes for skills hot-reload must be reversible: move probe directories to `/tmp/...` during cleanup instead of deleting them.
