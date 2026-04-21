# Memory

本文件记录仓库相关的长期偏好、背景信息和上下文，供智能体在每次任务开始时读取。

## 用户偏好

- 用户主要用中文沟通，代码注释和 commit message 用英文
- 回复保持简洁，不做多余分析
- 用户特别强调：左上角主品牌图标是软件 Logo；会话、消息、历史列表里表示调用 Agent Factory 的小图标是 Factory Logo；两者不是同一个图标，后续设计和实现必须严格区分
- 用户已明确纠正过一次：左上角品牌位只能使用软件 Logo，不能再误用 Factory Droid / Agent Factory 的 agent logo；后续凡是改品牌位，先判断这是“软件 Logo”还是“Factory/agent Logo”
- 用户希望做桌面端测试时优先直接操作运行中的 Electron 应用，不要只在浏览器 WebUI 上做替代验证
- 用户已明确要求：这个项目因大改后版本号要从 `0.1.0` 重新开始，后续版本显示、运行时版本、打包产物和更新元数据都必须以这条新版本线为准，不再沿用历史 `1.9.x`

## 项目背景

- 智能体工厂 / Agent Factory — 基于 Factory Droid 深度定制的智能体工作平台
- 主智能体交互链路：`src/process/agent/droid/` → `@factory/droid-sdk` → Factory Droid
- 当前版本 v0.1.0，License: Apache-2.0
- 三进程架构：main（`src/process/`）/ renderer（`src/renderer/`）/ worker（`src/process/worker/`）
- 技术栈：Electron + Vite + React + TypeScript + UnoCSS + Arco Design + Vitest
- 包管理器：bun
- Lint：oxlint；格式化：oxfmt
- 本仓库（`wangAoqi666/AionUi-aoqi`）是 `iOfficeAI/AionUi` 的 fork；当前品牌已切换为 Agent Factory，但部分技术标识仍保留 `AionUi`
- 分支策略：`upstream-sync` = upstream 纯净镜像；`dev` = 全集开发分支
- 其他 ACP / 多后端能力继续保留，但定位为兼容层

## 技术决策记录

- CSS 方案：UnoCSS 优先，复杂样式用 CSS Modules（`ComponentName.module.css`）
- 组件库：Arco Design Web React（`@arco-design/web-react`）
- 图标库：Icon Park React（`@icon-park/react`）
- 测试框架：Vitest 4，覆盖率目标 >= 80%
- i18n 配置入口：`src/common/config/i18n-config.json`

### 品牌重塑

- 项目已从 AionUi 重命名为"智能体工厂"（Agent Factory）
- 用户可见文本 → "智能体工厂"；版权头 → "Copyright 2025 Agent Factory"
- 原作者 GitHub/Twitter 链接已全部移除或隐藏
- SkillsMarketBanner 已注释掉，QuickActionButtons 只保留 WebUI 按钮

### Factory Droid SDK 集成

- Factory Droid 是项目当前的首要 Agent 后端
- Droid 后端已从 ACP 协议切换为 `@factory/droid-sdk`（JSON-RPC 原生协议）
- 代码位置：`src/process/agent/droid/`（DroidSdkAgent + messageMapper）
- 其他后端（claude/codex/goose 等）仍走 ACP 协议不受影响
- 模型切换使用 SDK `session.updateSettings({ modelId })` 运行时生效，不再需要重启进程
- Factory 模型列表硬编码在 `src/common/config/factoryModels.ts`（18 个模型）
- 默认模型：`claude-opus-4-6`，默认 agent：`droid`
- Settings 默认路由：`/settings/agent`（已移除 Gemini CLI Tab）
- 官方参考直链：
  - https://github.com/Factory-AI/droid-sdk-typescript/blob/main/README.md
  - https://docs.factory.ai/llms.txt

### 桌面端自动化测试

- 开发环境启动后，常用端口是：renderer `http://localhost:5173`、WebUI `http://localhost:25809`、Electron CDP `http://127.0.0.1:9230`
- 桌面端 UI 验证优先使用 `agent-browser connect 9230` 直连 Electron，而不是先退回到纯浏览器页面
- 稳定的取证顺序是：`agent-browser screenshot --annotate` → `agent-browser snapshot -i -C` → 交互 → `wait` → 再次截图和快照
- `snapshot -i -C` 对这个项目很重要，因为它能把带 `onclick` / `cursor:pointer` 的壳层元素一起抓出来
- 输入框 `fill` 失败时，常用回退方案是 `focus + keyboard inserttext`；点击被遮挡时，先 `press Escape` 再重新抓 refs
- 该工作流已沉淀为项目技能：`.factory/skills/desktop-app-testing/SKILL.md`

### 任务参考文档索引

- 核心上下文：
  - [AGENTS.md](../AGENTS.md)
  - [CLAUDE.md](../CLAUDE.md)
  - [RULES.md](./RULES.md)
  - [PROJECT_GUIDE.md](../PROJECT_GUIDE.md)
- 架构与规范：
  - [docs/tech/architecture.md](../docs/tech/architecture.md)
  - [docs/conventions/file-structure.md](../docs/conventions/file-structure.md)
  - [docs/development.md](../docs/development.md)
- 运行与调试：
  - [docs/cdp.md](../docs/cdp.md)
  - [docs/WEBUI_GUIDE.md](../docs/WEBUI_GUIDE.md)
  - [docs/SERVER_DEPLOY_GUIDE.md](../docs/SERVER_DEPLOY_GUIDE.md)
- 外部官方资料：
  - https://github.com/Factory-AI/droid-sdk-typescript/blob/main/README.md
  - https://docs.factory.ai/llms.txt
- 智能体在执行与 Factory Droid、SDK、架构、运行模式、调试、部署相关任务时，应优先查阅以上文档

### CHANGELOG 约定

- 项目使用根目录 `CHANGELOG.md` 记录版本变更
- 中文编写，按版本号分节，包含日期
- 分类：Bug Fixes / New Features / Breaking Changes
- 每条简洁描述修改内容和根因

## 常见陷阱与注意事项

- macOS 环境已配置 Clash 代理（127.0.0.1:7890），git 全局 HTTPS 代理已设置
- 禁止设置 `http.version=HTTP/1.1`，会导致代理下 git 协议握手卡死
- 大仓库 clone 不稳定时优先用 `wget` 下载 ZIP
- 含中文文件名的 ZIP 用 `python3 zipfile` 解压，不用 `unzip`
- **nvm 在后台子 shell / fireAndForget 中不可用**：`source ~/.nvm/nvm.sh && nvm use` 在后台进程中会失败（找不到已安装的版本）。必须用绝对路径设置 PATH：`export PATH="/Users/wayz/.nvm/versions/node/v22.20.0/bin:$PATH"`，不要再用 `nvm use`

### 打包加速：跳过不必要的网络下载（2026-04-21 确认）

- **三个下载大户**（默认都会跑，国内网络下每次加起来好几分钟）：
  1. `prepareHubResources.js` — 从 GitHub/jsDelivr 抓 13 个扩展 zip，大多 404，每个失败要重试 2 次镜像。跳过开关：`AIONUI_HUB_SKIP=1`
  2. `prepareBundledDroid.js` — 从 npm 抓 `@factory/droid-*` 平台二进制。**项目已决定不再内置 Droid CLI**。跳过开关：`AIONUI_SKIP_DROID_BUNDLE=1`
  3. `prepareAionrs.js` — 从 GitHub Releases 抓 Rust CLI。macOS 上还有 SSL cert 问题容易失败。跳过开关：`AIONUI_SKIP_AIONRS=1`
- **bun runtime 已有持久缓存**：`~/Library/Caches/AionUi/bundled-bun/<version>/<platform-arch>/`，重复构建直接命中，不需要 skip
- **默认打包命令（推荐日常使用）**：
  - `bun run build-win:x64:fast`
  - `bun run build-win:arm64:fast`
  - `bun run build-mac:x64:fast`
  - `bun run build-mac:arm64:fast`
- 这四个 `:fast` 变体在 `package.json` 里已预置 `AIONUI_HUB_SKIP=1 AIONUI_SKIP_DROID_BUNDLE=1 AIONUI_SKIP_AIONRS=1`（通过 cross-env），直接用即可。正式发布时若需要重新抓 hub/droid 再回退到非 `:fast` 版本
- `prepareBundledDroid` 和 `prepareHubResources` 都会在运行开头 `removeDirectorySafe(targetDir)` 清空本地产物再重新下载，所以本地已存在也没用，**必须靠 skip 开关**才能跳过

### Windows NSIS 安装包 7z 格式陷阱（2026-04 确认）

- **根因**：`7zip-bin` npm 包的 macOS wrapper 把所有 `7za a` 调用重定向到系统 `zip`，导致 NSIS 内嵌的 `app-64.7z` 实际是 ZIP 格式，`Nsis7z::Extract` 静默失败，安装后只剩卸载器
- **修复**：`scripts/build-with-builder.js` 开头写了 v2 wrapper，按输出扩展名分流：`.7z` → 系统 `7za`（合法 7z），`.zip` → 系统 `zip`（保留 symlink 修复）
- **前置**：构建机需 `brew install p7zip`（p7zip 17.x 才能在 ARM64 Mac 上正确生成 7z）
- **验证**：构建后提取 `app-64.7z`，`file` 命令必须显示 `7-zip archive data`，不能是 `Zip archive data`
- **体积对比**：修复后 224MB（7z 压缩）vs 修复前 355MB（zip 压缩），减少 37%

## Paper 原型状态

- Paper 原型用途：**双向同步**，设计即代码，作为前端开发工具直接指导 UI 实现
- 当前 31 个画板，覆盖 Login / Guid / Conversation / Settings / Team / Cron 全部页面
- Settings 侧栏 10 项顺序（与 BUILTIN_TAB_IDS 对应）：gemini → agent → model → assistants → skills-hub → tools → display → webui → system → about
- Settings 子页面 clone 模式：从 Page-Settings-About (IQ-0) 复制，sidebar 高亮项通过 backgroundColor: "#E5E7F0" 控制
- 高亮色: `#E5E7F0`（aou-2），非高亮: transparent
- 缺失页面需补全后原型才算完整（参照 Router.tsx 路由表）

## Paper 双向同步技能

- 技能位置：`.factory/skills/paper-sync/SKILL.md`（项目级）
- 映射数据：`docs/paper-sync-map.json`（记录 Paper 节点 ↔ 代码位置的对应关系）
- 同步脚本：`scripts/sync-code-to-design.ts`（检测代码→设计差异）、`scripts/sync-design-to-code.ts`（检测设计→代码差异）
- 支持 4 种模式：code→design / design→code / add-mapping / status
- 用户在 Paper UI 上修改后，说"同步"即触发 design→code 流程
- 同步节点通过 `@sync:` 前缀的 layer-name 标注

---

> 当用户说 **"记住这点"** 时，将新记忆以条目形式追加到本文件的相应章节。
> 如果不确定归入哪个章节，追加到「用户偏好」。
