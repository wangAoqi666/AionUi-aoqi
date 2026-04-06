# AionUi 项目结构说明文档（二次开发参考）

> 版本：v1.9.2 | 最后更新：2026-03-28

---

## 1. 项目概览

AionUi 是一个基于 Electron 的开源跨平台 AI 协作平台。它将命令行 AI Agent 封装成现代化的聊天界面，支持多 Agent 后端、多渠道消息接入、扩展系统、定时任务等能力。

### 技术栈

| 层面 | 技术 |
|------|------|
| 桌面框架 | Electron 36 |
| 前端 | React 19 + TypeScript |
| 构建 | electron-vite + Vite |
| CSS | UnoCSS（原子化）+ CSS Modules |
| UI 组件库 | @arco-design/web-react |
| 图标 | @icon-park/react |
| 数据库 | SQLite (better-sqlite3 / bun:sqlite) |
| 测试 | Vitest + Playwright |
| Lint/Format | oxlint + oxfmt |
| 包管理 | bun |
| 移动端 | React Native (Expo) |

### 运行模式

AionUi 支持四种运行模式：

```
┌──────────────────────────────────────────────────────────────┐
│  模式 1: start / cli  (Electron 桌面端)                       │
│  ┌──────────────┐    ┌──────────────────┐                    │
│  │ Electron 窗口 │    │ 浏览器 (WebUI)    │                    │
│  │     │         │    │       │          │                    │
│  │     │ IPC     │    │       │ WebSocket│                    │
│  │     ▼         │    │       ▼          │                    │
│  └──────┬────────┘    └───────┬──────────┘                    │
│         └────────┬────────────┘                               │
│                  ▼                                            │
│         Bridge 处理器 / 服务层 / SQLite                        │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│  模式 2: webui  (Electron 无窗口，仅 WebUI)                    │
│  浏览器 ──WebSocket──▶ Bridge 处理器 / 服务层 / SQLite         │
│  （保留完整 Electron API：文件系统、定时任务、MCP 等）            │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│  模式 3: server  (纯 Node.js，无 Electron)                    │
│  浏览器 ──WebSocket──▶ Bridge 处理器 / 服务层 / SQLite         │
│  （10 个 Electron 专属 Bridge 不可用）                         │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│  模式 4: Docker  (容器化 server 模式)                          │
│  同模式 3，通过 Dockerfile 构建                                │
└──────────────────────────────────────────────────────────────┘
```

---

## 2. 核心架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        AionUi 三进程架构                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐   contextBridge    ┌────────────────────┐  │
│  │  Renderer 进程   │◄════════════════►│   Preload 脚本      │  │
│  │  (src/renderer/) │   (IPC 桥接)      │   (src/preload.ts) │  │
│  │                  │                   └─────────┬──────────┘  │
│  │  React UI        │                             │              │
│  │  页面/组件/Hooks  │                             │ ipcRenderer  │
│  └─────────────────┘                             │              │
│                                                   ▼              │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    Main 进程 (src/process/)               │   │
│  │                                                          │   │
│  │  ┌─────────┐ ┌─────────┐ ┌──────────┐ ┌─────────────┐  │   │
│  │  │ Bridge  │ │ Task    │ │ Services │ │ Channels    │  │   │
│  │  │ (IPC层) │ │ (Agent) │ │ (DB/Cron)│ │ (消息渠道)   │  │   │
│  │  └────┬────┘ └────┬────┘ └─────┬────┘ └──────┬──────┘  │   │
│  │       │           │            │              │          │   │
│  │       └───────────┴────────────┴──────────────┘          │   │
│  └──────────────────────────┬───────────────────────────────┘   │
│                             │ child_process.fork()               │
│                             ▼                                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              Worker 进程 (src/process/worker/)            │   │
│  │  ACP Worker | Codex Worker | Gemini Worker | OpenClaw    │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │          共享代码 (src/common/)                            │   │
│  │  adapter/ | api/ | chat/ | config/ | types/ | platform/  │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

**关键约束**：
- Renderer 进程禁止使用 Node.js API（如 `fs`、`path`）
- Main 进程禁止使用 DOM API（如 `document`、`window`）
- Worker 进程禁止使用 Electron API（如 `app`、`BrowserWindow`）
- 跨进程通信必须通过 Bridge 层（`src/process/bridge/` + `src/preload.ts`）

---

## 3. 根目录文件说明

### 配置文件

| 文件 | 用途 |
|------|------|
| `package.json` | 项目依赖、脚本命令、元数据 |
| `bun.lock` | bun 包管理器锁文件 |
| `tsconfig.json` | TypeScript 编译配置（路径别名 `@/*`、`@process/*`、`@renderer/*`） |
| `electron.vite.config.ts` | electron-vite 构建配置（main/preload/renderer 三入口） |
| `vite.renderer.config.ts` | Renderer 独立 Vite 配置（用于 WebUI 独立构建） |
| `uno.config.ts` | UnoCSS 配置（主题色、语义 token、自定义规则） |
| `vitest.config.ts` | Vitest 测试框架配置 |
| `playwright.config.ts` | Playwright E2E 测试配置 |
| `electron-builder.yml` | electron-builder 打包配置（多平台 dmg/exe/deb） |
| `entitlements.plist` | macOS 签名权限声明 |
| `Dockerfile` | Docker 容器化构建（server 模式） |
| `justfile` | just 命令运行器（类 Makefile，包含构建/发布/版本管理任务） |
| `codecov.yml` | Codecov 代码覆盖率配置 |

### 代码质量

| 文件 | 用途 |
|------|------|
| `.oxlintrc.json` | oxlint 规则配置（替代 ESLint） |
| `.oxfmtrc.json` | oxfmt 格式化配置（替代 Prettier） |
| `.prettierrc.json` | Prettier 配置（兼容旧工具链） |
| `.prettierignore` | Prettier 忽略文件 |
| `.pre-commit-config.yaml` | pre-commit 钩子（lint/format/类型检查） |
| `.gitignore` | Git 忽略规则 |
| `.gitattributes` | Git 文件属性（LF 换行、二进制标记） |
| `.npmrc` | npm/bun 注册表配置 |

### 文档

| 文件 | 用途 |
|------|------|
| `readme.md` | 项目 README（功能介绍、安装指南） |
| `LICENSE` | Apache-2.0 开源协议 |
| `AGENTS.md` | AI Agent 开发指南（代码规范、架构约束） |
| `CLAUDE.md` | Claude Code 配置（指向 AGENTS.md） |

---

## 4. 一级目录说明

```
AionUi-aoqi/
├── src/                 # 核心源码（三进程架构，详见第 5 节）
├── tests/               # 测试代码（unit/integration/e2e/regression）
├── scripts/             # 构建、发布、CI 辅助脚本
├── docs/                # 项目文档（架构、部署、WebUI 指南等）
├── resources/           # 静态资源（应用图标、README 截图/GIF、安装脚本）
├── public/              # PWA 资源（manifest.webmanifest、sw.js、图标）
├── mobile/              # React Native 移动端（独立子项目，有独立 package.json）
├── examples/            # 扩展开发示例（hello-world/飞书/企微/办公等）
├── homebrew/            # macOS Homebrew 分发（Formula 模板）
├── patches/             # npm 依赖补丁（bun patch 机制）
├── .github/             # GitHub CI/CD 工作流 + Issue/PR 模板
├── .claude/             # Claude Code 配置（skills/commands）
├── .gemini/             # Gemini AI 辅助配置
├── .aionui/             # AionUi 自身的功能规格文档
└── .specify/            # Specify 模板和记忆
```

### 各目录详解

#### `scripts/` — 构建与运维脚本

| 文件 | 用途 |
|------|------|
| `build-with-builder.js` | 核心打包脚本（调用 electron-builder） |
| `afterPack.js` | 打包后处理（签名、资源复制） |
| `afterSign.js` | 签名后处理 |
| `build-server.mjs` | 纯 Node.js server 模式构建 |
| `build-mcp-servers.js` | MCP Server 构建 |
| `dev-bootstrap.mjs` | 开发环境启动引导 |
| `postinstall.js` | `bun install` 后置脚本 |
| `prepareBundledBun.js` | 打包内置 bun 运行时 |
| `rebuildNativeModules.js` | 重编译原生模块（better-sqlite3 等） |
| `check-i18n.js` | i18n 键值完整性校验 |
| `generate-i18n-types.js` | 根据 JSON 生成 i18n TypeScript 类型 |
| `packaged-launch.mjs` | 打包后启动脚本 |
| `install-ubuntu.sh` | Ubuntu 安装脚本 |
| `fix-sentry-daemon.sh` | Sentry 错误自动修复守护脚本 |

#### `docs/` — 项目文档

| 路径 | 内容 |
|------|------|
| `docs/tech/architecture.md` | 核心架构文档（四种运行模式图解） |
| `docs/CODE_STYLE.md` | 代码风格指南 |
| `docs/development.md` | 开发环境搭建 |
| `docs/SERVER_DEPLOY_GUIDE.md` | Server 模式部署指南 |
| `docs/WEBUI_GUIDE.md` | WebUI 使用指南 |
| `docs/cdp.md` | Chrome DevTools Protocol 集成 |
| `docs/conventions/` | 文件结构约定 |
| `docs/superpowers/` | 超级能力文档（PPT 生成等） |
| `docs/feature/` | 功能设计文档 |
| `docs/pr/` | PR 流程指南 |

#### `mobile/` — React Native 移动端

独立子项目，有自己的 `package.json`、`bun.lock`、`tsconfig.json`。

```
mobile/
├── app/              # Expo Router 页面
├── src/              # 移动端源码
├── assets/           # 移动端资源
├── scripts/          # 移动端脚本
├── __tests__/        # Jest 测试
├── app.config.ts     # Expo 配置
├── eas.json          # EAS Build 配置
└── metro.config.js   # Metro bundler 配置
```

#### `examples/` — 扩展开发示例

| 目录 | 说明 |
|------|------|
| `hello-world-extension/` | 最基础的扩展示例 |
| `e2e-full-extension/` | 完整功能扩展示例 |
| `acp-adapter-extension/` | ACP 协议适配器扩展 |
| `ext-feishu/` | 飞书集成扩展 |
| `ext-wecom-bot/` | 企业微信机器人扩展 |
| `star-office-extension/` | 星辰办公扩展 |

#### `.github/` — CI/CD

```
.github/
├── workflows/          # GitHub Actions 工作流（构建/测试/发布）
├── actions/            # 自定义 GitHub Actions
├── ISSUE_TEMPLATE/     # Issue 模板
├── pull_request_template.md  # PR 模板
└── CICD_SETUP.md       # CI/CD 配置说明
```

---

## 5. 源码目录深度解析（`src/`）

```
src/
├── index.ts            # Electron 主入口（创建窗口、注册 IPC、启动服务）
├── preload.ts          # Preload 脚本（contextBridge 暴露安全 API 给 Renderer）
├── server.ts           # 纯 Node.js Server 入口（无 Electron 依赖）
├── types.d.ts          # 全局类型声明
├── common/             # 跨进程共享代码
├── process/            # Main 进程代码
└── renderer/           # Renderer 进程代码（React UI）
```

### 5.1 Main 进程 (`src/process/`)

这是应用的"后端"，运行在 Electron 主进程中，拥有完整的 Node.js 能力。

```
src/process/
├── index.ts            # 主进程初始化入口
├── bridge/             # IPC 桥接层 ★ 核心
├── task/               # AI Agent 管理器
├── services/           # 后端服务
├── channels/           # 消息渠道系统
├── extensions/         # 扩展系统
├── worker/             # 子进程 fork 入口
├── webserver/          # Express + WebSocket 服务
├── agent/              # ACP 协议适配器
├── resources/          # 主进程资源
└── utils/              # 主进程工具函数
```

#### `bridge/` — IPC 桥接层（30+ 个文件）

这是 Main 进程与 Renderer 进程之间通信的核心。每个 bridge 文件负责一个功能域：

| Bridge 文件 | 功能域 | 说明 |
|-------------|--------|------|
| `conversationBridge.ts` | 会话管理 | 创建/删除/切换/搜索会话 |
| `acpConversationBridge.ts` | ACP 会话 | ACP 协议下的会话管理 |
| `modelBridge.ts` | 模型管理 | LLM 模型配置、切换、API Key |
| `fsBridge.ts` | 文件系统 | 文件读写、目录操作（最大的 bridge，54KB） |
| `channelBridge.ts` | 渠道管理 | 消息渠道的增删改查 |
| `extensionsBridge.ts` | 扩展管理 | 扩展安装/卸载/配置 |
| `mcpBridge.ts` | MCP 管理 | Model Context Protocol 服务器管理 |
| `updateBridge.ts` | 自动更新 | 检查/下载/安装更新 |
| `systemSettingsBridge.ts` | 系统设置 | 全局设置读写 |
| `databaseBridge.ts` | 数据库 | 数据导入/导出/迁移 |
| `authBridge.ts` | 认证 | WebUI 登录/JWT/密码管理 |
| `webuiBridge.ts` | WebUI | WebUI 服务启停/配置 |
| `applicationBridge.ts` | 应用控制 | 窗口管理、应用信息 |
| `cronBridge.ts` | 定时任务 | Cron 任务的增删改查 |
| `taskBridge.ts` | 后台任务 | Worker 任务状态管理 |
| `pptPreviewBridge.ts` | PPT 预览 | PPT 生成和实时预览 |
| `documentBridge.ts` | 文档操作 | 文档生成/转换 |
| `remoteAgentBridge.ts` | 远程 Agent | OpenClaw 远程 Agent 管理 |
| `starOfficeBridge.ts` | 星辰办公 | 办公套件集成 |
| `shellBridge.ts` | Shell | 打开外部链接/文件 |
| `dialogBridge.ts` | 对话框 | 系统文件选择对话框 |
| `notificationBridge.ts` | 通知 | 系统通知推送 |
| `windowControlsBridge.ts` | 窗口控件 | 最小化/最大化/关闭 |
| `fileWatchBridge.ts` | 文件监听 | 工作区文件变更监听 |
| `bedrockBridge.ts` | Bedrock | AWS Bedrock 集成 |
| `geminiBridge.ts` | Gemini | Google Gemini 配置 |
| `weixinLoginBridge.ts` | 微信登录 | 微信扫码登录 |

#### `task/` — AI Agent 管理器

每个 AI 后端对应一个 AgentManager，继承自 `BaseAgentManager`：

| 文件 | Agent 后端 | 说明 |
|------|-----------|------|
| `AcpAgentManager.ts` | ACP | Agent Communication Protocol（Claude Code 等） |
| `CodexAgentManager.ts` | Codex | OpenAI Codex 集成 |
| `GeminiAgentManager.ts` | Gemini | Google Gemini 原生集成 |
| `OpenClawAgentManager.ts` | OpenClaw | OpenClaw 协议 Agent |
| `RemoteAgentManager.ts` | Remote | 远程 Agent 连接 |
| `NanoBotAgentManager.ts` | NanoBot | 轻量级 Bot |
| `AgentFactory.ts` | - | Agent 工厂（根据类型创建对应 Manager） |
| `BaseAgentManager.ts` | - | 基类（定义公共生命周期） |
| `AcpSkillManager.ts` | - | ACP Skill（技能）管理 |
| `MessageMiddleware.ts` | - | 消息中间件链 |
| `CronCommandDetector.ts` | - | 消息中定时任务命令检测 |
| `ThinkTagDetector.ts` | - | 思维链标签检测 |
| `WorkerTaskManager.ts` | - | Worker 子进程任务调度 |

#### `services/` — 后端服务

| 目录/文件 | 服务 | 说明 |
|-----------|------|------|
| `database/` | 数据库 | SQLite 数据库（schema/migrations/Repository 模式） |
| `database/drivers/` | DB 驱动 | better-sqlite3 + bun:sqlite 双驱动 |
| `cron/` | 定时任务 | CronService + CronBusyGuard + SqliteRepository |
| `conversionService.ts` | 格式转换 | 文档/数据格式转换 |
| `ConversationServiceImpl.ts` | 会话服务 | 会话 CRUD 业务逻辑 |
| `autoUpdaterService.ts` | 自动更新 | electron-updater 封装 |
| `mcpServices/` | MCP | Model Context Protocol 服务管理 |
| `previewHistoryService.ts` | 预览历史 | 文件预览历史记录 |
| `geminiSubscription.ts` | Gemini 订阅 | Gemini 事件订阅管理 |
| `openclawConflictDetector.ts` | 冲突检测 | OpenClaw 配置冲突检测 |
| `i18n/` | 国际化 | 主进程 i18n 服务 |

#### `channels/` — 消息渠道系统

插件化架构，支持多种外部消息平台接入：

```
channels/
├── ARCHITECTURE.md     # 渠道架构文档
├── index.ts            # ChannelManager（渠道管理器）
├── types.ts            # 渠道类型定义
├── core/               # 渠道核心逻辑
├── gateway/            # 消息网关
├── actions/            # 渠道操作
├── agent/              # 渠道 Agent 适配
├── pairing/            # 渠道配对
├── utils/              # 渠道工具
└── plugins/            # 渠道插件 ★
    ├── BasePlugin.ts   # 插件基类
    ├── telegram/       # Telegram Bot
    ├── dingtalk/       # 钉钉机器人
    ├── lark/           # 飞书机器人
    └── weixin/         # 微信
```

#### `extensions/` — 扩展系统

```
extensions/
├── ExtensionRegistry.ts  # 扩展注册表（扫描、注册、管理）
├── ExtensionLoader.ts    # 扩展加载器
├── types.ts              # 扩展类型定义
├── constants.ts          # 扩展常量
├── lifecycle/            # 扩展生命周期管理
├── protocol/             # 扩展通信协议
├── resolvers/            # 扩展解析器（路径、配置）
└── sandbox/              # 扩展沙箱（安全隔离）
```

#### `worker/` — 子进程

通过 `child_process.fork()` 创建的后台进程：

| 文件 | Worker 类型 | 说明 |
|------|------------|------|
| `acp.ts` | ACP Worker | Claude Code 等 ACP 协议后端 |
| `codex.ts` | Codex Worker | OpenAI Codex 后端 |
| `gemini.ts` | Gemini Worker | Gemini 原生后端 |
| `nanobot.ts` | NanoBot Worker | 轻量级 Bot |
| `openclaw-gateway.ts` | OpenClaw Gateway | OpenClaw 网关 |
| `fork/` | fork 工具 | 子进程创建和通信工具 |

#### `webserver/` — Web 服务器

```
webserver/
├── index.ts            # WebServer 启动入口
├── setup.ts            # Express 应用配置
├── adapter.ts          # WebSocket ←→ Bridge 适配器
├── directoryApi.ts     # 文件目录 REST API
├── auth/               # JWT 认证
├── middleware/          # Express 中间件
├── routes/             # REST API 路由
├── config/             # WebServer 配置
├── types/              # 类型定义
└── websocket/          # WebSocket 处理
```

---

### 5.2 Renderer 进程 (`src/renderer/`)

React UI 层，运行在 Electron 的渲染进程或浏览器中。

```
src/renderer/
├── index.html          # HTML 入口
├── main.tsx            # React 应用入口
├── types.d.ts          # Renderer 类型声明
├── pages/              # 页面模块 ★
├── components/         # 共享组件
├── hooks/              # 自定义 Hooks
├── services/           # 前端服务
├── utils/              # 前端工具函数
├── assets/             # 静态资源（字体等）
└── styles/             # 全局样式
```

#### `pages/` — 页面模块

| 目录 | 页面 | 说明 |
|------|------|------|
| `guid/` | 引导页 | 首页/新对话引导、Agent 选择 |
| `conversation/` | 对话页 | 聊天主界面（消息列表、输入框、历史、预览） |
| `settings/` | 设置页 | Agent/模型/显示/工具/Skills/WebUI/扩展等设置 |
| `cron/` | 定时任务页 | Cron 任务管理界面 |
| `login/` | 登录页 | WebUI 登录界面 |

**对话页子模块**（最复杂的页面）：

```
conversation/
├── index.tsx           # 页面入口
├── Messages/           # 消息列表组件
├── GroupedHistory/     # 分组历史记录
├── Preview/            # 文件预览面板
├── Workspace/          # 工作区面板
├── components/         # 对话专属组件
├── hooks/              # 对话专属 Hooks
├── platforms/          # 平台适配（桌面/WebUI/移动端）
└── utils/              # 对话工具函数
```

**设置页子模块**：

```
settings/
├── AgentSettings/      # Agent 后端配置
├── DisplaySettings/    # 显示设置（主题、语言、布局）
├── ToolsSettings/      # 工具配置（MCP、CDP）
├── SkillsHubSettings.tsx  # Skills 市场
├── SystemSettings.tsx  # 系统设置
├── GeminiSettings.tsx  # Gemini 专属设置
├── ExtensionSettingsPage.tsx  # 扩展管理
├── WebuiSettings.tsx   # WebUI 设置
├── AssistantSettings.tsx  # 助手设置
├── ModeSettings.tsx    # 模式设置
└── components/         # 设置页共享组件
```

#### `components/` — 共享组件

| 目录 | 组件类型 | 说明 |
|------|---------|------|
| `Markdown/` | Markdown | Markdown 渲染器 |
| `chat/` | 聊天 | 消息气泡、输入框、工具调用展示 |
| `layout/` | 布局 | 侧边栏、头部、面板布局 |
| `media/` | 媒体 | 图片/视频/文件预览 |
| `agent/` | Agent | Agent 选择器、状态指示器 |
| `settings/` | 设置 | 设置项通用组件 |
| `base/` | 基础 | 按钮、输入框等基础组件封装 |

#### `hooks/` — 自定义 Hooks

| 目录 | 领域 | 示例 |
|------|------|------|
| `agent/` | Agent | useAgent、useAgentStatus |
| `chat/` | 聊天 | useChat、useAutoScroll、useMessages |
| `file/` | 文件 | useFileUpload、useFilePreview |
| `mcp/` | MCP | useMcpServers、useMcpTools |
| `system/` | 系统 | useSystemSettings、useUpdate |
| `ui/` | UI | useTheme、useLayout、useMinimap |
| `context/` | 上下文 | useConversation、useWorkspace |
| `assistant/` | 助手 | useAssistant、usePresetAssistant |

#### `services/` — 前端服务

| 文件 | 服务 | 说明 |
|------|------|------|
| `FileService.ts` | 文件服务 | 文件上传、下载、预览 |
| `PasteService.ts` | 粘贴服务 | 剪贴板内容处理 |
| `i18n/` | 国际化 | 前端 i18n 初始化和管理 |
| `registerPwa.ts` | PWA | Service Worker 注册 |

---

### 5.3 共享代码 (`src/common/`)

可被 Main、Renderer、Server 三方引用的代码：

```
src/common/
├── index.ts              # 导出入口
├── electronSafe.ts       # Electron API 安全封装
├── adapter/              # 跨环境通信适配器 ★
├── api/                  # LLM API 客户端
├── chat/                 # 聊天核心逻辑
├── config/               # 应用配置
├── platform/             # 平台抽象层
├── types/                # 共享类型定义
├── update/               # 更新逻辑
└── utils/                # 通用工具函数
```

#### `adapter/` — 通信适配器（核心）

这是实现多运行模式的关键：

| 文件 | 适配器 | 说明 |
|------|--------|------|
| `ipcBridge.ts` | 核心 | Bridge 注册表 + 消息路由（46KB，最大的文件之一） |
| `main.ts` | Electron | Electron IPC 适配（ipcMain.handle） |
| `browser.ts` | 浏览器 | WebSocket 适配（WebUI 模式） |
| `standalone.ts` | Node.js | 纯 Node.js 适配（server 模式） |
| `registry.ts` | 注册表 | Bridge 处理器注册 |
| `constant.ts` | 常量 | Bridge 事件键名 |

#### `api/` — LLM API 客户端

| 文件 | 说明 |
|------|------|
| `ClientFactory.ts` | API 客户端工厂 |
| `RotatingApiClient.ts` | 多 Key 轮询基类 |
| `OpenAIRotatingClient.ts` | OpenAI 轮询客户端 |
| `AnthropicRotatingClient.ts` | Anthropic 轮询客户端 |
| `GeminiRotatingClient.ts` | Gemini 轮询客户端 |
| `OpenAI2AnthropicConverter.ts` | OpenAI → Anthropic 协议转换 |
| `OpenAI2GeminiConverter.ts` | OpenAI → Gemini 协议转换 |
| `ProtocolConverter.ts` | 协议转换基类 |
| `ApiKeyManager.ts` | API Key 管理（多 Key 轮询） |

#### `config/` — 应用配置

| 文件 | 说明 |
|------|------|
| `storage.ts` | 持久化存储封装（19KB） |
| `storageKeys.ts` | 存储键名常量 |
| `constants.ts` | 全局常量 |
| `appEnv.ts` | 应用环境变量 |
| `i18n.ts` | i18n 配置 |
| `i18n-config.json` | 语言和模块定义 |
| `presets/` | 预设配置（Agent/助手预设） |

#### `platform/` — 平台抽象层

| 文件 | 说明 |
|------|------|
| `IPlatformServices.ts` | 平台服务接口 |
| `ElectronPlatformServices.ts` | Electron 实现 |
| `NodePlatformServices.ts` | Node.js 实现 |
| `register-electron.ts` | Electron 平台注册 |
| `register-node.ts` | Node.js 平台注册 |

---

## 6. 测试结构

```
tests/
├── vitest.setup.ts          # Vitest 全局 setup（Node 环境）
├── vitest.dom.setup.ts      # Vitest DOM setup（jsdom 环境，用于组件测试）
├── unit/                    # 单元测试（125+ 文件）
│   ├── *.test.ts            # 纯逻辑测试
│   ├── *.dom.test.ts        # DOM/组件测试（需要 jsdom）
│   ├── *.dom.test.tsx       # React 组件测试
│   ├── bridge/              # Bridge 层测试
│   ├── channels/            # 渠道系统测试
│   ├── common/              # 共享代码测试
│   ├── extensions/          # 扩展系统测试
│   ├── platform/            # 平台层测试
│   ├── process/             # 主进程测试
│   └── renderer/            # 渲染进程测试
├── integration/             # 集成测试
│   ├── i18n.test.ts         # i18n 完整性测试
│   ├── webui-*.test.ts      # WebUI 功能测试
│   └── bundled-bun-*.test.ts  # 打包 bun 测试
├── e2e/                     # Playwright E2E 测试
│   ├── fixtures.ts          # 测试 fixture
│   ├── helpers/             # 测试辅助函数
│   └── specs/               # 测试用例
└── regression/              # 回归测试
```

### 测试命名约定

| 后缀 | 环境 | 说明 |
|------|------|------|
| `*.test.ts` | Node | 纯逻辑/服务层测试 |
| `*.dom.test.ts` | jsdom | 需要 DOM 但不含 JSX |
| `*.dom.test.tsx` | jsdom | React 组件渲染测试 |
| `*.bun.test.ts` | bun | 需要 bun 运行时的测试 |

### 测试与源码对照

| 测试文件 | 对应源码 |
|---------|---------|
| `conversationBridge.test.ts` | `src/process/bridge/conversationBridge.ts` |
| `AcpAgentManager*.test.ts` | `src/process/task/AcpAgentManager.ts` |
| `cronService.test.ts` | `src/process/services/cron/CronService.ts` |
| `fsBridge.skills.test.ts` | `src/process/bridge/fsBridge.ts` |
| `RemoteAgentCore.test.ts` | `src/process/task/RemoteAgentManager.ts` |
| `extensionsBridge.test.ts` | `src/process/bridge/extensionsBridge.ts` |
| `chatLayoutHooks.dom.test.ts` | `src/renderer/hooks/chat/` |
| `guidAgentHooks.dom.test.ts` | `src/renderer/pages/guid/hooks/` |
| `SkillsHubSettings.dom.test.tsx` | `src/renderer/pages/settings/SkillsHubSettings.tsx` |

---

## 7. 二次开发速查表

### 场景 → 修改位置

| 想做什么 | 需要改哪里 | 备注 |
|---------|-----------|------|
| **添加新 AI Agent 后端** | `src/process/task/` 新增 XxxAgentManager | 继承 BaseAgentManager，注册到 AgentFactory |
| **添加新 Worker** | `src/process/worker/` 新增入口文件 | 同时修改 WorkerTaskManager |
| **修改聊天界面** | `src/renderer/pages/conversation/` | Messages/组件/Hooks |
| **添加新设置页** | `src/renderer/pages/settings/` | 同时在 SettingsPage 注册路由 |
| **添加新页面** | `src/renderer/pages/` 新增目录 | 在 main.tsx 注册路由 |
| **添加新 IPC 能力** | 1. `src/process/bridge/` 新增 bridge | 2. `src/preload.ts` 暴露 API |
| | 3. `src/common/adapter/ipcBridge.ts` 注册 | 三步缺一不可 |
| **添加新消息渠道** | `src/process/channels/plugins/` | 继承 BasePlugin |
| **添加新扩展** | 参考 `examples/hello-world-extension/` | 通过 ExtensionRegistry 注册 |
| **修改数据库** | `src/process/services/database/` | 修改 schema.ts + 新增 migration |
| **添加新 REST API** | `src/process/webserver/routes/` | WebUI/Server 模式可用 |
| **添加新 LLM 协议** | `src/common/api/` | 参考现有 Converter/Client |
| **修改主题/样式** | `uno.config.ts` + `src/renderer/styles/` | 语义 token 在 uno.config.ts 定义 |
| **添加国际化文本** | `src/common/config/i18n-config.json` | 运行 `bun run i18n:types` 生成类型 |
| **修改应用图标** | `resources/app.icns` / `app.ico` / `app.png` | 同时更新 electron-builder.yml |
| **修改自动更新** | `src/process/services/autoUpdaterService.ts` | + updateBridge.ts |
| **修改 PPT 生成** | `src/process/bridge/pptPreviewBridge.ts` | + 对应 Renderer 预览组件 |

### 数据流路径示例

**用户发送消息到 AI** 的完整链路：

```
Renderer (SendBox)
  └─▶ Hook (useChat / useGuidSend)
      └─▶ Bridge 调用 (electronAPI.emit)
          └─▶ Preload (ipcRenderer.invoke)
              └─▶ Main (ipcBridge 路由)
                  └─▶ conversationBridge / acpConversationBridge
                      └─▶ AgentManager (ACP/Codex/Gemini)
                          └─▶ Worker (fork 子进程)
                              └─▶ AI 后端 API
```

**WebUI 模式下**（替换前三步）：

```
浏览器 (React)
  └─▶ WebSocket 发送
      └─▶ webserver/adapter.ts (WebSocket → Bridge)
          └─▶ 同上 (Main 进程 Bridge 链路)
```

---

## 8. 开发命令速查

### 日常开发

```bash
bun start              # 启动 Electron 桌面端（开发模式）
bun run webui          # 启动 WebUI 模式（Electron 无窗口 + 浏览器）
bun run webui:remote   # 启动远程 WebUI（允许局域网访问）
```

### 构建

```bash
bun run package        # 仅构建（不打包安装器）
bun run dist:mac       # 打包 macOS 安装器
bun run dist:win       # 打包 Windows 安装器
bun run dist:linux     # 打包 Linux 安装器
```

### 测试

```bash
bun run test           # 运行所有单元测试
bun run test:watch     # 监听模式
bun run test:coverage  # 运行测试 + 覆盖率报告
bun run test:integration  # 集成测试
bun run test:e2e       # Playwright E2E 测试
```

### 代码质量

```bash
bun run lint           # 检查 lint 问题
bun run lint:fix       # 自动修复 lint
bun run format         # 自动格式化
bun run format:check   # 检查格式（不修改）
bunx tsc --noEmit      # TypeScript 类型检查
```

### 国际化

```bash
bun run i18n:types     # 从 JSON 生成 TypeScript 类型
node scripts/check-i18n.js  # 检查 i18n 键完整性
```

### Server 模式

```bash
bun run server:start         # 启动开发服务器（仅本机）
bun run server:start:remote  # 启动开发服务器（允许远程）
bun run server:start:prod    # 生产模式
```

---

## 9. 路径别名

在 `tsconfig.json` 中配置了以下路径别名，代码中直接使用：

| 别名 | 实际路径 | 说明 |
|------|---------|------|
| `@/*` | `src/*` | 项目根 src |
| `@process/*` | `src/process/*` | Main 进程 |
| `@renderer/*` | `src/renderer/*` | Renderer 进程 |
| `@worker/*` | `src/process/worker/*` | Worker 进程 |

---

## 10. 关键设计模式

| 模式 | 应用位置 | 说明 |
|------|---------|------|
| **Bridge 模式** | `src/process/bridge/` | 所有跨进程通信都通过 Bridge 抽象 |
| **工厂模式** | `AgentFactory.ts`, `ClientFactory.ts` | 根据类型创建对应实例 |
| **插件模式** | `channels/plugins/`, `extensions/` | 可插拔的渠道和扩展系统 |
| **Repository 模式** | `services/database/` | 数据访问层抽象（Interface + Sqlite 实现） |
| **单例模式** | `*Singleton.ts` 文件 | 服务实例的全局单例管理 |
| **适配器模式** | `common/adapter/` | 屏蔽 Electron/Browser/Node 环境差异 |
| **中间件模式** | `MessageMiddleware.ts`, `webserver/middleware/` | 消息处理链和 HTTP 中间件 |
| **平台抽象** | `common/platform/` | IPlatformServices 接口 + 多平台实现 |
