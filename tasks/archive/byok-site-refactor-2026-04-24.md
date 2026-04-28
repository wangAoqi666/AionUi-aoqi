# BYOK 站点化改造 + 删除同步 + Windows 打包 (2026-04-24)

> **会话连续协议**：压缩会话或重启后，新一轮 Droid 必须先 `Read tasks/byok-site-refactor-todo.md` 恢复进度；每完成一个 check 项立即更新为 `[x]`；全部完成后把本文件移至 `tasks/archive/byok-site-refactor-2026-04-24.md`。

> **Spec 来源**：`~/.factory/specs/2026-04-23-byok-site-centric-overhaul-delete-sync-windows-build.md`（用户已批准）。

## 上下文

- Q1 删除不同步：`removeDroidByokConfig` 已写 settings.local.json；但 `probeDroidModelCatalog` 失败返回 null 时 catalog 保留旧值；对话页 `AcpModelSelector` 还叠加活动会话的 stale `availableModels`
- Q2 站点内加模型要重复输 apiKey：现设计为"明文 key 不离主进程"，要改成站点内 add-model 在**主进程内部**复用已存 key
- Q3 同一 baseUrl 不同 provider 被拆成两个站点：`siteId = sha1(provider|baseUrl)`

## 实施 Checklist

### T0. 准备

- [x] 创建 `tasks/byok-site-refactor-todo.md`
- [x] AGENTS.md / `.factory/rules/project.md` 注入"BYOK 站点化改造期间必读"条目

### T1. 站点 id 改为 baseUrl-only（Q3）

- [x] `DroidByokService.ts`
  - [x] 新增 `normalizeSiteBaseUrl(baseUrl)`（协议无关：lowercase scheme/host，trim trailing slash）
  - [x] 改 `buildDroidByokSiteId(baseUrl)` 只接收 baseUrl
  - [x] 改 `aggregateSites` 按 baseUrl 分组；每条模型 entry 在 site 下带自己的 provider
  - [x] `IDroidByokSite` schema：`provider` → `providers: DroidByokModelProvider[]`（按 provider 去重）
  - [x] `removeDroidByokSite` 删除同 baseUrl 所有 refs（不看 provider）
  - [x] `upsertDroidByokSite` 允许 provider 不传时保留每条模型原 provider
- [x] Label migration：
  - [x] 新 storage 字段 `droidByokSiteIdV2MigrationVersion?: number`
  - [x] 写 `migrateSiteLabelsToBaseUrlOnlyIds()`（幂等 + AIONUI_BYOK_LEGACY 跳过）
  - [x] `acpConversationBridge` 启动链路接入（在 migrateLegacyGoogleProvider 之后）

### T2. Add-to-site 免输 key（Q2）

- [x] 主进程新 API：
  - [x] `fetchDroidByokModelsForSite(siteId, refresh)` → 内部读 site 第一条 entry apiKey → 走 `loadRemoteCatalog`
  - [x] `importDroidByokConfigsIntoSite(siteId, selections)` → 复用站点 apiKey → 内部调 `importDroidByokConfigs`
- [x] IPC 通道：
  - [x] `fetchDroidByokModelsForSite`
  - [x] `importDroidByokConfigsIntoSite`
- [x] `acpConversationBridge` handler + `flushFactoryCatalogRefresh`
- [x] Renderer：
  - [x] `FactoryDroidByokModal` 新 prop `bindToSiteId?: string` + 对应 UI 模式
  - [x] baseUrl 只读；apiKey 字段隐藏；"使用站点 Key" 标识
  - [x] `FactoryDroidByokSiteCard.onAddModel` 传 siteId

### T3. 删除同步保底（Q1）

- [x] `DroidByokService.ts`
  - [x] 新增 `rebuildDroidCatalogFromRefs()`：in-memory 兜底
  - [x] `removeDroidByokConfig` / `removeDroidByokSite` 在 flushFactoryCatalogRefresh 之后调它
- [x] Renderer `AcpModelSelector`:
  - [x] 增加 `useEffect` 监听 factoryCatalog 变化
  - [x] 若 modelInfo.currentModelId 不在新 catalog 里 → 自动 `getModelInfo.invoke` 刷新

### T4. UI per-model provider tag（Q3 UI 侧）

- [x] `FactoryDroidByokSiteCard`
  - [x] 站点头去掉单一 provider tag
  - [x] 每条模型行显示自己 provider 的 tag
  - [x] `providers` 数组 → 站点头显示多 tag（e.g. "anthropic + openai"）

### T5. 单元测试

- [x] 更新 `tests/unit/process/bridge/droidByokSites.test.ts` 站点 id + providers[] 相关
- [x] 更新 `tests/unit/droidByokGoogleMigration.test.ts` buildLegacyDroidByokSiteId 种子
- [x] 新增 `tests/unit/droidByokSiteMergeProviders.test.ts`
- [x] 新增 `tests/unit/droidByokDeleteSync.test.ts`
- [x] 新增 `tests/unit/importDroidByokConfigsIntoSite.test.ts`
- [x] 更新 `tests/unit/renderer/components/settings/FactoryDroidByokSiteCard.dom.test.tsx`

### T6. i18n

- [x] 新增 `settings.droidByok.site.useExistingKey` (6 locales)
- [x] `bun run i18n:types`

### T7. 质量闸门

- [x] `bunx tsc --noEmit`
- [x] `bun run test` 全绿 (3786 passed / 27 skipped / 0 failed)
- [x] `bun run lint:fix` (0 errors, warnings only)
- [x] `bun run format`

### T8. Windows X64 构建

- [x] `bun run build-win:x64:fast`
- [x] 校验 NSIS exe + 内嵌 7z magic (offset 207917, MZ 头, 269 MB payload)

## 不做的事

- 不引入明文 key 经 renderer 返流
- 不改 apiKey 加密/存储路径
- 不 bump version

## 完成判据

- 同一 baseUrl 不同协议的模型归入同一站点卡片
- 从站点"+"加模型 → 无需再输 apiKey，直接 fetch
- 删除模型后：settings UI + 对话页模型选择器同步消失
