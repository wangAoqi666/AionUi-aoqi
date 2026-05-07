---
name: package-build
version: 1.0.0
description: |
  本地打包当前仓库的 Mac 和 Windows 安装包。支持全量执行，也支持按平台或架构筛选。
  仅在用户明确要求“打包”“出安装包”“构建 Mac/Windows 包”或手动输入 /package-build 时使用。
  直接执行本地构建，不走 GitHub Actions。
disable-model-invocation: true
---

# Package build

这个技能把当前仓库的本地打包流程固化成一个可重复执行的工作流。

它只做两件事：

- 本地构建 Mac 安装包
- 本地构建 Windows 安装包

它**不会**做这些事：

- 不修改打包脚本或打包配置
- 不走 GitHub Actions
- 不构建 Linux 包
- 不做发布、上传、创建 release

## 适用范围

只适用于当前仓库，直接复用现有文件：

- `package.json`
- `scripts/build-with-builder.js`
- `electron-builder.yml`

## 触发方式

用户可以这样触发：

- `/package-build`
- `/package-build mac`
- `/package-build win`
- `/package-build mac-arm64`
- `/package-build mac-x64`
- `/package-build win-x64`
- `/package-build win-arm64`

如果用户不是用斜杠命令，而是自然语言表达需求，也要从上下文识别目标：

- “打个 Mac 包” → `mac`
- “出 Windows arm64 安装包” → `win-arm64`
- “把 Mac 和 Windows 都打了” → `all`

如果用户没有明确筛选，默认构建本机可执行的全部本地目标。

## 前置条件

执行前先确认：

1. 当前工作目录是仓库根目录
2. `package.json`、`scripts/build-with-builder.js`、`electron-builder.yml` 都存在
3. `bun`、`node`、`file` 命令可用
4. `out/` 目录可写

5. macOS 上构建 Windows 目标时，`7za`（Homebrew p7zip）可用：`command -v 7za`
6. `7z` 命令可用（用于产物 7z 格式校验）

如果缺少以上任一项，立刻停止并说明原因。

## 目标选择规则

### 默认目标

- 在 macOS 主机上：默认执行 `mac-arm64`、`mac-x64`、`win-x64`、`win-arm64`
- 在非 macOS 主机上：只执行与当前主机明确兼容的本地目标；不要伪装支持跨平台

### 用户显式筛选

如果用户明确指定平台或架构，只执行被点名的目标，不额外扩展。

## 标准流程

### Step 1：读取版本和现有脚本

先读取：

- `package.json` 中的 `version`
- `package.json` 中的打包 scripts
- `electron-builder.yml` 中的 target / artifactName

把本次预期产物文件名先推导出来，后续按这个结果校验。

### Step 2：决定执行命令

优先使用仓库里已经存在的命令，不发明新的打包入口。

#### 单目标时

只跑对应目标的标准命令：

| 目标        | 命令                      |
| ----------- | ------------------------- |
| `mac-arm64` | `bun run build-mac:arm64` |
| `mac-x64`   | `bun run build-mac:x64`   |
| `win-x64`   | `bun run build-win:x64`   |
| `win-arm64` | `bun run build-win:arm64` |

#### 多目标时

第一项走完整构建；后续目标优先复用已有 Vite 产物，改用 `build-with-builder.js` 的 `--skip-vite`：

| 目标        | 优化命令                                                             |
| ----------- | -------------------------------------------------------------------- |
| `mac-arm64` | `node scripts/build-with-builder.js arm64 --mac --arm64`             |
| `mac-x64`   | `node scripts/build-with-builder.js x64 --mac --x64 --skip-vite`     |
| `win-x64`   | `node scripts/build-with-builder.js x64 --win --x64 --skip-vite`     |
| `win-arm64` | `node scripts/build-with-builder.js arm64 --win --arm64 --skip-vite` |

默认顺序：

1. `mac-arm64`
2. `mac-x64`
3. `win-x64`
4. `win-arm64`

如果用户只选了部分目标，就按上面的相对顺序过滤后执行。

### Step 3：逐个执行

对每个目标：

1. 运行打包命令
2. 记录开始时间、结束时间、退出码
3. 不要因为单个目标失败而中止整批流程
4. 立即进入该目标的产物校验

## 已知失败处理

### DMG 阶段失败

如果是 mac 目标，并且满足下面条件：

- `.app` 已经生成
- 对应 `.dmg` 没生成

则把它视为 DMG 阶段失败，最多重试 **1 次** 同一目标。重试时优先使用 `--skip-vite`，不要重复完整编译。

### Electron 下载 TLS / x509 错误

如果错误信息包含以下任一关键词：

- `x509`
- `certificate`
- `Electron download`
- `certificate is not standards compliant`

则说明下载阶段被证书问题卡住。最多重试 **1 次**，并使用镜像环境变量：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
```

如果仍失败，保留失败信息，继续后续目标。

### 其他错误

不要发明额外“修复逻辑”。记录失败摘要，继续跑剩余目标。

## 产物校验

每个目标结束后，都要同时验证：

1. 预期安装包文件存在
2. 关键可执行文件架构正确

### 版本号

版本号来自 `package.json` 的 `version`，例如 `1.9.7`。

### Mac arm64

预期文件：

- `out/智能体工厂-{version}-mac-arm64.dmg`
- `out/智能体工厂-{version}-mac-arm64.zip`

架构校验：

- `out/mac-arm64/智能体工厂.app/Contents/MacOS/智能体工厂`
- 结果应包含 `arm64`

### Mac x64

预期文件：

- `out/智能体工厂-{version}-mac-x64.dmg`
- `out/智能体工厂-{version}-mac-x64.zip`

架构校验：

- `out/mac/智能体工厂.app/Contents/MacOS/智能体工厂`
- 结果应包含 `x86_64`

### Windows x64

预期文件：

- `out/智能体工厂-{version}-win-x64.exe`
- `out/智能体工厂-{version}-win-x64.zip`

架构校验：

- `out/win-unpacked/agentFactory.exe`
- 结果应包含 `x86-64`

7z 格式校验（**关键**）：

```bash
# 从 NSIS 安装器中提取内嵌的 app-64.7z，确认格式
7z x -o/tmp/nsis-verify "out/智能体工厂-{version}-win-x64.exe" '$PLUGINSDIR/app-64.7z' -y
file '/tmp/nsis-verify/$PLUGINSDIR/app-64.7z'
# 必须输出 "7-zip archive data"，不能是 "Zip archive data"
# 同时确认 agentFactory.exe 在归档内
7z l '/tmp/nsis-verify/$PLUGINSDIR/app-64.7z' | grep -i agentFactory.exe
```

如果 `file` 命令报告为 `Zip archive data`，说明 7zip-bin wrapper 未生效，构建无效。

### Windows arm64

预期文件：

- `out/智能体工厂-{version}-win-arm64.exe`
- `out/智能体工厂-{version}-win-arm64.zip`

架构校验：

- `out/win-arm64-unpacked/agentFactory.exe`
- 结果应包含 `Aarch64`

7z 格式校验（同 x64）：

```bash
7z x -o/tmp/nsis-verify-arm64 "out/智能体工厂-{version}-win-arm64.exe" '$PLUGINSDIR/app-arm64.7z' -y
file '/tmp/nsis-verify-arm64/$PLUGINSDIR/app-arm64.7z'
# 必须输出 "7-zip archive data"
```

## 输出要求

完成后必须给用户一个简洁结果汇总，至少包含：

### 1. 结果矩阵

| 目标 | 状态 | 产物 | 架构校验 | 备注 |
| ---- | ---- | ---- | -------- | ---- |

状态建议：

- `success`
- `failed`
- `skipped`

### 2. 每个成功产物的绝对路径

例如：

```text
/abs/path/out/智能体工厂-1.9.7-mac-arm64.dmg
/abs/path/out/智能体工厂-1.9.7-win-x64.exe
```

### 3. 每个失败目标的 blocker 摘要

只总结真正阻塞原因，不贴大段日志。

## 不要这样做

- 不要自动改 `electron-builder.yml`
- 不要自动改 `package.json`
- 不要自动清空整个 `out/`
- 不要把已经成功的目标判成失败
- 不要为了“全绿”而跳过架构校验
- 不要在没有用户要求的情况下顺手去打 Linux 包

## 最终判断标准

满足下面条件才算这个技能执行完成：

1. 用户请求范围内的目标都已经尝试执行
2. 每个目标都有明确的 `success / failed / skipped`
3. 成功目标给出了绝对路径
4. 成功目标给出了架构校验结果
5. 失败目标给出了 blocker 摘要
