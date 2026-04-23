# Environment — Mission 0.1.7

Required env vars, external dependencies, and setup notes.

**What belongs here:** Toolchain versions, dependency pins, platform quirks.
**What does NOT belong here:** Service ports/commands (`.factory/services.yaml`), architecture (`architecture.md`), testing surface (`user-testing.md`).

---

## Toolchain (confirmed at mission baseline `cbeaab34`)

| Tool               | Version             | Notes                                                                   |
| ------------------ | ------------------- | ----------------------------------------------------------------------- |
| Node               | v22.20.0            | LTS; any 20+ acceptable                                                 |
| Bun                | 1.2.16              | Primary runner (`bun run test`, `bun install`)                          |
| Electron           | 37.10.3             | User-managed dev instance                                               |
| Vite               | via `electron-vite` | Renderer dev server port 5173                                           |
| TypeScript         | per repo            | Strict mode; `bunx tsc --noEmit`                                        |
| oxlint / oxfmt     | per repo            | Primary lint + format                                                   |
| vitest             | 4.x                 | Dual projects (node + jsdom)                                            |
| @factory/droid-sdk | 0.1.4               | Pinned — type defs at `node_modules/@factory/droid-sdk/dist/index.d.ts` |
| agent-browser      | 0.17.1              | Pre-installed at `/Users/wayz/.factory/bin/agent-browser`               |
| prek               | (cargo)             | `npm install -g @j178/prek` (one-time)                                  |
| git                | 2.53.0              | homebrew; proxy config baked into user config                           |
| rg (ripgrep)       | 15.1.0              | Pre-installed                                                           |
| curl               | 8.7.1               |                                                                         |
| python3            | 3.13.9              | For auxiliary scripting; not a mission dependency                       |

---

## Machine resource budget

From pre-flight check at mission start:

- 8 CPU cores
- 16 GB RAM
- ~5 GB RAM headroom
- ~8.8 GB disk headroom
- Darwin 25.5.0 (arm64)

**Test parallelism**: the checked-in `.factory/services.yaml` test command now correctly uses plain `bun run test`. Vitest concurrency therefore follows the checked-in config/runtime defaults rather than any deprecated CLI `--poolOptions.threads.maxThreads=4` flag.

---

## Required external dependencies

- **Factory Droid CLI** (`droid` binary on PATH) — resolved via `src/process/agent/droid/cliResolver.ts` (bundled / project node_modules / system). Version dynamically probed.
- **~/.factory/skills/** must contain at least two real skills for BYOK skill-answering validation. Snapshot taken during m1 scrutiny (2026-04-22) confirms `docx`, `pptx`, `morph-ppt`, `star-office-helper`, `pdf`, and `xlsx` are present, while a standalone `office-cli` skill directory is not. Validators should use the live directory listing rather than an `office-cli`-only baseline for VAL-SKILLS-012..014 / VAL-CROSS-001.

---

## Environment variables

None required for the mission itself. Workers MUST NOT introduce new env-var-based secrets into the codebase.

For local debugging (NOT for mission execution):

- `ACP_PERF=1`, `PERF_MONITOR=1` — performance tracing (project script `debug:perf`)
- `SKIP_BASELINE_TEST=1` — skip the init.sh baseline smoke test
- `AIONUI_MULTI_INSTANCE=1` — multi-instance electron (NOT for workers)

---

## i18n locales in scope

All 6 locales must have every new user-facing string key (see mission target keys):

- `en-US` — primary
- `zh-CN` — mainland Chinese
- `zh-TW` — Traditional Chinese
- `ja-JP` — Japanese
- `ko-KR` — Korean
- `tr-TR` — Turkish

File layout: `src/renderer/services/i18n/locales/<locale>/<namespace>.json` (e.g., `agentMode.json`, `mcp.json`).

Validation: `bun run i18n:types && node scripts/check-i18n.js`.

---

## Platform-specific quirks

- **Windows CP936 / CJK paths**: NEVER use `execSync('where droid')` or `which`. Always let Node `spawn` do native lookup. See `src/process/agent/droid/cliResolver.ts`.
- **Windows PS7+ execution policy**: stderr is localized in user's language. Detector must rely on URL anchor (`about_Execution_Policies`) + exception class name (`PSSecurityException`) + legacy English substrings. See m5-f17.
- **macOS dev environment**: user's git proxy is `http://127.0.0.1:7890` (Clash). NEVER set `http.version=HTTP/1.1` (kills the proxy handshake).
- **Electron main/renderer split**: the renderer has NO Node APIs; the main process has NO DOM APIs. Cross-process = IPC bridge only.

---

## Security constraints

- No apiKey / api_key / Authorization: Bearer token values may be logged, exposed through IPC, or appear in error messages. `extractErrorMessage` already applies 300-char truncation; preserve it.
- Mission runs exclusively against the user's existing BYOK config — NO new credentials / accounts / secrets introduced.
- Security-auditor subagent runs at m5-f18 pre-commit; any high/critical finding blocks release.
