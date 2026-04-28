# BYOK Windows 用户问题修复 Todo (2026-04-23)

> **会话连续协议**：压缩会话或重启后，新一轮 Droid 必须先 `Read tasks/byok-fixes-todo.md` 恢复进度；每完成一个 check 项立即更新为 `[x]`；全部完成后把本文件移至 `tasks/archive/byok-fixes-2026-04-23.md`。

> **Spec 来源**：`~/.factory/specs/2026-04-23-byok-windows.md`（用户已批准）。

## 上下文（Problem → Root Cause → Decision）

- 问题 1：Gemini 站点（`/v1beta` 前缀）添加后启动不了对话
  - 根因：项目自定义 `google` provider 写入 `settings.local.json`，Factory Droid CLI 官方只认 `anthropic / openai / generic-chat-completion-api`，被判 "Invalid provider"
  - 决策（A 方案）：移除 `google` 枚举；Gemini 按官方走 `generic-chat-completion-api` + `/v1beta/openai`
- 问题 2：获取模型需点多次才出来
  - 根因：`loadRemoteCatalog` first-resolve race 三端点，第一个 200 但空列表会"赢"
  - 决策（3A）：改为 `Promise.allSettled` + 优先选 `models.length>0`
- 问题 3：部分模型添加后启动不了对话
  - 根因 A：provider=google 无效（同问题 1 根治）
  - 根因 B：SDK 的 `error` notification 被 `DroidSdkAgent` 归为 `ignored` 只写日志，**未上抛 UI**
  - 决策：`notificationMapper` 新增 `kind:'error'` 分支；`handleMappedNotification` 转发 `type:'error'` 事件

## 模糊匹配推荐规则（Provider Inference，统一口径）

```ts
// 1) 远端声明优先
if (types.includes('anthropic')) return 'anthropic';
if (types.includes('openai-response') || types.includes('openai')) return 'openai';
if (types.includes('gemini')) return 'generic-chat-completion-api';
// 2) 模型名模糊匹配（大小写无关）
const m = model.toLowerCase();
if (/(^|[-_/])(opus|sonnet|haiku|claude)([-_/.]|$)/.test(m)) return 'anthropic';
if (/(^|[-_/])(gpt-5|gpt-4\.?1|codex|o[1345])([-_/.]|$)/.test(m)) return 'openai';
// 3) 其余兜底
return 'generic-chat-completion-api';
```

## 实施 Checklist

### T0. 准备

- [x] 创建 `tasks/byok-fixes-todo.md`
- [x] AGENTS.md / `.factory/rules/project.md` 注入"BYOK 修复期间必读"条目

### T1. Provider 枚举收窄 + 推断重写（A 方案）

- [x] `src/common/adapter/ipcBridge.ts::DroidByokModelProvider` 去掉 `'google'`
- [x] `src/process/bridge/services/DroidByokService.ts`：
  - [x] `DROID_BYOK_PROVIDER_VALUES` 收窄为三种
  - [x] `normalizeDroidByokBaseUrl` 移除 `provider==='google'` 特判；新增 Gemini 官方域名自动改写到 `/v1beta/openai`
  - [x] `buildPersistedBaseUrl` 移除 `provider==='google'` 特判
  - [x] 重写 `inferProviderFromModel`：按上述模糊匹配规则
  - [x] 删除 `probeGoogleEndpoint`，从 `probeProvider` / `getCandidateProviders` 移除 `'google'` 分支
  - [x] `inferByokModelCapabilities` 中 `providerHint === 'google'` 条件改为 `supportedEndpointTypes?.includes('gemini')`
- [x] `src/renderer/components/settings/FactoryDroidByokModal.tsx`：
  - [x] `PROVIDER_OPTIONS` 去掉 `'google'`
  - [x] `providerKey` 删掉 `case 'google'` 分支
- [x] `src/renderer/components/settings/SettingsModal/contents/factoryDroidByok/FactoryDroidByokSiteCard.tsx` 去掉 Google 文案
- [x] 删除 `providerGoogle` 键：6 个 i18n 文件（en/zh-CN/zh-TW/ko/ja/tr）
- [x] `src/renderer/services/i18n/i18n-keys.d.ts` 去掉 `providerGoogle` 类型

### T3. 静默迁移 google→generic（2A 方案）

- [x] `DroidByokService.ts` 新增 `migrateLegacyGoogleProvider()`（幂等）：
  - [x] 读 `settings.local.json`，把 `customModels[].provider==='google'` 改为 `'generic-chat-completion-api'`
  - [x] `baseUrl` 含 `generativelanguage.googleapis.com` 且不以 `/openai` 结尾 → 追加 `/openai`
  - [x] 同步修正 `acp.config.droid.byokModelRefs`（provider + baseUrl + 重算 id）
  - [x] 搬迁 `byokSiteLabels` 旧 id → 新 id
  - [x] 幂等标记：`acp.config.droid.droidByokGoogleMigrationVersion = 1`
- [x] `initStorage.ts` / 启动引导链路：首次可达处调用该迁移函数
- [ ] 单元测试覆盖（见 T7）

### T4. fetchDroidByokModels 根治（3A 方案）

- [x] 重写 `loadRemoteCatalog`：
  - [x] 用 `Promise.allSettled` 等全部端点
  - [x] 优先返回 `models.length > 0`；再次选空 fulfilled；全部 rejected 才 throw
  - [ ] 端点顺序：baseUrl 含 `/v1beta` → `/v1beta/models` 优先
- [x] `remoteCatalogCache` 只缓存 `models.length > 0` 结果
- [x] renderer `handleFetchModels`：
  - [x] 空 catalog 返回时 `Message.warning` 提示
  - [x] `requestSeq` 防并发覆盖
- [x] 新增 i18n 键 `settings.droidByok.fetchReturnedEmpty`（6 语言）

### T5. error notification 透传到 UI

- [x] `src/process/agent/droid/runtime/notificationMapper.ts`：
  - [x] `NotificationMappedResult` union 新增 `{ kind:'error'; message:string; code?:string }`
  - [x] `mapDroidNotification` 增加 `case 'error'` 分支
- [x] `src/process/agent/droid/DroidSdkAgent.ts::handleMappedNotification`：
  - [x] 新增 `case 'error'`：emit `type:'error'` 到 `onStreamEvent`
- [x] 抽取 `normalizeBackendErrorMessage`（402/payment 文案），在 mapError + handleMappedNotification 共享

### T6. persist 前 provider 校验兜底

- [x] `saveDroidByokConfig` 在 `probeAndResolveConfig` 后、persist 前校验 provider ∈ 三种，否则 `throw new Error(...)`
- [x] `importDroidByokConfigs` 同样校验

### T7. Unit Tests

- [x] `tests/unit/droidByokProviderInference.test.ts`（模糊匹配：opus/sonnet/claude→anthropic, gpt-5/codex/o3→openai, gemini/qwen/deepseek→generic）
- [x] `tests/unit/droidByokLoadRemoteCatalog.test.ts`（allSettled 行为：3 端点全 200 非空/2 空 1 非空/全 400）
- [x] `tests/unit/droidByokGoogleMigration.test.ts`（旧 google 条目迁移 + 幂等）
- [x] `tests/unit/droidSdkAgentErrorNotification.test.ts`（error notification 被转发到 onStreamEvent）

### T8. 质量闸门

- [x] `bun run lint:fix` — 0 errors, 1449 pre-existing warnings (unrelated)
- [x] `bun run format` — oxfmt 1974 files, exit 0
- [x] `bunx tsc --noEmit` — 无错误
- [x] `bun run test` 全绿 — 3779 passed, 27 skipped
- [x] `bun run i18n:types` — up to date
- [x] 修复 3 个 BYOK 相关回归测试（acpConversationBridge mock、droidByokService gemini-on-openai 推断、allSettled 语义）

### T9. Windows X64 构建

- [x] 清理前置依赖（按需）— 构建脚本自动执行 arm64→x64 原生模块 rebuild
- [x] `bun run build-win:x64:fast`（跳过 droid bundle + hub + aionrs，加速）— 4 分钟完成
- [x] 校验产物：
  - `out/智能体工厂-0.1.7-win-x64.exe` = 269 MB（NSIS installer，已签名）
  - `out/智能体工厂-0.1.7-win-x64.zip` = 429 MB（unpacked）
  - NSIS 内嵌 7z 存档 magic (`37 7a bc af 27 1c`) 在偏移 207933 → 格式合法

## 不做的事

- 不新增 IPC channel
- 不动 apiKey 明文存储路径
- 不改 mission/decomp 逻辑
- 不 bump version（0.1.7 Mission 里统一处理）

## 完成判据

- Windows 用户重新导入 Gemini 模型后 provider 自动推为 `generic-chat-completion-api`，发消息能收到正文或明确错误
- 获取模型一次点击可见 models
- 旧 `provider:'google'` 数据已自动迁移，用户无感知
