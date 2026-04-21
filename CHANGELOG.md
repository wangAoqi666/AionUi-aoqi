# Changelog

## [0.1.6] - 2026-04-22

本次版本围绕 Factory Droid SDK 深度集成做了系统性补齐，覆盖 SDK 原生能力闭环 (P0/P1/P2)、BYOK 站点化改造、officecli 降级链路。测试总规模从 3276 → 3479（+203），全程 0 tsc error、0 lint error。

### Factory Droid SDK 原生能力 (P0)

- **Skills 同步闭环**：使用 SDK 官方 `listSkills()` 接口列举 `~/.factory/skills/`，通过 subagent classifier 分类为 core / user / workspace，写入 `AcpSkillManager.setSdkSkills()` 并广播 `slash_commands_updated`，不再依赖 prompt 注入
- **SDK 通知统一映射**：新增 `notificationMapper.ts`（282 LOC），将 SDK `onNotification` 发出的 10 种通知（MESSAGE / TOOL_CALL / PERMISSION / SETTINGS / MISSION 系列）统一映射为前端 `IResponseMessage`；BYOK modelId 受保护，不再被 Factory 云模型回显覆盖
- **YOLO 模式二次确认**：新增 `skipPermissionsUnsafe` 标志与 `SkipPermissionsConfirmModal`（6 语言），在 `AgentModeSelector` 选择 `yolo / bypassPermissions` 时拦截；会话关闭后自动清除，配合 IPC `acp.set-skip-permissions-unsafe`

### Factory Droid SDK 进阶能力 (P1)

- **动态 MCP 管理**：新增 `mcpSync.ts` 与 6 个 MCP 包装 (list/add/remove/update/enable/disable)，启动时做差集同步 `syncMcpServersOnStartup`；新增 22 个专项测试
- **原生多模态附件**：新增 `messageAttachments.ts`（12 KB），发送消息时通过 `MessageOptions` 附带 native image/file parts，10 MB 上限；保留 `@file` 兜底以兼容老会话；15 个专项测试
- **Factory Catalog 热刷新**：新增 `catalogRefresher.ts`，监听 SDK `settings_updated` 事件 → 500ms 防抖 + 2s 冷却（防死循环），BYOK CRUD 通过 `flushFactoryCatalogRefresh` 主动触发刷新

### Factory Droid SDK 扩展能力 (P2)

- **Mission / Decomp Orchestrator 模式**：新增 `sessionMode: 'mission'`，映射为 `DecompSessionType.Orchestrator` + Auto interactionMode + Medium autonomyLevel；`notificationMapper` 扩展 6 类 MISSION_* 通知（mission_created / milestone_completed / feature_started 等）
- **Tool Whitelist**：新增 `enabledToolIds` 三态语义（undefined=默认全开 / [] = 全禁 / [ids]=白名单）与 IPC `acp.set-enabled-tool-ids`；`setEnabledToolIds(null)` 显式清除
- **提交 Bug 报告**：新增 `DroidBugReportModal` 入口（About 页 Bug 图标），自动附带 app/SDK 版本、平台、sessionId、stack trace；支持 402 重写；16 keys × 6 语言

### BYOK 站点化改造

- **站点聚合**：新增 5 个服务函数（`listDroidByokSites / upsertDroidByokSite / removeDroidByokSite / rotateDroidByokSiteApiKey / migrateLegacyModelsIntoSites`）+ 4 个 IPC 通道；站点 ID 为 `sha1(provider|normalizedBaseUrl).slice(16)` 跨重启稳定；明文 `apiKey` 不出 main 进程
- **站点化 UI**：新增 `FactoryDroidByokSiteCard` / `FactoryDroidByokSiteList` / `FactoryDroidByokRotateKeyModal`，双保险回退开关（`AIONUI_BYOK_LEGACY=1` 环境变量 + `aionui.byok.legacyUi` localStorage）保留扁平列表视图
- **一次性迁移标记**：`droidByokMigrationVersion=1` 幂等写入；合并 `(provider, model, normalizedBaseUrl)` 重复 `customModels` 条目
- **多模态 + 推理级别**：BYOK 模型新增 `supportsImageInput` / `reasoningLevels` / `defaultReasoning` 字段与 8 大家族启发式推断（Claude 3.5+/4、GPT-5/codex、o1-o5、GPT-4o、Gemini 2.5/3、Kimi、Qwen3/QwQ、GLM-4v、DeepSeek-r1/vl）；新增 `FactoryDroidByokModelEditModal` 编辑面板 + 行内 Tag + 批量导入自动推断；当模型 `supportsImageInput=false` 时自动剥离图片附件并通过 `<system-reminder>` 提示

### officecli 完整降级

- **共享安装器**：新增 `OfficeCliInstaller.ts`（`src/process/bridge/services/`），抽取 PPT / Word / Excel 三份重复的安装逻辑；互斥锁防止并发安装，5 分钟失败 TTL 冷却，后台每 24h 静默更新检查一次
- **多路径解析**：探测 `~/.local/bin` / `~/.deno/bin` / `/usr/local/bin` / `/opt/homebrew/bin` / `/usr/bin`（Unix），以及 `%USERPROFILE%\.officecli\bin` / `%LOCALAPPDATA%\OfficeCli\bin` / `%ProgramFiles%\OfficeCli`（Windows）
- **失败卡片 + Windows 指南**：`OfficeWatchViewer` 失败态升级为带「重试 / 手动安装 / 复制命令」三按钮的 Result 卡片；检测到 PowerShell 执行策略错误时，提示 `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` 自救命令；12 个新 i18n keys × 6 语言

### 测试

- 新增单测（节选）：`droidListSkills` / `droidNotificationMapper` / `droidMcpManagement` / `droidSdkAttachments` / `droidCatalogRefresh` / `droidMissionMode` / `droidEnabledToolIds` / `droidBugReport` / `droidByokSites` / `droidByokCapabilities` / `officeCliInstaller` / `SkipPermissionsConfirmModal.dom` / `DroidBugReportModal.dom` / `FactoryDroidByokModelEditModal.dom` / `OfficeWatchViewer.dom`
- 测试总数：3276 → 3479（+203），全部通过；tsc `--noEmit` 与 oxlint 全程 0 error

## [0.1.5] - 2026-04-21

### Bug Fixes

- **BYOK 用户飞书/钉钉/微信/Telegram 首条消息失败**：修复 BYOK-only 用户通过远程渠道发送第一条消息时报 "No access token available" 的问题。根因是 DroidSdkAgent 将 BYOK modelId 静默降级为 Factory 云模型，导致 CLI 尝试用不存在的 Factory 鉴权发起请求。三层防御：构造函数保留 BYOK id、AcpAgentManager 跳过 catalog 校验、ActionExecutor 注入 currentModelId
- **渠道会话模型注入**：ActionExecutor 现在为 droid 后端的渠道会话显式注入 `currentModelId`，优先取管理员在配置页选择的 BYOK 模型，其次取主程序缓存的 BYOK id，避免回落到 Factory 云默认模型

### New Features

- **渠道 Droid 模型选择器**：飞书、钉钉、微信、Telegram 配置页新增 Droid 模型下拉选择器（`DroidChannelModelSelector`），当后端为 droid 时替代原有的 Gemini 模型选择器，支持按 BYOK / Factory 内置分组展示，管理员可显式指定渠道使用的模型

## [0.1.4] - 2026-04-21

### Bug Fixes

- **粘贴图片不再清空工作空间**：修复粘贴图片时 `setDir('')` 误清除已选文件夹，导致会话创建到临时空间的问题
- **AskUser 确认按钮修复**：当智能体提供恰好 4 个选项时，第 4 个选项不再被错误当成自定义输入。新增独立的「自定义回答」按钮
- **Windows Office 预览不再弹出 cmd 窗口**：将 officecli 安装和启动的 `stdio` 从 `inherit` 改为 `pipe`，添加 `windowsHide: true`，防止 cmd.exe 弹窗冻结 UI
- **切换标签页不再丢失回复内容**：在流式响应结束时强制刷新数据库写入缓冲（2000ms 防抖），确保切换回标签页时能从数据库正确加载完整消息

### New Features

- **Droid 后端 Skills 注入**：Droid SDK 会话现在通过 prompt 注入 Skills 索引（名称+描述），解决 SDK 模式下不自动加载技能元数据的问题
- **动态 Skills 刷新**：通过 `fs.watch` 监听 `~/.factory/skills/` 目录变化，中途安装新技能后下一条消息自动注入更新后的技能索引，无需重开会话

## [0.1.2] - 2026-04-19

本次版本为一次较大更新，重点增强了 BYOK（三方渠道 API） 能力、远程渠道交互体验，以及会话管理体验。

- 新增第三方 BYOK 集成能力，扩展自定义模型接入与设置流程
- 优化模型设置与 BYOK 配置相关交互，提升可用性与稳定性
- 新增会话标签重命名能力，支持更方便地管理当前会话
- 改进远程渠道下的提问交互逻辑：在微信、飞书等远程渠道中，不再依赖交互式 AskUser 组件，改为直接下发纯文本问题，便于用户直接回复
- 完善多语言文案与相关界面细节
- 修复若干已知问题，并提升整体稳定性
