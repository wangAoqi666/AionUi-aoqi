# 智能体工厂 / Agent Factory

> 基于 Factory Droid 深度定制的智能体工作平台（内部仓库）

---

## 项目概述

Agent Factory 是一个跨平台桌面应用（Electron），集成多种 AI Agent 后端，提供统一的对话、任务执行和自动化工作流界面。

**核心能力：**

- 内置 Agent 引擎，零配置即可使用
- 多 Agent 并行（Claude Code、Codex、Qwen Code、OpenClaw 等 12+ 后端）
- BYOK（Bring Your Own Key）支持 20+ AI 平台
- Mission 模式 — 多智能体协同任务分解与执行
- MCP 工具统一管理（list/add/remove/enable/disable + OAuth）
- WebUI 远程访问 + Telegram / 飞书 / 钉钉 Channel
- Cron 定时任务 — 24/7 无人值守
- 内置 Office 助手（PPT / Word / Excel）

---

## 技术架构

```
src/
├── process/          # 主进程（Node.js）
│   ├── agent/droid/  # Factory Droid SDK 对接（主链路）
│   ├── task/         # AcpAgentManager — 会话管理
│   ├── services/     # DB、MCP、配置等服务
│   └── worker/       # Fork 子进程
├── renderer/         # 渲染进程（React）
│   ├── pages/        # 页面模块
│   ├── components/   # 共享组件
│   └── hooks/        # React Hooks
├── preload.ts        # IPC 桥
└── common/           # 跨进程共享类型和工具
```

**主链路：** `src/process/agent/droid/` → `@factory/droid-sdk` → Factory Droid CLI

---

## 开发环境

### 前置要求

- Node.js 20+
- Bun 1.3+
- macOS 10.15+ / Windows 10+ / Linux

### 启动开发

```bash
# 安装依赖
bun install

# 启动开发环境（electron-vite dev）
bun run start

# 类型检查
bunx tsc --noEmit

# Lint + 格式化
bun run lint:fix
bun run format
```

### 构建

```bash
# macOS
bun run build-mac

# Windows
bun run build-win

# Linux
bun run build-deb
```

### 测试

```bash
bun run test
```

---

## 代码规范

- **组件** PascalCase，**工具函数** camelCase，**hooks** `use` 前缀
- UI 库：`@arco-design/web-react`，图标：`@icon-park/react`
- 样式：UnoCSS 优先，复杂样式用 CSS Modules
- TypeScript strict 模式，禁止 `any`
- 路径别名：`@/*`、`@process/*`、`@renderer/*`
- Commit 格式：`<type>(<scope>): <subject>`（英文）

详见 [AGENTS.md](./AGENTS.md) 和 [docs/conventions/](./docs/conventions/)。

---

## 相关链接

- 上游开源仓库：[iOfficeAI/AionUi](https://github.com/iOfficeAI/AionUi)
- Factory Droid SDK：[@factory/droid-sdk](https://github.com/Factory-AI/droid-sdk-typescript)
- Factory 文档：[docs.factory.ai](https://docs.factory.ai/llms.txt)

---

## License

[Apache-2.0](LICENSE)
