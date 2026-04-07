# Rules

本文件记录仓库内长期有效的执行规则，所有智能体在执行任务前必须读取并遵守。

## 项目定位规则

- 对外定位统一写为：`智能体工厂 / Agent Factory` 是基于 Factory Droid 深度定制的智能体工作平台
- 主智能体交互主链路统一写为：`src/process/agent/droid/` → `@factory/droid-sdk` → Factory Droid
- 其他 ACP / 多后端能力默认表述为兼容层或历史能力，除非任务明确讨论这些后端
- 涉及 Factory CLI、Droid SDK、skills、MCP、hooks、settings、BYOK 等能力时，优先查以下直链：
  - https://github.com/Factory-AI/droid-sdk-typescript/blob/main/README.md
  - https://docs.factory.ai/llms.txt
- 文档中涉及真实命令、包名、安装包名、仓库路径时，可保留 `AionUi` 技术标识；不要为了品牌统一而改坏真实命令或路径
- 新增或重写系统提示词、规则、记忆、架构说明时，同步维持上述主叙事与直链

## 通用规则

- 修改代码前先理解现有代码结构和约定，不要盲目动手
- 遵循仓库已有的技术栈、依赖库和设计模式，不擅自引入新依赖
- 每次变更尽量最小化影响范围，只改必要的部分
- 不在代码、日志或配置中暴露密钥、凭证等敏感信息
- 提交前确保 lint、格式化、类型检查和测试全部通过
- 代码注释用英文，保持简洁，只在必要时添加
- 不自动修改文档或 README，除非用户明确要求
- 遇到不确定的决策时，先向用户确认再执行
- 变更完成后给出简短总结，不做多余分析

## 代码质量规则

- UI 组件只用 `@arco-design/web-react`，禁止裸写 `<button>`/`<input>`/`<select>` 等交互元素
- 图标只用 `@icon-park/react`，不引入其他图标库
- CSS 颜色必须用语义化 token（`uno.config.ts` 或 CSS 变量），禁止硬编码色值
- TypeScript 严格模式：禁止 `any`、禁止隐式返回；优先用 `type` 而非 `interface`
- 使用路径别名 `@/*`、`@process/*`、`@renderer/*`、`@worker/*`
- 用户可见文本必须走 i18n（`src/common/config/i18n-config.json`），禁止硬编码字符串

## 进程隔离规则

- `src/process/` — 主进程，禁止 DOM API
- `src/renderer/` — 渲染进程，禁止 Node.js API
- `src/process/worker/` — Worker 进程，禁止 Electron API
- 跨进程通信必须走 IPC bridge（`src/preload.ts`）

## Git 与分支规则

- Commit 格式：`<type>(<scope>): <subject>`，英文书写
- 禁止 AI 签名（Co-Authored-By、Generated with 等）
- `upstream-sync` 分支 = upstream/main 纯净镜像，仅用于同步和代码对比，禁止在此分支上做自定义修改
- `dev` 分支 = 全集开发分支，所有自定义开发在此进行
- 同步流程：先在 `upstream-sync` 上 fetch + merge upstream/main，再切到 `dev` 执行 merge upstream-sync

## Paper 原型协作规则

- 构建任何页面前，必须先读对应的 `.tsx` + `.css` 源文件，提取真实布局/间距/颜色，**禁止凭印象简化或用占位符代替**
- 图标必须从 `node_modules/@icon-park/react/es/icons/*.js` 提取真实 SVG path，不得省略或用 emoji 替代
- 布局中 Sidebar + Content 结构：**先插入 Sidebar 子节点，再插入 Content 子节点**，确保左右顺序正确
- 删除画板/节点前必须确认，Paper 中删除不可撤销
- 原型的最终目的是**双向同步**（设计即代码），所有画板必须与实际 App UI 高保真对应
- Settings 子页面统一复用 clone 模式：复制 About 页 → 修改 sidebar 高亮 → 替换 content 区域
- 颜色硬编码值来源：`src/renderer/styles/themes/default-color-scheme.css`，Light Mode 为默认
- 每个画板对应一个可导航的 App 路由（参照 `Router.tsx`），确保路由全覆盖、无遗漏
- 涉及 Paper 原型与代码同步时，**必须调用 `paper-sync` 技能**（`/paper-sync`），不要手动执行同步流程
- design→code 同步（Paper 改了 → 更新代码）：**必须先展示 diff 给用户确认，确认后再应用**，禁止自动修改代码
- code→design 同步（代码改了 → 更新 Paper）：可直接通过 Paper MCP 更新，完成后报告变更

## Droid SDK 集成规则

- Factory Droid + SDK 是项目的首要 Agent 集成路径
- droid 后端走 `@factory/droid-sdk`（JSON-RPC），其他后端走 ACP 协议，互不影响
- DroidSdkAgent 发出的 `agent_status` 事件 data 必须包含 `{ backend: 'droid', status }` 字段，否则前端 `MessageAgentStatus` 组件会崩溃
- SDK 内部工作状态（`idle`/`streaming_assistant_message`/`executing_tool` 等）不应作为 `agent_status` 发给前端，前端只认 `connecting`/`connected`/`error` 等状态
- `agent_status` 类型的消息不应持久化到 DB（避免历史消息中出现状态 badge）
- 模型切换用 `session.updateSettings({ modelId })`，禁止用 `-m` 启动参数 hack
- `handleStreamEvent()` 方法是 AcpAgent 和 DroidSdkAgent 的共享事件管道，修改时需兼顾两种后端

## 协作规则

- 当用户说 **"记住这个规矩"** 时，将新规则以条目形式追加到本文件的相应章节
- 规则条目保持简洁、可执行，避免模糊表述
- 新增规则不得与已有规则矛盾；如需覆盖旧规则，标注替代关系
