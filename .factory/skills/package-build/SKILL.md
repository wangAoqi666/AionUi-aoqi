---
name: package-build
version: 1.3.0
description: |
  本地打包当前仓库的 Mac、Windows 和 Linux 安装包。支持全量执行，也支持按平台或架构筛选。
  仅在用户明确要求“打包”“出安装包”“构建 Mac/Windows/Linux 包”或手动输入 /package-build 时使用。
  直接执行本地构建，不走 GitHub Actions。
  正式打包必须包含 bundled Droid CLI；aionrs 是可选资源，GitHub 下载卡住时默认跳过。
disable-model-invocation: true
---

# Package build

这个技能把当前仓库的本地打包流程固化成一个可重复执行的工作流。

它做三件事：

- 本地构建 Mac 安装包（dmg + zip）
- 本地构建 Windows 安装包（exe + zip）
- 本地构建 Linux 安装包（deb）

它不会做这些事：

- 不走 GitHub Actions
- 不发布、不上传、不创建 release
- 不跳过 Droid CLI
- 不在用户要求同版本全平台打包时递增版本号

## 触发方式

支持：

- `/package-build`
- `/package-build mac`
- `/package-build win`
- `/package-build linux`
- `/package-build mac-arm64`
- `/package-build mac-x64`
- `/package-build win-x64`
- `/package-build win-arm64`
- `/package-build linux-x64`
- `/package-build linux-arm64`

自然语言也要识别：

- “打个 Mac 包” → `mac`
- “完整打包 Windows 64” → `win-x64`
- “每个芯片每个系统都打包” → `all`

## 版本和 Git 硬规则

1. 版本唯一来源是根目录 `package.json#version`。
2. 版本号按 `major.minor.patch` 理解：第一个是大版本，第二个是中版本，第三个是小版本。
3. 每次开始新一轮打包前，如果用户没有指定固定版本，必须只递增 patch 版本；不要自动递增 major/minor。
4. 如果用户明确要求“同一版本打全平台”，所有目标必须保持同一个版本号，不要中途再 bump。
5. 打包前必须先保证当前打包代码有 Git commit 可追溯；如存在未提交源码变更，应先按逻辑拆分提交，再开始打包。
6. 提交前必须检查 `git diff --cached` 和 `git status`，确认不包含密钥、token、构建产物或敏感信息。

## 前置检查

执行前先确认：

1. 当前目录是仓库根目录
2. `package.json`、`scripts/build-with-builder.js`、`electron-builder.yml` 存在
3. `bun`、`node`、`file` 可用
4. macOS 上构建 Windows 目标时，`7za` 和 `7z` 可用
5. `out/` 可写
6. 版本号符合本轮要求
7. Git 已提交到可追溯状态，或本轮明确是在修打包脚本并会先提交

### 网络和镜像检查

打包前必须检查：

```bash
curl --max-time 10 -s -o /dev/null -w "github:%{http_code}\n" https://github.com
curl --max-time 30 -fsSL https://downloads.factory.ai/factory-cli/releases/0.119.0/windows/x64-baseline/droid.exe.sha256 | head -c 80
curl -I -L --max-time 20 https://registry.npmmirror.com/-/binary/electron-builder-binaries/winCodeSign-2.6.0/winCodeSign-2.6.0.7z
curl -I -L --max-time 20 https://registry.npmmirror.com/-/binary/better-sqlite3/v12.8.0/better-sqlite3-v12.8.0-electron-v136-win32-x64.tar.gz
```

如果 GitHub TLS / x509 报错，但 npmmirror 可用，继续用镜像变量，不要反复卡在 GitHub。

## 标准环境变量

正式本地打包推荐统一带上这些变量：

```bash
AIONUI_SKIP_AIONRS=1 \
AIONUI_DOWNLOAD_TIMEOUT_MS=300000 \
AIONUI_HUB_TIMEOUT_MS=20000 \
ELECTRON_BUILDER_BINARIES_MIRROR=https://registry.npmmirror.com/-/binary/electron-builder-binaries/
```

说明：

- `AIONUI_SKIP_AIONRS=1`：aionrs 是可选资源，GitHub Release 经常卡住；跳过不影响 Factory Droid CLI 主链路。
- `AIONUI_HUB_TIMEOUT_MS=20000`：Hub 单文件下载超时后继续下一个扩展，避免整包无限卡住。
- `ELECTRON_BUILDER_BINARIES_MIRROR`：规避 winCodeSign / wine / nsis 从 GitHub 下载时的 TLS/x509 问题。
- `AIONUI_DOWNLOAD_TIMEOUT_MS`：给 Droid CLI、native prebuild 等下载留足时间。

禁止使用会跳过 Droid CLI 的 `:fast` 命令做正式包。正式包必须确认 `bundled-droid/.../manifest.json` 中 `skipped: false`。

## Factory CLI / Droid CLI 打包规则

Factory CLI 必须打入安装包。

解析顺序：

1. 先从 npm registry 下载 `@factory/cli-<platform>-<arch>` 或 baseline 包。
2. Windows x64 默认用 baseline 包以获得最大兼容性：`@factory/cli-win32-x64-baseline`。
3. 如果 npm 镜像缺包，fallback 到官方直链：`https://downloads.factory.ai/factory-cli/releases/<version>/<platform>/<arch>/<binary>`。
4. 官方直链平台名是 `windows` / `darwin` / `linux`，Windows 不是 `win32`。
5. 官方直链下载必须先写临时文件，checksum 校验通过后再复制到正式 `resources/bundled-droid/...` 路径。
6. 从 macOS 交叉打 Windows 时不要执行 `droid.exe --version`，只校验文件和 manifest；Windows exe 不能在 macOS 直接运行。

## Native 模块和 electron-builder 镜像

- Windows x64 的 `better-sqlite3` 必须通过 `prebuild-install` 下载 Electron 对应 ABI 的预编译包。
- GitHub Release 网络不稳定时，用 `npm_config_better_sqlite3_binary_host_mirror=https://registry.npmmirror.com/-/binary/better-sqlite3`。
- Windows 构建需要 `winCodeSign`、`wine`、`nsis` 等 electron-builder 二进制，优先用：`ELECTRON_BUILDER_BINARIES_MIRROR=https://registry.npmmirror.com/-/binary/electron-builder-binaries/`。
- Windows 构建失败时，不允许触发 Mac DMG retry；DMG retry 只适用于 `--mac` 或 `--all` 中的 Mac 目标。

## 目标选择和命令

### 单目标

| 目标 | 命令 |
| ---- | ---- |
| `mac-arm64` | `node scripts/build-with-builder.js arm64 --mac --arm64` |
| `mac-x64` | `node scripts/build-with-builder.js x64 --mac --x64` |
| `win-x64` | `node scripts/build-with-builder.js x64 --win --x64` |
| `win-arm64` | `node scripts/build-with-builder.js arm64 --win --arm64` |
| `linux-x64` | `node scripts/build-with-builder.js x64 --linux --x64` |
| `linux-arm64` | `node scripts/build-with-builder.js arm64 --linux --arm64` |

### 多目标

第一项可完整构建，后续目标使用 `--skip-vite` 复用 Vite 产物，但不要跳过 Droid CLI / Hub：

| 目标 | 命令 |
| ---- | ---- |
| `mac-arm64` | `node scripts/build-with-builder.js arm64 --mac --arm64` |
| `mac-x64` | `node scripts/build-with-builder.js x64 --mac --x64 --skip-vite` |
| `win-x64` | `node scripts/build-with-builder.js x64 --win --x64 --skip-vite` |
| `win-arm64` | `node scripts/build-with-builder.js arm64 --win --arm64 --skip-vite` |
| `linux-x64` | `node scripts/build-with-builder.js x64 --linux --x64 --skip-vite` |
| `linux-arm64` | `node scripts/build-with-builder.js arm64 --linux --arm64 --skip-vite` |

默认全平台顺序：

1. `mac-arm64`
2. `mac-x64`
3. `win-x64`
4. `win-arm64`
5. `linux-x64`
6. `linux-arm64`

## 每目标流程

1. 运行目标命令。
2. 记录日志到 `/tmp/agentfactory-<target>-build.log`。
3. 长构建必须后台跑并轮询日志，不要让前台 Execute 超过 600 秒。
4. 单个目标失败时记录 blocker，继续后续目标。
5. 成功后立即执行产物校验。

## 已知失败处理

### aionrs 下载卡住

aionrs 是可选资源。若 GitHub Release 下载卡住、TLS 失败或超时，正式本地打包默认使用 `AIONUI_SKIP_AIONRS=1` 跳过。不要为了 aionrs 阻塞 Factory Droid CLI 包。

### Hub 下载卡住

Hub 下载必须设置单文件超时。下载失败的扩展按非致命处理，继续后续扩展；如果本轮要求完整 Hub，至少确认 `resources/hub/manifest.json` 里成功数量和失败项。

### winCodeSign / wine / nsis 下载失败

优先使用 `ELECTRON_BUILDER_BINARIES_MIRROR=https://registry.npmmirror.com/-/binary/electron-builder-binaries/` 重跑。

### better-sqlite3 下载失败

优先使用 better-sqlite3 npmmirror binary host mirror；不要从 arm64 主机尝试源码交叉编译 Windows x64。

### DMG 阶段失败

仅当目标是 Mac，且 `.app` 已生成但 `.dmg` 缺失时，最多重试 3 次 DMG。Windows/Linux 构建失败不能走 DMG retry。

## 产物校验

每个目标都要校验：

1. 预期安装包文件存在。
2. unpacked 目录关键可执行文件架构正确。
3. `bundled-droid/<platform>-<arch>/manifest.json` 存在且 `skipped: false`。
4. `bundled-droid/<platform>-<arch>/droid(.exe)` 存在。
5. Hub manifest 存在；如用户要求完整 Hub，扩展数量必须完整。
6. Windows NSIS 安装包必须提取 `$PLUGINSDIR/app-64.7z` 或 `$PLUGINSDIR/app-arm64.7z` 并用 `file` 确认为 `7-zip archive data`。

### 当前 AgentFactory artifact 名称

`electron-builder.yml` 当前产物前缀是 `AgentFactory`：

- `out/AgentFactory-{version}-mac-arm64.dmg`
- `out/AgentFactory-{version}-mac-arm64.zip`
- `out/AgentFactory-{version}-mac-x64.dmg`
- `out/AgentFactory-{version}-mac-x64.zip`
- `out/AgentFactory-{version}-win-x64.exe`
- `out/AgentFactory-{version}-win-x64.zip`
- `out/AgentFactory-{version}-win-arm64.exe`
- `out/AgentFactory-{version}-win-arm64.zip`
- `out/AgentFactory-{version}-linux-x64.deb`
- `out/AgentFactory-{version}-linux-arm64.deb`

### Windows x64 校验示例

```bash
EXE="out/AgentFactory-${version}-win-x64.exe"
DROID_MANIFEST="out/win-unpacked/resources/bundled-droid/win32-x64/manifest.json"
DROID_BIN="out/win-unpacked/resources/bundled-droid/win32-x64/droid.exe"
file out/win-unpacked/AgentFactory.exe
python3 -c "import json; print(json.load(open('out/win-unpacked/resources/bundled-droid/win32-x64/manifest.json')))"
7z x -o/tmp/nsis-verify "$EXE" '$PLUGINSDIR/app-64.7z' -y
file '/tmp/nsis-verify/$PLUGINSDIR/app-64.7z'
7z l '/tmp/nsis-verify/$PLUGINSDIR/app-64.7z' | grep -E 'AgentFactory.exe|bundled-droid.*win32-x64.*droid.exe'
```

## 输出要求

完成后必须给用户简洁结果矩阵：

| 目标 | 状态 | 产物 | 架构校验 | Droid CLI | Hub | 备注 |
| ---- | ---- | ---- | -------- | --------- | --- | ---- |

并列出每个成功产物的绝对路径；失败目标只写 blocker 摘要。

## 最终判断标准

1. 用户请求范围内目标都已尝试。
2. 每个目标都有 `success / failed / skipped`。
3. 成功目标提供绝对路径。
4. 成功目标完成架构、Droid CLI、Windows 7z 校验。
5. 源码变更已按逻辑拆分提交，且 commit message 无 AI 签名。
