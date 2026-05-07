# Droid SDK 在本仓库的集成地图

> 面向“我想改 Droid 某个能力，应该动哪里”这类问题。所有路径从仓库根目录起。

## 1. 整体调用链

```
UI (renderer/)
  ↓ IPC
ipcBridge.conversation.sendMessage
  ↓
ActionExecutor (src/process/channels/gateway/ActionExecutor.ts)
  ↓ 根据 data.backend 分发
AcpAgentManager (src/process/task/AcpAgentManager.ts)
  ├─ backend === 'droid' → new DroidSdkAgent(...)
  └─ 其他 backend        → new AcpAgent(...)
DroidSdkAgent (src/process/agent/droid/DroidSdkAgent.ts)
  ↓
@factory/droid-sdk → ProcessTransport → droid CLI 子进程
```

## 2. `src/process/agent/droid/` 每个文件

### 2.1 `DroidSdkAgent.ts`

- **职责**：会话生命周期、消息流、权限 / AskUser、模型 / 模式切换、spec / ask_user 提醒注入
- **关键导出**：`DroidSdkAgent` class、`DroidSdkAgentConfig` type
- **关键钩子**：
  - `ensureSession()` → `startSession()`：`createSession` / `resumeSession` 双入口
  - `sendMessage()` / `sendMessageInternal()`：包装 `session.stream()`，逐条喂给 `DroidMessageMapper`
  - `handlePermission()`：把 SDK permission request 翻成 `AcpPermissionRequest` 发 UI；`DroidPermissionPolicy` 先行裁决
  - `handleAskUser()` + `answerAskUser()`：经 `DroidTextAskBridge` 做 TTL / prompt 格式化
  - `setModelByConfigOption()` / `setConfigOption()`：`session.updateSettings` 运行期调整
  - `getSessionSettingsForMode()`：`spec / plan / auto / acceptEdits / yolo` → `{ interactionMode, autonomyLevel }`
  - `getPromptPreamble()`：给每条消息前置 `<system-reminder>`（spec 模式 vs ask_user 格式）
- **外部依赖**：
  - `@factory/droid-sdk`（`createSession` / `resumeSession` / enums）
  - `factoryModels.ts`（Factory 模型目录 + BYOK 判定）
  - `cliRuntime.ts`（CLI 探测）
  - `runtime/*`（调度、权限、AskUser、config）

### 2.2 `messageMapper.ts`

- **职责**：SDK `DroidMessage` → UI `IResponseMessage`
- **目前 switch 覆盖**（缺一不可）：
  - `assistant_text_delta` → `content`
  - `thinking_text_delta` → `thought`
  - `tool_use` / `tool_result` / `tool_progress` → `acp_tool_call`
  - `working_state_changed` → no-op（前端不消费）
  - `token_usage_update` → `usage`
  - `error` → `error`（含 402 特殊文案）
  - `turn_complete` → `end`
- **还没覆盖**：`session_title_updated`、`settings_updated`、`mcp_status_changed`、`mission_*`、`permission_resolved`、`mcp_auth_*`（这些都要走 `onNotification`，SDK 不会通过 `stream()` 里的 `DroidMessage` 下来）

### 2.3 `cliResolver.ts`

- **职责**：候选路径解析（不做进程探测）
- **优先级**：
  1. 用户配置 `cliPath`（custom）
  2. system（让 OS 自己查 `droid`）— **优先于 bundled**，因为 bundled Bun baseline 在部分 Windows 上会报 illegal instruction
  3. 运行时资源目录 `bundled-droid/<platform>-<arch>/`
  4. `node_modules/@factory/cli/bin/droid[.exe]`
- **注意**：故意不返回绝对路径（除非 bundled/custom），否则 Windows CJK 路径会 mojibake

### 2.4 `cliRuntime.ts`

- **职责**：`droid --version` 实际探测 + 缓存 + soft-preflight
- **关键**：
  - 15s timeout（Windows Defender + cmd.exe shim + 慢网 telemetry 的已知上限）
  - 结果缓存在内存 `workingCliCache`，失败不缓存
  - `execFileSync` 用 `windowsHide: true`，避免 cmd.exe 黑框闪烁
  - **禁止用 `where` / `which` 把 execPath 解析成绝对字符串**
- **给谁用**：`DroidSdkAgent.startSession()` 里 `resolveWorkingDroidCli()` 拿到 execPath

### 2.5 `modelProbe.ts`

- **职责**：用 `createSession()` 打开一个临时 session 去读 `initResult.availableModels` / `defaultModelId` / BYOK 模型
- **用处**：`FactoryCatalog` 冷启动 (`refreshFactoryDroidCatalog`) 的数据源
- **注意**：探测完必须 `close()`；探测期间 UI 可能还在发第一条消息 —— 所以 `DroidSdkAgent` 里才要保留 BYOK modelId 透传逻辑

### 2.6 `runtime/DroidRuntimeScheduler.ts`

- **职责**：冷 / 暖会话状态机
- **要点**：
  - `withStartPermit`：同一 conversation 同一时刻只允许一个 `startSession`
  - `enqueueTurn`：turn 级排队，配合 AskUser 的 `pauseForInteractive` / `resumeAfterInteractive`
  - `markWarm` / `markCold` / `markFailed` / `markAskUser`：状态流转，超时后自动释放资源
- **不要**：在外部直接 new session，避免绕过调度器；也不要把 `runtimeScheduler` 改成全局单例（每个 scope key 一个实例）

### 2.7 `runtime/DroidPermissionPolicy.ts`

- **职责**：根据 `runtimeSettings`（autonomy、工具白名单、workspace 限制）给 `handlePermission` 返回裁决
- **返回**：`{ outcome: ToolConfirmationOutcome, notice?: string }`
- **边界**：不做 SDK 调用，只做策略；真正的 UI 提示在 `DroidSdkAgent` 里发出

### 2.8 `runtime/DroidTextAskBridge.ts`

- **职责**：AskUser 的 TTL 超时 + prompt 文本化
- **要点**：
  - `scheduleTimeout(callId, handler)` 到期执行 `handler`
  - `clearTimeout(callId)` 回答到达后必须调
  - `formatPrompt(questions)` 把结构化问题拼成文本消息给 UI

### 2.9 `runtime/config.ts` + `DroidRuntimeRegistry.ts` + `DroidWarmPool.ts` + `DroidIdleReclaimer.ts`

- **runtime/config.ts**：`loadDroidRuntimeConfigForSource` / `getDroidRuntimeScopeKey` / `isDroidChannelPlatform` —— 给 channel-plugin 场景共享 scheduler
- **DroidRuntimeRegistry.ts**：scope → scheduler 单例池
- **DroidWarmPool.ts**：暖 session 复用池
- **DroidIdleReclaimer.ts**：idle 超时回收空会话

### 2.10 `cliInstaller.ts`

- **职责**：从设置页触发的 `@factory/cli` 全局 / 项目本地安装 / 升级
- **注意**：不要在 `DroidSdkAgent` 里直接调它；走 `DroidByokService` → UI 按钮流程

### 2.11 `index.ts`

只做 re-export：`DroidSdkAgent` + `DroidSdkAgentConfig`。新文件若需要外部用，统一从这里导出。

## 3. `src/process/task/AcpAgentManager.ts` 中的 Droid 分支

### 3.1 选后端

```ts
if (data.backend === 'droid') {
  this.agent = new DroidSdkAgent({ ... });
} else {
  this.agent = new AcpAgent({ ... });
}
```

- Droid 不走 `acpArgs`、`ACP_BACKENDS_ALL.droid` 里的 CLI 参数（那些留给 ACP 兼容）
- `yoloMode` / `sessionMode` 会传进 Droid agent，但 autonomy 的最终解释在 `DroidSdkAgent.getSessionSettingsForMode`

### 3.2 Skills 注入（仅 Droid / 自定义 workspace）

`AcpAgentManager.ts`：

```ts
const useNativeSkills =
  hasNativeSkillSupport(this.options.backend) && !this.options.customWorkspace && this.options.backend !== 'droid';

if (useNativeSkills) {
  // native symlink 模式
} else {
  // Droid / 自定义 workspace → 用 prepareFirstMessageWithSkillsIndex 注入
  contentToSend = await prepareFirstMessageWithSkillsIndex(contentToSend, {
    presetContext,
    enabledSkills: this.options.enabledSkills,
  });
}
```

原因：SDK `createSession` 不像终端 Droid 那样自动把 `.factory/skills/` 挂到 system prompt。所以 Droid 后端**永远**走 prompt 注入。

### 3.3 Skills watcher

- `startSkillsWatcher()` 用 `fs.watch(getSkillsDir(), { recursive: true })` 监视 `~/.factory/skills/`
- 变化 debounce 500ms → `AcpSkillManager.invalidate()` + `skillsIndexStale = true`
- 下一条消息前置 `<system-reminder>\n[Skills Updated]\n...\n</system-reminder>`

### 3.4 Stream event 共享管线

`handleStreamEvent` 既给 `AcpAgent` 也给 `DroidSdkAgent` 用。要点：

- `thinking` 类型是 Droid mapper 直接发的
- `end` 类型是 Droid turn_complete 的映射（`AcpAgent` 用 `finish`）
- 新增事件类型要保证两路 agent 都能产生 / 处理，否则加 `if (this.agent instanceof DroidSdkAgent)` 分支

## 4. 前端链路（共用 ACP）

Droid 后端**不单独拥有**前端 SendBox。渲染器里的以下文件实际服务 Droid：

- `src/renderer/pages/conversation/platforms/acp/useAcpMessage.ts`
  - 消费 `acp_tool_call` / `acp_permission` / `slash_commands_updated`
- `src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx`
  - 斜杠命令 / 文件拖入 / 模式切换
- `src/renderer/hooks/useSlashCommands.ts`（目录位置随版本可能变）
  - 取当前会话可用斜杠命令

改 Droid 前端体验时不要新建 `platforms/droid/` 目录；在 ACP 平台里按条件分支即可。

## 5. 其他相关入口

- **Factory 模型目录**：`src/common/config/factoryModels.ts`
  - `getFactoryDefaultModelId` / `getFactoryModelById` / `resolveFactoryReasoning` / `resolveFactorySpecModel`
  - BYOK 认知：`isLikelyByokModelId`（id 以 `custom:` 开头或含 `[BYOK]`）
- **Factory 目录热刷新**：`refreshFactoryDroidCatalog`（主进程 did-finish-load 触发，依赖 `modelProbe`）
- **设置 → Droid BYOK**：
  - 渲染侧：`src/renderer/components/settings/FactoryDroidByokModal.tsx`
  - 主进程：`src/process/bridge/services/DroidByokService.ts`
- **Channel 运行期配置**：`src/common/config/storage.ts` + `src/common/config/storageKeys.ts` 里的 `droid.*`

## 6. 新加文件时的归位规则

| 情况                        | 放哪                                                      |
| --------------------------- | --------------------------------------------------------- |
| 纯 SDK 调用封装 / mapper    | `src/process/agent/droid/`                                |
| 调度 / 权限 / AskUser 相关  | `src/process/agent/droid/runtime/`                        |
| 给 UI 的事件 / IPC 扩展     | `src/common/adapter/ipcBridge.ts` + 对应 bridge           |
| ACP 公共 agent 生命周期逻辑 | `src/process/task/AcpAgentManager.ts`                     |
| SKill 索引 / 前端注入       | `src/process/task/AcpSkillManager.ts` + `agentUtils.ts`   |
| 端到端测试                  | `tests/unit/...` 或 `tests/integration/...`（按现有结构） |

`src/process/agent/droid/` 的文件数接近 10 个上限（`AGENTS.md` 规定单目录 ≤ 10），新增文件前先评估是否能合并或下沉到 `runtime/`。
