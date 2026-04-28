# Agent Factory - Project Guide

## Project Positioning

- `智能体工厂 / Agent Factory` 是基于 Factory Droid 深度定制的智能体工作平台
- 应用与主智能体的交互主链路：`src/process/agent/droid/` → `@factory/droid-sdk` → Factory Droid
- 其他 ACP / 多后端能力保留为兼容层与历史能力，不再作为项目第一定义
- 官方参考直链：
  - https://github.com/Factory-AI/droid-sdk-typescript/blob/main/README.md
  - https://docs.factory.ai/llms.txt
- 文档中出现 `AionUi` 作为仓库名、包名、二进制名或目录名时，默认表示当前技术标识，不代表对外品牌回退

## Agent Collaboration

> **本段优先级最高，所有智能体必须首先遵守。**

本仓库配备专属智能助手，通过以下文件实现持久化协作：

| 文件                        | 用途                                 |
| --------------------------- | ------------------------------------ |
| `.factory/rules/project.md` | 长期有效的执行规则，所有任务必须遵守 |
| `.factory/memories.md`      | 长期保留的偏好、背景和上下文信息     |

### 工作流程

1. **任务开始前**：读取 `.factory/rules/project.md` 和 `.factory/memories.md`，加载规则与上下文
2. **执行任务时**：优先遵循 `.factory/rules/project.md` 中的规则，结合 `.factory/memories.md` 中的背景信息
3. **用户说"记住这个规矩"**：将新规则追加到 `.factory/rules/project.md`
4. **用户说"记住这点"**：将新记忆追加到 `.factory/memories.md`

### BYOK 修复期间必读（2026-04-23 起）

- 存在 `tasks/byok-fixes-todo.md` 文件时，任务开始前必须先 `Read` 它恢复进度
- 对应批准 Spec：`~/.factory/specs/2026-04-23-byok-windows.md`
- 每完成一个 check 项立即把 `[ ]` 改为 `[x]`；全部完成后把该文件移至 `tasks/archive/byok-fixes-2026-04-23.md`
- Provider 枚举已收窄为 Factory 官方三种（`anthropic` / `openai` / `generic-chat-completion-api`），禁止再引入 `google`；Gemini 站点走 `generic-chat-completion-api` + `/v1beta/openai`

### BYOK 站点化改造期间必读（2026-04-24 起）

- 存在 `tasks/byok-site-refactor-todo.md` 文件时，任务开始前必须先 `Read` 它恢复进度
- 对应批准 Spec：`~/.factory/specs/2026-04-23-byok-site-centric-overhaul-delete-sync-windows-build.md`
- 站点 id 改为 `sha1(normalizedBaseUrl)`——不再按 provider 区分；同一 baseUrl 不同 provider 的模型合并到同一站点
- 从站点"+"按钮加模型时，禁止把 apiKey 回传到 renderer；走主进程内部通道（`fetchDroidByokModelsForSite` / `importDroidByokConfigsIntoSite`）
- BYOK 删除逻辑必须保证：settings.local.json、byokModelRefs、factoryDroidCatalog 三方同步，且对话页的 `AcpModelSelector` 能感知变化

---

## Code Conventions

### File & Directory Structure

- **Directory size limit**: A single directory must not exceed **10** direct children (files + subdirectories). Split by responsibility when approaching this limit.

See [docs/conventions/file-structure.md](docs/conventions/file-structure.md) for complete rules on directory naming, page module layout, and shared vs private code placement. Agents working in this repository must also read and follow the `architecture` skill (`.claude/skills/architecture/SKILL.md`) when creating files, modules, or making structure decisions.

### Naming

- **Components**: PascalCase (`Button.tsx`, `Modal.tsx`)
- **Utilities**: camelCase (`formatDate.ts`)
- **Hooks**: camelCase with `use` prefix (`useTheme.ts`)
- **Constants files**: camelCase (`constants.ts`) — values inside use UPPER_SNAKE_CASE
- **Type files**: camelCase (`types.ts`)
- **Style files**: kebab-case or `ComponentName.module.css`
- **Unused params**: prefix with `_`

### UI Library & Icons

- **Components**: `@arco-design/web-react` — no raw interactive HTML (`<button>`, `<input>`, `<select>`, etc.)
- **Icons**: `@icon-park/react`

### CSS

- Prefer **UnoCSS utility classes**; complex styles use **CSS Modules** (`ComponentName.module.css`)
- Colors must use **semantic tokens** from `uno.config.ts` or CSS variables — no hardcoded values
- Arco overrides go in the component's CSS Module via `:global()` — no global override files
- Global styles only in `src/renderer/styles/`

See [docs/conventions/file-structure.md](docs/conventions/file-structure.md) for full CSS and UI library rules.

### TypeScript

- Strict mode enabled — no `any`, no implicit returns
- Use path aliases: `@/*`, `@process/*`, `@renderer/*`, `@worker/*`
- Prefer `type` over `interface` (per Oxlint config)
- English for code comments; JSDoc for public functions

### Architecture

Three process types — never mix their APIs:

- `src/process/` — main process, no DOM APIs
- `src/renderer/` — renderer, no Node.js APIs
- `src/process/worker/` — fork workers, no Electron APIs

Cross-process communication must go through the IPC bridge (`src/preload.ts`).
See [docs/tech/architecture.md](docs/tech/architecture.md) for details.

## Testing

**Framework**: Vitest 4 (`vitest.config.ts`). Run `bun run test` before every commit. Coverage target ≥ 80%.

See the `testing` skill (`.claude/skills/testing/SKILL.md`) for complete workflow, quality rules, and checklist.

## Code Quality

**During development** — auto-fix as you edit:

```bash
bun run lint:fix       # auto-fix lint issues in .ts / .tsx (oxlint)
bun run format         # auto-format .ts / .tsx / .css / .json / .md (oxfmt)
bunx tsc --noEmit      # verify no type errors
```

**Before every PR** — run the full CI check locally to catch everything CI catches (end-of-file, trailing whitespace, all file types):

```bash
# One-time setup
npm install -g @j178/prek

# Replicate exact CI check (read-only — does not auto-fix)
prek run --from-ref origin/main --to-ref HEAD
```

> Note: `prek` uses `lint` (check only) and `format:check` (check only) — it will fail if there are issues but won't fix them.
> If prek reports formatting or lint issues, run the auto-fix commands above first, then re-run prek to verify.

**i18n validation:** If your changes touch `src/renderer/`, `locales/`, or `src/common/config/i18n`, run:

```bash
bun run i18n:types
node scripts/check-i18n.js
```

Both commands must complete without errors before opening a PR. The `oss-pr` skill enforces this automatically.

Common Oxfmt rules (Prettier-compatible, avoid a fix pass):

- Single-element arrays that fit on one line → inline: `[{ id: 'a', value: 'b' }]`
- Trailing commas required in multi-line arrays/objects
- Single quotes for strings

## Git Conventions

Commit format: `<type>(<scope>): <subject>` in English. Types: feat, fix, refactor, chore, docs, test, style, perf. **NEVER add AI signatures** (Co-Authored-By, Generated with, etc.).

For pull request creation, see the `oss-pr` skill (`.claude/skills/oss-pr/SKILL.md`).

## Skills Index

Detailed rules and guidelines are organized into Skills for better modularity:

| Skill             | Purpose                                                                              | Triggers                                                                  |
| ----------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| **architecture**  | File & directory structure conventions for all process types                         | Creating files, adding modules, architectural decisions                   |
| **i18n**          | Internationalization workflow and standards                                          | Adding user-facing text, modifying `locales/` or `src/common/config/i18n` |
| **testing**       | Testing workflow and quality standards                                               | Writing tests, adding features, before claiming completion                |
| **oss-pr**        | Full commit + PR workflow: branch management, quality checks, issue linking, PR      | Creating pull requests, after committing, `/oss-pr`                       |
| **bump-version**  | Version bump workflow: update package.json, checks, branch, PR, tag release          | Bumping version, `/bump-version`                                          |
| **pr-review**     | Local PR code review with full project context, no truncation limits                 | Reviewing a PR, user says "review PR", `/pr-review`                       |
| **pr-fix**        | Fix all issues from a pr-review report, create a follow-up PR, and verify each fix   | After pr-review, user says "fix all issues", `/pr-fix`                    |
| **pr-automation** | PR automation orchestrator: poll PRs, review, fix, and merge via label state machine | Invoked by daemon script (`pr-automation.sh`), `/pr-automation`           |

> Skills are located in `.claude/skills/` and contain project conventions that apply to **all** agents and contributors. Every agent working in this repository must read and follow the relevant skill files when the task matches their scope.

## PR 自动化流程

本仓库运行 PR 自动化 agent，定期处理 open PR（review、fix、合并）。

- **运行方式**：`scripts/pr-automation.sh` 作为 daemon 持续运行，每轮间隔 30 秒；日志默认写入 `~/Library/Logs/AionUi/`，可通过 `LOG_DIR=...` 覆盖
- **状态追踪**：通过 `bot:*` label（`bot:reviewing`、`bot:fixing`、`bot:ready-to-fix`、`bot:ci-waiting`、`bot:needs-human-review`、`bot:ready-to-merge`、`bot:done`）
- **详细说明**：[docs/conventions/pr-automation.md](docs/conventions/pr-automation.md)

## Internationalization

All user-facing text must use i18n keys — never hardcode strings. Languages and modules are defined in `src/common/config/i18n-config.json`.

See the `i18n` skill (`.claude/skills/i18n/SKILL.md`) for complete workflow, key naming, and validation steps.
