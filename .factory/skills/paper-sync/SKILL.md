---
name: paper-sync
description: >
  Paper 原型 ↔ 代码双向同步。当用户修改了 UI 代码或 Paper 设计后，
  执行同步检测和更新。支持 code→design、design→code、新增映射、状态查看。
  当用户提到"同步到 Paper"、"更新原型"、"Paper 同步"、"同步设计"时自动触发。
---

# Paper 原型双向同步

将 AionUi 代码与 Paper 设计原型保持双向同步。

## 前置条件

- Paper MCP 已连接（`paper___` 系列工具可用）
- 映射表存在于 `docs/paper-sync-map.json`
- 同步脚本存在于 `scripts/sync-code-to-design.ts` 和 `scripts/sync-design-to-code.ts`

## 触发方式

用户说以下任意内容时激活本技能：

- `/paper-sync`
- "同步到 Paper" / "更新原型" / "Paper 同步"
- "代码改了，更新设计" / "设计改了，更新代码"

## 操作模式

本技能支持 4 种操作模式。如果用户没有明确指定，先询问：

### 模式 1：code→design（代码 → 设计）

当代码变更后需要更新 Paper 原型时执行。

**步骤：**

1. 运行检测脚本：
   ```bash
   bun run scripts/sync-code-to-design.ts
   ```
2. 解析输出，找到所有 `[DIFF]` 标记的映射条目
3. 对每个有差异的映射：
   - 如果 `property` 是 `textContent`：调用 `paper___set_text_content` 更新文字
   - 如果 `property` 是样式属性：调用 `paper___update_styles` 更新样式
4. 对每个受影响的画板调用 `paper___get_screenshot` 验证
5. 确认更新后，读取 `docs/paper-sync-map.json` 检查 `designValue` 已由脚本自动更新
6. 向用户报告：更新了哪些节点，附截图

### 模式 2：design→code（设计 → 代码）

当 Paper 原型被手动修改后需要同步回代码时执行。

**步骤：**

1. 读取 `docs/paper-sync-map.json` 获取所有映射
2. 遍历每条映射，用 `paper___get_node_info` 读取 Paper 节点当前值
3. 对比节点实际值与映射中的 `designValue`：
   - 如果不同，说明 Paper 被手动修改了
   - 用 Edit 工具更新 `docs/paper-sync-map.json` 中对应条目的 `designValue`
4. 运行反向同步脚本：
   ```bash
   bun run scripts/sync-design-to-code.ts
   ```
5. 解析输出中的 diff 补丁
6. **展示所有 diff 给用户确认**，不要自动应用
7. 用户确认后，逐一用 Edit 工具修改代码文件
8. 向用户报告：修改了哪些文件的哪些行

### 模式 3：add-mapping（新增映射）

将新的 Paper 节点 ↔ 代码位置关联起来。

**所需信息（从用户获取或自行定位）：**

- `id`：映射唯一标识（kebab-case，如 `login-title-text`）
- `description`：中文描述
- Paper 侧：`artboardId`、`nodeId`、`property`（textContent / backgroundColor / color 等）
- 代码侧：`file`（相对路径）、`pattern`（正则表达式）、`captureGroup`

**步骤：**

1. 收集上述信息
2. 用 `paper___get_node_info` 验证 Paper 节点存在且值正确
3. 用 `paper___rename_nodes` 给节点设置 `@sync:{id}` 的 layer-name
4. 读取代码文件，用正则验证能匹配到值
5. 构造新映射条目，将 `designValue` 设为当前 Paper 节点值
6. 用 Edit 工具将新条目追加到 `docs/paper-sync-map.json` 的 `mappings` 数组
7. 向用户确认映射已创建

### 模式 4：status（同步状态报告）

**步骤：**

1. 读取 `docs/paper-sync-map.json`
2. 对每条映射同时获取：
   - **代码值**：读取对应文件，用正则提取
   - **Paper 值**：调用 `paper___get_node_info` 读取节点
   - **记录值**：映射中的 `designValue`
3. 输出表格：

   | ID                 | 描述            | 代码值 | 设计值 | Paper实际值 | 状态 |
   | ------------------ | --------------- | ------ | ------ | ----------- | ---- |
   | titlebar-app-title | Titlebar 应用名 | AionUi | AionUi | AionUi      | ✅   |

   状态标记：
   - ✅ 三方一致
   - ❌ 有差异（标注哪两方不同）
   - ⚠️ 节点不存在或文件找不到

## 映射表格式

参考 `docs/paper-sync-map.json`，每条映射结构：

```json
{
  "id": "唯一标识（kebab-case）",
  "description": "中文描述",
  "paper": {
    "artboardId": "画板 ID",
    "artboardName": "画板中文名",
    "nodeId": "节点 ID",
    "property": "textContent | backgroundColor | color | ...",
    "layerName": "@sync:唯一标识"
  },
  "code": {
    "file": "相对于项目根目录的文件路径",
    "pattern": "用于匹配代码行的正则表达式",
    "captureGroup": 1
  },
  "designValue": "当前设计侧的值"
}
```

## 安全规则

- **design→code 方向永远不自动应用**，必须展示 diff 让用户确认
- 不修改 `docs/paper-sync-map.json` 以外的 JSON/配置文件
- 如果 Paper MCP 工具不可用，提示用户先连接 Paper
- 如果映射中的节点 ID 在 Paper 中找不到，标记为 ⚠️ 但不报错中断

## 参考文件

- 映射数据：`docs/paper-sync-map.json`
- 画板规划：`docs/paper-prototype-plan.md`
- 同步规则：参考本目录下的 `sync-map.md` 和 `checklist.md`
- 项目规则：`.factory/RULES.md`（Paper 原型协作规则章节）
- 项目记忆：`.factory/MEMORY.md`（Paper 原型状态章节）
