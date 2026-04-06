# Memory

本文件记录仓库相关的长期偏好、背景信息和上下文，供智能体在每次任务开始时读取。

## 用户偏好

- 用户主要用中文沟通，代码注释和 commit message 用英文
- 回复保持简洁，不做多余分析

## 项目背景

- AionUi — Electron + React 桌面应用，将命令行 AI Agent 转为现代 Chat 界面
- 当前版本 v1.9.7，License: Apache-2.0
- 三进程架构：main（`src/process/`）/ renderer（`src/renderer/`）/ worker（`src/process/worker/`）
- 技术栈：Electron + Vite + React + TypeScript + UnoCSS + Arco Design + Vitest
- 包管理器：bun
- Lint：oxlint；格式化：oxfmt
- 本仓库（`wangAoqi666/AionUi-aoqi`）是 `iOfficeAI/AionUi` 的 fork
- 分支策略：`upstream-sync` = upstream 纯净镜像；`dev` = 全集开发分支

## 技术决策记录

- CSS 方案：UnoCSS 优先，复杂样式用 CSS Modules（`ComponentName.module.css`）
- 组件库：Arco Design Web React（`@arco-design/web-react`）
- 图标库：Icon Park React（`@icon-park/react`）
- 测试框架：Vitest 4，覆盖率目标 >= 80%
- i18n 配置入口：`src/common/config/i18n-config.json`

## 常见陷阱与注意事项

- macOS 环境已配置 Clash 代理（127.0.0.1:7890），git 全局 HTTPS 代理已设置
- 禁止设置 `http.version=HTTP/1.1`，会导致代理下 git 协议握手卡死
- 大仓库 clone 不稳定时优先用 `wget` 下载 ZIP
- 含中文文件名的 ZIP 用 `python3 zipfile` 解压，不用 `unzip`

---

> 当用户说 **"记住这点"** 时，将新记忆以条目形式追加到本文件的相应章节。
> 如果不确定归入哪个章节，追加到「用户偏好」。
