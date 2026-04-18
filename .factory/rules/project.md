# Rules

本文件记录仓库内长期有效的执行规则，所有智能体在执行任务前必须读取并遵守。

## 项目定位规则

- 对外定位统一写为：`智能体工厂 / Agent Factory` 是基于 Factory Droid 深度定制的智能体工作平台
- 主智能体交互主链路统一写为：`src/process/agent/droid/` → `@factory/droid-sdk` → Factory Droid
- 其他 ACP / 多后端能力默认表述为兼容层或历史能力，除非任务明确讨论这些后端
- UI 中左上角主品牌图标是本软件 Logo；会话、消息、历史列表里表示调用 Agent Factory 的图标是 Factory Logo；两者不是同一个图标，禁止混用
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

## 桌面端自动化测试规则

- 用户要求验证桌面端 UI / 交互时，优先直接连接正在运行的 Electron 应用 CDP（开发环境默认 `127.0.0.1:9230`），优先使用 `agent-browser` 操作桌面端；除非用户明确要求 Web 验证，不优先退回只测 `localhost` 页面
- 开始交互前先执行一次 `agent-browser screenshot --annotate` 和 `agent-browser snapshot -i -C`；每次导航、弹层变化或流式更新后都要重新抓取，避免继续使用过期 ref
- 输入框先尝试 `fill`；若超时或被遮挡，改用 `focus + keyboard inserttext`；点击被遮挡时先 `press Escape` 再重新抓取 refs
- 测试结论必须附带可核对证据（截图路径、snapshot 结果、关键 ref 或关键文案），不能只口头说“已验证”
- 同一轮桌面端自动化测试避免混用多个 CDP 控制器；已使用 `agent-browser` 时，不同时用 chrome-devtools / Playwright 抢同一窗口，除非任务明确需要

## 后端集成测试规则（优先走后台脚本）

- **验证后端能力（BYOK、proxy、SDK 调用、env 注入、配置读写等）时，优先写独立 Node.js / TS 脚本直接走完整调用链，不要盲目拉起 Electron GUI 让用户手点**；GUI 只在真的要验证 UI 交互时才启动
- 测试脚本可直接读取本地配置文件走真实链路：
  - Dev 配置：`~/Library/Application Support/AionUi-Dev/config/aionui-config.txt`
  - Prod 配置：`~/Library/Application Support/AionUi/config/aionui-config.txt`
  - 格式：`base64(encodeURIComponent(JSON))`；解码用 `decodeURIComponent(Buffer.from(raw, 'base64').toString('utf-8'))`
- 测试脚本必须**内联或复刻项目里对应辅助函数的匹配逻辑**（如 `buildProxyCatalogModelId`、`resolveSessionModelId`、`getDroidByokProxyEnv`），确保脚本侧和业务代码走同一套推导，不要临时简化
- 涉及 Droid / Factory SDK 链路时，用 `node_modules/@factory/droid-sdk/dist/index.js` 直接 `import { createSession }`，`execPath` 用 `which droid` 的路径，`env` 合并 `process.env` + 要验证的注入变量
- 测试脚本输出必须打印关键中间值，便于用户复核：catalog modelId、resolveSessionModelId 剥离结果、BASE_URL、AUTH_TOKEN **脱敏后前缀+后缀**（如 `sk-ant-xxx...xxx`）、可用模型列表
- 端到端验证要覆盖两层：(1) 静态匹配 —— env 构造是否正确；(2) 动态回路 —— `session.stream()` 发送一条真实消息，确认收到 `assistant_text_delta` + `turn_complete`
- 测试脚本默认放到 `/tmp/`，用完清理；不要留在项目目录污染 git status
- 禁止在测试脚本里明文打印完整 apiKey、secret、token，必须脱敏
- 测试结论附带实测证据（消息类型序列、sessionId、可用模型数量、回复内容），不能只口头说"已验证"

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
- `@factory/droid-sdk` 的工作方式是：拉起本地 `droid` CLI 子进程并通过 JSON-RPC 通信，不是直接请求某个模型 HTTP API；分析或修改集成链路时必须按 `SDK → CLI → 流式事件` 的模型理解
- 多轮 Droid 会话统一使用 `createSession` / `resumeSession` + `session.stream()` 事件流；涉及渲染或状态同步时，优先围绕 `assistant_text_delta`、`tool_use`、`tool_result`、`turn_complete` 等事件做映射，不能假设一次性返回完整文本
- Droid session 自带上下文与 workspace 绑定；当工作目录、会话绑定或迁移目标发生变化时，必须清理旧 `sessionId` 与相关运行态，禁止在新 workspace 上复用旧 session
- DroidSdkAgent 发出的 `agent_status` 事件 data 必须包含 `{ backend: 'droid', status }` 字段，否则前端 `MessageAgentStatus` 组件会崩溃
- SDK 内部工作状态（`idle`/`streaming_assistant_message`/`executing_tool` 等）不应作为 `agent_status` 发给前端，前端只认 `connecting`/`connected`/`error` 等状态
- `agent_status` 类型的消息不应持久化到 DB（避免历史消息中出现状态 badge）
- 模型切换用 `session.updateSettings({ modelId })`，禁止用 `-m` 启动参数 hack
- `handleStreamEvent()` 方法是 AcpAgent 和 DroidSdkAgent 的共享事件管道，修改时需兼顾两种后端

## 打包构建规则

- 当前项目版本策略已重置：因做了大改，版本号从 `0.1.0` 重新开始计算，禁止继续沿用历史 `1.9.x` 版本线
- 版本显示、运行时版本、安装包文件名、自动更新元数据等所有对内对外版本来源，统一以根目录 `package.json#version` 为唯一基准；除非用户明确要求，不要再额外推导或回退到旧版本号
- macOS 上构建 Windows NSIS 安装包时，`7zip-bin` 自带的 p7zip 16.02 会把 `.7z` 格式的归档文件错误地生成为 ZIP 格式，导致 NSIS `Nsis7z::Extract` 静默解压失败、安装后只有卸载器没有主程序
- 修复已固化在 `scripts/build-with-builder.js` 开头的 7zip-bin wrapper：`.7z` 输出走系统 `7za`，`.zip` 输出走系统 `zip`
- 构建 macOS 主机上的 Windows 包前，必须确保 Homebrew `p7zip` 已安装（`brew install p7zip`），否则 `.7z` 归档可能退回到有问题的 bundled binary
- 每次 `bun install` / `npm install` 后 `node_modules/7zip-bin/index.js` 会被覆盖，build script 的 wrapper 会在每次构建时重新写入，无需手动干预
- `electron-builder.yml` 顶层 `executableName` 和 `win.executableName` 都会影响 NSIS 的 `PRODUCT_FILENAME` 变量，确保它们一致或只保留平台特定配置
- Windows 安装包产物校验必须包含 7z 格式检查：提取内嵌 `app-64.7z`，用 `file` 命令确认为 `7-zip archive data`，不能是 `Zip archive data`

## 协作规则

- 当用户说 **"记住这个规矩"** 时，将新规则以条目形式追加到本文件的相应章节
- 规则条目保持简洁、可执行，避免模糊表述
- 新增规则不得与已有规则矛盾；如需覆盖旧规则，标注替代关系
