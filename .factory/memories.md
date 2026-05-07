# Memory

本文件记录仓库相关的长期偏好、背景信息和上下文，供智能体在每次任务开始时读取。

## 用户偏好

- 用户主要用中文沟通，代码注释和 commit message 用英文
- 回复保持简洁，不做多余分析
- 用户特别强调：左上角主品牌图标是软件 Logo；会话、消息、历史列表里表示调用 Agent Factory 的小图标是 Factory Logo；两者不是同一个图标，后续设计和实现必须严格区分
- 用户已明确纠正过一次：左上角品牌位只能使用软件 Logo，不能再误用 Factory Droid / Agent Factory 的 agent logo；后续凡是改品牌位，先判断这是“软件 Logo”还是“Factory/agent Logo”
- 用户希望做桌面端测试时优先直接操作运行中的 Electron 应用，不要只在浏览器 WebUI 上做替代验证
- 用户已明确要求：这个项目因大改后版本号要从 `0.1.0` 重新开始，后续版本显示、运行时版本、打包产物和更新元数据都必须以这条新版本线为准，不再沿用历史 `1.9.x`
- 每次打 Windows/Mac 安装包之前，必须先更新 package.json 的小版本号（patch bump），确保每次打包产出都有新版本号

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

### BYOK 模型 ID 教训（2026-04-24 确认）

- **根因**：`rebuildDroidCatalogFromRefs` 用内部 sha1 ref id 作为 `FactoryModel.id` 写入运行时目录，而 CLI 用 `custom:<displayName>[-N]` 格式。两套 id 永远不相等，导致：(1) UI 模型选择器显示 sha1 hash 而非模型名；(2) 新会话首条消息发送 sha1 给 CLI 被返回 400 "Invalid model ID"；(3) `AcpAgentManager` 发现 sha1 不在 `availableModels` 中就清除 `persistedModelId` 回退到默认模型
- **第一次修复尝试失败**：用 `custom:<displayName>`（无后缀）合成 id 仍然不对，因为 CLI 可能追加 `-2`、`-3` 等去重后缀，合成的 id 依然不匹配
- **正确修复**：`rebuildDroidCatalogFromRefs` 只做 prune（按 `(provider, sourceModelId)` 元组匹配决定保留/删除），绝不 synthesize 新条目。CLI probe 是 `FactoryModel.id` 的唯一权威来源
- **连带修复**：BYOK CRUD 后 renderer 侧 `AcpModelSelector` 的 `availableModels` 列表没有跟着刷新，导致新增模型不出现在对话页下拉框里。修复方式：监听 `factoryCatalog` 变化时从最新目录重建 `modelInfo`

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

### 打包前必须先验证网络环境（2026-04-23 确认）

- **规则**：每次执行打包前，必须先验证网络连通性，确认能访问所有必需的外部下载源，验证通过后再启动构建。不能直接开始打包再事后处理网络失败
- **验证清单**（按顺序检查）：
  1. Clash 代理是否在运行且正常：`curl -x http://127.0.0.1:7890 --max-time 10 https://github.com`
  2. GitHub Releases 是否可达：测试 `https://github.com/electron-userland/electron-builder-binaries/releases/` 的连通性
  3. electron-builder 本地缓存是否齐全：检查 `~/Library/Caches/electron-builder/` 下 nsis、nsis-resources、winCodeSign、wine、dmg-builder 目录是否存在且非空
- **缓存补齐**：如果网络不通但 `~/Library/Caches/electron-builder/` 已有全部缓存，可以直接打包（electron-builder 优先读本地缓存）
- **npmmirror 镜像兜底**：当 GitHub 不可达时，nsis-resources 等可从 `https://registry.npmmirror.com/-/binary/electron-builder-binaries/` 下载后手动解压到缓存目录
- **曾经踩坑**：Clash 代理 SSL 握手失败（SSL_ERROR_SYSCALL / x509 证书不合规）导致 nsis-resources 下载超时，四个平台构建全部白跑一遍（每个要 5-8 分钟），浪费了 30+ 分钟

### 打包错误教训汇总（持续更新）

- **不要并行跑两个 electron-builder**：electron-builder 的 Vite 构建和 asar 打包会互相锁文件，并行构建必定有一个 esbuild 冲突失败。正确做法：第一个走完整构建，后续用 `--skip-vite` 复用 Vite 产物串行跑
- **不要在 Execute 里跑超过 600s 的构建**：electron-builder 全量构建（含 native module 重编译 + 签名）在 macOS 上经常超过 10 分钟，必须用 `fireAndForget` 后台执行 + `sleep N && tail` 轮询
- **dmg-builder 下载偶尔卡住**：dmg-builder 的 tar.gz 从 GitHub 下载不稳定，如果 zip 产物已完成但 dmg 卡住，可以杀掉进程重跑，因为 dmg-builder 缓存一旦写入 `.complete` 标记文件后续就不会重新下载
- **2026-05-07 Windows x64 打包修复总结**：Factory CLI 必须内置，不能因为 npm 镜像缺 `@factory/cli-win32-x64-baseline@0.119.0` 就接受缺失。正确链路是先 npmjs 平台 tarball，必要时 fallback 到 `downloads.factory.ai/factory-cli/releases/0.119.0/windows/x64-baseline/droid.exe`，并用 manifest `skipped:false` + NSIS 内部 `resources/bundled-droid/win32-x64/droid.exe` 校验。
- **aionrs 是可选资源**：GitHub Release 下载 aionrs 在当前网络下容易 TLS/超时卡住；本地正式打包默认 `AIONUI_SKIP_AIONRS=1`，这不影响 Factory Droid CLI 主链路。
- **Hub 资源要有单文件 timeout**：`prepareHubResources.js` 如果不用 `AIONUI_HUB_TIMEOUT_MS=20000`，会在某个 GitHub/jsDelivr 请求上无限等。Hub 扩展下载失败按非致命处理，成功数量写入 manifest。
- **Windows native / builder 镜像**：Windows x64 的 `better-sqlite3` 预编译包走 `registry.npmmirror.com/-/binary/better-sqlite3`；electron-builder 的 `winCodeSign` / `wine` / `nsis` 走 `ELECTRON_BUILDER_BINARIES_MIRROR=https://registry.npmmirror.com/-/binary/electron-builder-binaries/`，不要反复卡 GitHub x509。
- **DMG retry 只能用于 Mac 目标**：Windows 构建失败时如果 `out/mac/*.app` 残留，旧逻辑会误触发 DMG retry；必须按 `--mac` / `--all` 判断，Windows/Linux 失败不能走 DMG retry。
- **版本和提交习惯**：用户要求以后每轮打包前必须先有 Git commit 可追溯；如果没有指定固定版本，每次只递增 patch。若用户要求同一版本全平台打包，所有平台/架构保持同一个版本号。

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
