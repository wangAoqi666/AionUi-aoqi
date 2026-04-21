# Factory Droid SDK 能力全景（@factory/droid-sdk 0.1.4）

> 本文只承担“SDK 实际能做什么”的知识锚点。所有行号都针对本仓库已安装版本：`node_modules/@factory/droid-sdk/dist/index.d.ts`（88475 行）。字段有变更时，按类型定义文件为准。

## 1. 顶层入口

```ts
import {
  createSession,
  resumeSession,
  query, // 一次性查询：内部 createSession → send → close
  DroidSession, // class，由 createSession / resumeSession 返回
  DroidClient, // 底层 JSON-RPC 客户端，session 的基座
  ProcessTransport, // 把 droid CLI 作为子进程 JSON-RPC transport
} from '@factory/droid-sdk';
```

- `createSession(options?: CreateSessionOptions): Promise<DroidSession>`
- `resumeSession(sessionId: string, options?: ResumeSessionOptions): Promise<DroidSession>`
- `query(text, options?)`：一次性请求，对长对话没用

## 2. `DroidSession` 全部方法

取自 `index.d.ts` 的 `declare class DroidSession`（约 88343 行附近）。

| 方法                                                                   | 说明                                                                                                                               |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `get sessionId(): string`                                              | 当前会话 ID                                                                                                                        |
| `get initResult(): InitializeSessionResult \| LoadSessionResult`       | 初始化 / 加载结果（含可用模型、默认设置等）                                                                                        |
| `stream(text, options?: MessageOptions): AsyncGenerator<DroidMessage>` | 流式发送并返回事件流，直到 `turn_complete`                                                                                         |
| `send(text, options?)`                                                 | 非流式：内部 consume `stream`，返回聚合 `DroidResult`                                                                              |
| `interrupt()`                                                          | 中止当前 turn                                                                                                                      |
| `close()`                                                              | 关闭 transport，不可复用                                                                                                           |
| `updateSettings(params: Partial<UpdateSessionSettingsRequestParams>)`  | 运行期更新 modelId / reasoningEffort / autonomyLevel / interactionMode / specMode\* / skipPermissionsUnsafe / enabledToolIds / ... |
| `addMcpServer(params)`                                                 | 加 MCP server（stdio / http / sse）                                                                                                |
| `removeMcpServer(params)`                                              | 移除 MCP server                                                                                                                    |
| `toggleMcpServer(params)`                                              | 启用 / 禁用 MCP server                                                                                                             |
| `listMcpServers()`                                                     | 列出 MCP server 与状态 summary                                                                                                     |
| `listMcpTools()`                                                       | 列出 MCP 工具                                                                                                                      |
| `authenticateMcpServer(params)`                                        | 触发 MCP OAuth 流程                                                                                                                |
| `listSkills(): Promise<ListSkillsResult>`                              | 返回 SDK 所见的 skills（含 `SkillLocation`：builtin / user / project / extension / ...）                                           |
| `onNotification(callback, filter?): () => void`                        | 订阅所有 server → client notification；返回取消订阅函数                                                                            |

> `DroidClient` 基本上是上述方法的超集（多了 `listMcpRegistry`、`submitBugReport`、`setPermissionHandler` 等），一般不直接用，通过 `DroidSession` 已够。

## 3. 创建 / 恢复会话的选项

`CreateSessionOptions`（可在 `index.d.ts` 搜索 `type CreateSessionOptions`）汇集了所有可调项：

```ts
interface CreateSessionOptions {
  cwd?: string; // 工作目录
  execPath?: string; // droid CLI 绝对路径（通过 cliResolver 给出）
  env?: Record<string, string>; // 额外环境变量
  modelId?: string; // 主模型 id（Factory id 或 BYOK id）
  reasoningEffort?: ReasoningEffort; // low / medium / high
  autonomyLevel?: AutonomyLevel; // Off / Low / Medium / High
  interactionMode?: DroidInteractionMode; // Auto / Spec
  specModeModelId?: string | null; // spec 模式单独指定模型
  specModeReasoningEffort?: ReasoningEffort | null;
  skipPermissionsUnsafe?: boolean; // 真 YOLO：不再触发 permissionHandler
  enabledToolIds?: string[]; // 工具白名单
  decompSessionType?: DecompSessionType; // mission 相关
  decompMissionId?: string;
  permissionHandler?: ClientPermissionHandler;
  askUserHandler?: ClientAskUserHandler;
  timeoutMs?: number;
  source?: SessionSource; // session 来源（CLI / SDK / ...）
  tags?: SessionTag[]; // 遥测 tag
  // ... 其它少用字段见类型定义
}
```

`ResumeSessionOptions` 是 `CreateSessionOptions` 的子集，不含 `modelId` / `reasoningEffort` 等（那些必须用 `updateSettings` 设）。

## 4. 消息 / 事件

### 4.1 发消息：`MessageOptions`

```ts
interface MessageOptions {
  images?: Array<Base64ImageSource | ImageBlock | ...>;
  files?: Array<DocumentBlock | DocumentSource | ...>;
  // 其他 transport 级参数
}
```

项目当前把 `data.files` 拼成 `@file` 文本 —— 原生路径应改用这里的 `files` / `images`。

### 4.2 DroidMessage 事件类型（stream 产出）

项目 `messageMapper.ts` 的 switch 必须覆盖的事件类型（部分）：

| `type`                  | 含义                                                             |
| ----------------------- | ---------------------------------------------------------------- |
| `assistant_text_delta`  | 流式输出增量                                                     |
| `thinking_text_delta`   | 思考增量                                                         |
| `tool_use`              | 模型发起工具调用                                                 |
| `tool_result`           | 工具调用结果                                                     |
| `tool_progress`         | 工具中途进度                                                     |
| `working_state_changed` | Droid 工作状态（idle / streaming / executing_tool / compacting） |
| `token_usage_update`    | token 使用量                                                     |
| `error`                 | 错误                                                             |
| `turn_complete`         | 当前 turn 结束                                                   |

SDK 还有更多 `DroidMessage` 类型（通过 `convertNotificationToStreamMessage` 转换），随版本升级可能新增。

### 4.3 SessionNotificationType（`onNotification` filter 可选值）

```
TOOL_RESULT
TOOL_PROGRESS_UPDATE
CREATE_MESSAGE
ERROR
DROID_WORKING_STATE_CHANGED
PERMISSION_RESOLVED
SETTINGS_UPDATED
SESSION_TITLE_UPDATED
MCP_STATUS_CHANGED
ASSISTANT_TEXT_DELTA
THINKING_TEXT_DELTA
SESSION_TOKEN_USAGE_CHANGED
MISSION_STATE_CHANGED
MISSION_FEATURES_CHANGED
MISSION_PROGRESS_ENTRY
MISSION_HEARTBEAT
MISSION_WORKER_STARTED
MISSION_WORKER_COMPLETED
MCP_AUTH_REQUIRED
MCP_AUTH_COMPLETED
```

当前项目只通过 `stream()` 消费 `DroidMessage`，没订阅 `onNotification`。Title / settings / mcp / mission 相关事件都没接。

## 5. 关键枚举

```ts
enum DroidInteractionMode {
  Auto = 'auto',
  Spec = 'spec',
}

enum AutonomyLevel {
  Off = 'off', // 每个工具都要 permission
  Low = 'low', // 低风险工具自动 proceed_auto_run_low
  Medium = 'medium',
  High = 'high', // 所有工具自动运行（非"无权限"，仍走 permissionHandler）
}

enum ReasoningEffort {
  Low = 'low',
  Medium = 'medium',
  High = 'high',
}

enum ToolConfirmationOutcome {
  ProceedOnce = 'proceed_once',
  ProceedAlways = 'proceed_always',
  ProceedAutoRun = 'proceed_auto_run',
  ProceedAutoRunLow = 'proceed_auto_run_low',
  ProceedAutoRunMedium = 'proceed_auto_run_medium',
  ProceedAutoRunHigh = 'proceed_auto_run_high',
  ProceedEdit = 'proceed_edit',
  Cancel = 'cancel',
}

enum ToolConfirmationType {
  Edit = 'edit',
  Execute = 'exec',
  Create = 'create',
  AskUser = 'ask_user',
  ExitSpecMode = 'exit_spec_mode',
  ProposeMission = 'propose_mission',
  StartMissionRun = 'start_mission_run',
  ApplyPatch = 'apply_patch',
  McpTool = 'mcp_tool',
}

enum SkillLocation {
  Builtin = 'builtin',
  User = 'user',
  Project = 'project',
  Extension = 'extension',
  // 按版本可能还有 team / global 等
}

enum DecompSessionType {
  // mission / decomposition 相关；触发方式见 SDK 文档
}
```

## 6. `UpdateSessionSettingsRequestParams` 常用字段

```ts
{
  modelId?: string;
  reasoningEffort?: ReasoningEffort;
  autonomyLevel?: AutonomyLevel;
  interactionMode?: DroidInteractionMode;
  specModeModelId?: string | null;
  specModeReasoningEffort?: ReasoningEffort | null;
  skipPermissionsUnsafe?: boolean;
  enabledToolIds?: string[];
  // 其余见类型
}
```

**注意**：`reasoningEffort` 的有效值跟 `modelId` 有关，项目已有 `resolveFactoryReasoning()` 做 normalize，新增字段前先过一遍这个 helper。

## 7. Handler 契约

```ts
type ClientPermissionHandler = (
  params: RequestPermissionRequestParams
) => ToolConfirmationOutcome | Promise<ToolConfirmationOutcome>;

type ClientAskUserHandler = (params: AskUserRequestParams) => AskUserResult | Promise<AskUserResult>;
```

- `permissionHandler` 返回 `ToolConfirmationOutcome` 字符串枚举值
- `askUserHandler` 返回 `{ cancelled: boolean, answers: AskUserCollectedAnswer[] }`
- 两者都可以 async；handler 抛错会变成 JSON-RPC error 回给 SDK

## 8. 错误类型

```
ConnectionError     // transport / 进程层
ProtocolError       // JSON-RPC / schema
SessionError        // 会话级（如未初始化）
SessionNotFoundError
TimeoutError
ProcessExitError    // CLI 子进程退出
DroidClientError
```

封装错误时要保留原始 message 方便排障。402 Payment Required 是 Factory 算力耗尽的典型信号（项目里已映射成中文提示）。

## 9. 版本确认

```bash
# 当前实际版本
cat node_modules/@factory/droid-sdk/package.json | jq -r .version
# 期望输出：0.1.4（或后续升级版本）
```

任何 SDK 行为讨论都请先确认版本号，再对 `index.d.ts` 做 ground truth 核对。
