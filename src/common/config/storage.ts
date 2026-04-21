/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AcpBackend, AcpBackendAll, AcpBackendConfig } from '@/common/types/acpTypes';
import type { SpeechToTextConfig } from '@/common/types/speech';
import type { DroidByokModelProvider } from '../adapter/ipcBridge';
import type { FactoryModel } from './factoryModels';
import { storage } from '@office-ai/platform';

export type DroidRuntimePermissionMode = 'safe-auto' | 'deny-all' | 'custom';
export type DroidRuntimeOverloadStrategy = 'queue' | 'reject';
export type DroidChannelPlatform = 'telegram' | 'lark' | 'dingtalk' | 'weixin';

export type DroidChannelRuntimeConfig = {
  inheritDefaults?: boolean;
  maxConcurrentStarts?: number;
  maxConcurrentRuns?: number;
  maxWarmSessions?: number;
  warmTtlMs?: number;
  askReplyTtlMs?: number;
  maxQueuePerConversation?: number;
  maxQueuePerPublishedAgent?: number;
  overloadStrategy?: DroidRuntimeOverloadStrategy;
  permissionMode?: DroidRuntimePermissionMode;
  allowExecCommands?: string[];
  allowEditRoots?: string[];
  allowMcpTools?: string[];
};

export type ResolvedDroidChannelRuntimeConfig = Required<Omit<DroidChannelRuntimeConfig, 'inheritDefaults'>>;

export type ChannelPublishInstanceSettings = {
  workspace?: string;
  agent?: {
    backend: AcpBackendAll;
    customAgentId?: string;
    name?: string;
  };
  defaultModel?: {
    id: string;
    useModel: string;
  };
  droidRuntime?: DroidChannelRuntimeConfig;
};

export type ChannelPublishInstanceSettingsMap = Record<string, ChannelPublishInstanceSettings>;

export const CHANNEL_DROID_RUNTIME_PLATFORMS = ['telegram', 'lark', 'dingtalk', 'weixin'] as const;

export const DEFAULT_DROID_CHANNEL_RUNTIME_CONFIG: ResolvedDroidChannelRuntimeConfig = {
  maxConcurrentStarts: 1,
  maxConcurrentRuns: 2,
  maxWarmSessions: 4,
  warmTtlMs: 15 * 60 * 1000,
  askReplyTtlMs: 8 * 60 * 1000,
  maxQueuePerConversation: 10,
  maxQueuePerPublishedAgent: 40,
  overloadStrategy: 'queue',
  permissionMode: 'safe-auto',
  allowExecCommands: ['pwd', 'ls', 'rg', 'git status', 'git diff', 'bun run test', 'bunx tsc --noEmit'],
  allowEditRoots: [],
  allowMcpTools: [],
};

const sanitizePositiveInteger = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }

  const normalized = Math.trunc(value);
  return normalized > 0 ? normalized : undefined;
};

const sanitizeStringList = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);

  return normalized.length > 0 ? Array.from(new Set(normalized)) : [];
};

export const sanitizeDroidChannelRuntimeConfig = (
  value?: DroidChannelRuntimeConfig | null
): DroidChannelRuntimeConfig => {
  if (!value || typeof value !== 'object') {
    return {};
  }

  return {
    ...(typeof value.inheritDefaults === 'boolean' ? { inheritDefaults: value.inheritDefaults } : {}),
    ...(sanitizePositiveInteger(value.maxConcurrentStarts)
      ? { maxConcurrentStarts: sanitizePositiveInteger(value.maxConcurrentStarts) }
      : {}),
    ...(sanitizePositiveInteger(value.maxConcurrentRuns)
      ? { maxConcurrentRuns: sanitizePositiveInteger(value.maxConcurrentRuns) }
      : {}),
    ...(sanitizePositiveInteger(value.maxWarmSessions)
      ? { maxWarmSessions: sanitizePositiveInteger(value.maxWarmSessions) }
      : {}),
    ...(sanitizePositiveInteger(value.warmTtlMs) ? { warmTtlMs: sanitizePositiveInteger(value.warmTtlMs) } : {}),
    ...(sanitizePositiveInteger(value.askReplyTtlMs)
      ? { askReplyTtlMs: sanitizePositiveInteger(value.askReplyTtlMs) }
      : {}),
    ...(sanitizePositiveInteger(value.maxQueuePerConversation)
      ? { maxQueuePerConversation: sanitizePositiveInteger(value.maxQueuePerConversation) }
      : {}),
    ...(sanitizePositiveInteger(value.maxQueuePerPublishedAgent)
      ? { maxQueuePerPublishedAgent: sanitizePositiveInteger(value.maxQueuePerPublishedAgent) }
      : {}),
    ...(value.overloadStrategy === 'queue' || value.overloadStrategy === 'reject'
      ? { overloadStrategy: value.overloadStrategy }
      : {}),
    ...(value.permissionMode === 'safe-auto' || value.permissionMode === 'deny-all' || value.permissionMode === 'custom'
      ? { permissionMode: value.permissionMode }
      : {}),
    ...(sanitizeStringList(value.allowExecCommands)
      ? { allowExecCommands: sanitizeStringList(value.allowExecCommands) }
      : {}),
    ...(sanitizeStringList(value.allowEditRoots) ? { allowEditRoots: sanitizeStringList(value.allowEditRoots) } : {}),
    ...(sanitizeStringList(value.allowMcpTools) ? { allowMcpTools: sanitizeStringList(value.allowMcpTools) } : {}),
  };
};

export const resolveDroidChannelRuntimeConfig = (
  defaults?: DroidChannelRuntimeConfig | null,
  override?: DroidChannelRuntimeConfig | null
): ResolvedDroidChannelRuntimeConfig => {
  const normalizedDefaults = sanitizeDroidChannelRuntimeConfig(defaults);
  const normalizedOverride = sanitizeDroidChannelRuntimeConfig(override);
  const base =
    normalizedOverride.inheritDefaults === false
      ? DEFAULT_DROID_CHANNEL_RUNTIME_CONFIG
      : { ...DEFAULT_DROID_CHANNEL_RUNTIME_CONFIG, ...normalizedDefaults };

  const { inheritDefaults: _inheritDefaults, ...overrideSettings } = normalizedOverride;
  return {
    ...base,
    ...overrideSettings,
    allowExecCommands: overrideSettings.allowExecCommands ?? base.allowExecCommands,
    allowEditRoots: overrideSettings.allowEditRoots ?? base.allowEditRoots,
    allowMcpTools: overrideSettings.allowMcpTools ?? base.allowMcpTools,
  };
};

export const sanitizeChannelPublishInstanceSettings = (
  value?: ChannelPublishInstanceSettings | null
): ChannelPublishInstanceSettings => {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const agent =
    value.agent && typeof value.agent === 'object' && typeof value.agent.backend === 'string'
      ? {
          backend: value.agent.backend as AcpBackendAll,
          ...(typeof value.agent.customAgentId === 'string' && value.agent.customAgentId.trim()
            ? { customAgentId: value.agent.customAgentId.trim() }
            : {}),
          ...(typeof value.agent.name === 'string' && value.agent.name.trim() ? { name: value.agent.name.trim() } : {}),
        }
      : undefined;

  const defaultModel =
    value.defaultModel &&
    typeof value.defaultModel === 'object' &&
    typeof value.defaultModel.id === 'string' &&
    typeof value.defaultModel.useModel === 'string' &&
    value.defaultModel.id.trim() &&
    value.defaultModel.useModel.trim()
      ? {
          id: value.defaultModel.id.trim(),
          useModel: value.defaultModel.useModel.trim(),
        }
      : undefined;

  const workspace = typeof value.workspace === 'string' && value.workspace.trim() ? value.workspace.trim() : undefined;

  return {
    ...(workspace ? { workspace } : {}),
    ...(agent ? { agent } : {}),
    ...(defaultModel ? { defaultModel } : {}),
    ...(value.droidRuntime ? { droidRuntime: sanitizeDroidChannelRuntimeConfig(value.droidRuntime) } : {}),
  };
};

export const sanitizeChannelPublishInstanceSettingsMap = (value: unknown): ChannelPublishInstanceSettingsMap => {
  if (!value || typeof value !== 'object') {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([pluginId]) => typeof pluginId === 'string' && pluginId.trim())
      .map(([pluginId, settings]) => [pluginId, sanitizeChannelPublishInstanceSettings(settings)])
  );
};

/**
 * @description 聊天相关的存储
 */
export const ChatStorage = storage.buildStorage<IChatConversationRefer>('agent.chat');

// 聊天消息存储
export const ChatMessageStorage = storage.buildStorage('agent.chat.message');

// 系统配置存储
export const ConfigStorage = storage.buildStorage<IConfigStorageRefer>('agent.config');

// 系统环境变量存储
export const EnvStorage = storage.buildStorage<IEnvStorageRefer>('agent.env');

export interface IConfigStorageRefer {
  'gemini.config': {
    authType: string;
    proxy: string;
    GOOGLE_GEMINI_BASE_URL?: string;
    /** @deprecated Use accountProjects instead. Kept for backward compatibility migration. */
    GOOGLE_CLOUD_PROJECT?: string;
    /** 按 Google 账号存储的 GCP 项目 ID / GCP project IDs stored per Google account */
    accountProjects?: Record<string, string>;
    yoloMode?: boolean;
    /** Preferred session mode for new conversations / 新会话的默认模式 */
    preferredMode?: string;
  };
  'codex.config'?: {
    cliPath?: string;
    yoloMode?: boolean;
    sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
  };
  'acp.config': {
    [backend in AcpBackend]?: {
      authMethodId?: string;
      authToken?: string;
      lastAuthTime?: number;
      cliPath?: string;
      yoloMode?: boolean;
      /** Preferred session mode for new conversations / 新会话的默认模式 */
      preferredMode?: string;
      /** Preferred model ID for new conversations / 新会话的默认模型 */
      preferredModelId?: string;
      /** Dedicated spec-mode model ID for Droid mixed models / SPEC 规划阶段专用模型 */
      specModeModelId?: string;
      /** Dedicated spec-mode reasoning effort for Droid mixed models / SPEC 规划阶段专用推理强度 */
      specModeReasoningEffort?: string;
      /** @deprecated Use byokModelRefs instead. Kept for backward compatibility migration. */
      byokModelRef?: {
        model: string;
        baseUrl: string;
        provider: DroidByokModelProvider;
      };
      /** App-managed Factory Droid BYOK references / 客户端托管的 Factory Droid BYOK 引用 */
      byokModelRefs?: Array<{
        id: string;
        model: string;
        baseUrl: string;
        provider: DroidByokModelProvider;
      }>;
      /**
       * Optional BYOK site labels (display name only; ids/baseUrl/provider are
       * derived from `byokModelRefs`). Used purely for UI grouping in the
       * station-card view (M3.A). Labels are opt-in and may be absent for
       * sites migrated from the legacy flat list.
       *
       * BYOK 站点显示名映射（站点实体由 byokModelRefs 聚合得出，label 仅用于前端分组展示）。
       */
      byokSiteLabels?: Array<{
        id: string;
        label: string;
      }>;
      /**
       * Migration schema version for BYOK data — bump when the on-disk
       * layout changes so one-time migrations stay idempotent. See
       * `migrateLegacyModelsIntoSites()` in DroidByokService.
       *
       * BYOK 数据结构迁移版本号；在首次迁移后写入以避免重复运行。
       */
      byokMigrationVersion?: number;
      /** LLM prompt timeout in seconds (default: 300) / LLM 请求超时时间（秒，默认 300） */
      promptTimeout?: number;
    };
  };
  /** Global LLM prompt timeout in seconds (default: 300). Per-backend promptTimeout overrides this. */
  'acp.promptTimeout'?: number;
  'acp.customAgents'?: AcpBackendConfig[];
  // Cached model lists per ACP backend for Guid page pre-selection
  'acp.cachedModels'?: Record<string, import('@/common/types/acpTypes').AcpModelInfo>;
  // Cached config options per ACP backend for Guid page pre-selection
  'acp.cachedConfigOptions'?: Record<string, import('@/common/types/acpTypes').AcpSessionConfigOption[]>;
  // Runtime-refreshed Factory Droid model catalog
  factoryDroidCatalog?: FactoryModel[];
  'model.config': IProvider[];
  'mcp.config': IMcpServer[];
  'mcp.agentInstallStatus': Record<string, string[]>;
  language: string;
  theme: string;
  colorScheme: string;
  /** Persisted app-wide UI zoom factor for Display settings */
  'ui.zoomFactor'?: number;
  /** 桌面模式下是否自动启用 WebUI / Auto-enable WebUI in desktop mode */
  'webui.desktop.enabled'?: boolean;
  /** 桌面模式下是否允许远程访问 / Allow remote access in desktop mode */
  'webui.desktop.allowRemote'?: boolean;
  /** 桌面模式下 WebUI 端口 / WebUI port in desktop mode */
  'webui.desktop.port'?: number;
  customCss: string; // 自定义 CSS 样式
  'css.themes': ICssTheme[]; // 自定义 CSS 主题列表 / Custom CSS themes list
  'css.activeThemeId': string; // 当前激活的主题 ID / Currently active theme ID
  'gemini.defaultModel': string | { id: string; useModel: string };
  'tools.imageGenerationModel': TProviderWithModel & {
    /** @deprecated Image generation is now controlled via built-in MCP server toggle */
    switch?: boolean;
  };
  'tools.speechToText'?: SpeechToTextConfig;
  // 是否在粘贴文件到工作区时询问确认（true = 不再询问）
  'workspace.pasteConfirm'?: boolean;
  // 新增 Office 文件时是否自动打开预览 / Auto-open preview for newly added Office files
  'workspace.autoPreviewOffice'?: boolean;
  // 上传的文件是否保存到工作区目录（true = 保存到工作区，false = 保存到缓存目录）
  'upload.saveToWorkspace'?: boolean;
  // guid 页面上次选择的 agent 类型 / Last selected agent type on guid page
  'guid.lastSelectedAgent'?: string;
  // 迁移标记：修复老版本中助手 enabled 默认值问题 / Migration flag: fix assistant enabled default value issue
  'migration.assistantEnabledFixed'?: boolean;
  // 迁移标记：为 cowork 助手添加默认启用的 skills / Migration flag: add default enabled skills for cowork assistant
  /** @deprecated Use migration.builtinDefaultSkillsAdded_v2 instead */
  'migration.coworkDefaultSkillsAdded'?: boolean;
  // 迁移标记：为所有内置助手添加默认启用的 skills / Migration flag: add default enabled skills for all builtin assistants
  'migration.builtinDefaultSkillsAdded_v2'?: boolean;
  // 迁移标记：为所有内置助手添加 promptsI18n / Migration flag: add promptsI18n for all builtin assistants
  'migration.promptsI18nAdded'?: boolean;
  /** Migration flag: Electron desktop config has been imported to server config */
  'migration.electronConfigImported'?: boolean;
  // 关闭窗口时最小化到系统托盘 / Minimize to system tray when closing window
  'system.closeToTray'?: boolean;
  // 任务完成时显示系统通知 / Show system notification when task completes
  'system.notificationEnabled'?: boolean;
  // 定时任务完成时显示系统通知 / Show system notification when scheduled task completes
  'system.cronNotificationEnabled'?: boolean;
  // 阻止系统休眠以保证定时任务执行 / Prevent system sleep to ensure scheduled tasks run
  'system.keepAwake'?: boolean;
  // Telegram assistant default model / Telegram 助手默认模型
  'assistant.telegram.defaultModel'?: {
    id: string;
    useModel: string;
  };
  // Telegram assistant agent selection / Telegram 助手所使用的 Agent
  'assistant.telegram.agent'?: {
    backend: AcpBackendAll;
    customAgentId?: string;
    name?: string;
  };
  'assistant.telegram.droidRuntime'?: DroidChannelRuntimeConfig;
  // Lark assistant default model / Lark 助手默认模型
  'assistant.lark.defaultModel'?: {
    id: string;
    useModel: string;
  };
  // Lark assistant agent selection / Lark 助手所使用的 Agent
  'assistant.lark.agent'?: {
    backend: AcpBackendAll;
    customAgentId?: string;
    name?: string;
  };
  'assistant.lark.droidRuntime'?: DroidChannelRuntimeConfig;
  // DingTalk assistant default model / DingTalk 助手默认模型
  'assistant.dingtalk.defaultModel'?: {
    id: string;
    useModel: string;
  };
  // DingTalk assistant agent selection / DingTalk 助手所使用的 Agent
  'assistant.dingtalk.agent'?: {
    backend: AcpBackendAll;
    customAgentId?: string;
    name?: string;
  };
  'assistant.dingtalk.droidRuntime'?: DroidChannelRuntimeConfig;
  // WeChat assistant default model / WeChat 助手默认模型
  'assistant.weixin.defaultModel'?: {
    id: string;
    useModel: string;
  };
  // WeChat assistant agent selection / WeChat 助手所使用的 Agent
  'assistant.weixin.agent'?: {
    backend: AcpBackendAll;
    customAgentId?: string;
    name?: string;
  };
  'assistant.weixin.droidRuntime'?: DroidChannelRuntimeConfig;
  'assistant.droidRuntime.defaults'?: DroidChannelRuntimeConfig;
  'assistant.channel.publishInstances'?: ChannelPublishInstanceSettingsMap;
  // Skills Market: whether the aionui-skills builtin skill is enabled
  'skillsMarket.enabled'?: boolean;
}

export interface IEnvStorageRefer {
  'aionui.dir': {
    workDir: string;
    cacheDir: string;
  };
}

/**
 * Conversation source type - identifies where the conversation was created
 * 会话来源类型 - 标识会话创建的来源
 */
export type ConversationSource = 'aionui' | 'telegram' | 'lark' | 'dingtalk' | 'weixin' | (string & {});

interface IChatConversation<T, Extra> {
  createTime: number;
  modifyTime: number;
  name: string;
  desc?: string;
  id: string;
  type: T;
  extra: Extra;
  model: TProviderWithModel;
  status?: 'pending' | 'running' | 'finished' | undefined;
  /** 会话来源，默认为 aionui / Conversation source, defaults to aionui */
  source?: ConversationSource;
  /** Channel chat isolation ID (e.g. user:xxx, group:xxx) */
  channelChatId?: string;
  /** Channel plugin instance ID for multi-instance published channels */
  channelPluginId?: string;
}

// Token 使用统计数据类型
export interface TokenUsageData {
  totalTokens: number;
}

export type TChatConversation =
  | IChatConversation<
      'gemini',
      {
        workspace: string;
        customWorkspace?: boolean; // true 用户指定工作目录 false 系统默认工作目录
        webSearchEngine?: 'google' | 'default'; // 搜索引擎配置
        lastTokenUsage?: TokenUsageData; // 上次的 token 使用统计
        contextFileName?: string;
        contextContent?: string;
        // 系统规则支持 / System rules support
        presetRules?: string; // 系统规则，在初始化时注入 / System rules, injected at initialization
        /** 启用的 skills 列表，用于过滤 SkillManager 加载的 skills / Enabled skills list for filtering SkillManager skills */
        enabledSkills?: string[];
        /** 预设助手 ID，用于在会话面板显示助手名称和头像 / Preset assistant ID for displaying name and avatar in conversation panel */
        presetAssistantId?: string;
        /** 是否置顶会话 / Whether this conversation is pinned */
        pinned?: boolean;
        /** 置顶时间戳（毫秒）/ Pin timestamp in milliseconds */
        pinnedAt?: number;
        /** Persisted session mode for resume support / 持久化的会话模式，用于恢复 */
        sessionMode?: string;
        /** Explicit marker for temporary health-check conversations */
        isHealthCheck?: boolean;
        /** Cron job ID that spawned this conversation */
        cronJobId?: string;
      }
    >
  | Omit<
      IChatConversation<
        'acp',
        {
          workspace?: string;
          backend: AcpBackend;
          cliPath?: string;
          customWorkspace?: boolean;
          agentName?: string;
          customAgentId?: string; // UUID for identifying specific custom agent
          presetContext?: string; // 智能助手的预设规则/提示词 / Preset context from smart assistant
          /** 启用的 skills 列表，用于过滤 SkillManager 加载的 skills / Enabled skills list for filtering SkillManager skills */
          enabledSkills?: string[];
          /** 预设助手 ID，用于在会话面板显示助手名称和头像 / Preset assistant ID for displaying name and avatar in conversation panel */
          presetAssistantId?: string;
          /** 是否置顶会话 / Whether this conversation is pinned */
          pinned?: boolean;
          /** 置顶时间戳（毫秒）/ Pin timestamp in milliseconds */
          pinnedAt?: number;
          /** ACP 后端的 session UUID，用于会话恢复 / ACP backend session UUID for session resume */
          acpSessionId?: string;
          /** Conversation ID that owns the ACP session / 拥有该 ACP session 的会话 ID */
          acpSessionConversationId?: string;
          /** Workspace path that the ACP session was created for / ACP session 创建时绑定的工作区路径 */
          acpSessionWorkspace?: string;
          /** ACP session 最后更新时间 / Last update time of ACP session */
          acpSessionUpdatedAt?: number;
          /** Last context usage from usage_update */
          lastTokenUsage?: TokenUsageData;
          /** Context window capacity from usage_update */
          lastContextLimit?: number;
          /** Persisted session mode for resume support / 持久化的会话模式，用于恢复 */
          sessionMode?: string;
          /** Persisted model ID for resume support / 持久化的模型 ID，用于恢复 */
          currentModelId?: string;
          /** Cached config options from ACP backend / 缓存的 ACP 配置选项 */
          cachedConfigOptions?: import('@/common/types/acpTypes').AcpSessionConfigOption[];
          /** Pending config option selections from Guid page / Guid 页面待应用的配置选项 */
          pendingConfigOptions?: Record<string, string>;
          /** Explicit marker for temporary health-check conversations */
          isHealthCheck?: boolean;
          /** Cron job ID that spawned this conversation */
          cronJobId?: string;
        }
      >,
      'model'
    >
  | Omit<
      IChatConversation<
        'codex',
        {
          workspace?: string;
          cliPath?: string;
          customWorkspace?: boolean;
          sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access'; // Codex sandbox permission mode
          presetContext?: string; // 智能助手的预设规则/提示词 / Preset context from smart assistant
          /** 启用的 skills 列表，用于过滤 SkillManager 加载的 skills / Enabled skills list for filtering SkillManager skills */
          enabledSkills?: string[];
          /** 预设助手 ID，用于在会话面板显示助手名称和头像 / Preset assistant ID for displaying name and avatar in conversation panel */
          presetAssistantId?: string;
          /** 是否置顶会话 / Whether this conversation is pinned */
          pinned?: boolean;
          /** 置顶时间戳（毫秒）/ Pin timestamp in milliseconds */
          pinnedAt?: number;
          /** Persisted session mode for resume support / 持久化的会话模式，用于恢复 */
          sessionMode?: string;
          /** User-selected Codex model from Guid page / 用户在引导页选择的 Codex 模型 */
          codexModel?: string;
          /** Explicit marker for temporary health-check conversations */
          isHealthCheck?: boolean;
          /** Cron job ID that spawned this conversation */
          cronJobId?: string;
        }
      >,
      'model'
    >
  | Omit<
      IChatConversation<
        'openclaw-gateway',
        {
          workspace?: string;
          backend?: AcpBackendAll;
          agentName?: string;
          customWorkspace?: boolean;
          /** Gateway configuration */
          gateway?: {
            host?: string;
            port?: number;
            token?: string;
            password?: string;
            useExternalGateway?: boolean;
            cliPath?: string;
          };
          /** Session key for resume */
          sessionKey?: string;
          /** Runtime validation snapshot used for post-switch strong checks */
          runtimeValidation?: {
            expectedWorkspace?: string;
            expectedBackend?: string;
            expectedAgentName?: string;
            expectedCliPath?: string;
            expectedModel?: string;
            expectedIdentityHash?: string | null;
            switchedAt?: number;
          };
          /** 启用的 skills 列表 / Enabled skills list */
          enabledSkills?: string[];
          /** 预设助手 ID / Preset assistant ID */
          presetAssistantId?: string;
          /** 是否置顶会话 / Whether this conversation is pinned */
          pinned?: boolean;
          /** 置顶时间戳（毫秒）/ Pin timestamp in milliseconds */
          pinnedAt?: number;
          /** Explicit marker for temporary health-check conversations */
          isHealthCheck?: boolean;
          /** Cron job ID that spawned this conversation */
          cronJobId?: string;
        }
      >,
      'model'
    >
  | Omit<
      IChatConversation<
        'nanobot',
        {
          workspace?: string;
          customWorkspace?: boolean;
          /** 启用的 skills 列表 / Enabled skills list */
          enabledSkills?: string[];
          /** 预设助手 ID / Preset assistant ID */
          presetAssistantId?: string;
          /** 是否置顶会话 / Whether this conversation is pinned */
          pinned?: boolean;
          /** 置顶时间戳（毫秒）/ Pin timestamp in milliseconds */
          pinnedAt?: number;
          /** Explicit marker for temporary health-check conversations */
          isHealthCheck?: boolean;
          /** Cron job ID that spawned this conversation */
          cronJobId?: string;
        }
      >,
      'model'
    >
  | Omit<
      IChatConversation<
        'remote',
        {
          workspace?: string;
          customWorkspace?: boolean;
          /** Remote agent config ID (FK to remote_agents table) */
          remoteAgentId: string;
          /** Remote session key for resume */
          sessionKey?: string;
          /** Enabled skills list */
          enabledSkills?: string[];
          /** Preset assistant ID */
          presetAssistantId?: string;
          /** Whether this conversation is pinned */
          pinned?: boolean;
          /** Pin timestamp in milliseconds */
          pinnedAt?: number;
          /** Explicit marker for temporary health-check conversations */
          isHealthCheck?: boolean;
          /** Cron job ID that spawned this conversation */
          cronJobId?: string;
        }
      >,
      'model'
    >
  | IChatConversation<
      'aionrs',
      {
        workspace: string;
        customWorkspace?: boolean;
        proxy?: string;
        /** System rules injected at initialization */
        presetRules?: string;
        /** Enabled skills list */
        enabledSkills?: string[];
        /** Preset assistant ID */
        presetAssistantId?: string;
        /** Whether this conversation is pinned */
        pinned?: boolean;
        /** Pin timestamp in milliseconds */
        pinnedAt?: number;
        /** Max tokens per response */
        maxTokens?: number;
        /** Max agentic turns */
        maxTurns?: number;
        /** Persisted session mode for resume support */
        sessionMode?: string;
        /** Explicit marker for temporary health-check conversations */
        isHealthCheck?: boolean;
        /** Last token usage stats */
        lastTokenUsage?: TokenUsageData;
        /** Cron job ID that spawned this conversation */
        cronJobId?: string;
      }
    >;

export type IChatConversationRefer = {
  'chat.history': TChatConversation[];
};

export type ModelType =
  | 'text' // 文本对话
  | 'vision' // 视觉理解
  | 'function_calling' // 工具调用
  | 'image_generation' // 图像生成
  | 'web_search' // 网络搜索
  | 'reasoning' // 推理模型
  | 'embedding' // 嵌入模型
  | 'rerank' // 重排序模型
  | 'excludeFromPrimary'; // 排除：不适合作为主力模型

export type ModelCapability = {
  type: ModelType;
  /**
   * 是否为用户手动选择，如果为true，则表示用户手动选择了该类型，否则表示用户手动禁止了该模型；如果为undefined，则表示使用默认值
   */
  isUserSelected?: boolean;
};

export interface IProvider {
  id: string;
  platform: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string[];
  /**
   * 模型能力标签列表。打了标签就是支持，没打就是不支持
   */
  capabilities?: ModelCapability[];
  /**
   * 上下文token限制，可选字段，只在明确知道时填写
   */
  contextLimit?: number;
  /**
   * 每个模型的协议覆盖配置。映射模型名称到协议字符串。
   * 仅在 platform 为 'new-api' 时使用。
   * Per-model protocol overrides. Maps model name to protocol string.
   * Only used when platform is 'new-api'.
   * e.g. { "gemini-2.5-pro": "gemini", "claude-sonnet-4": "anthropic", "gpt-4o": "openai" }
   */
  modelProtocols?: Record<string, string>;
  /**
   * AWS Bedrock specific configuration
   * Only used when platform is 'bedrock'
   */
  bedrockConfig?: {
    authMethod: 'accessKey' | 'profile';
    region: string;
    // For access key method
    accessKeyId?: string;
    secretAccessKey?: string;
    // For profile method
    profile?: string;
  };
  /**
   * 供应商启用状态，默认为 true
   * Provider enabled state, defaults to true
   */
  enabled?: boolean;
  /**
   * 各个模型的启用状态，默认全部为 true
   * Individual model enabled states, defaults to all true
   */
  modelEnabled?: Record<string, boolean>;
  /**
   * 各个模型的健康检测结果（仅用于 UI 显示，不影响启用状态）
   * Model health check results (for UI display only, does not affect enabled state)
   */
  modelHealth?: Record<
    string,
    {
      status: 'unknown' | 'healthy' | 'unhealthy';
      lastCheck?: number; // 时间戳 / timestamp
      latency?: number; // 延迟时间（毫秒）/ latency in milliseconds
      error?: string; // 错误信息 / error message
    }
  >;
}

export type TProviderWithModel = Omit<IProvider, 'model'> & {
  useModel: string;
};

// MCP Server Configuration Types
export type McpTransportType = 'stdio' | 'sse' | 'http';

export interface IMcpServerTransportStdio {
  type: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface IMcpServerTransportSSE {
  type: 'sse';
  url: string;
  headers?: Record<string, string>;
}

export interface IMcpServerTransportHTTP {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
}

export interface IMcpServerTransportStreamableHTTP {
  type: 'streamable_http';
  url: string;
  headers?: Record<string, string>;
}

export type IMcpServerTransport =
  | IMcpServerTransportStdio
  | IMcpServerTransportSSE
  | IMcpServerTransportHTTP
  | IMcpServerTransportStreamableHTTP;

export interface IMcpServer {
  id: string;
  name: string;
  description?: string;
  enabled: boolean; // 是否已安装到 CLI agents（控制 Switch 状态）
  transport: IMcpServerTransport;
  tools?: IMcpTool[];
  status?: 'connected' | 'disconnected' | 'error' | 'testing'; // 连接状态（同时表示服务可用性）
  lastConnected?: number;
  createdAt: number;
  updatedAt: number;
  originalJson: string; // 存储原始JSON配置，用于编辑时的准确显示
  /** Built-in MCP server managed by AionUi (hide edit/delete in UI) */
  builtin?: boolean;
}

/** Stable ID for the built-in image generation MCP server */
export const BUILTIN_IMAGE_GEN_ID = 'builtin-image-gen';

export interface IMcpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

/**
 * CSS 主题配置接口 / CSS Theme configuration interface
 * 用于存储用户自定义的 CSS 皮肤 / Used to store user-defined CSS skins
 */
export interface ICssTheme {
  id: string; // 唯一标识 / Unique identifier
  name: string; // 主题名称 / Theme name
  cover?: string; // 封面图片 base64 或 URL / Cover image base64 or URL
  css: string; // CSS 样式代码 / CSS style code
  isPreset?: boolean; // 是否为预设主题 / Whether it's a preset theme
  createdAt: number; // 创建时间 / Creation time
  updatedAt: number; // 更新时间 / Update time
}
