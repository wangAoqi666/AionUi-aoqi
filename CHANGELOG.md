# Changelog

## [0.1.4] - 2026-04-21

### Bug Fixes

- **粘贴图片不再清空工作空间**：修复粘贴图片时 `setDir('')` 误清除已选文件夹，导致会话创建到临时空间的问题
- **AskUser 确认按钮修复**：当智能体提供恰好 4 个选项时，第 4 个选项不再被错误当成自定义输入。新增独立的「自定义回答」按钮
- **Windows Office 预览不再弹出 cmd 窗口**：将 officecli 安装和启动的 `stdio` 从 `inherit` 改为 `pipe`，添加 `windowsHide: true`，防止 cmd.exe 弹窗冻结 UI
- **切换标签页不再丢失回复内容**：在流式响应结束时强制刷新数据库写入缓冲（2000ms 防抖），确保切换回标签页时能从数据库正确加载完整消息

### New Features

- **Droid 后端 Skills 注入**：Droid SDK 会话现在通过 prompt 注入 Skills 索引（名称+描述），解决 SDK 模式下不自动加载技能元数据的问题
- **动态 Skills 刷新**：通过 `fs.watch` 监听 `~/.factory/skills/` 目录变化，中途安装新技能后下一条消息自动注入更新后的技能索引，无需重开会话
