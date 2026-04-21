# Changelog

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
