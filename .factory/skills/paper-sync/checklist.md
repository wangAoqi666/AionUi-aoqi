# 同步验证清单

每次执行同步操作后，按此清单逐项验证。

## code→design 完成后

- [ ] 所有 `[DIFF]` 条目已通过 Paper MCP 更新
- [ ] 每个受影响画板已截图确认视觉正确
- [ ] `docs/paper-sync-map.json` 中 `designValue` 与 Paper 节点实际值一致
- [ ] 无报错或跳过的映射（如有，已向用户说明原因）

## design→code 完成后

- [ ] 所有 Paper 变更已检测并记录到 `designValue`
- [ ] 生成的代码 diff 已展示给用户
- [ ] 用户已确认要应用的变更
- [ ] 代码文件已正确修改
- [ ] 修改后重新运行检测脚本确认无差异

## add-mapping 完成后

- [ ] Paper 节点存在且值正确（`get_node_info` 验证）
- [ ] 节点已标注 `@sync:` layer-name
- [ ] 代码文件路径正确且正则能匹配
- [ ] 新条目已写入 `docs/paper-sync-map.json`
- [ ] `id` 在映射表中唯一

## 通用检查

- [ ] `docs/paper-sync-map.json` 是合法 JSON（无语法错误）
- [ ] 无孤立的 `@sync:` 标注（即标注了但映射表中没有对应条目）
- [ ] 无失效的映射（即映射表中有但 Paper 节点已被删除）
