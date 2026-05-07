---
name: desktop-app-testing
version: 1.0.0
description: |
  直接操作正在运行的 Agent Factory / Electron 桌面端应用做 UI 与交互测试。
  优先通过 agent-browser 连接桌面端 CDP（开发环境默认 127.0.0.1:9230），
  完成截图、点击、输入、发送消息、结果验证和问题复现。
  当用户提到“桌面端测试”“Electron 测试”“直接操作桌面版验证”“CDP 测试”“agent-browser 测试”时触发。
---

# Desktop app testing

这个技能用于直接验证桌面端行为。优先连正在运行的 Electron 应用，不先退回到纯 Web 页面。

## 前置条件

- 桌面应用已经启动
- 能访问 CDP：开发环境默认 `http://127.0.0.1:9230`；生产环境需在 `设置 → 系统 → Developer Debug` 打开远程调试后重启
- 本机已安装 `agent-browser`
- 如果同一窗口正被其他 CDP 客户端控制，先停掉它们；`agent-browser` 不要和 chrome-devtools / Playwright 同时抢同一个窗口

## 先做这一步

先确认端口，再连桌面端：

```bash
lsof -nP -iTCP -sTCP:LISTEN | rg "5173|5174|9230|25809"
agent-browser connect 9230
```

常见端口：

- `5173`：renderer dev server
- `25809`：WebUI
- `9230`：Electron CDP

## 标准流程

1. 连接桌面端 CDP
2. 先拿一张带标注的截图，再拿一份交互快照
3. 根据最新 refs 做点击、输入、发送
4. 每次导航、弹层变化、流式输出或显著状态变化后，重新截图和 re-snapshot
5. 用截图和快照一起给出验证结论

推荐起手命令：

```bash
agent-browser connect 9230 && agent-browser screenshot --annotate && agent-browser snapshot -i -C
```

说明：

- `screenshot --annotate` 会给可交互元素打编号，方便对照 `@e1`、`@e2`
- `snapshot -i -C` 会把普通交互元素和 `onclick` / `cursor:pointer` 的壳层元素一起抓出来

## 交互规则

### 点击

- 一律使用**最新**截图或快照里的 ref
- 点击后如果页面有变化，立刻重新抓 refs

```bash
agent-browser click @e12
agent-browser wait 1000
agent-browser screenshot --annotate && agent-browser snapshot -i -C
```

### 输入

先试 `fill`。如果输入框被遮挡、还在 loading，或者 `fill` 超时，就切到 `focus + keyboard inserttext`。

```bash
agent-browser fill @e6 "测试内容"
```

回退方案：

```bash
agent-browser focus @e6 && agent-browser keyboard inserttext "测试内容"
```

### 被遮挡的按钮或输入框

先收掉遮挡层，再重新抓 refs：

```bash
agent-browser press Escape
agent-browser screenshot --annotate && agent-browser snapshot -i -C
```

## 常见测试节奏

### 发送一条消息做验证

下面是常用节奏。注意，`@e15`、`@e6`、`@e11` 只是示例，实际以**当前快照**为准。

```bash
agent-browser screenshot --annotate && agent-browser snapshot -i -C
agent-browser click @e15 && agent-browser wait 1000
agent-browser focus @e6 && agent-browser keyboard inserttext "帮我做一个测试"
agent-browser click @e11 && agent-browser wait 10000
agent-browser screenshot --annotate && agent-browser snapshot -i -C
```

### 复现问题

复现时不要只说“看起来有问题”。至少保留下面两样：

- 一张操作前或操作后的标注截图
- 一份对应时刻的 `snapshot -i -C`

如果前后差异很关键，可以补一条：

```bash
agent-browser diff snapshot
```

## 什么时候不用这个技能

下面这些情况可以不用直连桌面端：

- 用户明确要测 `localhost:5173` 或 `25809` 的 Web 页面
- 任务只和静态 DOM、路由、样式源码有关，不需要真实桌面行为

只要用户要的是“桌面端真实行为”，就优先回到 CDP + `agent-browser`。

## 故障排查

- 连不上 `9230`：应用没启动，或者生产环境没开 CDP
- `fill` 超时：改用 `focus + keyboard inserttext`
- 点击没反应：先 `press Escape`，再重新截图/快照
- ref 失效：页面已经变了，重新执行 `screenshot --annotate` 和 `snapshot -i -C`
- `agent-browser` 状态混乱：先 `agent-browser close`，再重新 `connect 9230`

## 输出要求

回报测试结果时至少带上这些内容：

- 实际执行了哪些关键操作
- 用到的截图路径
- 看到的关键 UI 文案 / 按钮 / 状态
- 结果是否符合预期；如果不符合，卡在哪一步
