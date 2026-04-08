# AionUi Paper 原型同步 — 执行计划

> 目标：在 Paper 中创建 AionUi 全部页面的可编辑设计原型，供后续持续迭代。

---

## 一、项目技术栈概览

| 层级     | 技术                                                 |
| -------- | ---------------------------------------------------- |
| 框架     | Electron + React 18 + TypeScript (strict)            |
| 路由     | react-router-dom v6, HashRouter                      |
| UI 库    | @arco-design/web-react                               |
| 图标     | @icon-park/react                                     |
| CSS 方案 | UnoCSS (utility-first) + CSS Modules + CSS Variables |
| 状态管理 | React Context + SWR                                  |
| 国际化   | react-i18next, 6 种语言                              |
| 构建     | electron-vite, Bun                                   |

### Paper MCP 技术限制

Paper 的 `write_html` 只支持：

- **布局**: `display: flex` (不支持 grid, inline, table)
- **样式**: 内联 style (不支持 class, CSS 变量, UnoCSS)
- **间距**: padding, gap (不支持 margin)
- **盒模型**: 默认 border-box
- **字体**: 所有 Google Fonts + 本地字体
- **图片**: `<img src="...">` 支持本地文件和 URL
- **不支持**: 交互状态、动画、伪类、媒体查询、JS

---

## 二、设计系统 (Design System)

### 2.1 颜色系统

项目使用 CSS Variables 实现主题切换，所有颜色必须从此处提取硬编码值。

#### Light Mode 色板

```
背景层级:
  --bg-base:    #ffffff    (主背景)
  --bg-1:       #f9fafb    (次级背景)
  --bg-2:       #f2f3f5    (三级背景)
  --bg-3:       #e5e6eb    (边框/分隔线)
  --bg-4:       #c9cdd4
  --bg-5:       #adb4c1
  --bg-hover:   #f3f4f6    (悬停)
  --bg-active:  #e5e6eb    (激活)

文字:
  --text-primary:   #1d2129    (主要文字)
  --text-secondary: #86909c    (次要文字)
  --text-disabled:  #c9cdd4    (禁用)

语义色:
  --primary:  #165dff    (主色/链接)
  --success:  #00b42a
  --warning:  #ff7d00
  --danger:   #f53f3f

品牌色 (AOU Purple):
  --aou-5:  #97a0c5
  --aou-6:  #7583b2    (品牌主色)
  --aou-7:  #596590
  --brand:  #7583b2

边框:
  --border-base:  #e5e6eb
  --border-light: #f2f3f5

组件专用:
  --message-user-bg:    #e9efff    (用户消息气泡)
  --message-tips-bg:    #f0f4ff    (提示消息)
  --workspace-btn-bg:   #eff0f1    (工作区按钮)
```

#### Dark Mode 色板

```
背景层级:
  --bg-base:    #0e0e0e
  --bg-1:       #1a1a1a
  --bg-2:       #262626
  --bg-3:       #333333
  --bg-4:       #404040
  --bg-5:       #4d4d4d
  --bg-hover:   #1f1f1f
  --bg-active:  #2d2d2d

文字:
  --text-primary:   #e5e5e5
  --text-secondary: #a6a6a6
  --text-disabled:  #737373

语义色:
  --primary:  #4d9fff
  --success:  #23c343
  --warning:  #ff9a2e
  --danger:   #f76560

品牌色:
  --brand:  #a1aacb

边框:
  --border-base:  #333333
  --border-light: #262626

组件专用:
  --message-user-bg:    #1e2a3a
  --message-tips-bg:    #1a2333
  --workspace-btn-bg:   #1f1f1f
```

### 2.2 字体

```
系统字体栈: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif
推荐 Paper 使用: "Inter" 或 "Noto Sans SC" (Google Fonts)
```

### 2.3 间距规范

```
基础单位: 4px
常用间距: 4, 8, 12, 16, 20, 24, 32, 40, 48
圆角: 4px (小), 8px (中), 12px (大), 16px (卡片), 20px (弹窗)
```

---

## 三、全局布局结构

### 3.1 App Shell (桌面端)

```
┌──────────────────────────────────────────────┐
│  Titlebar (36px, 系统标题栏)                    │
├────────┬─────────────────────────────────────┤
│        │  Header (44px, 标题+标签页+操作)        │
│ Sider  ├─────────────────────┬───────────────┤
│(可折叠) │                     │  Workspace    │
│ 266px  │   Main Content      │  (可折叠面板)   │
│        │   (对话/设置/引导)     │   20-40%     │
│        │                     │               │
├────────┴─────────────────────┴───────────────┤
```

### 3.2 关键尺寸

```
Titlebar 高度:    36px (CSS var: --titlebar-height)
App 最小宽度:     360px (CSS var: --app-min-width)
Sider 宽度:       266px (展开) / 折叠状态隐藏文字
Header 高度:      44px
Workspace 比例:   20-40% (可拖拽)
Chat/Preview 比例: 可拖拽分割
```

---

## 四、页面清单与构建顺序

### Phase 0: Design System 画板 (2 个)

| 画板                       | 内容                                       |
| -------------------------- | ------------------------------------------ |
| `DS-Colors`                | Light/Dark 双列色板展示，含变量名和色值    |
| `DS-Typography-Components` | 字体层级 + 按钮/输入框/标签/卡片等基础组件 |

**数据源文件**:

- `src/renderer/styles/themes/default-color-scheme.css` (所有颜色值)
- `uno.config.ts` (语义化颜色映射)

### Phase 1: 全局框架 (2 个)

| 画板             | 内容                                                |
| ---------------- | --------------------------------------------------- |
| `Layout-Desktop` | App Shell 骨架: Titlebar + Sider + Content 区域占位 |
| `Layout-Mobile`  | 移动端布局: 无 Titlebar, Sider 为抽屉式             |

**数据源文件**:

- `src/renderer/components/layout/Sider/index.tsx` (侧栏)
- `src/renderer/components/layout/Titlebar/titlebar.css` (标题栏)
- `src/renderer/styles/layout.css` (全局布局)

### Phase 2: Login 页 (1 个)

| 画板         | 内容                                               |
| ------------ | -------------------------------------------------- |
| `Page-Login` | 渐变背景 + 居中登录卡片 (logo/标题/表单/按钮/页脚) |

**数据源文件**:

- `src/renderer/pages/login/index.tsx`
- `src/renderer/pages/login/LoginPage.css`

**关键视觉参数**:

- 背景: `linear-gradient(135deg, #97a0c5 0%, #596590 100%)`
- 卡片: `max-width: 360px`, `border-radius: 20px`, `padding: 36px 28px 32px`
- 标题渐变: `linear-gradient(135deg, #667eea 0%, #764ba2 100%)`
- 按钮: `border-radius: 12px`, 高度 46px, 同标题渐变色

### Phase 3: Guid 引导页 (2 个)

| 画板                | 内容                                                         |
| ------------------- | ------------------------------------------------------------ |
| `Page-Guid-Default` | 默认状态: 标题 + AgentPillBar + 输入卡片 + QuickActions      |
| `Page-Guid-Agent`   | 选中 Agent 状态: 返回按钮 + Agent 头像标题 + 描述 + 输入卡片 |

**数据源文件**:

- `src/renderer/pages/guid/GuidPage.tsx`
- `src/renderer/pages/guid/index.module.css`
- `src/renderer/pages/guid/components/` (所有子组件)

### Phase 4: Conversation 对话页 (4-6 个)

| 画板                  | 内容                                               |
| --------------------- | -------------------------------------------------- |
| `Page-Conv-Chat`      | 对话主视图: Header + 消息列表 + 发送框             |
| `Page-Conv-Messages`  | 消息类型展示: 用户消息/AI消息/工具调用/思考中/计划 |
| `Page-Conv-Workspace` | 工作区面板: 文件树 + 编辑器                        |
| `Page-Conv-Preview`   | 预览面板: 代码/Markdown/图片/PDF 预览              |
| `Page-Conv-History`   | 侧栏对话历史: 分组列表 + 搜索                      |
| `Page-Conv-Mobile`    | 移动端对话视图                                     |

**数据源文件**:

- `src/renderer/pages/conversation/components/ChatLayout/index.tsx` (主布局)
- `src/renderer/pages/conversation/Messages/` (消息组件)
- `src/renderer/pages/conversation/Workspace/` (工作区)
- `src/renderer/pages/conversation/Preview/` (预览)
- `src/renderer/pages/conversation/GroupedHistory/` (历史)
- `src/renderer/pages/conversation/components/ChatLayout/chat-layout.css`
- `src/renderer/pages/conversation/Messages/messages.css`
- `src/renderer/pages/conversation/Workspace/workspace.css`

### Phase 5: Settings 设置页 (8-10 个)

| 画板                      | 内容                                       |
| ------------------------- | ------------------------------------------ |
| `Page-Settings-Shell`     | 设置页框架: 左侧菜单 + 右侧内容区          |
| `Page-Settings-Gemini`    | Gemini 设置                                |
| `Page-Settings-Aionrs`    | AionRS 设置                                |
| `Page-Settings-Model`     | 模型设置                                   |
| `Page-Settings-Agent`     | Agent 管理 (含 AgentCard, AgentHub)        |
| `Page-Settings-Assistant` | 助手管理 (含 AssistantManagement 子组件群) |
| `Page-Settings-Display`   | 显示设置 (含主题预览)                      |
| `Page-Settings-Tools`     | 工具/MCP 设置 (含 McpServerItem 列表)      |
| `Page-Settings-System`    | 系统设置                                   |
| `Page-Settings-SkillsHub` | 技能市场设置                               |

**数据源文件**:

- `src/renderer/pages/settings/components/SettingsSider.tsx` (设置侧栏)
- `src/renderer/pages/settings/components/settings.css`
- 各子页面 `.tsx` 文件

### Phase 6: Team 团队页 (2 个)

| 画板               | 内容         |
| ------------------ | ------------ |
| `Page-Team-Chat`   | 团队对话视图 |
| `Page-Team-Create` | 创建团队弹窗 |

**数据源文件**:

- `src/renderer/pages/team/TeamPage.tsx`
- `src/renderer/pages/team/components/`

### Phase 7: Scheduled Tasks 定时任务页 (2 个)

| 画板               | 内容       |
| ------------------ | ---------- |
| `Page-Cron-List`   | 任务列表页 |
| `Page-Cron-Detail` | 任务详情页 |

**数据源文件**:

- `src/renderer/pages/cron/ScheduledTasksPage/index.tsx`
- `src/renderer/pages/cron/ScheduledTasksPage/TaskDetailPage.tsx`

---

## 五、执行规范

### 5.1 画板命名约定

```
{类型}-{页面}-{状态}
类型: DS (Design System), Layout, Page
示例: DS-Colors, Layout-Desktop, Page-Login, Page-Conv-Chat, Page-Settings-Agent
```

### 5.2 画板尺寸

```
桌面页面: 1440 x 900 (或按内容高度自适应)
移动页面: 390 x 844
设计系统: 1440 x auto (按内容)
```

### 5.3 每个画板的构建流程

1. **读源码**: 先读对应的 `.tsx` + `.css` 文件，理解布局结构
2. **提取骨架**: 识别 flex 方向、层级、间距、尺寸
3. **映射颜色**: CSS 变量 → 硬编码色值 (参照 Phase 0 色板)
4. **逐层构建**: 用 Paper `write_html` 从外到内构建
   - 先 `create_artboard` 创建画板
   - 再 `write_html(mode: insert-children)` 逐步添加内容
   - 每次 write_html 只写一个视觉组 (header / row / card / section)
5. **截图验证**: 用 `get_screenshot` 检查效果
6. **标注关键信息**: 用 `rename_nodes` 给关键层命名

### 5.4 Paper HTML 编写规则

```html
<!-- 所有样式必须内联 -->
<div style="display: flex; flex-direction: column; gap: 16px; padding: 24px;">
  <!-- 不要用 margin，用 gap 和 padding -->
  <!-- 不要用 display: grid / inline / table -->
  <!-- 不要用 emoji 做图标，用 SVG 或省略 -->
  <!-- 图片用: <img src="http://localhost:29979/media{绝对路径}"> -->

  <!-- 用 layer-name 属性命名重要层 -->
  <div layer-name="Header" style="..."></div>
</div>
```

### 5.5 颜色使用规则

由于 Paper 不支持 CSS 变量，需要将变量名映射为硬编码色值。构建时：

- 默认使用 **Light Mode** 色值
- 如需同时展示 Dark Mode，创建单独的 `-Dark` 后缀画板

---

## 六、预计产出

| 阶段                   | 画板数    | 预计工作量 |
| ---------------------- | --------- | ---------- |
| Phase 0: Design System | 2         | 小         |
| Phase 1: 全局框架      | 2         | 小         |
| Phase 2: Login         | 1         | 小         |
| Phase 3: Guid          | 2         | 中         |
| Phase 4: Conversation  | 4-6       | 大         |
| Phase 5: Settings      | 8-10      | 大         |
| Phase 6: Team          | 2         | 中         |
| Phase 7: Cron          | 2         | 小         |
| **合计**               | **23-27** |            |

---

## 七、持续维护

当代码变更后需要更新原型时：

1. 确认变更涉及哪些页面 (通过 `git diff` 看改动文件)
2. 找到对应的 Paper 画板
3. 读取新代码，用 `write_html(mode: replace)` 更新变更部分
4. 用 `get_screenshot` 验证
