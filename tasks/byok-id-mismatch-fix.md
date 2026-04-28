# BYOK Model ID Mismatch Fix (2026-04-24) — v0.1.8

## Bug Summary

New conversations selecting a BYOK model fall back to the Factory default model.
The model selector displays a raw sha1 hash instead of the model name.
First message always fails with 400 "Invalid model ID"; second message works.

**Root cause**: `rebuildDroidCatalogFromRefs` used internal sha1 ref id as
`FactoryModel.id`. CLI only accepts `custom:<displayName>[-N]` format.
The sha1 was persisted as `modelId` → CLI returned 400 → `AcpAgentManager`
cleared it → fell back to `claude-opus-4-6`.

**First fix attempt (synthesize custom:xxx) also failed**: CLI appends `-N`
dedup suffix, so `custom:<displayName>` (without suffix) still didn't match.

**Final fix**: prune-only — never synthesize. CLI probe is the sole source
of truth for `FactoryModel.id`.

## Changes (Final — v0.1.8)

### 1. `src/process/bridge/services/DroidByokService.ts`

- [x] Removed `buildSynthesizedCustomModelId` and `byokConfigToFactoryModel` (no more synthesize)
- [x] `rebuildDroidCatalogFromRefs` is now prune-only: matches by `(provider, sourceModelId)` tuple,
      keeps CLI-reported entries verbatim, drops orphans, never creates new entries
- [x] `buildByokCatalogTupleKey` reduced to 2-arg `(provider, sourceModelId)`

### 2. `src/process/agent/droid/catalogRefresher.ts`

- [x] `runByokVerification` resolves BYOK config ids to CLI catalog ids via 2-arg tuple

### 3. `src/renderer/components/agent/AcpModelSelector.tsx`

- [x] Replaced stale-model-only effect with full catalog-sync effect:
      when `factoryCatalog` changes, rebuild `modelInfo.availableModels` from fresh catalog
      so newly added BYOK models appear immediately in conversation page dropdown

### 4. Rules & Memory

- [x] `.factory/rules/project.md` — added "BYOK 模型 ID 铁律" section
- [x] `.factory/memories.md` — added "BYOK 模型 ID 教训" with root cause + lesson learned

### 5. Version & Changelog

- [x] `package.json` → 0.1.8
- [x] `CHANGELOG.md` → 0.1.8 section

### 6. Quality Gates

- [x] `bunx tsc --noEmit` clean
- [x] `bun run test` all 3786 pass (27 skipped)
- [x] `bun run lint:fix` 0 errors
- [x] `bun run format` clean

### 7. Builds

- [x] Windows x64 → `out/智能体工厂-0.1.8-win-x64.exe`
- [x] Windows arm64 → `out/智能体工厂-0.1.8-win-arm64.exe`
- [x] Mac arm64 → `out/智能体工厂-0.1.8-mac-arm64.dmg`
- [x] Mac x64 → `out/智能体工厂-0.1.8-mac-x64.dmg`
