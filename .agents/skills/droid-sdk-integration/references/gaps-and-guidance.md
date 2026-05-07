# Droid SDK 集成已知缺口与修改指引

> 本文罗列 **@factory/droid-sdk 0.1.4 已提供但项目尚未用 / 半接的能力**，并给出改动指引。对照 SKILL.md 的“常见任务速查”使用。

## 优先级说明

- **P0**：直接影响用户可见行为 / 与终端 Droid 不一致
- **P1**：提升体验或统一后端能力面，但无阻塞
- **P2**：高级 / 场景性能力，未来再做

## P0 缺口

### P0-1 `session.listSkills()` 未调用

- **现状**：`DroidSdkAgent.ts` 顶部注释声明“Skill listing (listSkills)”，实际代码里没任何调用；skills 仅通过 `prepareFirstMessageWithSkillsIndex` 做 prompt 注入
- **风险**：用户安装的 builtin / user / project / extension skills 在 SDK 侧无法自动生效，与终端 Droid 行为不一致，且前端斜杠命令不会显示 SDK skill
- **改法**：
  1. `startSession` 成功后 `await this.session.listSkills()`
  2. 把 `SkillInfo[]` 合进 `AcpSkillManager` 的 extension skills（调 `registerExtensionSkills` 或 `addExtensionSkills`，看现有 API）
  3. 发 `slash_commands_updated` 事件刷新 UI
- **验证**：Skills 出现在 `/` 弹出列表；安装新 skill 后首条消息带 `[Skills Updated]` 提示

### P0-2 `session.onNotification` 未订阅

- **现状**：仅消费 `stream()` 产生的 `DroidMessage`，所有 server 主动推送的 notification 都丢了
- **受影响事件**：`SESSION_TITLE_UPDATED` / `SETTINGS_UPDATED` / `MCP_STATUS_CHANGED` / `MISSION_*` / `MCP_AUTH_*`
- **改法**：
  1. `startSession` 返回后 `this.session.onNotification(cb)`，保存取消函数在 `closeSession` 里调
  2. 在 `messageMapper` 里新增 `mapNotification(notification: SessionNotification)` 或新建 `notificationMapper.ts`
  3. 映射到已有 UI 事件通道（title / mcp / mission）
- **注意**：notification 到达时序可能与 stream 交叉，`mapMessage` 里累积的 `activeToolCalls` map 要线程安全

### P0-3 真 YOLO 只改 autonomy，没有 `skipPermissionsUnsafe`

- **现状**：`getSessionSettingsForMode('yolo')` 返回 `AutonomyLevel.High`，`handlePermission` 仍被调用（只是策略裁决成 `ProceedOnce`）
- **风险**：仍有短暂权限弹窗竞态；用户期待“一路跑完”
- **改法**：
  - `getSessionSettingsForMode('yolo')` 多返回 `skipPermissionsUnsafe: true`
  - UI 层在开启 YOLO 前增加二次确认 + memory 记住选择
  - 保留一个 hotkey / 配置可回滚，避免被静默打开
- **验证**：桌面端跑一个需要多次 permission 的任务，完全不弹框

### P0-4 Subagent / Task 工具不可用

- **现状**：Factory 文档里的 Custom Droids（`/droids.factory-ai.com/custom-droids`）通过 CLI 层的 Task 工具发 subagent。SDK 路径的 `enabledToolIds` / skill 注入都没带 Task 相关配置，表现为 UI 里调不动 subagent
- **改法**：
  1. 调 `listSkills()` 看返回里是否包含 custom droid 类的条目（按 `SkillLocation` 过滤）
  2. 若 SDK 不直接代理 Task，需要走 MCP / 文档约定给 UI 一个 subagent 选项 surface
  3. 与 P0-1 同时实现更易诊断

## P1 缺口

### P1-1 动态 MCP 管理

- **SDK 方法**：`addMcpServer` / `removeMcpServer` / `toggleMcpServer` / `listMcpServers` / `listMcpTools` / `authenticateMcpServer`
- **现状**：`DroidSdkAgent` 完全没调 MCP 相关方法；`AcpAgent` 里有 `teamMcpStdioConfig` 的下发路径，但 Droid 分支未接
- **改法**：
  1. `DroidSdkAgent` 暴露 `addMcpServer / toggleMcpServer` 等方法（或 IPC bridge 扩展）
  2. session 启动后先 `listMcpServers()` 做一次 sync，补齐团队 / 用户配置
  3. 订阅 `MCP_STATUS_CHANGED` + `MCP_AUTH_REQUIRED` → UI
- **验证**：在 UI 里新增 MCP stdio server，观察 Droid session 可以调到对应工具

### P1-2 原生附件（图片 / 文件）

- **现状**：`sendMessageInternal` 把 `data.files` 拼成 `@file` 文本
- **改法**：改为 SDK `MessageOptions.files` / `images`，文本里不再拼 `@file`
- **注意**：兼容老消息（cron message、plugin 保存的历史消息里的 `@file` 仍要工作）
- **验证**：发送 PNG / PDF 测试 Droid 能直接读；老 `@file` 仍可用

### P1-3 Factory 模型目录热刷新

- **现状**：`refreshFactoryDroidCatalog` 在 did-finish-load 触发一次；之后 BYOK 新增 / 删除不会让 UI 模型 selector 刷新
- **改法**：监听 `SETTINGS_UPDATED` notification + BYOK 设置变更 → 重新 `modelProbe`
- **验证**：在设置页新增 BYOK，5s 内模型选择器应能看到

### P1-4 Session 发现 / 续查

- **SDK 方法**：`listSessions()`（通过 `DroidClient`）+ `resumeSession(id)`
- **现状**：项目已有 `acpSessionId` resume，但没有主动列出会话；用户换 workspace 时可能重复创建
- **改法**：提供一个 main-process 侧 API，开会话前先 `listSessions({ cwd })`，如果有匹配就提示续开

### P1-5 Session Tags / 遥测

- **SDK 字段**：`CreateSessionOptions.tags`
- **改法**：注入 `{ namespace: 'agent-factory', channel, conversationId }` 方便 Factory 侧对账

## P2 缺口

### P2-1 Mission / Decomp 模式

- **SDK 字段**：`decompSessionType` + `decompMissionId`，通知类型 `MISSION_STATE_CHANGED` 等
- **改法**：
  1. 新增 `sessionMode === 'mission'`
  2. `getSessionSettingsForMode` 返回 decomp 参数
  3. 专门的 mission 进度 UI 消费 mission notification
- **先决条件**：P0-2 订阅 notification 已实现

### P2-2 工具白名单

- **SDK 字段**：`enabledToolIds: string[]`
- **用途**：只允许 agent 用某些工具（例如只读模式）
- **改法**：从 UI 读配置 → `updateSettings({ enabledToolIds })`

### P2-3 Spec 模式模型独立

- **现状**：已经接了 `specModeModelId` / `specModeReasoningEffort`
- **进一步**：在 UI 里暴露更直观的“规划用高能模型，执行用小模型”配置

### P2-4 原生 `submitBugReport`

- **SDK 方法**：`DroidClient.submitBugReport`
- **改法**：在设置页“反馈”入口里调用，附上当前 session id

## 修改指引（通用）

### 改 SDK 调用

1. 先看 `index.d.ts` 对应方法的参数 / 返回类型
2. 在 `DroidSdkAgent` 里加一层封装方法，不要让外部文件直接 `import from '@factory/droid-sdk'`（类型除外）
3. 新增 notification / event 时先扩 `messageMapper`，再扩 `AcpAgentManager.handleStreamEvent`
4. 所有 `session.xxx` 调用要 `if (!this.session) return` 防御
5. 错误要过 `createRuntimeErrorResult`，保留 402 / 算力文案

### 改 runtime / 调度

- 不要改单例机制（`DroidRuntimeRegistry.getDroidRuntimeScheduler`）语义
- `enqueueTurn` / `withStartPermit` 必须成对使用
- AskUser 到达时必须 `pauseForInteractive`；回答后 `resumeAfterInteractive`
- 超时默认 `settings.askReplyTtlMs`，不要硬编码

### 改 CLI 解析

- 只在 `cliResolver.ts` / `cliRuntime.ts` 里改
- 新增平台 / 架构时先确认 `bundled-droid/` 目录布局
- **绝不允许**：`execSync('where droid')` / `which droid` / `Get-Command droid`

### 改前端

- 共用 `src/renderer/pages/conversation/platforms/acp/*`
- 新事件类型走 `useAcpMessage.ts` 里的 switch
- 如果一定要区分 Droid 和其它 ACP，在组件内部用 `data.backend === 'droid'` 判断

## 测试 / 验证清单

1. **单元测试**
   - [ ] `tests/unit/AcpAgentManagerSkillInjection.test.ts` 通过
   - [ ] 新增 SDK 行为有独立测试（mock `DroidSession`）
2. **类型 / 规范**
   - [ ] `bunx tsc --noEmit`
   - [ ] `bun run lint:fix` 无残留警告
   - [ ] `bun run format` 无 diff
   - [ ] `prek run --from-ref origin/main --to-ref HEAD` 通过
3. **桌面端 CDP 自测**（按 `.factory/skills/desktop-app-testing`）
   - [ ] `/` 弹出斜杠命令 / skill 列表
   - [ ] 切模型 → Droid 自报新模型
   - [ ] Spec 模式只出计划，不改文件
   - [ ] YOLO 无权限弹窗
   - [ ] AskUser 回答可被 SDK 接收
   - [ ] BYOK modelId 发首条消息不被替换
4. **跨平台回归**
   - [ ] macOS arm64 / x64
   - [ ] Windows x64（特别是 CJK 用户名路径）
5. **发版**（如需）
   - [ ] `.factory/skills/package-build` 跑全平台打包 + 架构 / 7z 校验

## 不要做清单

- ❌ 把 Droid 主链路切回 `droid exec --output-format acp`
- ❌ 在 `DroidSdkAgent` 之外直接使用 `@factory/droid-sdk` 的运行期函数
- ❌ 删除 `isLikelyByokModelId` / BYOK 透传判断
- ❌ 在 `messageMapper.ts` 里做业务 / 存储 / IPC 调用
- ❌ 用 `where` / `which` 解析 CLI 路径
- ❌ YOLO 自动开启 `skipPermissionsUnsafe` 而不经过用户确认
- ❌ 为 Droid 单独写一套 SendBox / 前端 platform 目录
- ❌ 把 15s CLI 探测变成启动硬阻塞
- ❌ 在 `DroidPermissionPolicy` 外另写权限旁路
