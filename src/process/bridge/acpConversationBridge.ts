/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import { acpDetector } from '@process/agent/acp/AcpDetector';
import { AcpConnection } from '@process/agent/acp/AcpConnection';
import { buildAcpModelInfo, summarizeAcpModelInfo } from '@process/agent/acp/modelInfo';
import { detectAionrs } from '@process/agent/aionrs/binaryResolver';
import type { IWorkerTaskManager } from '@process/task/IWorkerTaskManager';
import AcpAgentManager from '@process/task/AcpAgentManager';
import { GeminiAgentManager } from '@process/task/GeminiAgentManager';
import { AionrsManager } from '@process/task/AionrsManager';
import { mcpService } from '@/process/services/mcpServices/McpService';
import { mainLog, mainWarn } from '@/process/utils/mainLogger';
import { ProcessConfig, refreshFactoryDroidCatalog } from '@/process/utils/initStorage';
import { flushFactoryCatalogRefresh } from '@/process/agent/droid/catalogRefresher';
import { ipcBridge } from '@/common';
import { getFactoryModels } from '@/common/config/factoryModels';
import { checkDroidCliUpdate, probeDroidStatus } from '@process/agent/droid/modelProbe';
import { detectNodeRuntime, installOrUpdateDroidCli } from '@process/agent/droid/cliInstaller';
import {
  fetchDroidByokModels,
  getDroidByokConfigs,
  importDroidByokConfigs,
  listDroidByokSites,
  migrateLegacyModelsIntoSites,
  removeDroidByokConfig,
  removeDroidByokSite,
  rotateDroidByokSiteApiKey,
  saveDroidByokConfig,
  testDroidByokConfig,
  upsertDroidByokSite,
} from './services/DroidByokService';
import * as os from 'os';

export function initAcpConversationBridge(workerTaskManager: IWorkerTaskManager): void {
  // One-time BYOK migration to the site-aware shape. No-ops when
  // `AIONUI_BYOK_LEGACY=1` is set or the migration marker is already present.
  // Errors are swallowed inside the helper — startup must never crash on this.
  //
  // 一次性 BYOK 数据迁移（站点化 schema），AIONUI_BYOK_LEGACY=1 或已跑过则直接跳过。
  void migrateLegacyModelsIntoSites().catch((error) => {
    mainWarn('[ACP droid]', 'BYOK migration failed', error instanceof Error ? error.message : String(error));
  });

  // Debug provider to check environment variables
  ipcBridge.acpConversation.checkEnv.provider(() => {
    return Promise.resolve({
      env: {
        GEMINI_API_KEY: process.env.GEMINI_API_KEY ? '[SET]' : '[NOT SET]',
        GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT ? '[SET]' : '[NOT SET]',
        NODE_ENV: process.env.NODE_ENV || '[NOT SET]',
      },
    });
  });

  // 保留旧的detectCliPath接口用于向后兼容，但使用新检测器的结果
  ipcBridge.acpConversation.detectCliPath.provider(({ backend }) => {
    const agents = acpDetector.getDetectedAgents();
    const agent = agents.find((a) => a.backend === backend);

    if (agent?.cliPath) {
      return Promise.resolve({ success: true, data: { path: agent.cliPath } });
    }

    return Promise.resolve({
      success: false,
      msg: `${backend} CLI not found. Please install it and ensure it's accessible.`,
    });
  });

  // 新的ACP检测接口 - 基于全局标记位
  // Enrich with MCP transport support info so the frontend can show accurate counts
  ipcBridge.acpConversation.getAvailableAgents.provider(() => {
    try {
      const agents = acpDetector.getDetectedAgents();
      const enriched = agents.map((agent) => ({
        ...agent,
        supportedTransports: mcpService.getSupportedTransportsForAgent(agent),
      }));

      // Detect aionrs binary (non-ACP, uses JSON Lines protocol)
      // Insert at front so Aion CLI appears before other agents (including Gemini)
      const aionrs = detectAionrs();
      if (aionrs.available) {
        const aionrsAgent = { backend: 'aionrs' as const, name: 'Aion CLI', cliPath: aionrs.path };
        enriched.unshift({
          ...aionrsAgent,
          supportedTransports: mcpService.getSupportedTransportsForAgent(aionrsAgent),
        } as (typeof enriched)[number]);
      }

      return Promise.resolve({ success: true, data: enriched });
    } catch (error) {
      return Promise.resolve({
        success: false,
        msg: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // Refresh custom agents detection - called when custom agents config changes
  ipcBridge.acpConversation.refreshCustomAgents.provider(async () => {
    try {
      await acpDetector.refreshCustomAgents();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        msg: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // Test custom agent connection - validates CLI exists and ACP handshake works
  ipcBridge.acpConversation.testCustomAgent.provider(async (params) => {
    const { testCustomAgentConnection } = await import('./testCustomAgentConnection');
    return testCustomAgentConnection(params);
  });

  // Check agent health by sending a real test message
  // This is the most reliable way to verify an agent can actually respond
  ipcBridge.acpConversation.checkAgentHealth.provider(async ({ backend }) => {
    const startTime = Date.now();

    // Step 1: Check if CLI is installed
    const agents = acpDetector.getDetectedAgents();
    const agent = agents.find((a) => a.backend === backend);

    // Skip CLI check for claude/codebuddy (uses npx) and codex (has its own detection)
    if (!agent?.cliPath && backend !== 'claude' && backend !== 'codebuddy' && backend !== 'codex') {
      return {
        success: false,
        msg: `${backend} CLI not found`,
        data: { available: false, error: 'CLI not installed' },
      };
    }

    const tempDir = os.tmpdir();

    // Step 2: For ACP-based agents (claude, codex, gemini, qwen, etc.)
    const connection = new AcpConnection();

    try {
      // Connect to the agent
      await connection.connect(backend, agent?.cliPath, tempDir, agent?.acpArgs);

      // Create a new session
      await connection.newSession(tempDir);

      // Send a minimal test message - just need to verify we can communicate
      // Using a simple prompt that should get a quick response
      await connection.sendPrompt('hi');

      // If we get here, the agent responded successfully
      const latency = Date.now() - startTime;

      // Clean up
      await connection.disconnect();

      return {
        success: true,
        data: { available: true, latency },
      };
    } catch (error) {
      // Clean up on error
      try {
        await connection.disconnect();
      } catch {
        // Ignore disconnect errors
      }

      const errorMsg = error instanceof Error ? error.message : String(error);
      const lowerError = errorMsg.toLowerCase();

      // Check for authentication-related errors
      if (
        lowerError.includes('auth') ||
        lowerError.includes('login') ||
        lowerError.includes('credential') ||
        lowerError.includes('api key') ||
        lowerError.includes('unauthorized') ||
        lowerError.includes('forbidden')
      ) {
        return {
          success: false,
          msg: `${backend} not authenticated`,
          data: { available: false, error: 'Not authenticated' },
        };
      }

      return {
        success: false,
        msg: `${backend} health check failed: ${errorMsg}`,
        data: { available: false, error: errorMsg },
      };
    }
  });

  // Get current session mode for ACP/Gemini agents
  // 获取 ACP/Gemini 代理的当前会话模式
  // Use getTaskById (cache-only) to avoid spawning a worker process on read-only queries
  ipcBridge.acpConversation.getMode.provider(({ conversationId }) => {
    const task = workerTaskManager.getTask(conversationId);
    if (
      !task ||
      !(task instanceof AcpAgentManager || task instanceof GeminiAgentManager || task instanceof AionrsManager)
    ) {
      return Promise.resolve({
        success: true,
        data: { mode: 'default', initialized: false },
      });
    }
    return Promise.resolve({ success: true, data: task.getMode() });
  });

  // Get model info for ACP/Codex agents
  // 获取 ACP/Codex 代理的模型信息
  // Use getTaskById (cache-only) to avoid spawning a worker process on read-only queries
  ipcBridge.acpConversation.getModelInfo.provider(({ conversationId }) => {
    const task = workerTaskManager.getTask(conversationId);
    if (!task || !(task instanceof AcpAgentManager)) {
      return Promise.resolve({ success: true, data: { modelInfo: null } });
    }
    return Promise.resolve({
      success: true,
      data: { modelInfo: task.getModelInfo() },
    });
  });

  ipcBridge.acpConversation.getDroidModelCatalog.provider(async ({ refresh }) => {
    try {
      const catalog = refresh ? await refreshFactoryDroidCatalog() : getFactoryModels();
      return {
        success: true,
        data: { catalog },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      mainWarn('[ACP droid]', 'getDroidModelCatalog failed', errorMsg);
      return {
        success: true,
        data: { catalog: getFactoryModels() },
        msg: errorMsg,
      };
    }
  });

  ipcBridge.acpConversation.getDroidStatus.provider(async () => {
    try {
      const acpConfig = (await ProcessConfig.get('acp.config').catch((): undefined => undefined)) || {};
      const droidCliPath =
        acpConfig && typeof acpConfig === 'object' && 'droid' in acpConfig
          ? (acpConfig.droid as { cliPath?: string } | undefined)?.cliPath
          : undefined;

      return {
        success: true,
        data: await probeDroidStatus({
          cwd: os.homedir(),
          execPath: droidCliPath,
        }),
      };
    } catch (error) {
      return {
        success: false,
        msg: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcBridge.acpConversation.checkDroidCliUpdate.provider(async () => {
    try {
      const acpConfig = (await ProcessConfig.get('acp.config').catch((): undefined => undefined)) || {};
      const droidCliPath =
        acpConfig && typeof acpConfig === 'object' && 'droid' in acpConfig
          ? (acpConfig.droid as { cliPath?: string } | undefined)?.cliPath
          : undefined;

      return {
        success: true,
        data: await checkDroidCliUpdate({
          cwd: os.homedir(),
          execPath: droidCliPath,
        }),
      };
    } catch (error) {
      return {
        success: false,
        msg: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcBridge.acpConversation.detectDroidNodeRuntime.provider(async () => {
    try {
      return { success: true, data: await detectNodeRuntime() };
    } catch (error) {
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcBridge.acpConversation.installDroidCli.provider(async ({ mode }) => {
    try {
      const result = await installOrUpdateDroidCli({
        mode,
        onProgress: (progress) => {
          try {
            ipcBridge.acpConversation.droidCliInstallProgress.emit(progress);
          } catch {
            // ignore emit errors
          }
        },
      });
      return { success: result.success, data: result, ...(result.success ? {} : { msg: result.message }) };
    } catch (error) {
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcBridge.acpConversation.getDroidByokConfig.provider(async () => {
    try {
      return {
        success: true,
        data: {
          configs: await getDroidByokConfigs(),
        },
      };
    } catch (error) {
      return {
        success: false,
        msg: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcBridge.acpConversation.fetchDroidByokModels.provider(async (payload) => {
    try {
      return {
        success: true,
        data: {
          catalog: await fetchDroidByokModels(payload),
        },
      };
    } catch (error) {
      return {
        success: false,
        msg: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcBridge.acpConversation.testDroidByokConfig.provider(async (payload) => {
    try {
      return {
        success: true,
        data: {
          config: await testDroidByokConfig(payload),
        },
      };
    } catch (error) {
      return {
        success: false,
        msg: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcBridge.acpConversation.saveDroidByokConfig.provider(async (payload) => {
    try {
      const config = await saveDroidByokConfig(payload);
      // Flush-refresh immediately so the new BYOK entry is visible in the
      // main-process catalog before the renderer re-queries it. Errors are
      // caught + warn-logged inside the helper (never throw) and the helper
      // also updates `lastRefreshAt`, which lets the subsequent SDK-echoed
      // `settings_updated` notification hit the cooldown and skip a redundant
      // refresh. See `@process/agent/droid/catalogRefresher`.
      await flushFactoryCatalogRefresh('byok-crud-save');

      return {
        success: true,
        data: {
          config,
        },
      };
    } catch (error) {
      return {
        success: false,
        msg: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcBridge.acpConversation.importDroidByokConfigs.provider(async (payload) => {
    try {
      const result = await importDroidByokConfigs(payload, {
        onProgress: (progress) => {
          try {
            ipcBridge.acpConversation.droidByokImportProgress.emit(progress);
          } catch {
            // ignore emit errors
          }
        },
      });
      // See `saveDroidByokConfig` above — same rationale: flush refresh,
      // swallow errors, keep cooldown state for the SDK echo.
      await flushFactoryCatalogRefresh('byok-crud-import');

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        msg: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcBridge.acpConversation.removeDroidByokConfig.provider(async ({ id }) => {
    try {
      await removeDroidByokConfig(id);
      // See `saveDroidByokConfig` above — same rationale: flush refresh,
      // swallow errors, keep cooldown state for the SDK echo.
      await flushFactoryCatalogRefresh('byok-crud-remove');

      return {
        success: true,
      };
    } catch (error) {
      return {
        success: false,
        msg: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // --- BYOK site handlers (M3.A) ---
  // Site aggregation delegates to DroidByokService. Any CRUD op flushes the
  // Factory catalog so the renderer sees an up-to-date model list.
  //
  // 站点聚合 / CRUD，成功后统一 flush 刷新 Factory catalog，UI 拿到最新模型。
  ipcBridge.acpConversation.listDroidByokSites.provider(async () => {
    try {
      return {
        success: true,
        data: {
          sites: await listDroidByokSites(),
        },
      };
    } catch (error) {
      return {
        success: false,
        msg: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcBridge.acpConversation.upsertDroidByokSite.provider(async (payload) => {
    try {
      const site = await upsertDroidByokSite(payload);
      await flushFactoryCatalogRefresh('byok-site-crud');
      return { success: true, data: { site } };
    } catch (error) {
      return {
        success: false,
        msg: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcBridge.acpConversation.removeDroidByokSite.provider(async ({ id }) => {
    try {
      await removeDroidByokSite(id);
      await flushFactoryCatalogRefresh('byok-site-crud');
      return { success: true };
    } catch (error) {
      return {
        success: false,
        msg: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcBridge.acpConversation.rotateDroidByokSiteApiKey.provider(async ({ id, newApiKey }) => {
    try {
      const site = await rotateDroidByokSiteApiKey(id, newApiKey);
      await flushFactoryCatalogRefresh('byok-site-crud');
      return { success: true, data: { site } };
    } catch (error) {
      return {
        success: false,
        msg: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcBridge.acpConversation.probeModelInfo.provider(async ({ backend }) => {
    const agents = acpDetector.getDetectedAgents();
    const agent = agents.find((item) => item.backend === backend);

    if (!agent?.cliPath && backend !== 'claude' && backend !== 'codebuddy' && backend !== 'codex') {
      return {
        success: false,
        msg: `${backend} CLI not found`,
      };
    }

    const connection = new AcpConnection();
    const tempDir = os.tmpdir();

    try {
      await connection.connect(backend, agent?.cliPath, tempDir, agent?.acpArgs);
      await connection.newSession(tempDir);

      const modelInfo = buildAcpModelInfo(connection.getConfigOptions(), connection.getModels());
      if (backend === 'codex') {
        const initializeResult = connection.getInitializeResponse() as unknown as Record<string, unknown> | null;
        mainLog('[ACP codex]', 'probeModelInfo completed', {
          initializeAgentInfo: initializeResult?.agentInfo || null,
          modelInfo: summarizeAcpModelInfo(modelInfo),
        });
      }

      return { success: true, data: { modelInfo } };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (backend === 'codex') {
        mainWarn('[ACP codex]', 'probeModelInfo failed', errorMsg);
      }
      return { success: false, msg: errorMsg };
    } finally {
      try {
        await connection.disconnect();
      } catch {
        // Ignore cleanup failures for best-effort probes
      }
    }
  });

  // Set model for ACP agents
  // 设置 ACP 代理的模型
  ipcBridge.acpConversation.setModel.provider(async ({ conversationId, modelId }) => {
    try {
      const task = await workerTaskManager.getOrBuildTask(conversationId);
      if (!task || !(task instanceof AcpAgentManager)) {
        return {
          success: false,
          msg: 'Conversation not found or not an ACP agent',
        };
      }
      return {
        success: true,
        data: { modelInfo: await task.setModel(modelId) },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { success: false, msg: errorMsg };
    }
  });

  // Set session mode for ACP/Gemini agents (claude, qwen, gemini, etc.)
  // 设置 ACP/Gemini 代理的会话模式（claude、qwen、gemini 等）
  ipcBridge.acpConversation.setMode.provider(async ({ conversationId, mode }) => {
    try {
      const task = await workerTaskManager.getOrBuildTask(conversationId);
      if (!task) {
        return { success: false, msg: 'Conversation not found' };
      }
      if (!(task instanceof AcpAgentManager || task instanceof GeminiAgentManager || task instanceof AionrsManager)) {
        return {
          success: false,
          msg: 'Mode switching not supported for this agent type',
        };
      }
      return await task.setMode(mode);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { success: false, msg: errorMsg };
    }
  });

  // Toggle the "真 YOLO" skipPermissionsUnsafe flag for Droid SDK conversations.
  // Only the Droid SDK path supports this; other backends reply with an
  // "unsupported" failure so the renderer can fall back to the normal YOLO flow.
  // Hard rule (SKILL P0-3 / "不要做清单"): UI MUST present a second confirmation
  // modal before invoking this provider with confirmed=true.
  //
  // 切换 Droid SDK 真 YOLO 开关。只有 Droid 后端会真的下发 skipPermissionsUnsafe；
  // 其他后端直接报 "unsupported"。前端必须先弹二次确认，才允许 confirmed=true。
  ipcBridge.acpConversation.setSkipPermissionsUnsafe.provider(async ({ conversationId, confirmed }) => {
    try {
      const task = await workerTaskManager.getOrBuildTask(conversationId);
      if (!task || !(task instanceof AcpAgentManager)) {
        return { success: false, msg: 'Conversation not found' };
      }
      const result = await task.setSkipPermissionsUnsafe(confirmed);
      if (!result.success) {
        return { success: false, msg: result.msg };
      }
      return { success: true, data: { confirmed } };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { success: false, msg: errorMsg };
    }
  });

  // Update the Droid SDK tool whitelist (`enabledToolIds`) for a conversation.
  // Three-state semantics:
  //   - `toolIds: null`    → clear whitelist (SDK default tool set)
  //   - `toolIds: []`      → disable ALL tools (strict mode)
  //   - `toolIds: [id, …]` → only allow the listed tool ids
  // Only Droid SDK supports this; other backends return an "unsupported"
  // failure so the renderer can gracefully surface the limitation.
  //
  // 调整 Droid 后端工具白名单，其他后端返回 unsupported。三态语义：
  // null = 清空恢复默认；空数组 = 禁用全部；有值数组 = 仅允许列表中的工具。
  ipcBridge.acpConversation.setEnabledToolIds.provider(async ({ conversationId, toolIds }) => {
    try {
      const task = await workerTaskManager.getOrBuildTask(conversationId);
      if (!task || !(task instanceof AcpAgentManager)) {
        return { success: false, msg: 'Conversation not found' };
      }
      const result = await task.setEnabledToolIds(toolIds);
      if (!result.success) {
        return { success: false, msg: result.msg };
      }
      return { success: true, data: { toolIds } };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { success: false, msg: errorMsg };
    }
  });

  // Forward a user-triggered "report this to Factory" submission onto the Droid
  // SDK `submitBugReport` path. Only Droid backend supports this; other
  // backends return an unsupported-style failure. `clientLogs` is NEVER
  // attached (privacy); `includeSessionId` defaults to `true` so UI can opt
  // out via the "attach current session id" checkbox in the Modal.
  //
  // 转发 Droid 问题反馈给 AcpAgentManager，再由其交给 DroidSdkAgent。
  // 仅 Droid 后端可用；clientLogs 永远不会被附带。
  ipcBridge.acpConversation.submitBugReport.provider(
    async ({ conversationId, title, description, includeSessionId }) => {
      try {
        const task = await workerTaskManager.getOrBuildTask(conversationId);
        if (!task || !(task instanceof AcpAgentManager)) {
          return { success: false, msg: 'Conversation not found' };
        }
        const result = await task.submitBugReport({ title, description, includeSessionId });
        if (!result.success) {
          return { success: false, msg: result.msg };
        }
        return {
          success: true,
          data: result.reportId ? { reportId: result.reportId } : {},
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return { success: false, msg: errorMsg };
      }
    }
  );

  // Get non-model config options for ACP agents (e.g., reasoning effort)
  // 获取 ACP 代理的非模型配置选项（如推理级别）
  // Use getTaskById (cache-only) to avoid spawning a worker process on read-only queries
  ipcBridge.acpConversation.getConfigOptions.provider(({ conversationId }) => {
    const task = workerTaskManager.getTask(conversationId);
    if (!task || !(task instanceof AcpAgentManager)) {
      return Promise.resolve({ success: true, data: { configOptions: [] } });
    }
    return Promise.resolve({
      success: true,
      data: { configOptions: task.getConfigOptions() },
    });
  });

  // Set a config option value for ACP agents (e.g., reasoning effort)
  // 设置 ACP 代理的配置选项值（如推理级别）
  ipcBridge.acpConversation.setConfigOption.provider(async ({ conversationId, configId, value }) => {
    try {
      const task = await workerTaskManager.getOrBuildTask(conversationId);
      if (!task || !(task instanceof AcpAgentManager)) {
        return {
          success: false,
          msg: 'Conversation not found or not an ACP agent',
        };
      }
      const configOptions = await task.setConfigOption(configId, value);
      return { success: true, data: { configOptions } };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { success: false, msg: errorMsg };
    }
  });
}
