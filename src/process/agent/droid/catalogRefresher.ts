/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Factory Droid 模型目录热刷新调度器（P1-3，见
 * `.factory/skills/droid-sdk-integration/references/gaps-and-guidance.md`）。
 *
 * 应用场景：
 * - SDK 推送 `settings_updated` notification → `scheduleFactoryCatalogRefresh('settings-updated')`
 *   进行 debounce 合并，减少重复探测；同时通过 cooldown 避免刚刷新过的 catalog
 *   被 SDK 的 `settings_updated` 回声再次触发刷新，进而形成死循环。
 * - BYOK CRUD（save / remove / import）成功后 → `flushFactoryCatalogRefresh('byok-crud-*')`
 *   立即同步刷新，使前端保存成功后再调 `getDroidModelCatalog({ refresh: false })`
 *   就能拿到最新的 BYOK 模型。
 *
 * 硬约束：
 * - `refreshFactoryDroidCatalog()` 的调用全部在 helper 内部 try/catch：失败只打 warn，
 *   绝不 throw；主链路调用方（notification callback / IPC handler）感知不到异常。
 * - `scheduleFactoryCatalogRefresh('settings-updated')` 触发前会检查 cooldown：
 *   距离最近一次**成功**刷新 < `SETTINGS_UPDATED_COOLDOWN_MS` 时直接跳过。
 * - 不扩展 IPC bridge：刷新后 catalog 更新在主进程内存里，渲染端通过现成
 *   `ipcBridge.acpConversation.getDroidModelCatalog({ refresh: false | true })`
 *   主动拉取即可。
 */

import { refreshFactoryDroidCatalog } from '@process/utils/initStorage';
import { getFactoryModels } from '@/common/config/factoryModels';
import { mainLog, mainWarn } from '@process/utils/mainLogger';
import { getDroidByokConfigs, verifyByokCapabilitiesAgainstCli } from '@/process/bridge/services/DroidByokService';
import { ipcBridge } from '@/common';

/** 默认 debounce 间隔（~500ms）。多次连续调用会合并成一次刷新。 */
const DEFAULT_DEBOUNCE_MS = 500;

/**
 * `settings-updated` 触发的 cooldown：刚刷新过后短时间内若再次收到 SDK 的
 * `settings_updated` 回声，跳过以避免无限循环。
 */
const SETTINGS_UPDATED_COOLDOWN_MS = 2000;

/** 模块级状态。测试需要用 `__resetCatalogRefresherForTests()` 重置。 */
let lastRefreshAt = 0;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let pendingInvocation: Promise<void> | null = null;
let pendingReason: string | null = null;

/**
 * 内部：执行一次刷新，成功后更新 `lastRefreshAt`。错误只打 warn，不向外抛。
 */
function performRefreshInternal(reason: string): Promise<void> {
  return refreshFactoryDroidCatalog()
    .then(() => {
      lastRefreshAt = Date.now();
      mainLog('[catalogRefresher]', 'refresh completed', { reason });
    })
    .catch((error) => {
      mainWarn('[catalogRefresher]', 'refresh failed', {
        reason,
        err: error instanceof Error ? error.message : String(error),
      });
    });
}

/**
 * 在 `delayMs` 之后刷新一次 Factory Droid 模型目录。
 *
 * - 多次连续调用会在 debounce 窗口内合并成一次刷新（只保留最后一次 reason 用于日志）。
 * - 当 `reason === 'settings-updated'` 且距离最近一次成功刷新 < 2s 时，直接跳过，
 *   用以避免 SDK 在 catalog 刷新后自动回发 `settings_updated` 导致的死循环。
 *
 * @param reason  触发原因（仅日志，`'settings-updated'` 额外走 cooldown）。
 * @param delayMs debounce 延迟（默认 500ms）。
 */
export function scheduleFactoryCatalogRefresh(reason: string, delayMs = DEFAULT_DEBOUNCE_MS): void {
  if (reason === 'settings-updated' && lastRefreshAt > 0) {
    const elapsedMs = Date.now() - lastRefreshAt;
    if (elapsedMs < SETTINGS_UPDATED_COOLDOWN_MS) {
      mainLog('[catalogRefresher]', 'skipping settings-updated within cooldown', {
        elapsedMs,
        cooldownMs: SETTINGS_UPDATED_COOLDOWN_MS,
      });
      return;
    }
  }

  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }

  pendingReason = reason;
  pendingTimer = setTimeout(
    () => {
      pendingTimer = null;
      const activeReason = pendingReason ?? reason;
      pendingReason = null;
      pendingInvocation = performRefreshInternal(activeReason).finally(() => {
        pendingInvocation = null;
      });
    },
    Math.max(0, delayMs)
  );
}

/**
 * 立即刷新 Factory Droid 模型目录并等待完成。
 *
 * - 取消任何 pending debounce timer。
 * - 如果已有 in-flight 刷新，复用同一个 promise（`refreshFactoryDroidCatalog` 内部
 *   也有 in-flight dedup，这里只是让并发 flush 等到同一个结果）。
 * - 错误只会在内部被 log；返回 promise 永远 resolve。
 * - 当 reason 以 `byok-` 开头时，刷新成功后运行一次 BYOK 能力校验。
 *
 * 主要用于 BYOK CRUD IPC handler：调用方 save BYOK 成功后立刻 flush 刷新，
 * 让主进程内存 catalog 立即反映新 / 删除的模型。
 */
export async function flushFactoryCatalogRefresh(reason: string = 'flush'): Promise<void> {
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
    pendingReason = null;
  }
  if (!pendingInvocation) {
    pendingInvocation = performRefreshInternal(reason).finally(() => {
      pendingInvocation = null;
    });
  }
  await pendingInvocation;

  // Run BYOK capability verification after BYOK CRUD operations
  if (reason.startsWith('byok-')) {
    await runByokVerification();
  }
}

/**
 * Run BYOK capability verification against the refreshed CLI catalog.
 *
 * Called once after each BYOK CRUD flush. Reads local BYOK configs,
 * compares them against the just-refreshed `getFactoryModels()` catalog,
 * and emits a non-blocking IPC event if any conflicts are detected.
 *
 * Never throws — all errors are caught and logged.
 */
async function runByokVerification(): Promise<void> {
  try {
    const byokConfigs = await getDroidByokConfigs();
    if (byokConfigs.length === 0) {
      return;
    }

    const catalogModels = getFactoryModels();
    // Map FactoryModel → the shape verifier expects (id + noImageSupport)
    const cliModels = catalogModels.map((m) => ({
      id: m.id,
      noImageSupport: m.supportsImageInput !== true ? true : undefined,
    }));

    const localConfigs = byokConfigs.map((c) => ({
      id: c.id,
      model: c.model,
      supportsImageInput: c.supportsImageInput,
    }));

    const result = verifyByokCapabilitiesAgainstCli(localConfigs, cliModels);

    if (result.conflict.length > 0) {
      ipcBridge.acpConversation.droidByokCapabilityDrift.emit(result);
      mainLog('[CatalogRefresher]', 'BYOK capability drift detected', {
        conflicts: result.conflict.length,
        ok: result.ok.length,
        missing: result.missing.length,
      });
    }
  } catch (error) {
    mainWarn('[CatalogRefresher]', 'BYOK verification failed (non-blocking)', {
      err: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * 测试辅助：重置 helper 的模块级状态。生产代码绝不要调用。
 * 每个 `droidCatalogRefresh.test.ts` 的 `beforeEach` 都应调用一次，避免跨用例干扰。
 */
export function __resetCatalogRefresherForTests(): void {
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  pendingReason = null;
  pendingInvocation = null;
  lastRefreshAt = 0;
}
