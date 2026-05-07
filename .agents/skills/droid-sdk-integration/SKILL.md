---
name: droid-sdk-integration
description: |
  智能体工厂主链路 src/process/agent/droid/ 对接 @factory/droid-sdk 的开发规范。
  任何改动 DroidSdkAgent、messageMapper、cliRuntime、cliResolver、modelProbe、
  runtime/* 调度/权限/AskUser 桥、BYOK 模型、Factory 模型切换、
  Spec/Plan/Auto/YOLO 模式、MCP 管理、skills 注入/listSkills、onNotification、
  AskUser / 权限确认、createSession / resumeSession、MessageOptions 附件、
  mission / decomp 相关的任务都必须先加载这个 skill。
  排查“skills 不加载 / subagent 无法调用 / 终端 Droid 与 SDK 行为不一致 /
  模型切换被覆盖成 Factory 默认 / Windows CJK 路径乱码 / 冷启动超时”时也必须加载。
  触发词：Droid SDK、@factory/droid-sdk、DroidSdkAgent、Factory Droid、
  Droid 后端、Spec mode、listSkills、onNotification、BYOK、createSession、
  updateSettings、MCP、mission、decomp。
---

# Droid SDK 集成开发规范

智能体工厂（Agent Factory）的主智能体链路是：

```
UI → AcpAgentManager (data.backend === 'droid') → DroidSdkAgent → @factory/droid-sdk → Factory Droid CLI
```

在本仓库里，**Droid SDK 路径是第一定义**，ACP `droid exec --output-format acp` 只作为历史兼容。任何时候改这条主链路，都必须先读完 SKILL.md 再动手，需要细节再按需读 `references/*.md`。

## 前置阅读（改代码前必读）

1. `AGENTS.md` + `CLAUDE.md`：项目定位、目录约束、测试与 PR 规范
2. `src/process/agent/droid/` 下所有 `.ts`（文件少，全看）
3. `node_modules/@factory/droid-sdk/package.json`：确认当前 SDK 版本（目前 **0.1.4**）
4. `node_modules/@factory/droid-sdk/dist/index.d.ts`：SDK 真实类型定义，是唯一可信来源
5. `.factory/memories.md` + `.factory/rules/project.md`：长期记忆与规则
6. 本 skill 的三份参考资料：
   - [`references/sdk-surface.md`](references/sdk-surface.md) — SDK 完整能力清单
   - [`references/project-integration-map.md`](references/project-integration-map.md) — 本仓库每个 droid 文件的职责与钩子
   - [`references/gaps-and-guidance.md`](references/gaps-and-guidance.md) — 已知缺口 + 修改指引 + 不要做清单

## 项目地图（一句话速查）

| 文件                                                       | 职责                                                                                                   |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `src/process/agent/droid/DroidSdkAgent.ts`                 | 会话生命周期、stream、权限 / AskUser 转发、模型 / 模式切换、spec+ask_user 提醒注入                     |
| `src/process/agent/droid/messageMapper.ts`                 | SDK `DroidMessage` → UI `IResponseMessage` 映射（**目前只覆盖 9 种事件**）                             |
| `src/process/agent/droid/cliResolver.ts`                   | 解析 bundled / 项目 node_modules / system 三类 droid CLI 候选                                          |
| `src/process/agent/droid/cliRuntime.ts`                    | `droid --version` 探测 + 结果缓存 + Windows CJK 规避                                                   |
| `src/process/agent/droid/modelProbe.ts`                    | 用 `createSession()` 获取 CLI 可用模型                                                                 |
| `src/process/agent/droid/cliInstaller.ts`                  | `@factory/cli` 的本地安装/升级                                                                         |
| `src/process/agent/droid/runtime/DroidRuntimeScheduler.ts` | 冷/暖会话状态机 + 启动许可 + idle reclaim                                                              |
| `src/process/agent/droid/runtime/DroidPermissionPolicy.ts` | 把 autonomyLevel 翻成 `ToolConfirmationOutcome`                                                        |
| `src/process/agent/droid/runtime/DroidTextAskBridge.ts`    | AskUser TTL 超时 + prompt 格式化                                                                       |
| `src/process/agent/droid/runtime/config.ts`                | Droid channel 运行期配置加载                                                                           |
| `src/process/task/AcpAgentManager.ts`                      | `data.backend === 'droid'` 分支构造 DroidSdkAgent + skills 注入 + 共用 ACP UI 事件                     |
| `src/process/task/AcpSkillManager.ts` + `agentUtils.ts`    | skills 发现 / 首条消息 skill index 注入                                                                |
| `src/renderer/pages/conversation/platforms/acp/*`          | Droid 后端共用 ACP SendBox UI，消费 `acp_tool_call` / `acp_permission` / `slash_commands_updated` 事件 |

## 硬规则（违反即回退）

1. **BYOK modelId 必须保留**。看起来像 `custom:…` / `…[BYOK]…` 的 modelId 不要用 Factory 默认模型兜底（见 `isLikelyByokModelId`）。主进程 `FactoryCatalog` 冷启动期没探测完时必须透传，否则首条消息会被静默换成 Factory 云模型并报 `No access token available`。
2. **新增 SDK 事件先改 mapper**。SDK 新 notification / message type 必须先在 `DroidMessageMapper.mapMessage` 的 switch 里加 case，别在 `DroidSdkAgent` 或 `AcpAgentManager` 里直接消费原始事件。
3. **权限链路单入口**。权限逻辑必须过 `handlePermission → DroidPermissionPolicy.evaluate → ToolConfirmationOutcome`；不要新开 bypass 路径，也不要直接 resolve `proceed_always`。
4. **真 YOLO 要同时处理两件事**。仅 `setMode('yolo')` 只把 autonomy 调到 High，不等于 `skipPermissionsUnsafe`。如果产品确实要求“无提示跑完”，必须同时写 `CreateSessionOptions.skipPermissionsUnsafe = true`，并在 UI 上加显式二次确认。
5. **兼容 resume 场景**。任何对 session 的新设置都要考虑 `resumeSession(acpSessionId)` 路径：在 `startSession` 里继续用 `this.session.updateSettings({...})` 下发，不要只在 `createSession` 的 options 上加。
6. **两条 system-reminder 前缀不能删**。`SPEC_MODE_EXECUTION_REMINDER` / `ASK_USER_TOOL_FORMAT_REMINDER` 是 SDK 路径和终端 Droid 对齐行为的关键，改文案可以、删不行。
7. **CLI 路径只用 Node spawn 原生查找**。禁止调用 `where.exe` / `which` 把路径解析成字符串 —— Windows 非 UTF-8 代码页（如 CP936）会产出 mojibake 再 ENOENT。沿用 `cliResolver` + `resolveWorkingDroidCli` 的逻辑即可。
8. **Windows 冷启动 15s 为软预检**。`cliRuntime.ts` 15s 超时之后要继续下沉给 SDK spawn，不要直接抛错中断 `ensureSession`，SDK 会给出更好的错误。
9. **skills 注入走 `prepareFirstMessageWithSkillsIndex`**。Droid 后端必须走 prompt 注入（SDK session 不会像终端那样自动把 skills 塞进 system prompt），不要去掉 `AcpAgentManager.ts` 里 `backend !== 'droid'` 那段判断。
10. **先跑自检再提交**：
    ```bash
    bun run lint:fix
    bun run format
    bunx tsc --noEmit
    bun run test
    prek run --from-ref origin/main --to-ref HEAD
    ```

## 常见任务速查

每项都给出“改哪里 / 用什么 SDK 方法 / 怎么验”。细节看 `references/gaps-and-guidance.md`。

### T1. 让 SDK 路径支持 `listSkills`（与终端 Droid 对齐）

- **SDK 方法**：`session.listSkills() → ListSkillsResult`（定义见 `index.d.ts` 附近 `SkillInfo` / `SkillLocation`）
- **改哪里**：`DroidSdkAgent` 在 `startSession` 成功后调一次 `listSkills()`，把结果合进 `AcpSkillManager` 的 extension skills，或直接发 `slash_commands_updated`
- **验**：前端 ACP SendBox 的 `useSlashCommands` 应能看到 SDK 返回的 skill 作为斜杠命令；桌面端 CDP 实测打 `/` 看列表

### T2. 订阅 SDK notification 接入 title / MCP / mission / settings 变更

- **SDK 方法**：`session.onNotification(callback, filter?)`
- **过滤类型**：`SessionNotificationType.SESSION_TITLE_UPDATED` / `MCP_STATUS_CHANGED` / `SETTINGS_UPDATED` / `MISSION_*`
- **改哪里**：`DroidSdkAgent.startSession` 注册 callback，映射到已有 UI 事件（如 session title 走 conversation 更新，MCP status 走现有 MCP UI 通道）
- **验**：在 Electron 里触发 `/mcp list`、让 Droid 改 title、跑 mission，看 UI 对应更新

### T3. 动态 MCP 管理

- **SDK 方法**：`session.addMcpServer / removeMcpServer / toggleMcpServer / listMcpServers / listMcpTools / authenticateMcpServer`
- **改哪里**：`DroidSdkAgent` 加一组 `addMcpServer(...)` 包装，`AcpAgentManager` 把 team MCP 配置（`teamMcpStdioConfig`）在 Droid 分支里也下发
- **验**：`bun run test` + 手动在 UI 里加 MCP → 观察 SDK 调用 → listMcpServers 返回

### T4. 真 YOLO

- **SDK 方法**：`CreateSessionOptions.skipPermissionsUnsafe: true`
- **改哪里**：`getSessionSettingsForMode('yolo')` 同时返回 `skipPermissionsUnsafe: true`；UI 层给一个明显 toggle（不要自动开启）
- **验**：跑一个会要求多次 permission 的任务，确认不再弹窗

### T5. 原生附件（图片/文件）

- **SDK 方法**：`session.stream(text, { images, files })`
- **改哪里**：`sendMessageInternal` 不再把 `data.files` 拼成 `@file` 文本；按 SDK `MessageOptions` 分别传 `images` / `files`
- **注意**：保留 `@file` 兼容路径给旧消息体，避免破坏 cron / 插件
- **验**：发送带图片/文件的消息，观察 SDK spawn 命令与 Droid 响应

### T6. Mission / Decomp 模式

- **SDK 方法**：`CreateSessionOptions.decompSessionType` + `decompMissionId`，订阅 `MissionStateChanged` / `MissionWorkerStarted` 等 notification
- **改哪里**：新增一种 sessionMode（`mission`），在 `getSessionSettingsForMode` 里返回对应 enum；mapper 里补 mission 类型事件
- **验**：独立单测 + 实机跑一个简单 mission

### T7. 前端斜杠命令 / skill 列表

- **改哪里**：让 Droid 路径在 `startSession` / `listSkills` 返回后也发 `slash_commands_updated`；复用 ACP 的 `useAcpMessage` 事件（`src/renderer/pages/conversation/platforms/acp/useAcpMessage.ts`）
- **验**：ACP SendBox 输入 `/` 自动弹出 SDK 提供的命令

## 排障 Checklist（按出现概率从高到低）

1. **skills 不加载 / subagent 调不动**：先确认首条消息里有没有注入 skills index（`prepareFirstMessageWithSkillsIndex`）；再看 `AcpSkillManager.invalidate()` 是否被触发；最后才考虑 `listSkills()` 缺失
2. **模型切换失效 / 被换回默认 Factory 模型**：
   - 检查 `isLikelyByokModelId` 判定
   - 看 `FactoryCatalog` 是否已 `refreshFactoryDroidCatalog()`
   - 看 `session.updateSettings` 是否在 `resumeSession` 后被调用
3. **第一条消息报 `No access token available`**：几乎都是 BYOK id 被替换成 Factory 默认；按上一条查
4. **AskUser 超时 / 不回应**：看 `DroidTextAskBridge` 的 TTL 是否刷新；`runtimeScheduler.markAskUser` 是否清理
5. **Windows 冷启动 > 15s / `droid --version` 失败**：正常，`cliRuntime.ts` 已设计为 soft-preflight；直接下沉给 SDK
6. **Windows CJK 用户目录 ENOENT**：检查有没有引入 `where` / `which`；用绝对路径也会踩坑，坚持用 bare `droid` 让 `CreateProcessW` 做查找
7. **Factory 402**：显示"Factory 算力额度不足"提示并引导充值，别重试
8. **tool_result / tool_progress 没显示**：通常是 mapper 里 `activeToolCalls` Map 里没找到对应 id；回到事件顺序排查

## 验证方式

### 单元 / 集成测试

- 默认底线：`bun run test`
- 专项用例：
  - `tests/unit/AcpAgentManagerSkillInjection.test.ts` — skills 注入
  - `tests/unit/droid/*`（若无，新增）— BYOK 透传 / mapper 分支
- 新增 SDK 调用务必写对应测试（mock `DroidSession` 方法）

### 桌面端实测

使用 `.factory/skills/desktop-app-testing` 提供的 CDP 流程：

```bash
lsof -nP -iTCP -sTCP:LISTEN | rg "5173|5174|9230|25809"
agent-browser connect 9230
agent-browser screenshot --annotate && agent-browser snapshot -i -C
```

优先验证：

- `/` 弹斜杠命令列表
- 切换模型 → 下一次回答声明自己是该模型
- Spec/Plan 模式下 Droid 只给 plan，不改文件
- YOLO 模式下不再弹权限
- AskUser 出现能在 UI 里回答并写回 SDK

### 发版前

如果改动影响分发，联用 `.factory/skills/package-build`：本地产出 mac/win 安装包并校验架构 + 7z 格式。

## 不要做清单

- ❌ 把 Droid 主链路切回 `droid exec --output-format acp`（ACP 保留为兼容层，不是第一定义）
- ❌ 在 `messageMapper.ts` 里塞业务逻辑 / IPC 调用 —— 只做 SDK event → UI event 纯映射
- ❌ 删除 BYOK 透传判断 / spec 提醒注入 / ask_user 格式提醒
- ❌ 在 `DroidSdkAgent` 外直接 import `@factory/droid-sdk` 的运行期方法（类型除外）
- ❌ 用 `execSync('where droid')` / `which droid` 解析 CLI 绝对路径
- ❌ 给 Droid 后端单独写一套前端 SendBox —— 目前复用 ACP 平台的组件，保持一致性
- ❌ 把 YOLO 默认打开或者让自动化脚本偷偷加 `skipPermissionsUnsafe`

## 官方参考

- SDK 仓库：<https://github.com/Factory-AI/droid-sdk-typescript>
- Factory docs：<https://docs.factory.ai/llms.txt>
- 终端 Droid 行为对照时以本仓库已安装的 `@factory/droid-sdk@0.1.4` 类型定义为准，而不是网页文档（文档偶尔滞后）
