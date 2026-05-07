# 同步映射表维护规则

## 映射表位置

`docs/paper-sync-map.json`

## 支持的 property 类型

| property          | Paper 工具         | 代码侧示例                  |
| ----------------- | ------------------ | --------------------------- |
| `textContent`     | `set_text_content` | `const title = 'AionUi'`    |
| `backgroundColor` | `update_styles`    | `background-color: #ffffff` |
| `color`           | `update_styles`    | `color: #1d2129`            |
| `fontSize`        | `update_styles`    | `font-size: 14px`           |
| `borderRadius`    | `update_styles`    | `border-radius: 8px`        |
| `padding`         | `update_styles`    | `padding: 16px`             |
| `gap`             | `update_styles`    | `gap: 12px`                 |
| `width`           | `update_styles`    | `width: 220px`              |
| `height`          | `update_styles`    | `height: 36px`              |

## 命名规范

- `id` 使用 kebab-case：`{画板区域}-{元素}-{属性}`
- 示例：`titlebar-app-title`、`sider-width`、`login-card-bg`
- `layerName` 固定前缀 `@sync:`，后接 id：`@sync:titlebar-app-title`

## 正则模式编写指南

代码侧的 `pattern` 是逐行匹配的正则表达式：

```
// 匹配字符串赋值
"const appTitle = useMemo\\(\\) => '(.+?)'"

// 匹配 CSS 变量值
"--titlebar-height:\\s*(.+?);"

// 匹配 JSX 属性
"width[=:]\\s*['\"]?(\\d+)"

// 匹配对象属性
"height:\\s*['\"]?(\\d+)"
```

`captureGroup` 指定要提取第几个捕获组（通常是 1）。

## 新增映射检查清单

1. Paper 节点确实存在（用 `get_node_info` 验证）
2. 代码文件存在且正则能匹配到值
3. `id` 在映射表中唯一
4. 节点已用 `rename_nodes` 标注 `@sync:` 前缀
5. `designValue` 已设为当前实际值

## 删除映射

1. 从 `docs/paper-sync-map.json` 的 `mappings` 数组中移除条目
2. 可选：用 `rename_nodes` 移除节点的 `@sync:` 前缀标注
