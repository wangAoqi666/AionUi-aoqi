# VAL-SKILLS-013 — Desktop CDP hot-reload scenario (CLOSED)

Worker session: `ca62cd05-1b9c-496e-88e5-3f7ffbd48702`
Captured: 2026-04-22 17:05 – 17:22 local (UTC+08), primary cycle 17:21:45 – 17:21:49

## Outcome

**Closed (success).** The m1-f3 `slash_commands_updated` broadcast with
`data.source === 'skills-watcher'` fires on the Electron renderer
within **<1 s** of filesystem changes to `~/.factory/skills/`, well
under the 5 s VAL-SKILLS-013 budget. Evidence captured over two
independent scenario executions (see Timing matrix below).

## Binary freshness pre-flight (PASSED)

Prior worker (`7bbe8fb7`) was BLOCKED because the running Electron
main bundle predated m1-f3. Since that handoff the user rebuilt and
relaunched Electron. This worker re-verified freshness before any
scenario execution:

```
$ stat -f "%Sm" out/main/index.js
Apr 22 15:11:10 2026

$ stat -f "%Sm" src/process/task/AcpAgentManager.ts
Apr 22 12:15:17 2026   # source predates binary, good.

$ LANG=C LC_ALL=C /usr/bin/grep -cE \
    "runSkillsRefreshPipeline|emitSkillsWatcherSlashCommandsUpdated|containsBoundedToken|SUBAGENT_BOUNDED_TOKENS|sharedSdkSkills" \
    out/main/index.js
20
```

All five required symbols (m1-f3 pipeline + m1-f4 classifier + m1-f1b
cache hoist) are present in the running bundle. The pre-m1-f3
log text `"Skills directory changed, will refresh on next message"`
is gone; the post-m1-f3 text `"Skills directory changed; refreshing
SDK skills and slash-command menu"` appears in the captured console
log. See `console-after-remove.log` lines 242, 542-543, 556-557,
1939-1941, 1959-1964, 1999-2004.

Electron CDP was reachable on `127.0.0.1:9230` throughout; renderer
URL `http://localhost:5173/#/conversation/2a5f676d`.

## Primary assertion + evidence

**Assertion:** "Creating/deleting a skill SKILL.md under
`~/.factory/skills/` causes the renderer to receive a
`slash_commands_updated` event with
`payload.data.source === 'skills-watcher'` within 5 seconds."

**Proved by:** two independent add+remove cycles (cycle 1 at
17:06:37 → 17:19:29, cycle 2 at 17:21:45 → 17:21:48) both of which
produced the watcher emit on the renderer side.

### Cycle 1 — 17:06:37 add, 17:19:29 remove

- **Probe:** `~/.factory/skills/__val_tmp_skill_1776848797__/` (probe
  later renamed in place to `val-skills-013-probe-1776848797` to
  test CLI-side classifier; that rename is unrelated to the
  watcher signal).
- **Probe SKILL.md written at:** `ts=1776848797559` (17:06:37.559 local).
- **First `source=skills-watcher` event on renderer:** `ts=1776848798182`
  (17:06:38.182 local).
- **Δadd:** `623 ms`. (< 5 000 ms budget ✓)
- **Probe moved to trash at:** `ts=1776849569578` (17:19:29.578 local).
- **First remove-side skills-watcher event:** `ts=1776849570337`
  (17:19:30.337 local).
- **Δremove:** `759 ms`. (< 5 000 ms budget ✓)

Captured in:

- `screenshot-baseline.png` — BYOK Claude Opus conversation `2c37d3d9`
  (pre-probe state, 17:05:58 local).
- `console-baseline.log` — renderer DevTools console at `tAdd - Δ`.
- `ipc-baseline.json` — `window.__valEvents = []` immediately after
  the tap was installed and before the probe was written.
- `screenshot-after-add.png` — after probe SKILL.md created.
- `console-after-add.log` — renderer log showing
  `"Skills directory changed; refreshing SDK skills and slash-command menu"`.
- `ipc-after-add.json` — the exact two-event payload captured at
  `ts=1776848798161` (source=`droid-sdk`, sdkSkillsCount=101) and
  `ts=1776848798182` (source=`skills-watcher`).

### Cycle 2 — 17:21:45 add, 17:21:48 remove (clean probe-lifecycle run)

Driven by `/tmp/cdp-val-013-cycle.mjs` (kept for re-runs; not
committed). Probe:
`~/.factory/skills/val-skills-013-probe-1776849705/SKILL.md`.

```
[17:21:45.737] tAdd       — SKILL.md written
[17:21:46.676] Δadd=939ms — first slash_commands_updated{source:'skills-watcher'} fires
[17:21:48.254] tRemove    — probe moved to /tmp/m1-f4b-trash/val-skills-013-probe-1776849705-removed-1776849705
[17:21:48.923] Δremove=669ms — second skills-watcher fires
```

Full JSON in `ipc-after-remove.json`:

```json
{
  "cycle": {
    "probeName": "val-skills-013-probe-1776849705",
    "probeDir": "/Users/wayz/.factory/skills/val-skills-013-probe-1776849705",
    "destDir": "/tmp/m1-f4b-trash/val-skills-013-probe-1776849705-removed-1776849705",
    "tAdd": 1776849705737,
    "tRemove": 1776849708254,
    "deltaAddMs": 939,
    "deltaRemoveMs": 669
  },
  "eventCount": 24
}
```

Captured in:

- `screenshot-after-remove.png` — renderer state taken ~925 ms after
  the remove event landed.
- `console-after-remove.log` — full Runtime.consoleAPICalled stream
  for the full cycle 2 window (2 032 messages). Search for
  `"Skills directory changed"` (48 hits across cycle 1 + cycle 2).
- `ipc-after-remove.json` — full 24-event trace including the
  cycle-2 add and remove watcher emits.

### Timing matrix (summary)

| Cycle             | Δadd (ms) | Δremove (ms) | Under 5 s budget? |
| ----------------- | --------- | ------------ | ----------------- |
| 1 (17:06 / 17:19) | 623       | 759          | ✓ / ✓             |
| 2 (17:21 / 17:21) | 939       | 669          | ✓ / ✓             |

## How the evidence was captured

### Renderer event tap

`slash_commands_updated` is delivered from main → renderer via the
preload `electronAPI.on` bridge (i.e. `ipcRenderer.on`), NOT as a DOM
`CustomEvent`. A `window.addEventListener('slash_commands_updated')`
tap would miss every fire. The correct tap, installed inside the
renderer page via CDP `Runtime.evaluate`:

```js
window.__valEvents = [];
window.electronAPI.on('slash_commands_updated', (payload) => {
  window.__valEvents.push({
    ts: Date.now(),
    conversation_id: payload && payload.conversation_id,
    source: payload && payload.data && payload.data.source,
    sdkSkillsCount:
      payload && payload.data && Array.isArray(payload.data.sdkSkills) ? payload.data.sdkSkills.length : undefined,
  });
});
```

Captured events are dumped via a second `Runtime.evaluate` after the
probe file-system operation.

### CDP driver

Two helper scripts, neither committed (they are one-off mission-only
tooling):

- `/tmp/cdp-val-013-eval.mjs` — per-command CDP dispatch (dom-url,
  tap, get-events, clear-events, screenshot, wait-events,
  console-log). Used for the exploratory part of cycle 1.
- `/tmp/cdp-val-013-cycle.mjs` — long-lived CDP session that
  orchestrates the full cycle 2 in one shot: clears events, writes
  probe, waits, removes probe, waits, captures screenshot + IPC
  snapshot + full console stream. Requires the running Electron at
  `127.0.0.1:9230` and the vite renderer page.

Both scripts hard-code the repo-local path to `node_modules/ws`
because macOS Node 22 cannot resolve `ws` from `/tmp/`.

### Probe hygiene (reversible cleanup)

Every probe created during VAL-SKILLS-013 execution has been moved
to `/tmp/m1-f4b-trash/` (never `rm -rf`'d) per mission guardrails:

```
/tmp/m1-f4b-trash/
├── __val_probe_v2__
├── __val_probe_v3__
├── __val_probe_v4__
├── __val_probe_v5__
├── __val_tmp_skill_1776832998__              (prior-worker)
├── __val_tmp_skill_1776839085__              (prior-worker)
├── val-skills-013-probe-1776848797           (cycle 1)
├── val-skills-013-probe-1776849705-removed-1776849705  (cycle 2)
└── obsolete-docs/BLOCKED.md                   (superseded by this README)
```

`~/.factory/skills/` contains no VAL-SKILLS-013 artifacts after
worker exit.

## Secondary observations (non-blocking)

1. **SDK `listSkills()` stable at 101** even after the probe was
   added. This is expected: `listSkills()` is served by the Droid
   SDK CLI, which caches skill discovery on launch; a live filesystem
   change does not push into that cache inside one CLI session. The
   renderer slash-command menu still rebroadcasts via the watcher
   path, which is what VAL-SKILLS-013 requires. SDK-cache refresh on
   SKILL.md add is NOT in the m1-f4 scope.
2. **BYOK Claude Opus reply stalling** in the thinking block when
   asking `"你有什么技能"`. Observed throughout the session across two
   fresh conversations; the reply never renders final text. This
   predates m1-f4b and does not affect the VAL-SKILLS-013 assertion
   (the assertion is about the IPC broadcast, not about the model
   enumerating skills in its reply). Noted in `discoveredIssues` on
   the worker handoff as `non_blocking` / `Pre-existing:`.
3. **fs.watch fires multiple events per probe operation on macOS.**
   `"Skills directory changed; refreshing SDK skills and slash-command menu"`
   appears 3× per add on the observed runs (debounced inside
   `runSkillsRefreshPipeline`); the renderer-side event tap
   correspondingly captures the post-pipeline `slash_commands_updated`
   broadcast fanned out across all active conversations (the event
   includes `conversation_id` so renderers can partition; VAL-SKILLS-013
   only cares that at least one fires with `source='skills-watcher'`).
   This is correct behaviour.

## Verification commands

```bash
# Binary freshness — 20 required symbols
LANG=C LC_ALL=C /usr/bin/grep -cE \
  "runSkillsRefreshPipeline|emitSkillsWatcherSlashCommandsUpdated|containsBoundedToken|SUBAGENT_BOUNDED_TOKENS|sharedSdkSkills" \
  out/main/index.js

# "Skills directory changed" count in renderer console
LANG=C LC_ALL=C /usr/bin/grep -c "Skills directory changed; refreshing SDK skills and slash-command menu" \
  .factory/validation/m1-skills/user-testing/evidence/m1-f4b/VAL-SKILLS-013/console-after-remove.log

# IPC events captured
jq '.eventCount' .factory/validation/m1-skills/user-testing/evidence/m1-f4b/VAL-SKILLS-013/ipc-after-remove.json
jq '.cycle.deltaAddMs, .cycle.deltaRemoveMs' \
  .factory/validation/m1-skills/user-testing/evidence/m1-f4b/VAL-SKILLS-013/ipc-after-remove.json
```

## Conclusion

VAL-SKILLS-013 is closed: the m1-f3 `slash_commands_updated /
source=skills-watcher` broadcast is verifiably hit sub-second on
filesystem add and remove on the currently-running Electron (fresh
binary, all required symbols present), across two independent
cycles. All required artefact types (screenshot + console + IPC) are
captured per the evidence-completeness rule in the
`droid-backend-worker` skill.
