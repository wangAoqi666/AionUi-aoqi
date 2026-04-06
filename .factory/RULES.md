# Rules

本文件记录仓库内长期有效的执行规则，所有智能体在执行任务前必须读取并遵守。

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

## 协作规则

- 当用户说 **"记住这个规矩"** 时，将新规则以条目形式追加到本文件的相应章节
- 规则条目保持简洁、可执行，避免模糊表述
- 新增规则不得与已有规则矛盾；如需覆盖旧规则，标注替代关系
