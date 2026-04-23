# CDP Scenario Template — Electron Desktop Validation

> **Origin**: `/tmp/cdp-val-013-cycle.mjs` (used successfully in m1-f4b
> VAL-SKILLS-013 desktop validation)
> **Date**: 2026-04-23

## When to Use CDP vs Vitest / React Testing Library

| Scenario                                                   | Use CDP | Use Vitest/RTL    |
| ---------------------------------------------------------- | ------- | ----------------- |
| Verify IPC events arrive in the renderer from main process | ✅      | ❌                |
| Validate `window.electronAPI.on(channel)` subscriptions    | ✅      | ❌                |
| Confirm live filesystem watcher → renderer broadcast chain | ✅      | ❌                |
| Test React component rendering logic                       | ❌      | ✅                |
| Test pure business logic / utility functions               | ❌      | ✅                |
| Validate hook state transitions                            | ❌      | ✅                |
| Test main-process code in isolation                        | ❌      | ✅ (node project) |
| Verify end-to-end user-visible behavior in running app     | ✅      | ❌                |

**Rule of thumb**: If the behavior requires Electron's IPC bridge (`preload →
contextBridge → renderer`) to be live, use CDP. If you can mock the boundary,
use Vitest.

## Prerequisites

1. **Electron dev server running** with `--remote-debugging-port=9230`
   (default in this project's dev config).
2. **`ws` package available** in the repo's `node_modules/` (it is — used
   by Electron internals).

## Common Pitfalls

### 1. `ws` import fails from `/tmp` on macOS with non-ASCII paths

When running a CDP script from `/tmp/` (or any directory outside the repo),
Node 22's default module resolution fails to find `ws` because the repo
path contains non-ASCII characters (中文). The fix is to import `ws` using
an absolute path resolved from the repo's `node_modules`:

```js
// ❌ BROKEN — fails with ERR_MODULE_NOT_FOUND on macOS + non-ASCII paths
import WebSocket from 'ws';

// ✅ WORKS — explicit absolute import from repo-local node_modules
const repoRoot = '/Users/wayz/Desktop/我的云盘/git_repo/AionUi-aoqi';
const wsMod = await import(`${repoRoot}/node_modules/ws/index.js`);
const WebSocket = wsMod.default;
```

For a portable version, resolve relative to the script or use an env var:

```js
const repoRoot = process.env.REPO_ROOT ?? path.resolve(import.meta.dirname ?? '.', '../../..');
const wsMod = await import(path.join(repoRoot, 'node_modules/ws/index.js'));
const WebSocket = wsMod.default;
```

### 2. DOM `CustomEvent` tap silently misses main→renderer broadcasts

The renderer receives IPC events through `window.electronAPI.on(channel, cb)`
— these are **not** DOM `CustomEvent`s. If you try to listen via
`document.addEventListener('ipc-event', ...)` or `window.dispatchEvent(...)`,
you will silently receive nothing.

```js
// ❌ WRONG — CustomEvent is NOT how Electron IPC broadcasts arrive
window.addEventListener('slash_commands_updated', (e) => { ... });

// ✅ CORRECT — use the preload-exposed bridge
window.electronAPI.on('slash_commands_updated', (_event, data) => { ... });
```

In CDP scripts, you inject JavaScript into the renderer page via
`Runtime.evaluate`. To tap IPC events:

```js
await cdp('Runtime.evaluate', {
  expression: `
    window.__valEvents = [];
    window.electronAPI.on('slash_commands_updated', (_ev, data) => {
      window.__valEvents.push({ channel: 'slash_commands_updated', data, ts: Date.now() });
    });
  `,
});
```

### 3. CDP connection lifecycle

Always:

- Fetch `/json/version` first to get the `webSocketDebuggerUrl`.
- Enable `Runtime.enable` and `Console.enable` before evaluating.
- Close the WebSocket gracefully in a `finally` block.

## Complete CDP Cycle Recipe

Below is a copy-pasteable template for a CDP scenario that:

1. Connects to the running Electron app
2. Sets up IPC event listeners
3. Performs a filesystem mutation (skill add/remove)
4. Waits for watcher events
5. Collects results

```js
#!/usr/bin/env node
/**
 * CDP validation scenario template.
 * Usage: REPO_ROOT=/path/to/repo node cdp-scenario.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// --- ws import workaround for non-ASCII repo paths on macOS ---
const repoRoot = process.env.REPO_ROOT ?? path.resolve(os.homedir(), 'Desktop/我的云盘/git_repo/AionUi-aoqi');
const wsMod = await import(path.join(repoRoot, 'node_modules/ws/index.js'));
const WebSocket = wsMod.default;

const CDP_HOST = '127.0.0.1';
const CDP_PORT = 9230;

// ---------- helpers ----------

function fetchJson(urlPath) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: CDP_HOST, port: CDP_PORT, path: urlPath }, (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error(`Bad JSON from ${urlPath}: ${body}`));
          }
        });
      })
      .on('error', reject);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------- CDP transport ----------

function createCdpSession(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let reqId = 0;
    const pending = new Map();
    const eventHandlers = [];

    ws.on('open', () => {
      resolve({
        send(method, params = {}) {
          const id = ++reqId;
          return new Promise((res, rej) => {
            pending.set(id, { res, rej });
            ws.send(JSON.stringify({ id, method, params }));
          });
        },
        onEvent(cb) {
          eventHandlers.push(cb);
        },
        close() {
          ws.close();
        },
      });
    });

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rej(msg.error) : res(msg.result);
      } else if (msg.method) {
        for (const h of eventHandlers) h(msg);
      }
    });

    ws.on('error', reject);
  });
}

// ---------- main ----------

async function main() {
  // 1. Find the renderer page's debugger URL
  const pages = await fetchJson('/json');
  const target = pages.find((p) => p.type === 'page' && p.url.includes('renderer'));
  if (!target) throw new Error('No renderer page found on CDP port ' + CDP_PORT);

  const cdp = await createCdpSession(target.webSocketDebuggerUrl);

  try {
    // 2. Enable streams
    await cdp.send('Runtime.enable');
    await cdp.send('Console.enable');

    // 3. Install IPC event tap
    await cdp.send('Runtime.evaluate', {
      expression: `
        window.__valEvents = [];
        window.electronAPI.on('slash_commands_updated', (_ev, data) => {
          window.__valEvents.push({
            channel: 'slash_commands_updated',
            data,
            ts: Date.now(),
          });
        });
        'tap installed';
      `,
    });

    // 4. Perform a filesystem mutation (example: add a probe skill)
    const skillsDir = path.join(os.homedir(), '.factory/skills');
    const probeDir = path.join(skillsDir, '__cdp-probe-test');
    fs.mkdirSync(probeDir, { recursive: true });
    fs.writeFileSync(path.join(probeDir, 'SKILL.md'), '# CDP Probe\nTest skill for validation.\n');

    // 5. Wait for watcher debounce + pipeline
    await sleep(3000);

    // 6. Collect events
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: 'JSON.stringify(window.__valEvents)',
      returnByValue: true,
    });
    const events = JSON.parse(result.value);
    console.log('Collected events:', JSON.stringify(events, null, 2));

    // 7. Cleanup — remove probe skill
    fs.rmSync(probeDir, { recursive: true, force: true });

    // 8. Wait for removal event
    await sleep(3000);

    const { result: result2 } = await cdp.send('Runtime.evaluate', {
      expression: 'JSON.stringify(window.__valEvents)',
      returnByValue: true,
    });
    const allEvents = JSON.parse(result2.value);
    console.log('All events after cleanup:', JSON.stringify(allEvents, null, 2));

    // 9. Assertions (adapt to your scenario)
    const addEvents = allEvents.filter((e) => e.channel === 'slash_commands_updated');
    console.log(`Total slash_commands_updated events: ${addEvents.length}`);
    if (addEvents.length < 1) {
      console.error('FAIL: Expected at least 1 slash_commands_updated event');
      process.exit(1);
    }
    console.log('PASS: CDP scenario completed successfully');
  } finally {
    cdp.close();
  }
}

main().catch((err) => {
  console.error('CDP scenario failed:', err);
  process.exit(1);
});
```

## Adapting the Template

1. **Change the IPC channel**: Replace `'slash_commands_updated'` with
   whatever channel your scenario validates.
2. **Change the mutation**: Replace the skill add/remove with your specific
   filesystem or IPC trigger.
3. **Add timing assertions**: Use `event.ts` timestamps to verify debounce
   behavior (e.g., events should cluster within 500ms of the mutation).
4. **Save evidence**: Write `allEvents` to a JSON file for CI artifact
   collection:
   ```js
   fs.writeFileSync('/tmp/cdp-evidence.json', JSON.stringify(allEvents, null, 2));
   ```

## Reference: Original VAL-SKILLS-013 Script

The original `/tmp/cdp-val-013-cycle.mjs` (291 lines) performed a more
complex two-phase cycle (add probe → wait → remove probe → wait → collect)
with parallel console log capture. The template above is a simplified
single-cycle version. See the mission library's
`validation/m1-skills/user-testing/evidence/m1-f4b/VAL-SKILLS-013/` for the
full evidence output from that original script.
