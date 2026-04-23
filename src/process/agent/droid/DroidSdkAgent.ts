/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * DroidSdkAgent — Factory Droid backend powered by @factory/droid-sdk.
 *
 * Replaces the generic ACP protocol path for the droid backend with the
 * native JSON-RPC protocol via the SDK, enabling:
 *   - Runtime model switching (updateSessionSettings)
 *   - Typed streaming messages (assistant_text_delta, tool_use, etc.)
 *   - MCP server management (listMcpServers, addMcpServer, etc.)
 *   - Skill listing (listSkills)
 *   - Session resume (resumeSession)
 */

import type {
  AddMcpServerRequestParams,
  AddMcpServerResult,
  AskUserQuestion,
  AuthenticateMcpServerRequestParams,
  AuthenticateMcpServerResult,
  ListMcpServersResult,
  ListMcpToolsResult,
  ListSkillsResult,
  McpServerStatusInfo,
  McpToolInfo,
  MessageOptions,
  ReasoningEffort,
  RemoveMcpServerResult,
  SkillInfo,
  ToggleMcpServerResult,
} from '@factory/droid-sdk';
import {
  createSession,
  resumeSession,
  ToolConfirmationOutcome,
  AutonomyLevel,
  DecompSessionType,
  DroidInteractionMode,
  type DroidSession,
  type CreateSessionOptions,
} from '@factory/droid-sdk';
import type { IResponseMessage } from '@/common/adapter/ipcBridge';
import type { AskUserConfirmationQuestion } from '@/common/chat/chatLib';
import type { ConversationSource, ResolvedDroidChannelRuntimeConfig } from '@/common/config/storage';
import type { AcpModelInfo, AcpPermissionRequest, AcpResult, AcpSessionConfigOption } from '@/common/types/acpTypes';
import { AcpErrorType, createAcpError } from '@/common/types/acpTypes';
import { uuid } from '@/common/utils';
import {
  buildFactoryDroidConfigOptions,
  FACTORY_REASONING_CONFIG_ID,
  FACTORY_SPEC_MODEL_CONFIG_ID,
  FACTORY_SPEC_MODEL_USE_MAIN_VALUE,
  FACTORY_SPEC_REASONING_CONFIG_ID,
  getFactoryDefaultModelId,
  getFactoryDroidModelInfo,
  getFactoryModelById,
  resolveFactoryReasoning,
  resolveFactorySpecModel,
  type ReasoningLevel,
} from '@/common/config/factoryModels';
import { app } from 'electron';
import { DroidMessageMapper } from './messageMapper';
import { mainLog, mainWarn } from '@process/utils/mainLogger';
import { getEnhancedEnv } from '@process/utils/shellEnv';
import { scheduleFactoryCatalogRefresh } from './catalogRefresher';
import appPackageJson from '../../../../package.json';
import { resolveWorkingDroidCli } from './cliRuntime';
import { loadDroidRuntimeConfigForSource, getDroidRuntimeScopeKey, isDroidChannelPlatform } from './runtime/config';
import { DroidPermissionPolicy } from './runtime/DroidPermissionPolicy';
import { DroidTextAskBridge, type DroidAskUserAnswerPayload } from './runtime/DroidTextAskBridge';
import type { DroidRuntimeScheduler, DroidRuntimeTurnController } from './runtime/DroidRuntimeScheduler';
import { getDroidRuntimeScheduler } from './runtime/DroidRuntimeScheduler';
import { AcpSkillManager, type SdkSkill, type SdkSkillKind } from '@process/task/AcpSkillManager';
import { mapDroidNotification, type NotificationMappedResult } from './runtime/notificationMapper';
import {
  diffMissingMcpServers,
  normalizeDesiredMcpServers,
  toAddMcpServerParams,
  type DesiredMcpServer,
} from './runtime/mcpSync';
import {
  contentHasLegacyFileReference,
  resolveAttachmentsForDroid,
  type ResolvedAttachments,
  type SkippedAttachment,
} from './runtime/messageAttachments';
import { getDroidByokConfigs } from '@process/bridge/services/DroidByokService';
import type { IDroidByokModelConfig } from '@/common/adapter/ipcBridge';

type DroidSessionSettings = Parameters<DroidSession['updateSettings']>[0];

/**
 * Bounded tokens used by `classifySdkSkill` to identify subagent-style
 * skills. Lowercase, exact form expected inside the haystack — the bounded
 * match logic in `containsBoundedToken` treats path/word separators as
 * boundaries, so e.g. `/.../subagent/...` and `research-subagent` both
 * match while `agent-factory` / `droidflyer` / `droid-skill-agent-of-truth`
 * do NOT.
 *
 * NEVER add bare `agent` or `droid` here — the whole point of the m1-f4
 * hardening is that substring-matching those words false-positively flags
 * user-installed skills whose path happens to live under the
 * `agent-factory/` project directory.
 */
const SUBAGENT_BOUNDED_TOKENS = ['subagent', 'custom-droid', 'custom_droid'] as const;

/**
 * Characters treated as token boundaries when scanning `name` / `filePath`
 * for subagent markers. `/` and `\` catch path segments; `.`, `_`, `-`, and
 * whitespace cover hyphen/underscore-delimited compound names (e.g.
 * `my-subagent`, `research_subagent`).
 */
const BOUNDARY_CHAR_PATTERN = /[/\\._\-\s]/;

/**
 * Return true iff `haystack` contains one of `tokens` bounded on both sides
 * by either a string edge or one of the boundary characters defined in
 * `BOUNDARY_CHAR_PATTERN`. The comparison is case-insensitive.
 *
 * 在 haystack 中查找任意 token, 左右必须是字符串边界或路径 / 词分隔符，
 * 目的是避免 `includes('agent')` / `includes('droid')` 造成的假阳性。
 */
function containsBoundedToken(haystack: string, tokens: readonly string[]): boolean {
  const lower = haystack.toLowerCase();
  for (const token of tokens) {
    if (token.length === 0) continue;
    let fromIndex = 0;
    while (fromIndex <= lower.length) {
      const idx = lower.indexOf(token, fromIndex);
      if (idx === -1) break;
      const beforeOk = idx === 0 || BOUNDARY_CHAR_PATTERN.test(lower.charAt(idx - 1));
      const afterIdx = idx + token.length;
      const afterOk = afterIdx === lower.length || BOUNDARY_CHAR_PATTERN.test(lower.charAt(afterIdx));
      if (beforeOk && afterOk) return true;
      fromIndex = idx + 1;
    }
  }
  return false;
}

/**
 * Public-facing shape for `listMcpServers()` entries. Re-exported as a type
 * alias to avoid forcing callers of `DroidSdkAgent` to depend on the SDK
 * module — hard constraint #1 from the task spec.
 *
 * 对外暴露的 MCP server summary 结构。直接复用 SDK 类型（只是 type 别名），
 * 避免外部文件 import SDK 运行期 API。
 */
export type McpServerSummary = McpServerStatusInfo;

/** Public-facing shape for `listMcpTools()` entries. */
export type McpToolSummary = McpToolInfo;

/**
 * Params accepted by `DroidSdkAgent.addMcpServer(...)`. Structurally identical
 * to the SDK's `AddMcpServerRequestParams` — re-exported so callers don't need
 * to `import` from `@factory/droid-sdk` directly.
 */
export type AddMcpServerParams = AddMcpServerRequestParams;

/** Params accepted by `DroidSdkAgent.authenticateMcpServer(...)`. */
export type AuthMcpServerParams = AuthenticateMcpServerRequestParams;

/**
 * Team-scoped stdio MCP injection description accepted by
 * `DroidSdkAgentConfig.teamMcpStdioConfig`. Identical to the existing
 * `TeamMcpStdioConfig` used by the ACP path — we deliberately accept the
 * legacy `env: Array<{name, value}>` shape for source compatibility.
 */
export interface DroidTeamMcpStdioConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Array<{ name: string; value: string }>;
}

/**
 * Shape of the mode-derived settings merged into `CreateSessionOptions` / `session.updateSettings`.
 *
 * `skipPermissionsUnsafe` is part of the SDK's internal `InitializeSessionRequestParams`
 * (see `@factory/droid-sdk/dist/index.d.ts` line ~11039) but the public
 * `CreateSessionOptions` TS interface in 0.1.4 doesn't surface it, nor does
 * `UpdateSessionSettingsRequestParamsSchema`. Same story for `decompSessionType`
 * (SDK P2-1 mission/decomp hook) which the internal `initializeSession` schema
 * accepts but the public TS shape omits. We widen the mode-settings return
 * type here so we can still express the intent without losing type safety on
 * the other fields. `skipPermissionsUnsafe` is only ever set to `true` after
 * an explicit UI confirmation (see `setSkipPermissionsUnsafe` +
 * `SkipPermissionsConfirmModal`); `decompSessionType` is only set when the
 * caller explicitly selected `sessionMode: 'mission'`.
 *
 * 为什么要这个类型：
 * - SDK 0.1.4 的公共 CreateSessionOptions / UpdateSessionSettingsRequestParams
 *   都没有暴露 skipPermissionsUnsafe 和 decompSessionType，但底层 JSON-RPC 的
 *   init / update 都支持这些字段；
 * - skipPermissionsUnsafe 必须"显式二次确认"才写，默认永远是 undefined；
 * - decompSessionType 仅在 mission 模式下由 getSessionSettingsForMode 注入，
 *   由 createSession 后的 updateSettings 通过 unknown 强制类型注入，避免被
 *   @factory/droid-sdk 的 createSession() 包装器在复制 options 时静默丢弃。
 */
type DroidModeSettings = Pick<CreateSessionOptions, 'interactionMode' | 'autonomyLevel'> & {
  skipPermissionsUnsafe?: boolean;
  decompSessionType?: DecompSessionType;
};

export type DroidSdkAgentConfig = {
  id: string;
  workingDir: string;
  cliPath?: string;
  modelId?: string;
  yoloMode?: boolean;
  sessionMode?: string;
  acpSessionId?: string;
  cachedConfigOptions?: AcpSessionConfigOption[];
  pendingConfigOptions?: Record<string, string>;
  onStreamEvent: (data: IResponseMessage) => void;
  onSignalEvent?: (data: IResponseMessage) => void;
  onSessionIdUpdate?: (sessionId: string) => void;
  onAskUserRequest?: (data: { callId: string; questions: AskUserConfirmationQuestion[] }) => void;
  source?: ConversationSource;
  runtimeSettings?: ResolvedDroidChannelRuntimeConfig;
  onPublishedRuntimeSettingsUpdate?: (settings: ResolvedDroidChannelRuntimeConfig) => void;
  /**
   * Team-scoped stdio MCP config (same shape AcpAgent's `extra.teamMcpStdioConfig`
   * accepts). Passed-through by `AcpAgentManager`; the Droid path will register
   * it via `session.addMcpServer(...)` during `syncMcpServersOnStartup()` when
   * it's not already present on the live session.
   */
  teamMcpStdioConfig?: DroidTeamMcpStdioConfig;
  /**
   * Optional project / user MCP servers that should be registered on startup.
   * Each entry is converted to `AddMcpServerRequestParams`; entries already
   * present in the session are skipped. Shape is intentionally the storage
   * shape (`IMcpServer.transport` split across fields) flattened.
   */
  projectMcpServers?: DesiredMcpServer[];
  /**
   * Mission id to attach to the session when `sessionMode === 'mission'`
   * (Factory Droid P2-1 decomp / mission hook). When present, the agent will
   * push `{ decompSessionType: Orchestrator, decompMissionId }` to the CLI via
   * `session.updateSettings(...)` immediately after `createSession()` (the
   * public `CreateSessionOptions` shape doesn't expose the fields, so they
   * are injected via the same `unknown`-cast pattern used for
   * `skipPermissionsUnsafe`). If `sessionMode !== 'mission'` this field is
   * ignored — setting it alone does NOT switch the session into mission mode.
   *
   * 仅当 sessionMode 为 'mission' 时生效。该字段由调用方（AcpAgentManager /
   * mission UI）传入，作为一次会话绑定的 mission id。非 mission 模式时即使
   * 设置了也不会被下发给 CLI。
   */
  decompMissionId?: string;
  /**
   * Tool whitelist (SKILL P2-2). When set, the Droid CLI will ONLY allow the
   * listed tool ids for this session — any other tool call is rejected. The
   * SDK's public `CreateSessionOptions.enabledToolIds` is plumbed through to
   * `createSession({ enabledToolIds })` on a fresh session; for a resumed
   * session (or a runtime change via `setEnabledToolIds(...)`) the agent
   * pushes it via `session.updateSettings({ enabledToolIds })`.
   *
   * ── Semantics ──
   * - `undefined` → "user hasn't configured a whitelist; let the SDK / CLI use
   *   its default tool set". MUST NOT send the field at all.
   * - `[]`        → "user explicitly disabled every tool". MUST send the empty
   *   array as-is so the CLI enforces the whitelist. The SDK zod schema accepts
   *   an empty `string[]` (see `index.d.ts` `enabledToolIds: z.ZodOptional<z.ZodArray<z.ZodString, "many">>`),
   *   so the difference between "unset" and "empty" is preserved.
   * - `[id1, id2, …]` → pass through verbatim; unknown ids surface as CLI
   *   errors at tool-use time, not here.
   *
   * 语义区分（P2-2 硬约束）：
   *   undefined = 从未设置，交给 SDK 默认行为，不发字段；
   *   空数组    = 用户显式禁用所有工具，照原样下发；
   *   有值数组  = 白名单下发，未知 id 由 CLI 在执行时报错。
   */
  enabledToolIds?: string[];
};

const ASK_USER_TOOL_FORMAT_REMINDER =
  `<system-reminder>\n` +
  `When using the AskUser tool, the questionnaire must use the exact numbered format:\n` +
  `1. [question] Your question text\n` +
  `[topic] Short topic label\n` +
  `[option] First option\n` +
  `Use 1-4 numbered questions and never omit the leading number.\n` +
  `</system-reminder>\n\n`;

const SPEC_MODE_EXECUTION_REMINDER =
  `<system-reminder>\n` +
  `Specification Mode is active.\n` +
  `You are in planning mode only. Do not create, edit, move, or delete files, and do not run commands that modify the workspace.\n` +
  `Do not start implementation yet, even if the user directly asks you to build or change something.\n` +
  `First analyze the request, prepare a complete markdown implementation plan, and then use the ExitSpecMode tool so the user can review and approve the plan.\n` +
  `Use AskUser only if a blocking requirement is missing and you cannot produce a reasonable plan without clarification. If you must use AskUser, its questionnaire must use the exact numbered format:\n` +
  `1. [question] Your question text\n` +
  `[topic] Short topic label\n` +
  `[option] First option\n` +
  `When there are multiple strong implementation approaches, include optionNames in ExitSpecMode so the user can choose.\n` +
  `Remain in Specification Mode until ExitSpecMode is approved.\n` +
  `</system-reminder>\n\n`;

/**
 * Heuristic: is this modelId produced by a BYOK/custom provider rather than a
 * first-party Factory cloud model? Used to decide whether to trust a modelId
 * that isn't in the main-process catalog cache (so we don't silently fall back
 * to the Factory default when the catalog is still being probed asynchronously).
 *
 * 判断一个 modelId 是否看起来像 BYOK/自定义模型：主进程 catalog 还没探测完时，
 * 我们信任这种格式的 id 直接下放给 CLI，避免在启动竞速期被静默替换为默认模型。
 */
const isLikelyByokModelId = (modelId: string): boolean => {
  if (!modelId) return false;
  return modelId.startsWith('custom:') || modelId.includes('[BYOK]');
};

/**
 * Resolve whether the currently selected model supports image attachments.
 *
 * Precedence (highest wins):
 *   1. `FACTORY_MODELS` entry with an explicit `supportsImageInput` boolean —
 *      the hard-coded catalog treats this field as optional, so we only honor
 *      booleans (never `undefined`).
 *   2. A BYOK model config whose id / managed id / displayName matches the
 *      currentModelId. BYOK configs always carry a concrete
 *      `supportsImageInput` boolean (inferred at normalization time).
 *   3. `undefined` → caller should treat this as "capability unknown" and let
 *      the image through. We never silently drop images unless we have
 *      concrete negative evidence.
 *
 * Why lookup per send? The BYOK list can change mid-session (user toggles the
 * capability from the settings modal), and caching would leak stale values
 * into the next turn. The call is an in-memory JSON-file read — negligible.
 *
 * 判断当前选中模型是否支持图片输入；用于 M3.B 的图片附件门控。
 */
const resolveCurrentModelSupportsImageInput = async (modelId: string): Promise<boolean | undefined> => {
  const catalogModel = getFactoryModelById(modelId);
  if (catalogModel && typeof catalogModel.supportsImageInput === 'boolean') {
    return catalogModel.supportsImageInput;
  }

  try {
    const byokConfigs: IDroidByokModelConfig[] = await getDroidByokConfigs();
    const byokMatch = byokConfigs.find(
      (config) =>
        modelId === config.id ||
        modelId === `managed-byok:${config.id}` ||
        modelId === config.model ||
        modelId === config.displayName
    );
    if (byokMatch && typeof byokMatch.supportsImageInput === 'boolean') {
      return byokMatch.supportsImageInput;
    }
  } catch {
    // ignore — unknown capability → allow image through
  }

  return undefined;
};

/**
 * Extract the declared version of `@factory/droid-sdk` from the host
 * `package.json` so we can attach it as metadata to bug reports. We read from
 * the app's package.json (not from the SDK's own package.json) because
 * `@factory/droid-sdk@0.1.4` doesn't expose `./package.json` in its
 * `exports` map — importing it directly would break on bundlers that honor
 * the exports field.
 *
 * 从宿主工程 package.json 读取 SDK 版本号，避免走 SDK 包自己的 package.json
 * （exports 未暴露）。读取失败时返回 'unknown'，不会抛出异常。
 */
const resolveFactoryDroidSdkVersion = (): string => {
  try {
    const pkg = appPackageJson as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const raw = pkg.dependencies?.['@factory/droid-sdk'] || pkg.devDependencies?.['@factory/droid-sdk'];
    if (!raw) return 'unknown';
    const match = raw.match(/\d+\.\d+\.\d+(?:[-+][\w.-]+)?/u);
    return match ? match[0] : raw.trim();
  } catch {
    return 'unknown';
  }
};

const FACTORY_DROID_SDK_VERSION_FOR_BUG_REPORT = resolveFactoryDroidSdkVersion();

/**
 * Shape of the SDK's internal `DroidClient.submitBugReport` call. The public
 * `DroidSession` type in SDK 0.1.4 does NOT expose `submitBugReport` directly
 * (only `DroidClient` does — see `node_modules/@factory/droid-sdk/dist/index.d.ts`
 * line ~87825), but `DroidSession` carries a private `_client: DroidClient`
 * reference. We reach into that reference via a narrow structural cast so the
 * IPC surface stays on `DroidSdkAgent.submitBugReport(...)` and external files
 * never need to `import` the SDK runtime directly (hard constraint #1 of P2-4).
 *
 * SDK 0.1.4 的 DroidSession 没有暴露 submitBugReport 方法；只能通过私有的
 * _client 转调 DroidClient.submitBugReport。此结构用于描述这个最小接口面。
 */
type SessionWithInternalClient = {
  _client?: {
    submitBugReport?: (params: { userComment: string; clientLogs?: string }) => Promise<{ bugReportId?: string }>;
  };
};

export class DroidSdkAgent {
  private config: DroidSdkAgentConfig;
  private session: DroidSession | null = null;
  private mapper: DroidMessageMapper;
  private currentModelId: string;
  private currentReasoningEffort: ReasoningLevel;
  private hasConfiguredReasoningEffort: boolean;
  private currentSpecModeModelId: string | null;
  private currentSpecModeReasoningEffort: ReasoningLevel | null;
  private hasConfiguredSpecModeSettings: boolean;
  private userModelOverride: string | null = null;
  private pendingModelSwitchNotice: string | null = null;
  private pendingPermissions = new Map<
    string,
    { resolve: (response: { optionId: string }) => void; reject: (error: Error) => void }
  >();
  private pendingAskUserRequests = new Map<
    string,
    { resolve: (response: Record<string, unknown>) => void; reject: (error: Error) => void }
  >();
  private abortController: AbortController | null = null;
  private _isConnected = false;
  private currentSessionMode: string;
  private runtimeSettings: ResolvedDroidChannelRuntimeConfig | null = null;
  private runtimeScheduler: DroidRuntimeScheduler | null = null;
  private permissionPolicy: DroidPermissionPolicy | null = null;
  private askBridge: DroidTextAskBridge | null = null;
  private currentTurnController: DroidRuntimeTurnController | null = null;
  private pendingPublishedAskCallId: string | null = null;
  /**
   * Unsubscribe handle returned by `session.onNotification(...)`. Must be
   * invoked in `closeSession()` to avoid leaking listeners across session
   * restarts / resumes (see SKILL P0-2 hard rule #4).
   */
  private notificationUnsubscribe: (() => void) | null = null;
  /**
   * Whether the user has explicitly confirmed "真 YOLO" (skipPermissionsUnsafe)
   * for this conversation. Defaults to false — must stay false until the UI
   * second-confirmation modal (see `SkipPermissionsConfirmModal`) explicitly
   * flips it via `setSkipPermissionsUnsafe(true)`.
   *
   * Hard rule (SKILL P0-3 + "不要做清单"): YOLO mode MUST NOT implicitly enable
   * `skipPermissionsUnsafe`; auto-enabling it silently is banned. When the user
   * leaves YOLO mode the UI calls `setSkipPermissionsUnsafe(false)` again so
   * a subsequent YOLO reselect won't reuse the old confirmation.
   *
   * 该字段只有在用户点了弹窗"我确认"之后才会被置 true，任何默认走 YOLO 的路径
   * 都必须保持 false。同时，每次离开 YOLO 都应被重置为 false。
   */
  private skipPermissionsUnsafeConfirmed: boolean = false;
  /**
   * Current tool whitelist. `undefined` = "use SDK default"; `[]` = "disable
   * all tools"; `[id, …]` = only those ids are allowed.
   *
   * Populated from `DroidSdkAgentConfig.enabledToolIds` at construction time
   * and updated via `setEnabledToolIds(...)` at runtime. See the
   * `DroidSdkAgentConfig.enabledToolIds` docblock for the undefined / empty /
   * populated semantics (SKILL P2-2 hard constraint).
   *
   * 三态语义：undefined = 未设置走 SDK 默认；[] = 显式全禁；[id,…] = 白名单。
   */
  private enabledToolIds: string[] | undefined;

  /**
   * Process-lifetime counter for `syncSdkSkills` failures (VAL-SKILLS-002).
   *
   * Incremented whenever `session.listSkills()` rejects. Surviving across
   * session restarts / resumes is intentional — a user who opens several
   * conversations with the same failing backend should see the cumulative
   * evidence in `Help → Bug Report`. Absence of `listSkills` (older SDK /
   * mock) is NOT a failure and MUST NOT bump this counter.
   *
   * syncSdkSkills 的失败计数器，覆盖整个 agent 生命周期（不清零）。仅在
   * `session.listSkills()` reject 的路径 +1；session 缺失 listSkills 不算失败。
   */
  private syncSdkSkillsFailureCount = 0;

  constructor(config: DroidSdkAgentConfig) {
    this.config = config;
    this.mapper = new DroidMessageMapper(config.id);
    // Preserve custom/BYOK model ids even when the main-process catalog hasn't
    // been hydrated yet. The Factory CLI reads `settings.local.json` on spawn,
    // so a raw BYOK id (e.g. `custom:…-[BYOK]-N`) is safe to pass through — and
    // it MUST be preserved, otherwise the first message arriving before
    // `refreshFactoryDroidCatalog()` completes would silently fall back to the
    // Factory default model, which then requires a Factory access token and
    // fails with "No access token available" for users running BYOK-only.
    //
    // 主进程的 FactoryCatalog 启动时可能还未探测到 CLI 里的 BYOK 模型（
    // `refreshFactoryDroidCatalog` 是 did-finish-load 之后才跑），如果此时
    // 第一条消息进来就把 BYOK id 静默替换成默认的 Factory 模型，后续 CLI
    // 调用就需要 Factory access token，用户只配了 BYOK 就会看到
    // "No access token available"。这里保留看起来像 BYOK 的 id，交给 CLI 校验。
    const rawConfiguredModelId = (config.modelId || '').trim();
    const canonicalModelId = getFactoryModelById(rawConfiguredModelId)?.id;
    if (canonicalModelId) {
      this.currentModelId = canonicalModelId;
    } else if (rawConfiguredModelId && isLikelyByokModelId(rawConfiguredModelId)) {
      mainWarn(
        '[DroidSdkAgent]',
        `Model id "${rawConfiguredModelId}" not found in cached catalog, passing through as BYOK candidate (catalog may still be hydrating)`
      );
      this.currentModelId = rawConfiguredModelId;
    } else {
      this.currentModelId = getFactoryDefaultModelId();
    }
    this.currentSessionMode = config.sessionMode || 'default';
    const configuredReasoning = this.getConfiguredReasoningEffort();
    this.hasConfiguredReasoningEffort = configuredReasoning !== undefined;
    this.currentReasoningEffort = resolveFactoryReasoning(this.currentModelId, configuredReasoning);
    this.hasConfiguredSpecModeSettings = this.hasConfiguredSpecModeOverride();
    const resolvedSpecModeSettings = this.resolveSpecModeSettings(
      this.getConfiguredSpecModeModelId(),
      this.getConfiguredSpecModeReasoningEffort(),
      this.currentModelId,
      this.currentReasoningEffort
    );
    this.currentSpecModeModelId = resolvedSpecModeSettings.specModeModelId;
    this.currentSpecModeReasoningEffort = resolvedSpecModeSettings.specModeReasoningEffort;
    // Tool whitelist (P2-2): copy the configured value into runtime state so
    // `startSession` and `setEnabledToolIds` share a single source of truth.
    // NOTE: we deliberately DO NOT defensive-copy here — ownership of the
    // array transfers to the agent; callers that mutate their own reference
    // after construction are out of spec.
    // 工具白名单初始化：三态（undefined / [] / 有值）直接透传，不做拷贝。
    this.enabledToolIds = config.enabledToolIds;
    if (config.runtimeSettings && isDroidChannelPlatform(config.source)) {
      this.applyPublishedRuntimeSettings(config.runtimeSettings);
    }
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────

  async start(): Promise<void> {
    await this.ensureSession();
  }

  async kill(): Promise<void> {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.pendingPublishedAskCallId && this.askBridge) {
      this.askBridge.clearTimeout(this.pendingPublishedAskCallId);
      this.pendingPublishedAskCallId = null;
    }
    await this.closeSession();
    this._isConnected = false;
    this.runtimeScheduler?.markCold(this.config.id);
    // Reject pending permission dialogs
    for (const [id, pending] of this.pendingPermissions) {
      pending.reject(new Error('Cancelled'));
      this.pendingPermissions.delete(id);
    }
    for (const [id, pending] of this.pendingAskUserRequests) {
      pending.reject(new Error('Cancelled'));
      this.pendingAskUserRequests.delete(id);
    }
  }

  private async ensureSession(): Promise<void> {
    await this.refreshPublishedRuntimeSettings();
    if (this.session) {
      return;
    }

    if (this.runtimeScheduler) {
      await this.runtimeScheduler.withStartPermit(this.config.id, async () => {
        if (!this.session) {
          await this.startSession();
        }
      });
      return;
    }

    await this.startSession();
  }

  private async startSession(): Promise<void> {
    try {
      const env = getEnhancedEnv();
      const cliRuntime = resolveWorkingDroidCli(this.config.cliPath);
      // If the synchronous `droid --version` probe failed (e.g. Windows
      // cold-start > 15s due to Defender + cmd.exe shim + telemetry), do NOT
      // block session startup. The Factory droid SDK will asynchronously spawn
      // the CLI itself and surface any real failure (ENOENT, exit code, etc.)
      // with richer diagnostics. The sync probe is only a soft-preflight.
      if (!cliRuntime.version) {
        mainWarn(
          '[DroidSdkAgent]',
          `droid --version preflight did not return (source=${cliRuntime.source}, err=${cliRuntime.error || 'timeout'}); proceeding with execPath=${cliRuntime.execPath}`
        );
      }

      const execPath = cliRuntime.execPath;
      const modeSettings = this.getSessionSettingsForMode(this.currentSessionMode);
      // Split mode settings into (a) the subset that fits public
      // `CreateSessionOptions` / `UpdateSessionSettingsRequestParams` and
      // (b) the `skipPermissionsUnsafe` + `decompSessionType` flags which need
      // a separate type cast because SDK 0.1.4 doesn't surface them on either
      // public shape. See `DroidModeSettings` docblock.
      const { skipPermissionsUnsafe, decompSessionType, ...typedModeSettings } = modeSettings;

      // `skipPermissionsUnsafe` is part of the SDK's internal
      // `InitializeSessionRequestParams` (see `@factory/droid-sdk/dist/index.d.ts`
      // around line 11039) but the public `CreateSessionOptions` shape strips
      // it when copying fields into `initParams` in `createSession()`. We still
      // pass it via a type cast so that:
      //   1. intent is documented in source,
      //   2. a future SDK wrapper that honors the field just works,
      //   3. our explicit post-init `updateSettings` call handles the present.
      const sessionOptions: CreateSessionOptions = {
        cwd: this.config.workingDir,
        execPath,
        modelId: this.currentModelId,
        reasoningEffort: this.currentReasoningEffort as ReasoningEffort,
        env,
        ...typedModeSettings,
        ...(skipPermissionsUnsafe ? ({ skipPermissionsUnsafe: true } as Partial<CreateSessionOptions>) : {}),
        // Tool whitelist (P2-2): inline only when set (including empty array,
        // which preserves "disable all tools" intent). `undefined` MUST NOT be
        // serialized — the SDK would ignore it but the check also documents
        // the three-state semantics at the call site.
        // 白名单三态：仅在 ≠ undefined 时带上该字段，空数组 = 禁用所有工具。
        ...(this.enabledToolIds !== undefined ? { enabledToolIds: this.enabledToolIds } : {}),
        permissionHandler: (params) => this.handlePermission(params),
        askUserHandler: (params) => this.handleAskUser(params),
      };

      if (this.config.acpSessionId) {
        // Resume existing session
        this.session = await resumeSession(this.config.acpSessionId, {
          cwd: this.config.workingDir,
          execPath,
          env,
          permissionHandler: (params) => this.handlePermission(params),
          askUserHandler: (params) => this.handleAskUser(params),
        });
        mainLog('[DroidSdkAgent]', `Resumed session: ${this.session.sessionId}`);
        await this.session.updateSettings({
          ...typedModeSettings,
          ...(this.hasConfiguredReasoningEffort
            ? { reasoningEffort: this.currentReasoningEffort as ReasoningEffort }
            : {}),
          ...this.buildUpdateSessionSpecModeSettings(),
        });
        // Resume path: re-apply skipPermissionsUnsafe explicitly if confirmed.
        // Raw JSON-RPC passthrough (no client-side zod) lets the field reach the
        // CLI even though the public TS type doesn't include it. We cast through
        // `unknown` to Partial<DroidSessionSettings>.
        if (skipPermissionsUnsafe) {
          await this.applySkipPermissionsUnsafeToSession(true);
        }
        // Tool whitelist (P2-2): resume path does NOT pipe `enabledToolIds`
        // through `ResumeSessionOptions` (SDK 0.1.4 doesn't expose the field
        // on resume), so we push it via the shared helper. Same three-state
        // semantics as create: undefined = skip, [] / [id,…] = send verbatim.
        // 恢复路径：SDK 不支持 resume options 携带 enabledToolIds，只能在
        // 会话恢复后通过 updateSettings 显式下发。
        if (this.enabledToolIds !== undefined) {
          await this.applyEnabledToolIdsToSession(this.enabledToolIds);
        }
        // Mission / Decomp (P2-1): if the resumed session was started with
        // mission mode, push decompSessionType (+ optional decompMissionId)
        // via the same cast pattern. Best-effort — a mismatched CLI just
        // rejects the extra fields and the session stays non-mission.
        if (decompSessionType) {
          await this.applyDecompSettingsToSession(decompSessionType, this.config.decompMissionId);
        }
      } else {
        this.session = await createSession(sessionOptions);
        mainLog('[DroidSdkAgent]', `Created session: ${this.session.sessionId}`);
        const specModeSettings = this.buildUpdateSessionSpecModeSettings();
        if (Object.keys(specModeSettings).length > 0) {
          await this.session.updateSettings(specModeSettings);
        }
        // `createSession` wrapper in SDK 0.1.4 silently strips
        // `skipPermissionsUnsafe` from the options, so we explicitly push it
        // after the session is live. Best-effort — if the CLI rejects the
        // field (e.g. older CLI), the permission policy layer still auto-approves.
        if (skipPermissionsUnsafe) {
          await this.applySkipPermissionsUnsafeToSession(true);
        }
        // Mission / Decomp (P2-1): the SDK's `createSession` also strips
        // decompSessionType / decompMissionId when building initParams (same
        // pattern as skipPermissionsUnsafe). We push them via a dedicated
        // post-init `updateSettings` call so the CLI switches the live session
        // into orchestrator mode. Best-effort: a CLI that doesn't understand
        // the fields will just no-op and the session stays non-mission.
        if (decompSessionType) {
          await this.applyDecompSettingsToSession(decompSessionType, this.config.decompMissionId);
        }
      }

      this._isConnected = true;
      this.config.onSessionIdUpdate?.(this.session.sessionId);
      // Subscribe to server → client notifications (P0-2). MUST be done BEFORE
      // any async follow-up (listSkills) so we don't miss SDK-emitted events
      // fired during initialization. A failure here is logged but never bubbles
      // up to break startSession — startup resilience beats losing notifications.
      //
      // 订阅 Droid SDK 主动推送的 notification（title / settings / MCP / MCP auth）。
      // 注册失败只记日志，不中断 startSession。
      this.subscribeToSdkNotifications();
      // Sync MCP servers required by team / project config (P1-1). Best-effort:
      // a listMcpServers / addMcpServer failure MUST NOT break session startup.
      //
      // 同步 team / project MCP 配置到 SDK session。失败不会中断会话启动。
      await this.syncMcpServersOnStartup();
      // Sync SDK-reported skills (P0-1). This is best-effort — a listSkills
      // failure must NOT break the session startup (hard rule 5 in the task
      // spec). The fallback path stays on `prepareFirstMessageWithSkillsIndex`
      // via AcpSkillManager's filesystem discovery.
      //
      // 同步 Droid SDK `listSkills()`。失败不会中断会话启动，仅回退到
      // 原有的 prompt 注入流程。
      await this.syncSdkSkills();
    } catch (error) {
      this._isConnected = false;
      let errMsg = error instanceof Error ? error.message : String(error);
      mainWarn('[DroidSdkAgent]', `Failed to start: ${errMsg}`);
      if (errMsg.includes('402') || errMsg.includes('Payment Required')) {
        errMsg = 'Factory 算力额度不足，请前往 https://app.factory.ai/settings/usage 充值后继续使用。';
      }
      this.emitError(errMsg);
      throw error;
    }
  }

  private async closeSession(): Promise<void> {
    // Drop the SDK notification listener FIRST so the transport can close
    // cleanly without dispatching to a callback owned by a torn-down agent.
    // 先取消 notification 订阅，避免 session.close() 之后仍然回调到
    // 已被销毁的 agent 实例。
    if (this.notificationUnsubscribe) {
      try {
        this.notificationUnsubscribe();
      } catch (error) {
        mainWarn(
          '[DroidSdkAgent]',
          'Failed to unsubscribe from notifications',
          error instanceof Error ? error.message : String(error)
        );
      }
      this.notificationUnsubscribe = null;
    }
    if (this.session) {
      try {
        await this.session.close();
      } catch {
        // Best-effort cleanup
      }
      this.session = null;
    }
    this._isConnected = false;
    // Drop SDK skills registered by the just-closed session so a later
    // Droid conversation doesn't see stale entries.
    // 会话关闭时清空 Droid 后端的 SDK skills 缓存，避免过期 / 跨会话污染。
    // m1-f1c — thread `backend: 'droid'` so the clear targets the
    // droid-scoped slot, matching where `syncSdkSkills` writes. A bare
    // `getInstance()` would operate on the legacy no-backend slot and
    // leave the actual droid slot populated with stale entries.
    try {
      AcpSkillManager.getInstance(undefined, { backend: 'droid' }).clearSdkSkills();
    } catch (error) {
      mainWarn('[DroidSdkAgent]', 'Failed to clear SDK skills on session close', error);
    }
  }

  // ── Messaging ───────────────────────────────────────────────────────

  async sendMessage(data: { content: string; files?: string[]; msg_id?: string }): Promise<AcpResult> {
    mainLog('[DroidSdkAgent]', 'sendMessage enter', {
      conversation_id: this.config.id,
      msg_id: data.msg_id,
      modelId: this.currentModelId,
      hasRuntimeScheduler: Boolean(this.runtimeScheduler),
      sessionExists: Boolean(this.session),
      contentLength: data.content?.length ?? 0,
    });
    await this.refreshPublishedRuntimeSettings();

    if (!this.runtimeScheduler) {
      try {
        await this.ensureSession();
      } catch (error) {
        return this.createRuntimeErrorResult(error);
      }

      return this.sendMessageInternal(data);
    }

    try {
      return await this.runtimeScheduler.enqueueTurn(this.config.id, async (controller) => {
        this.currentTurnController = controller;
        try {
          await this.ensureSession();
          const result = await this.sendMessageInternal(data);
          if (result.success) {
            this.runtimeScheduler?.markWarm(this.config.id, async () => {
              await this.closeSession();
              this.runtimeScheduler?.markCold(this.config.id);
            });
          } else {
            this.runtimeScheduler?.markFailed(this.config.id);
          }
          return result;
        } catch (error) {
          this.runtimeScheduler?.markFailed(this.config.id);
          return this.createRuntimeErrorResult(error);
        } finally {
          this.currentTurnController = null;
        }
      });
    } catch (error) {
      return this.createRuntimeErrorResult(error);
    }
  }

  private async sendMessageInternal(data: { content: string; files?: string[]; msg_id?: string }): Promise<AcpResult> {
    if (!this.session) {
      return {
        success: false,
        error: createAcpError(AcpErrorType.CONNECTION_NOT_READY, 'Session not initialized', true),
      };
    }

    try {
      this.config.onStreamEvent({
        type: 'start',
        conversation_id: this.config.id,
        msg_id: data.msg_id || uuid(),
        data: null,
      });

      this.mapper.resetForNewTurn();

      // ── Native attachments (P1-2) ──────────────────────────────────
      //
      // Resolution precedence:
      //   1. If the upstream `content` already begins with a legacy `@file`
      //      reference (cron / plugin-saved history) we MUST preserve it
      //      verbatim — no native resolution, no double-attach. The SDK will
      //      treat the leading `@path` tokens as plain text.
      //   2. If `data.files` is non-empty AND the content is NOT a legacy
      //      payload, resolve into the SDK-native `MessageOptions.images` /
      //      `MessageOptions.files`. Any file that fails resolution (missing,
      //      directory, > 10 MB, read error) is classified in `skipped`:
      //        * `too_large`  → fall back to legacy `@path` text so Droid can
      //                         still see the file without blowing RAM;
      //        * others       → omit entirely, but surface a
      //                         `<system-reminder>` so the model doesn't
      //                         hallucinate about the missing attachment.
      //   3. If `data.files` is empty, emit a plain text message.
      //
      // 为什么这样分支：P1-2 的硬约束要求 `@file` 向后兼容，且不能把>10MB
      // 的文件读进内存。
      let content = data.content;
      let messageOptions: MessageOptions | undefined;
      let nativeAttachments: ResolvedAttachments | null = null;

      const hasFiles = Array.isArray(data.files) && data.files.length > 0;
      const legacyPrefix = contentHasLegacyFileReference(data.content);

      if (hasFiles && !legacyPrefix) {
        try {
          nativeAttachments = await resolveAttachmentsForDroid(data.files);
        } catch (error) {
          // Defensive: resolveAttachmentsForDroid is specified as never-throw,
          // but if an underlying Node error does leak through we fall back to
          // the legacy text path rather than abort the whole turn.
          mainWarn(
            '[DroidSdkAgent]',
            'resolveAttachmentsForDroid threw unexpectedly; falling back to legacy @file path',
            error instanceof Error ? error.message : String(error)
          );
          nativeAttachments = null;
        }
      }

      if (nativeAttachments) {
        const { images, files, skipped } = nativeAttachments;
        const fallbackFileRefs: string[] = [];
        for (const entry of skipped) {
          // Oversized files fall back to the legacy `@path` text — the Droid
          // CLI can still mmap them off disk without us reading the bytes.
          if (entry.reason === 'too_large') {
            fallbackFileRefs.push(entry.path);
            mainWarn('[DroidSdkAgent]', 'attachment exceeded native size budget; falling back to @file', {
              path: entry.path,
              detail: entry.detail,
            });
          } else {
            mainWarn('[DroidSdkAgent]', 'attachment skipped', {
              path: entry.path,
              reason: entry.reason,
              detail: entry.detail,
            });
          }
        }

        if (fallbackFileRefs.length > 0) {
          const refs = fallbackFileRefs.map((f) => (f.includes(' ') ? `@"${f}"` : `@${f}`)).join(' ');
          content = refs + ' ' + content;
        }

        // M3.B: Gate image attachments when the current model explicitly
        // reports `supportsImageInput === false`. Unknown capability
        // (undefined) falls through untouched — we only strip when we have
        // concrete negative evidence from the catalog or BYOK config.
        let gatedImages = images;
        let multimodalStrippedCount = 0;
        if (images.length > 0) {
          const modelSupportsImages = await resolveCurrentModelSupportsImageInput(this.currentModelId);
          if (modelSupportsImages === false) {
            multimodalStrippedCount = images.length;
            gatedImages = [];
            mainWarn('[DroidSdkAgent]', 'dropped image attachments: current model lacks vision support', {
              modelId: this.currentModelId,
              strippedCount: multimodalStrippedCount,
            });
          }
        }

        if (gatedImages.length > 0 || files.length > 0) {
          // SDK 0.1.4 declares images/files as `Array<Record<string, unknown>>`
          // but the validator accepts the concrete `Base64ImageSource` /
          // `DocumentSource` shapes produced by the resolver. The double cast
          // through `unknown` tells TS the shapes are compatible for the JSON-RPC
          // transport layer without weakening `ResolvedImageAttachment` /
          // `ResolvedFileAttachment` at the helper boundary.
          messageOptions = {
            ...(gatedImages.length > 0 ? { images: gatedImages as unknown as MessageOptions['images'] } : {}),
            ...(files.length > 0 ? { files: files as unknown as MessageOptions['files'] } : {}),
          };
        }

        const surfacedSkips = skipped.filter((s) => s.reason !== 'too_large');
        if (surfacedSkips.length > 0) {
          const reminder = this.buildSkippedAttachmentReminder(surfacedSkips);
          if (reminder) {
            content = reminder + content;
          }
        }

        if (multimodalStrippedCount > 0) {
          // Inform the model (and through the notice the operator) that we
          // stripped N image attachments so the LLM does not hallucinate
          // about invisible pixels.
          const reminder =
            `<system-reminder>\n` +
            `Dropped ${multimodalStrippedCount} image attachment${multimodalStrippedCount === 1 ? '' : 's'} ` +
            `because the active model (${this.currentModelId}) does not accept image inputs. ` +
            `Switch to a multimodal model (e.g., a Gemini/Claude/GPT-4o variant) if you need to send images.\n` +
            `</system-reminder>\n\n`;
          content = reminder + content;
        }
      } else if (hasFiles) {
        // Legacy path: content already begins with `@...` tokens (historical
        // cron / plugin payload). Keep the original behaviour of appending
        // file refs so Droid still sees the attachments, and never populate
        // `MessageOptions`.
        const fileRefs = data.files!.map((f) => (f.includes(' ') ? `@"${f}"` : `@${f}`)).join(' ');
        content = fileRefs + ' ' + content;
      }

      content = this.getPromptPreamble() + content;

      if (this.pendingModelSwitchNotice) {
        const modelNotice =
          `<system-reminder>\n` +
          `Model switch: The active model has been changed to ${this.pendingModelSwitchNotice} via the /model command. ` +
          `You are now running as ${this.pendingModelSwitchNotice}. ` +
          `When asked which model you are, answer ${this.pendingModelSwitchNotice}.\n` +
          `</system-reminder>\n\n`;
        content = modelNotice + content;
        this.pendingModelSwitchNotice = null;
      }

      this.abortController = new AbortController();
      mainLog('[DroidSdkAgent]', 'sendMessageInternal stream begin', {
        conversation_id: this.config.id,
        sessionId: this.session.sessionId,
        modelId: this.currentModelId,
        contentLength: content.length,
        nativeImages: messageOptions?.images?.length ?? 0,
        nativeFiles: messageOptions?.files?.length ?? 0,
      });
      let streamMsgCount = 0;
      for await (const msg of this.session.stream(content, messageOptions)) {
        if (this.abortController?.signal.aborted) {
          break;
        }

        streamMsgCount += 1;
        if (streamMsgCount === 1 || streamMsgCount % 20 === 0) {
          mainLog('[DroidSdkAgent]', 'sendMessageInternal stream progress', {
            conversation_id: this.config.id,
            sessionId: this.session.sessionId,
            msgCount: streamMsgCount,
            lastMsgType: (msg as { type?: string } | null)?.type ?? null,
          });
        }

        const uiEvents = this.mapper.mapMessage(msg);
        for (const event of uiEvents) {
          this.config.onStreamEvent(event);
        }
      }
      mainLog('[DroidSdkAgent]', 'sendMessageInternal stream complete', {
        conversation_id: this.config.id,
        sessionId: this.session.sessionId,
        msgCount: streamMsgCount,
      });

      return { success: true, data: null };
    } catch (error) {
      return this.createRuntimeErrorResult(error);
    }
  }

  private createRuntimeErrorResult(error: unknown): AcpResult {
    let errMsg = error instanceof Error ? error.message : String(error);
    if (errMsg.includes('402') || errMsg.includes('Payment Required')) {
      errMsg = 'Factory 算力额度不足，请前往 https://app.factory.ai/settings/usage 充值后继续使用。';
    }
    mainWarn('[DroidSdkAgent]', 'sendMessage error', {
      conversation_id: this.config.id,
      sessionId: this.session?.sessionId ?? null,
      modelId: this.currentModelId,
      errMsg,
    });
    this.emitError(errMsg);
    return {
      success: false,
      error: createAcpError(AcpErrorType.UNKNOWN, errMsg, false),
    };
  }

  cancelPrompt(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.pendingPublishedAskCallId && this.askBridge) {
      this.askBridge.clearTimeout(this.pendingPublishedAskCallId);
      this.pendingPublishedAskCallId = null;
    }
    if (this.session) {
      this.session.interrupt().catch((err) => {
        mainWarn('[DroidSdkAgent]', `Interrupt failed: ${err}`);
      });
    }
    // Reject pending permissions
    for (const [id, pending] of this.pendingPermissions) {
      pending.reject(new Error('Cancelled'));
      this.pendingPermissions.delete(id);
    }
    for (const [id, pending] of this.pendingAskUserRequests) {
      pending.reject(new Error('Cancelled'));
      this.pendingAskUserRequests.delete(id);
    }
  }

  // ── Permission handling ─────────────────────────────────────────────

  private handlePermission(params: Record<string, unknown>): string | Promise<string> {
    const toolUses =
      Array.isArray(params.toolUses) && params.toolUses.every((item) => item && typeof item === 'object')
        ? (params.toolUses as Array<Record<string, unknown>>)
        : [];
    const firstToolUse = toolUses[0];
    const toolUse =
      firstToolUse?.toolUse && typeof firstToolUse.toolUse === 'object'
        ? (firstToolUse.toolUse as Record<string, unknown>)
        : undefined;
    const toolInput =
      toolUse?.input && typeof toolUse.input === 'object' ? (toolUse.input as Record<string, unknown>) : {};
    const details =
      firstToolUse?.details && typeof firstToolUse.details === 'object'
        ? (firstToolUse.details as Record<string, unknown>)
        : undefined;
    const parsed =
      details?.parsed && typeof details.parsed === 'object' ? (details.parsed as Record<string, unknown>) : undefined;
    const parseError =
      details?.parseError && typeof details.parseError === 'object'
        ? (details.parseError as Record<string, unknown>)
        : undefined;
    const questionnaire = typeof details?.questionnaire === 'string' ? details.questionnaire : undefined;
    const parseErrorMessage = typeof parseError?.message === 'string' ? parseError.message : undefined;
    const confirmationType =
      typeof firstToolUse?.confirmationType === 'string' ? firstToolUse.confirmationType : undefined;
    const sdkOptions =
      Array.isArray(params.options) &&
      params.options.every(
        (item) =>
          item &&
          typeof item === 'object' &&
          typeof (item as Record<string, unknown>).label === 'string' &&
          typeof (item as Record<string, unknown>).value === 'string'
      )
        ? (params.options as Array<{ label: string; value: string }>)
        : [];
    const specPlan = typeof details?.plan === 'string' ? details.plan : undefined;
    const specTitle = typeof details?.title === 'string' ? details.title : undefined;
    const specOptionNames =
      Array.isArray(details?.optionNames) && details.optionNames.every((item) => typeof item === 'string')
        ? (details.optionNames as string[])
        : undefined;
    const callId =
      (typeof toolUse?.id === 'string' ? toolUse.id : undefined) || (params.toolUseId as string | undefined) || uuid();
    const toolName = typeof toolUse?.name === 'string' ? toolUse.name : undefined;
    const title =
      specTitle ||
      toolName ||
      (typeof params.title === 'string' ? params.title : undefined) ||
      (confirmationType === 'exit_spec_mode' ? 'Specification Review' : undefined) ||
      'Permission Request';

    if (confirmationType === 'ask_user') {
      mainLog('[DroidSdkAgent]', 'AskUser tool permission requested', {
        callId,
        hasParsedQuestions: Array.isArray(parsed?.questions),
        parseError: parseErrorMessage,
      });
    }

    if (this.permissionPolicy) {
      const evaluation = this.permissionPolicy.evaluate({
        confirmationType,
        toolName,
        toolInput,
        workspace: this.config.workingDir,
      });

      if (evaluation.notice) {
        this.config.onStreamEvent({
          type: 'content',
          conversation_id: this.config.id,
          msg_id: `permission_notice_${callId}`,
          data: evaluation.notice,
        });
      }

      return evaluation.outcome;
    }

    const permissionRequest: AcpPermissionRequest = {
      sessionId: this.session?.sessionId || '',
      toolCall: {
        toolCallId: callId,
        title,
        kind: (typeof params.type === 'string' ? params.type : undefined) || confirmationType || 'tool',
        rawInput: {
          ...toolInput,
          ...params,
          ...(specPlan ? { plan: specPlan, description: specPlan } : {}),
          ...(specTitle ? { title: specTitle } : {}),
          ...(specOptionNames ? { optionNames: specOptionNames } : {}),
          ...(questionnaire ? { description: questionnaire, questionnaire } : {}),
          ...(parsed ? { parsed } : {}),
          ...(parseError ? { parseError } : {}),
          ...(parseErrorMessage ? { description: `AskUser parse error: ${parseErrorMessage}` } : {}),
        },
      },
      options:
        sdkOptions.length > 0
          ? sdkOptions.map((option) => ({
              optionId: option.value,
              name: option.label,
              kind:
                option.value === ToolConfirmationOutcome.Cancel
                  ? 'reject_once'
                  : option.value === ToolConfirmationOutcome.ProceedAlways
                    ? 'allow_always'
                    : 'allow_once',
            }))
          : [
              {
                optionId: ToolConfirmationOutcome.ProceedOnce,
                name: 'Allow Once',
                kind: 'allow_once',
              },
              {
                optionId: ToolConfirmationOutcome.ProceedAlways,
                name: 'Allow Always',
                kind: 'allow_always',
              },
              {
                optionId: ToolConfirmationOutcome.Cancel,
                name: 'Deny',
                kind: 'reject_once',
              },
            ],
    };

    // Emit permission request to UI
    this.config.onStreamEvent({
      type: 'acp_permission',
      conversation_id: this.config.id,
      msg_id: callId,
      data: permissionRequest,
    });

    // Wait for user response
    return new Promise<string>((resolve, reject) => {
      this.pendingPermissions.set(callId, {
        resolve: (response) => resolve(response.optionId),
        reject,
      });
    });
  }

  private handleAskUser(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const callId = (params.toolCallId as string) || uuid();
    const questions = this.normalizeAskUserQuestions(
      Array.isArray(params.questions) ? (params.questions as AskUserQuestion[]) : []
    );

    mainLog('[DroidSdkAgent]', 'AskUser requested', {
      callId,
      questionCount: questions.length,
    });

    if (this.askBridge && this.runtimeScheduler) {
      this.pendingPublishedAskCallId = callId;
      this.currentTurnController?.pauseForInteractive();
      this.runtimeScheduler.markAskUser(this.config.id, callId);
      this.config.onStreamEvent({
        type: 'content',
        conversation_id: this.config.id,
        msg_id: `ask_user_${callId}`,
        data: this.askBridge.formatPrompt(questions),
      });
      this.askBridge.scheduleTimeout(callId, async () => {
        this.config.onStreamEvent({
          type: 'content',
          conversation_id: this.config.id,
          msg_id: `ask_user_timeout_${callId}`,
          data: 'Timed out waiting for a reply. The pending question was cancelled.',
        });
        await this.answerAskUser({
          callId,
          result: {
            cancelled: true,
            answers: [],
          } satisfies DroidAskUserAnswerPayload,
        });
      });
    }

    this.config.onAskUserRequest?.({
      callId,
      questions,
    });

    return new Promise<Record<string, unknown>>((resolve, reject) => {
      this.pendingAskUserRequests.set(callId, { resolve, reject });
    });
  }

  confirmMessage(data: { confirmKey: string; callId: string }): Promise<AcpResult> {
    const pending = this.pendingPermissions.get(data.callId);
    if (pending) {
      this.pendingPermissions.delete(data.callId);
      pending.resolve({ optionId: data.confirmKey });
      return Promise.resolve({ success: true, data: null });
    }
    return Promise.resolve({
      success: false,
      error: createAcpError(AcpErrorType.UNKNOWN, `Permission request not found for callId: ${data.callId}`, false),
    });
  }

  async answerAskUser(data: { callId: string; result: Record<string, unknown> }): Promise<AcpResult> {
    const pending = this.pendingAskUserRequests.get(data.callId);
    if (pending) {
      this.pendingAskUserRequests.delete(data.callId);
      this.askBridge?.clearTimeout(data.callId);
      if (this.pendingPublishedAskCallId === data.callId) {
        this.pendingPublishedAskCallId = null;
      }
      mainLog('[DroidSdkAgent]', 'AskUser answered', {
        callId: data.callId,
        result: data.result,
      });
      this.runtimeScheduler?.clearAskUser(this.config.id);
      try {
        await this.currentTurnController?.resumeAfterInteractive();
        pending.resolve(data.result);
        return { success: true, data: null };
      } catch (error) {
        return this.createRuntimeErrorResult(error);
      }
    }
    return {
      success: false,
      error: createAcpError(AcpErrorType.UNKNOWN, `AskUser request not found for callId: ${data.callId}`, false),
    };
  }

  // ── Model management ────────────────────────────────────────────────

  getModelInfo(): AcpModelInfo | null {
    return getFactoryDroidModelInfo(this.currentModelId) as AcpModelInfo;
  }

  async setModelByConfigOption(modelId: string): Promise<AcpModelInfo | null> {
    if (!this.session) {
      throw new Error('No active session');
    }

    const reasoningEffort = resolveFactoryReasoning(modelId, this.currentReasoningEffort);
    const resolvedSpecModeSettings = this.resolveSpecModeSettings(
      this.currentSpecModeModelId,
      this.currentSpecModeReasoningEffort,
      modelId,
      reasoningEffort
    );

    await this.session.updateSettings({
      modelId,
      reasoningEffort: reasoningEffort as ReasoningEffort,
      ...this.buildUpdateSessionSpecModeSettings(resolvedSpecModeSettings),
    });

    this.currentModelId = modelId;
    this.currentReasoningEffort = reasoningEffort;
    this.hasConfiguredReasoningEffort = true;
    this.currentSpecModeModelId = resolvedSpecModeSettings.specModeModelId;
    this.currentSpecModeReasoningEffort = resolvedSpecModeSettings.specModeReasoningEffort;
    this.userModelOverride = modelId;
    this.pendingModelSwitchNotice = modelId;

    mainLog('[DroidSdkAgent]', `Model switched to: ${modelId}`);
    return this.getModelInfo();
  }

  // ── Config options (stub for AcpAgentManager compatibility) ─────────

  getConfigOptions(): AcpSessionConfigOption[] {
    return buildFactoryDroidConfigOptions({
      mainModelId: this.currentModelId,
      mainReasoning: this.currentReasoningEffort,
      specModelId: this.currentSpecModeModelId,
      specReasoning: this.currentSpecModeReasoningEffort,
    });
  }

  async setConfigOption(configId: string, value: string): Promise<AcpSessionConfigOption[]> {
    if (!this.session) {
      return this.getConfigOptions();
    }

    if (configId === FACTORY_REASONING_CONFIG_ID) {
      const reasoningEffort = resolveFactoryReasoning(this.currentModelId, value);
      const resolvedSpecModeSettings = this.resolveSpecModeSettings(
        this.currentSpecModeModelId,
        this.currentSpecModeReasoningEffort,
        this.currentModelId,
        reasoningEffort
      );

      await this.session.updateSettings({
        reasoningEffort: reasoningEffort as ReasoningEffort,
        ...this.buildUpdateSessionSpecModeSettings(resolvedSpecModeSettings),
      });
      this.currentReasoningEffort = reasoningEffort;
      this.currentSpecModeModelId = resolvedSpecModeSettings.specModeModelId;
      this.currentSpecModeReasoningEffort = resolvedSpecModeSettings.specModeReasoningEffort;
      this.hasConfiguredReasoningEffort = true;
      return this.getConfigOptions();
    }

    if (configId === FACTORY_SPEC_MODEL_CONFIG_ID) {
      this.hasConfiguredSpecModeSettings = true;
      const nextRequestedSpecModelId = value === FACTORY_SPEC_MODEL_USE_MAIN_VALUE ? null : value;
      const resolvedSpecModeSettings = this.resolveSpecModeSettings(
        nextRequestedSpecModelId,
        this.currentSpecModeReasoningEffort,
        this.currentModelId,
        this.currentReasoningEffort
      );

      await this.session.updateSettings(this.buildUpdateSessionSpecModeSettings(resolvedSpecModeSettings));
      this.currentSpecModeModelId = resolvedSpecModeSettings.specModeModelId;
      this.currentSpecModeReasoningEffort = resolvedSpecModeSettings.specModeReasoningEffort;
      return this.getConfigOptions();
    }

    if (configId === FACTORY_SPEC_REASONING_CONFIG_ID && this.currentSpecModeModelId) {
      this.hasConfiguredSpecModeSettings = true;
      const resolvedSpecModeSettings = this.resolveSpecModeSettings(
        this.currentSpecModeModelId,
        value,
        this.currentModelId,
        this.currentReasoningEffort
      );

      await this.session.updateSettings(this.buildUpdateSessionSpecModeSettings(resolvedSpecModeSettings));
      this.currentSpecModeModelId = resolvedSpecModeSettings.specModeModelId;
      this.currentSpecModeReasoningEffort = resolvedSpecModeSettings.specModeReasoningEffort;
    }

    return this.getConfigOptions();
  }

  // ── Mode management ─────────────────────────────────────────────────

  async setMode(mode: string): Promise<{ success: boolean; error?: string }> {
    if (!this.session) {
      this.currentSessionMode = mode;
      return { success: true };
    }

    try {
      const modeSettings = this.getSessionSettingsForMode(mode);
      // `modeSettings` may carry extra fields (`skipPermissionsUnsafe`,
      // `decompSessionType`) that are not part of the public
      // `UpdateSessionSettingsRequestParams` shape. TS accepts them here via
      // structural typing (typed variable, not a literal) and the client-side
      // `updateSettings` forwards params raw via JSON-RPC without client-side
      // zod validation. If `decompSessionType` is present, also push the
      // optional `decompMissionId` via the dedicated helper (it's not part of
      // `modeSettings`, so it needs a separate call).
      await this.session.updateSettings(modeSettings);
      if (modeSettings.decompSessionType && this.config.decompMissionId) {
        await this.applyDecompSettingsToSession(modeSettings.decompSessionType, this.config.decompMissionId);
      }
      this.currentSessionMode = mode;
      return { success: true };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return { success: false, error: errMsg };
    }
  }

  rememberSessionMode(mode: string): void {
    this.currentSessionMode = mode;
  }

  async enableYoloMode(): Promise<void> {
    await this.setMode('yolo');
  }

  // ── Internal helpers ────────────────────────────────────────────────

  /**
   * Subscribe to server-pushed SDK notifications via `session.onNotification`.
   * Registers the listener, stashes the unsubscribe fn for `closeSession`, and
   * routes every notification through the pure `mapDroidNotification` mapper
   * before dispatching to UI via `handleMappedNotification`.
   *
   * Hard requirements (see `droid-sdk-integration` SKILL, P0-2):
   * - Failure to register MUST NOT propagate — log and continue.
   * - Callback-body exceptions MUST NOT escape the SDK callback (the SDK path
   *   dispatches JSON-RPC; a thrown error would poison the transport).
   */
  private subscribeToSdkNotifications(): void {
    if (!this.session) return;
    const sessionWithNotifications = this.session as DroidSession & {
      onNotification?: DroidSession['onNotification'];
    };
    if (typeof sessionWithNotifications.onNotification !== 'function') {
      // Older / mocked sessions may not expose onNotification; skip silently
      // so the startup path stays green in tests and backport scenarios.
      mainLog('[DroidSdkAgent]', 'session.onNotification unavailable; skipping notification subscription');
      return;
    }
    try {
      const unsubscribe = sessionWithNotifications.onNotification((notification) => {
        let mapped: NotificationMappedResult;
        try {
          mapped = mapDroidNotification(notification);
        } catch (error) {
          mainWarn(
            '[DroidSdkAgent]',
            'mapDroidNotification threw (should never happen)',
            error instanceof Error ? error.message : String(error)
          );
          return;
        }
        try {
          this.handleMappedNotification(mapped);
        } catch (error) {
          mainWarn(
            '[DroidSdkAgent]',
            'handleMappedNotification threw',
            error instanceof Error ? error.message : String(error)
          );
        }
      });
      this.notificationUnsubscribe = unsubscribe;
      mainLog('[DroidSdkAgent]', 'onNotification subscribed', {
        conversation_id: this.config.id,
        sessionId: this.session.sessionId,
      });
    } catch (error) {
      mainWarn(
        '[DroidSdkAgent]',
        'Failed to subscribe to SDK notifications — UI will not receive title/MCP/settings pushes',
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Dispatch a mapped notification onto the shared stream pipeline.
   *
   * - `session_title`       → `session_title` UI event (renderer updates title)
   * - `settings_updated`    → local state sync (but BYOK modelId is never overwritten)
   *                           + `settings_updated` UI event for completeness
   * - `mcp_status`          → `mcp_status` UI event
   * - `mcp_auth_required`   → `mcp_auth` UI event (carries authUrl for the user)
   * - `ignored`             → debug log only
   *
   * 注意：本轮不扩 `ipcBridge` channel（硬约束），所以所有新事件都复用现成的
   * `IResponseMessage { type: string; data: unknown }` 通道，前端按需消费 type 字段。
   */
  private handleMappedNotification(mapped: NotificationMappedResult): void {
    switch (mapped.kind) {
      case 'session_title': {
        if (!mapped.title) return;
        this.config.onStreamEvent({
          type: 'session_title',
          conversation_id: this.config.id,
          msg_id: `session_title_${uuid()}`,
          data: {
            sessionId: this.session?.sessionId ?? null,
            title: mapped.title,
          },
        });
        return;
      }
      case 'settings_updated': {
        // Hot-refresh Factory Droid model catalog so any newly available /
        // removed models (especially BYOK) propagate into main-process memory
        // without restarting the app. The helper debounces + enforces a short
        // cooldown, so the SDK's own `settings_updated` echoes (emitted after
        // a refresh updates the session settings) cannot trigger an infinite
        // refresh loop. See `./catalogRefresher` for details.
        scheduleFactoryCatalogRefresh('settings-updated');

        // Sync SDK-reported model / reasoning changes into local runtime state
        // so subsequent `updateSettings` calls reflect the true server-side
        // picture. BYOK modelIds MUST NOT be overwritten (hard rule #1): a
        // server-echoed `modelId` that looks like a BYOK id is still authoritative,
        // but if the SDK returns a Factory default while the user just set a
        // BYOK id locally, preserve the user's choice.
        const nextModelId = mapped.changed.modelId;
        if (typeof nextModelId === 'string' && nextModelId.length > 0) {
          const userHasByok = isLikelyByokModelId(this.currentModelId);
          const serverSaysByok = isLikelyByokModelId(nextModelId);
          if (serverSaysByok || !userHasByok) {
            this.currentModelId = nextModelId;
          } else {
            mainWarn(
              '[DroidSdkAgent]',
              `Ignoring settings_updated.modelId=${nextModelId}; keeping user-selected BYOK modelId=${this.currentModelId}`
            );
          }
        }
        if (typeof mapped.changed.reasoningEffort === 'string') {
          this.currentReasoningEffort = mapped.changed.reasoningEffort as ReasoningLevel;
          this.hasConfiguredReasoningEffort = true;
        }
        this.config.onStreamEvent({
          type: 'settings_updated',
          conversation_id: this.config.id,
          msg_id: `settings_updated_${uuid()}`,
          data: {
            sessionId: this.session?.sessionId ?? null,
            changed: mapped.changed,
            currentModelId: this.currentModelId,
          },
        });
        return;
      }
      case 'mcp_status': {
        this.config.onStreamEvent({
          type: 'mcp_status',
          conversation_id: this.config.id,
          msg_id: `mcp_status_${uuid()}`,
          data: {
            sessionId: this.session?.sessionId ?? null,
            servers: mapped.servers,
            summary: mapped.summary,
          },
        });
        return;
      }
      case 'mcp_auth_required': {
        this.config.onStreamEvent({
          type: 'mcp_auth',
          conversation_id: this.config.id,
          msg_id: `mcp_auth_${uuid()}`,
          data: {
            sessionId: this.session?.sessionId ?? null,
            serverName: mapped.serverName,
            authUrl: mapped.authUrl,
            message: mapped.message,
            state: mapped.state,
          },
        });
        return;
      }
      // ── P2-1 mission / decomp events ───────────────────────────────
      //
      // Every mission event is dispatched onto the same stream pipeline using
      // a dedicated `type` literal so renderer code can subscribe via a simple
      // `type === 'mission_*'` check. We DO NOT extend `ipcBridge` — hard
      // constraint in the task spec — so the events ride the existing
      // `IResponseMessage` channel.
      //
      // 每个 mission 通知独立下发，复用现有的 onStreamEvent 通道。
      case 'mission_state': {
        this.config.onStreamEvent({
          type: 'mission_state',
          conversation_id: this.config.id,
          msg_id: `mission_state_${uuid()}`,
          data: {
            sessionId: this.session?.sessionId ?? null,
            state: mapped.state,
            missionId: mapped.missionId,
          },
        });
        return;
      }
      case 'mission_features': {
        this.config.onStreamEvent({
          type: 'mission_features',
          conversation_id: this.config.id,
          msg_id: `mission_features_${uuid()}`,
          data: {
            sessionId: this.session?.sessionId ?? null,
            features: mapped.features,
            missionId: mapped.missionId,
          },
        });
        return;
      }
      case 'mission_progress': {
        this.config.onStreamEvent({
          type: 'mission_progress',
          conversation_id: this.config.id,
          msg_id: `mission_progress_${uuid()}`,
          data: {
            sessionId: this.session?.sessionId ?? null,
            entry: mapped.entry,
            progressLog: mapped.progressLog,
            missionId: mapped.missionId,
          },
        });
        return;
      }
      case 'mission_heartbeat': {
        this.config.onStreamEvent({
          type: 'mission_heartbeat',
          conversation_id: this.config.id,
          msg_id: `mission_heartbeat_${uuid()}`,
          data: {
            sessionId: this.session?.sessionId ?? null,
            timestamp: mapped.timestamp,
            at: mapped.at,
            missionId: mapped.missionId,
          },
        });
        return;
      }
      case 'mission_worker_started': {
        this.config.onStreamEvent({
          type: 'mission_worker_started',
          conversation_id: this.config.id,
          msg_id: `mission_worker_started_${uuid()}`,
          data: {
            sessionId: this.session?.sessionId ?? null,
            workerSessionId: mapped.workerSessionId,
            featureId: mapped.featureId,
            spawnId: mapped.spawnId,
            missionId: mapped.missionId,
          },
        });
        return;
      }
      case 'mission_worker_completed': {
        this.config.onStreamEvent({
          type: 'mission_worker_completed',
          conversation_id: this.config.id,
          msg_id: `mission_worker_completed_${uuid()}`,
          data: {
            sessionId: this.session?.sessionId ?? null,
            workerSessionId: mapped.workerSessionId,
            featureId: mapped.featureId,
            exitCode: mapped.exitCode,
            successState: mapped.successState,
            result: mapped.result,
            missionId: mapped.missionId,
          },
        });
        return;
      }
      case 'ignored':
      default: {
        mainLog('[DroidSdkAgent]', 'notification ignored', { type: mapped.kind === 'ignored' ? mapped.type : mapped });
        return;
      }
    }
  }

  /**
   * Fetch skills reported by Droid SDK `session.listSkills()` and surface them
   * to the rest of the app via `AcpSkillManager` so the next prompt injection
   * / UI slash-command refresh picks them up.
   *
   * Hard requirements (see `droid-sdk-integration` SKILL, P0-1 / P0-4):
   * - MUST not throw — a listSkills failure falls back to the existing
   *   `prepareFirstMessageWithSkillsIndex` filesystem injection path.
   * - MUST tolerate older / mocked sessions that don't expose `listSkills`.
   * - SDK skills are classified into `kind: 'skill' | 'subagent'` (P0-4) so the
   *   UI / agent prompt can mark custom-droid subagents distinctly.
   *
   * Promoted to `public` in m1-f3 so `AcpAgentManager.startSkillsWatcher()`
   * can re-sync SDK skills whenever the filesystem changes under any of the
   * three skill roots (user / builtin / autoSkills). The method remains
   * idempotent and safe to invoke many times.
   */
  async syncSdkSkills(): Promise<void> {
    if (!this.session) return;
    const sessionId = this.session.sessionId ?? null;
    const sessionWithListSkills = this.session as DroidSession & {
      listSkills?: () => Promise<ListSkillsResult>;
    };
    // Sessions without `listSkills` short-circuit silently (VAL-SKILLS-003):
    // absence is the fallback path, NOT a failure — do not bump the counter
    // and do not emit slash_commands_updated because there is nothing to
    // broadcast. The filesystem discovery path in
    // `prepareFirstMessageWithSkillsIndex` still provides the skills index.
    if (typeof sessionWithListSkills.listSkills !== 'function') {
      mainLog('[DroidSdkAgent]', 'session.listSkills unavailable; skipping SDK skill sync');
      return;
    }

    let result: ListSkillsResult | undefined;
    try {
      result = await sessionWithListSkills.listSkills();
    } catch (error) {
      // VAL-SKILLS-002: listSkills rejection MUST NOT throw. We record a
      // structured log with stable key `droid.sync_sdk_skills.failed`
      // (name, message, sessionId — NEVER the raw Error object, to avoid
      // leaking stack traces / SDK internals into logs), bump the
      // observable failure counter, and still emit a `slash_commands_updated`
      // event so the UI can distinguish "SDK declined skills" from "we
      // never asked". The fallback prompt-injection path keeps working
      // because AcpSkillManager's filesystem discovery runs independently.
      //
      // 失败路径：结构化日志 + 失败计数器自增 + 仍发 slash_commands_updated
      // (sdkSkills: [], error: "..."); 绝不 throw, 绝不中断 startSession。
      const errName = error instanceof Error ? error.name : 'Error';
      const errMessage = error instanceof Error ? error.message : String(error);
      this.syncSdkSkillsFailureCount += 1;
      mainWarn('[DroidSdkAgent]', 'droid.sync_sdk_skills.failed', {
        sessionId,
        message: errMessage,
        name: errName,
      });
      this.config.onStreamEvent({
        type: 'slash_commands_updated',
        conversation_id: this.config.id,
        msg_id: '',
        data: {
          source: 'droid-sdk',
          sessionId,
          error: errMessage,
          sdkSkills: [],
        },
      });
      return;
    }

    const rawSkills: SkillInfo[] = Array.isArray(result?.skills) ? result!.skills : [];
    const sdkSkills: SdkSkill[] = rawSkills
      .filter((info): info is SkillInfo => Boolean(info?.name))
      .map((info) => ({
        name: info.name,
        description: info.description || `SDK Skill: ${info.name}`,
        // The SDK enum is a string union; reuse the raw string to avoid a
        // runtime import in AcpSkillManager.
        location: info.location as SdkSkill['location'],
        filePath: info.filePath || '',
        kind: this.classifySdkSkill(info),
        enabled: info.enabled,
        userInvocable: info.userInvocable,
        version: info.version,
      }));

    try {
      // m1-f1c — thread `backend: 'droid'` so the write lands in the
      // droid-scoped bucket of `sharedSdkSkillsByBackend`. Without this,
      // droid SDK skills leak into non-droid keyed instances (claude /
      // opencode / qwen / iflow) via every consumer method
      // (getSkillsIndex / hasAnySkills / hasSkill / getSdkSkills), and then
      // into `prepareFirstMessageWithSkillsIndex` /
      // `buildStaleSkillsReminder` prompt streams for those non-droid
      // conversations.
      const manager = AcpSkillManager.getInstance(undefined, { backend: 'droid' });
      manager.setSdkSkills(sdkSkills);
      // Force the next `prepareFirstMessageWithSkillsIndex` to re-scan the FS
      // (which is cheap) so user-installed builtin / optional skills stay fresh
      // alongside the SDK-reported set.
      AcpSkillManager.invalidate();
    } catch (error) {
      mainWarn('[DroidSdkAgent]', 'Failed to merge SDK skills into AcpSkillManager', error);
    }

    mainLog(
      '[DroidSdkAgent]',
      `listSkills merged ${sdkSkills.length} skills (subagents: ${sdkSkills.filter((s) => s.kind === 'subagent').length})`
    );

    // Notify UI to refresh the slash-command / skill menu.
    // VAL-CROSS-001: `AcpAgentManager.handleStreamEvent` now whitelists
    // `slash_commands_updated` so the renderer receives this emission even
    // during initial bootstrap; there is no longer a suppression caveat on
    // the fresh-conversation boot path.
    this.config.onStreamEvent({
      type: 'slash_commands_updated',
      conversation_id: this.config.id,
      msg_id: '',
      data: {
        source: 'droid-sdk',
        sessionId,
        sdkSkills: sdkSkills.map((skill) => ({
          name: skill.name,
          description: skill.description,
          kind: skill.kind,
          location: skill.location,
        })),
      },
    });
  }

  /**
   * Public diagnostics snapshot for the Droid SDK backend. Used by the
   * Bug Report modal and by integration tests to observe counters that would
   * otherwise be invisible (e.g. silent `listSkills` rejection cascades).
   *
   * The returned object is a value snapshot — mutating it has no effect on
   * the live agent state. Fields may grow in future releases; callers must
   * treat unknown keys as informational and ignore them.
   *
   * 对外暴露的诊断快照，目前只包含 `syncSdkSkillsFailureCount`。
   * 不可变数据，仅用于 Bug Report 展示 / 单测断言。
   */
  getDiagnosticsSnapshot(): { syncSdkSkillsFailureCount: number } {
    return {
      syncSdkSkillsFailureCount: this.syncSdkSkillsFailureCount,
    };
  }

  /**
   * Classify an SDK skill as a regular `skill` or a `subagent` (custom droid /
   * Task-style) so the UI can badge them differently.
   *
   * m1-f4 hardening — replaces the previous `haystack.includes('agent')` /
   * `haystack.includes('droid')` substring checks which false-positively
   * flagged user-installed skills living under the `agent-factory/` project
   * directory (e.g. `office-cli`). The new rule is:
   *
   *   1. If the SDK payload carries a structured `kind: 'subagent'` field
   *      (passthrough on `SkillInfoSchema` — not in the strict type yet),
   *      honour it verbatim.
   *   2. Otherwise scan the skill `name` and `filePath` for the bounded
   *      tokens `subagent`, `custom-droid`, `custom_droid` (NEVER the bare
   *      words `agent` or `droid`). A token is "bounded" when it is either
   *      at the start/end of the string or surrounded by a path/word
   *      separator (`/`, `\`, `.`, `_`, `-`, or whitespace). This prevents
   *      segments like `agent-factory` / `droidflyer` / `managed-skill` /
   *      `droid-skill-agent-of-truth` from matching while still allowing
   *      `my-subagent`, `research-subagent`, `/subagent/helper`,
   *      `/custom-droid/reviewer`, and `custom_droid` path segments to
   *      surface as subagents.
   *   3. Anything else falls through to `'skill'`.
   *
   * VAL-SKILLS-008 / 009 / 010 pin this classifier contract.
   *
   * 词边界 / 路径分段匹配：结构化 `kind` → bounded 名称 / 路径匹配 → 其他一律 `skill`。
   */
  private classifySdkSkill(info: Pick<SkillInfo, 'name' | 'location' | 'filePath'>): SdkSkillKind {
    // (1) Structured SDK signal takes precedence — if `@factory/droid-sdk`
    //     grows a `kind` discriminator (already allowed by the passthrough
    //     zod schema), we trust it and short-circuit the text matching.
    const structuredKind = (info as Record<string, unknown>).kind;
    if (typeof structuredKind === 'string' && structuredKind.toLowerCase() === 'subagent') {
      return 'subagent';
    }

    // (2) Bounded token match on `name` and `filePath`. `location` is an
    //     enum ('project' | 'personal' | 'builtin') which never carries
    //     user-controlled text, so we deliberately exclude it to keep the
    //     surface tight.
    const haystacks = [info.name, info.filePath].filter((value): value is string => typeof value === 'string');
    if (haystacks.some((value) => containsBoundedToken(value, SUBAGENT_BOUNDED_TOKENS))) {
      return 'subagent';
    }

    return 'skill';
  }

  private async refreshPublishedRuntimeSettings(): Promise<void> {
    if (!isDroidChannelPlatform(this.config.source)) {
      return;
    }

    try {
      const settings = await loadDroidRuntimeConfigForSource(this.config.source);
      this.applyPublishedRuntimeSettings(settings);
    } catch (error) {
      mainWarn('[DroidSdkAgent]', 'Failed to load published runtime settings', error);
      if (this.config.runtimeSettings) {
        this.applyPublishedRuntimeSettings(this.config.runtimeSettings);
      }
    }
  }

  private applyPublishedRuntimeSettings(settings: ResolvedDroidChannelRuntimeConfig): void {
    this.runtimeSettings = settings;
    const scopeKey = getDroidRuntimeScopeKey(this.config.source);
    this.runtimeScheduler = getDroidRuntimeScheduler(scopeKey, settings);

    if (this.permissionPolicy) {
      this.permissionPolicy.updateSettings(settings);
    } else {
      this.permissionPolicy = new DroidPermissionPolicy(settings);
    }

    if (this.askBridge) {
      this.askBridge.updateSettings(settings.askReplyTtlMs);
    } else {
      this.askBridge = new DroidTextAskBridge(settings.askReplyTtlMs);
    }

    this.config.onPublishedRuntimeSettingsUpdate?.(settings);
  }

  private normalizeAskUserQuestions(questions: AskUserQuestion[]): AskUserConfirmationQuestion[] {
    return questions.map((question, index) => ({
      index: question.index ?? index,
      topic: question.topic ?? '',
      question: question.question ?? '',
      options: Array.isArray(question.options)
        ? question.options.filter((option): option is string => typeof option === 'string')
        : [],
    }));
  }

  private getConfiguredReasoningEffort(): string | undefined {
    return (
      this.config.pendingConfigOptions?.[FACTORY_REASONING_CONFIG_ID] ||
      this.config.cachedConfigOptions?.find((option) => option.id === FACTORY_REASONING_CONFIG_ID)?.currentValue ||
      this.config.cachedConfigOptions?.find((option) => option.id === FACTORY_REASONING_CONFIG_ID)?.selectedValue
    );
  }

  private hasConfiguredSpecModeOverride(): boolean {
    return Boolean(
      this.config.pendingConfigOptions?.[FACTORY_SPEC_MODEL_CONFIG_ID] !== undefined ||
      this.config.cachedConfigOptions?.some((option) => option.id === FACTORY_SPEC_MODEL_CONFIG_ID)
    );
  }

  private getConfiguredSpecModeModelId(): string | null {
    const value =
      this.config.pendingConfigOptions?.[FACTORY_SPEC_MODEL_CONFIG_ID] ||
      this.config.cachedConfigOptions?.find((option) => option.id === FACTORY_SPEC_MODEL_CONFIG_ID)?.currentValue ||
      this.config.cachedConfigOptions?.find((option) => option.id === FACTORY_SPEC_MODEL_CONFIG_ID)?.selectedValue;

    if (!value || value === FACTORY_SPEC_MODEL_USE_MAIN_VALUE) {
      return null;
    }

    return value;
  }

  private getConfiguredSpecModeReasoningEffort(): string | undefined {
    return (
      this.config.pendingConfigOptions?.[FACTORY_SPEC_REASONING_CONFIG_ID] ||
      this.config.cachedConfigOptions?.find((option) => option.id === FACTORY_SPEC_REASONING_CONFIG_ID)?.currentValue ||
      this.config.cachedConfigOptions?.find((option) => option.id === FACTORY_SPEC_REASONING_CONFIG_ID)?.selectedValue
    );
  }

  private resolveSpecModeSettings(
    specModeModelId: string | null,
    specModeReasoningEffort: string | null | undefined,
    mainModelId: string,
    mainReasoningEffort: ReasoningLevel
  ): {
    specModeModelId: string | null;
    specModeReasoningEffort: ReasoningLevel | null;
  } {
    const resolvedSpecModeModelId = resolveFactorySpecModel(mainModelId, mainReasoningEffort, specModeModelId);
    if (!resolvedSpecModeModelId) {
      return {
        specModeModelId: null,
        specModeReasoningEffort: null,
      };
    }

    return {
      specModeModelId: resolvedSpecModeModelId,
      specModeReasoningEffort: resolveFactoryReasoning(resolvedSpecModeModelId, specModeReasoningEffort),
    };
  }

  private buildUpdateSessionSpecModeSettings(specModeSettings?: {
    specModeModelId: string | null;
    specModeReasoningEffort: ReasoningLevel | null;
  }): Partial<DroidSessionSettings> {
    const nextSettings = specModeSettings || {
      specModeModelId: this.currentSpecModeModelId,
      specModeReasoningEffort: this.currentSpecModeReasoningEffort,
    };

    if (!this.hasConfiguredSpecModeSettings && !nextSettings.specModeModelId) {
      return {};
    }

    return {
      specModeModelId: nextSettings.specModeModelId,
      specModeReasoningEffort: nextSettings.specModeModelId
        ? (nextSettings.specModeReasoningEffort as ReasoningEffort)
        : null,
    };
  }

  private getPromptPreamble(): string {
    return this.currentSessionMode === 'spec' || this.currentSessionMode === 'plan'
      ? SPEC_MODE_EXECUTION_REMINDER
      : ASK_USER_TOOL_FORMAT_REMINDER;
  }

  /**
   * Build a `<system-reminder>` snippet describing any attachments the native
   * resolver had to skip (missing file, directory, read error). Oversized files
   * MUST NOT be surfaced here because the `sendMessageInternal` caller already
   * falls back to the legacy `@file` text for them — a duplicate notice would
   * confuse Droid.
   *
   * Returns an empty string when there is nothing to say (caller is expected
   * to check `reminder.length > 0` before prepending).
   *
   * 给 Droid 发一条 system-reminder，说明哪些附件因为什么原因没传进来。
   */
  private buildSkippedAttachmentReminder(skipped: SkippedAttachment[]): string {
    if (skipped.length === 0) return '';
    const lines = skipped.map((entry) => {
      const reasonLabel =
        entry.reason === 'not_found'
          ? 'not found'
          : entry.reason === 'is_directory'
            ? 'is a directory'
            : entry.reason === 'read_failed'
              ? 'could not be read'
              : entry.reason;
      return `- ${entry.path} (${reasonLabel})`;
    });
    return (
      `<system-reminder>\n` +
      `The following attachments were not delivered and should be considered unavailable:\n` +
      `${lines.join('\n')}\n` +
      `Do not reference them as if they were loaded; ask the user to re-send if you need them.\n` +
      `</system-reminder>\n\n`
    );
  }

  private emitError(message: string): void {
    this.config.onStreamEvent({
      type: 'error',
      conversation_id: this.config.id,
      msg_id: `error_${uuid()}`,
      data: message,
    });
  }

  private getSessionSettingsForMode(mode: string | undefined): DroidModeSettings {
    switch (mode) {
      case 'spec':
      case 'plan':
        return {
          interactionMode: DroidInteractionMode.Spec,
          autonomyLevel: AutonomyLevel.Off,
        };
      case 'acceptEdits':
      case 'autoEdit':
      case 'auto_edit':
        return {
          interactionMode: DroidInteractionMode.Auto,
          autonomyLevel: AutonomyLevel.Low,
        };
      case 'auto':
        return {
          interactionMode: DroidInteractionMode.Auto,
          autonomyLevel: AutonomyLevel.Medium,
        };
      case 'bypassPermissions':
      case 'yolo': {
        // autonomyLevel=High already routes every permission request through
        // `DroidPermissionPolicy.evaluate` which auto-approves with
        // `ProceedOnce`, so the UX is already prompt-less. `skipPermissionsUnsafe`
        // is the SDK-level "真 YOLO" switch that tells Droid to stop SENDING
        // permission requests entirely. It is ONLY added when the user has
        // explicitly confirmed via `SkipPermissionsConfirmModal`.
        //
        // 同时满足两件事（SKILL P0-3 硬约束）：
        //   1. autonomyLevel=High（下发给策略层 → ProceedOnce）
        //   2. skipPermissionsUnsafe=true（下发给 CLI → 不再触发 permissionHandler）
        //   仅在 skipPermissionsUnsafeConfirmed === true 时才加第二项。
        const base: DroidModeSettings = {
          interactionMode: DroidInteractionMode.Auto,
          autonomyLevel: AutonomyLevel.High,
        };
        if (this.skipPermissionsUnsafeConfirmed) {
          base.skipPermissionsUnsafe = true;
        }
        return base;
      }
      case 'mission': {
        // Mission / Decomp mode (SKILL P2-1). Routes the session into Factory
        // Droid's orchestrator path so the CLI spawns worker sessions for each
        // decomposed feature. We always request Orchestrator here — worker
        // sessions are created by the CLI itself (via `mission_worker_started`
        // notifications), never by this agent. `autonomyLevel=Medium` keeps
        // the orchestrator prompt-driven (not fully autonomous) so the user
        // can pause / replan between milestones.
        //
        // 硬约束（SKILL P2-1）：
        //   - decompSessionType 必须是 Orchestrator；worker 由 CLI 自行创建。
        //   - decompSessionType 通过 unknown 强转注入（公共 SDK 接口不暴露）。
        //   - 交互形态仍是 interactionMode=Auto，便于用户回到主对话流查看
        //     mission 进度；autonomyLevel=Medium 与普通 auto 模式一致。
        return {
          interactionMode: DroidInteractionMode.Auto,
          autonomyLevel: AutonomyLevel.Medium,
          decompSessionType: DecompSessionType.Orchestrator,
        };
      }
      case 'default':
      default:
        return {
          interactionMode: DroidInteractionMode.Auto,
          autonomyLevel: AutonomyLevel.Off,
        };
    }
  }

  /**
   * Apply (or clear) the "真 YOLO" `skipPermissionsUnsafe` flag for the current
   * conversation.
   *
   * - MUST only be called after the UI has shown `SkipPermissionsConfirmModal`
   *   and collected an explicit user confirmation.
   * - Default state is `false`; a brand-new session or a session returning to
   *   non-YOLO mode MUST NOT carry over a previous `true` across sessions.
   * - When called with `confirmed=true` while the current mode is already
   *   `yolo`, the setter forwards the change to the live session via
   *   `session.updateSettings({ skipPermissionsUnsafe: true })`. Since the
   *   public `UpdateSessionSettingsRequestParams` TS type in SDK 0.1.4 doesn't
   *   include the field, we cast through `unknown` — the SDK sends the params
   *   raw via JSON-RPC so the CLI receives the flag.
   * - If the CLI rejects the update (e.g. strict schema on server), the error
   *   is surfaced back to the caller but the in-memory state is still updated
   *   so subsequent mode switches in the same session will re-attempt via
   *   `getSessionSettingsForMode('yolo')`.
   *
   * 硬约束：仅当 UI 弹窗用户显式"我确认"后调用，且默认 false。离开 YOLO 或切换
   * 模式时应再次调用本方法 confirmed=false 以清除状态，避免跨会话泄漏。
   */
  async setSkipPermissionsUnsafe(confirmed: boolean): Promise<{ success: boolean; error?: string }> {
    const previous = this.skipPermissionsUnsafeConfirmed;
    this.skipPermissionsUnsafeConfirmed = confirmed;

    // No live session yet — state will take effect on next `startSession()`.
    if (!this.session) {
      return { success: true };
    }

    // If we're not in yolo mode the flag doesn't need pushing right now; the
    // next `setMode('yolo')` will pick it up through `getSessionSettingsForMode`.
    if (this.currentSessionMode !== 'yolo') {
      return { success: true };
    }

    // Already consistent — no-op
    if (previous === confirmed) {
      return { success: true };
    }

    try {
      await this.applySkipPermissionsUnsafeToSession(confirmed);
      mainLog('[DroidSdkAgent]', `skipPermissionsUnsafe ${confirmed ? 'enabled' : 'disabled'} for active YOLO session`);
      return { success: true };
    } catch (error) {
      // Roll back local state on hard failure so subsequent setMode('yolo')
      // won't try to re-push the flag silently.
      this.skipPermissionsUnsafeConfirmed = previous;
      const errMsg = error instanceof Error ? error.message : String(error);
      mainWarn('[DroidSdkAgent]', `setSkipPermissionsUnsafe(${confirmed}) failed`, errMsg);
      return { success: false, error: errMsg };
    }
  }

  /** Read-only view used by tests / diagnostics. */
  get isSkipPermissionsUnsafeConfirmed(): boolean {
    return this.skipPermissionsUnsafeConfirmed;
  }

  /**
   * Push `skipPermissionsUnsafe` to the active session via
   * `session.updateSettings(...)`. The public
   * `UpdateSessionSettingsRequestParams` in SDK 0.1.4 doesn't include the
   * field, but the SDK sends the params raw via JSON-RPC to the CLI. We cast
   * through `unknown` because the TS type is deliberately strict.
   *
   * Caller is responsible for updating `this.skipPermissionsUnsafeConfirmed`
   * (this method ONLY performs the JSON-RPC call — it does not mutate state).
   */
  private async applySkipPermissionsUnsafeToSession(enabled: boolean): Promise<void> {
    if (!this.session) return;
    const payload = { skipPermissionsUnsafe: enabled } as unknown as Partial<DroidSessionSettings>;
    await this.session.updateSettings(payload);
  }

  /**
   * Push `decompSessionType` (+ optional `decompMissionId`) to the active
   * session via `session.updateSettings(...)`. The public
   * `UpdateSessionSettingsRequestParams` in SDK 0.1.4 doesn't include these
   * fields, but the `InitializeSessionRequestParamsSchema` does and the client
   * forwards the params raw via JSON-RPC. We cast through `unknown` for the
   * same reason as `applySkipPermissionsUnsafeToSession`.
   *
   * Hard rules (SKILL P2-1):
   * - Best-effort: the caller MUST swallow any error so a mismatched CLI
   *   doesn't blow up the whole startup.
   * - `decompMissionId` is only forwarded when provided; an absent id means
   *   "start a fresh mission" (CLI will allocate one on its side).
   * - Caller must have already set `currentSessionMode = 'mission'` before
   *   calling this — the method itself does NOT check or mutate mode state.
   *
   * 只做 JSON-RPC 推送，不做状态管理。由调用方（startSession / setMode）负责
   * 在正确的时机（mode === 'mission'）调用。
   */
  private async applyDecompSettingsToSession(
    decompSessionType: DecompSessionType,
    decompMissionId: string | undefined
  ): Promise<void> {
    if (!this.session) return;
    const payload = {
      decompSessionType,
      ...(decompMissionId ? { decompMissionId } : {}),
    } as unknown as Partial<DroidSessionSettings>;
    try {
      await this.session.updateSettings(payload);
      mainLog('[DroidSdkAgent]', 'decomp settings pushed to session', {
        decompSessionType,
        decompMissionId: decompMissionId ?? null,
      });
    } catch (error) {
      // Best-effort: a CLI that doesn't recognise decomp fields will reject
      // the updateSettings call. That must NOT break session startup — the
      // caller (startSession) is already in its happy path.
      mainWarn(
        '[DroidSdkAgent]',
        'applyDecompSettingsToSession failed; session will remain non-mission',
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  // ── Tool whitelist (P2-2) ───────────────────────────────────────────

  /**
   * Update the tool whitelist for the current conversation.
   *
   * Three-state contract (SKILL P2-2 hard constraint):
   * - `null`         → clear the whitelist; restores the SDK default tool set
   *                    on subsequent sessions. On a live session we push
   *                    `enabledToolIds: undefined` so the server drops the
   *                    previously-installed whitelist.
   * - `[]` (empty)   → "disable ALL tools" — sent verbatim so the CLI rejects
   *                    every tool call. Distinct from `null` / `undefined`.
   * - `[id, id, …]`  → pass-through whitelist; unknown ids surface as CLI
   *                    errors at tool-use time, NOT here.
   *
   * Local state (`this.enabledToolIds`) is updated first so that if a later
   * `startSession` / `resumeSession` happens before a turn, the whitelist
   * takes effect automatically via `createSession({ enabledToolIds })` /
   * `applyEnabledToolIdsToSession(...)`. If the JSON-RPC push fails, the
   * local state stays in sync with the intent (no rollback) — the SDK's
   * next `updateSettings` with a valid schema will simply overwrite it.
   *
   * Public API is idempotent: calling with the same value twice is a no-op
   * for the live session but always updates local state (cheap).
   *
   * 硬约束：
   *   - null = 清空白名单（回到 SDK 默认）；
   *   - []   = 禁用所有工具；
   *   - [id] = 白名单，SDK 在执行时做真实性校验；
   *   - 永不在本方法里做 rollback，调用方按 success 结果决定 UI 状态即可。
   *
   * @returns `{ success: true }` on happy path / live-session updateSettings
   *   accepted / no live session yet (value cached for next startSession).
   *   `{ success: false, error }` when the SDK rejected the updateSettings
   *   call (e.g. network / 402 / schema mismatch).
   */
  async setEnabledToolIds(ids: string[] | null): Promise<{ success: boolean; error?: string }> {
    // Normalize incoming value onto the three-state contract:
    //   null → undefined (clear); array (including []) → verbatim.
    // Do NOT convert `[]` to `undefined` — the empty-array intent must survive.
    // 归一化：null → undefined；数组原样保留（空数组不能被丢弃）。
    const next = ids === null ? undefined : ids;
    this.enabledToolIds = next;

    // No live session yet: state will apply on the next startSession /
    // resumeSession via the create/resume paths.
    if (!this.session) {
      return { success: true };
    }

    try {
      await this.applyEnabledToolIdsToSession(next);
      mainLog('[DroidSdkAgent]', 'enabledToolIds updated', {
        conversation_id: this.config.id,
        sessionId: this.session.sessionId,
        count: next?.length ?? null, // null = cleared (no whitelist)
      });
      return { success: true };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      mainWarn('[DroidSdkAgent]', 'setEnabledToolIds failed', errMsg);
      return { success: false, error: errMsg };
    }
  }

  /**
   * Read-only view of the current tool whitelist.
   *
   * Returns the same three-state shape that `setEnabledToolIds` accepts on
   * input, minus the `null` sentinel — `undefined` is used for both "unset"
   * and "cleared". Exposed for tests / diagnostics only; UI code should
   * persist its own copy.
   */
  get currentEnabledToolIds(): string[] | undefined {
    return this.enabledToolIds;
  }

  /**
   * Push the current `enabledToolIds` value to the live session.
   *
   * The SDK 0.1.4 public `UpdateSessionSettingsRequestParams` type does NOT
   * include `enabledToolIds` (the field lives on `CreateSessionOptions` /
   * `InitializeSessionRequestParams` only). At runtime, however, the JSON-RPC
   * client forwards the params object as-is; the Droid CLI accepts the
   * whitelist mid-session. We cast through `unknown` to `Partial<DroidSessionSettings>`
   * for the same reason as `applySkipPermissionsUnsafeToSession` /
   * `applyDecompSettingsToSession`: keep intent visible in the source, let a
   * future SDK release with a widened public type take over without a rewrite.
   *
   * Note: `undefined` is explicitly included in the payload so the CLI can
   * distinguish "clear whitelist" from "no change" when the session was
   * previously configured with one.
   *
   * 只做 JSON-RPC 推送，状态管理由 setEnabledToolIds / startSession 负责。
   */
  private async applyEnabledToolIdsToSession(ids: string[] | undefined): Promise<void> {
    if (!this.session) return;
    const payload = { enabledToolIds: ids } as unknown as Partial<DroidSessionSettings>;
    await this.session.updateSettings(payload);
  }

  // ── MCP management (P1-1) ───────────────────────────────────────────
  //
  // Thin public wrappers around the SDK's MCP methods. Every method MUST:
  //   1. Guard on `this.session` being alive (return a structured error).
  //   2. Route thrown errors through a shared try/catch that converts them
  //      into `{ success: false, error: string }` — callers never see raw SDK
  //      exceptions, which keeps BYOK / 402 fallback centralised.
  //   3. Stay the ONLY entry point that imports SDK runtime types — external
  //      files talk to MCP exclusively via these wrappers (hard constraint #1
  //      in the task spec).
  //
  // 这一层是 DroidSdkAgent 对外暴露的 MCP 管理入口。任何外部调用（AcpAgentManager
  // / BYOK 服务 / 未来 IPC bridge）都必须走这些方法，禁止绕开 DroidSdkAgent 直接
  // import `@factory/droid-sdk` 的运行期 API。

  /**
   * Register a new MCP server on the live session.
   *
   * Returns `{ success: true }` on happy path, `{ success: false, error }` on
   * any error (session not ready, SDK rejected, network, etc.).
   */
  async addMcpServer(params: AddMcpServerParams): Promise<{ success: boolean; error?: string }> {
    if (!this.session) {
      return { success: false, error: 'Droid session not initialized' };
    }
    try {
      const result = (await this.session.addMcpServer(params)) as AddMcpServerResult;
      if (result && typeof result.success === 'boolean' && !result.success) {
        return { success: false, error: 'SDK reported addMcpServer returned success=false' };
      }
      mainLog('[DroidSdkAgent]', 'addMcpServer ok', { name: params.name, type: params.type });
      return { success: true };
    } catch (error) {
      return this.createMcpErrorResult(error, 'addMcpServer');
    }
  }

  /**
   * Remove an MCP server by name. SDK requires `settingsLevel: SettingsLevel.User`
   * — we pass the literal string `'user'` to avoid a runtime enum import.
   */
  async removeMcpServer(name: string): Promise<{ success: boolean; error?: string }> {
    if (!this.session) {
      return { success: false, error: 'Droid session not initialized' };
    }
    try {
      // SDK's RemoveMcpServerRequestParams requires `settingsLevel: SettingsLevel.User`.
      // Literal 'user' matches the enum string value in SDK 0.1.4.
      const result = (await this.session.removeMcpServer({
        serverName: name,
        settingsLevel: 'user',
      } as Parameters<DroidSession['removeMcpServer']>[0])) as RemoveMcpServerResult;
      if (result && typeof result.success === 'boolean' && !result.success) {
        return { success: false, error: 'SDK reported removeMcpServer returned success=false' };
      }
      mainLog('[DroidSdkAgent]', 'removeMcpServer ok', { name });
      return { success: true };
    } catch (error) {
      return this.createMcpErrorResult(error, 'removeMcpServer');
    }
  }

  /**
   * Enable or disable an existing MCP server.
   */
  async toggleMcpServer(name: string, enabled: boolean): Promise<{ success: boolean; error?: string }> {
    if (!this.session) {
      return { success: false, error: 'Droid session not initialized' };
    }
    try {
      const result = (await this.session.toggleMcpServer({
        serverName: name,
        enabled,
        settingsLevel: 'user',
      } as Parameters<DroidSession['toggleMcpServer']>[0])) as ToggleMcpServerResult;
      if (result && typeof result.success === 'boolean' && !result.success) {
        return { success: false, error: 'SDK reported toggleMcpServer returned success=false' };
      }
      mainLog('[DroidSdkAgent]', 'toggleMcpServer ok', { name, enabled });
      return { success: true };
    } catch (error) {
      return this.createMcpErrorResult(error, 'toggleMcpServer');
    }
  }

  /**
   * List MCP servers known to the live session. Returns the raw
   * `McpServerStatusInfo[]` (re-exported as `McpServerSummary`) so callers can
   * inspect connection status / auth state without importing SDK types.
   */
  async listMcpServers(): Promise<{ servers: McpServerSummary[]; error?: string }> {
    if (!this.session) {
      return { servers: [], error: 'Droid session not initialized' };
    }
    try {
      const result = (await this.session.listMcpServers()) as ListMcpServersResult;
      const servers: McpServerSummary[] = Array.isArray(result?.servers) ? (result.servers as McpServerSummary[]) : [];
      return { servers };
    } catch (error) {
      const errMsg = this.createMcpErrorResult(error, 'listMcpServers').error ?? 'listMcpServers failed';
      return { servers: [], error: errMsg };
    }
  }

  /**
   * List MCP tools available via currently-connected servers.
   */
  async listMcpTools(): Promise<{ tools: McpToolSummary[]; error?: string }> {
    if (!this.session) {
      return { tools: [], error: 'Droid session not initialized' };
    }
    try {
      const result = (await this.session.listMcpTools()) as ListMcpToolsResult;
      const tools: McpToolSummary[] = Array.isArray(result?.tools) ? (result.tools as McpToolSummary[]) : [];
      return { tools };
    } catch (error) {
      const errMsg = this.createMcpErrorResult(error, 'listMcpTools').error ?? 'listMcpTools failed';
      return { tools: [], error: errMsg };
    }
  }

  /**
   * Trigger the SDK OAuth / token flow for an MCP server. The `authUrl` is
   * emitted to the UI via the `mcp_auth` stream event when the SDK sends a
   * follow-up `MCP_AUTH_REQUIRED` notification (see `handleMappedNotification`).
   * We do NOT surface the URL from the return value here — the SDK's current
   * result schema (`{ success: boolean }`) does not include it directly.
   */
  async authenticateMcpServer(
    params: AuthMcpServerParams
  ): Promise<{ success: boolean; authUrl?: string; error?: string }> {
    if (!this.session) {
      return { success: false, error: 'Droid session not initialized' };
    }
    try {
      const result = (await this.session.authenticateMcpServer(params)) as AuthenticateMcpServerResult & {
        authUrl?: string;
      };
      if (result && typeof result.success === 'boolean' && !result.success) {
        return { success: false, error: 'SDK reported authenticateMcpServer returned success=false' };
      }
      mainLog('[DroidSdkAgent]', 'authenticateMcpServer ok', { name: params.serverName });
      // SDK 0.1.4's declared result is `{ success: boolean }`, but the schema
      // is `passthrough`, so the CLI may also ship an `authUrl` field. Preserve
      // it when present; otherwise rely on the MCP_AUTH_REQUIRED notification
      // to carry the URL (see mapDroidNotification / handleMappedNotification).
      const authUrl = typeof result?.authUrl === 'string' ? result.authUrl : undefined;
      return { success: true, ...(authUrl ? { authUrl } : {}) };
    } catch (error) {
      return this.createMcpErrorResult(error, 'authenticateMcpServer');
    }
  }

  /**
   * Compute which servers need to be registered and call `addMcpServer` for
   * each one. Called once per `startSession()` (see call site). This is
   * strictly best-effort:
   *
   * - Any failure (listMcpServers throws, addMcpServer rejects) is logged but
   *   MUST NOT bubble up — the session MUST still reach `isConnected = true`.
   * - We never REMOVE servers here; team / user management is the source of
   *   truth for removals.
   * - We skip entries that are already present by name (no re-add, no update
   *   — `addMcpServer` would likely fail with a duplicate-name error anyway).
   *
   * 启动时把 team / project 应当启用的 MCP 注册到 session，容忍任何失败。
   */
  private async syncMcpServersOnStartup(): Promise<void> {
    if (!this.session) return;

    // 1. Collect desired servers from config sources. Team-scoped stdio config
    //    uses a legacy `env: Array<{name, value}>` shape — flatten it here so
    //    downstream mapping can treat everything uniformly.
    const desired: DesiredMcpServer[] = [];
    const teamCfg = this.config.teamMcpStdioConfig;
    if (teamCfg && teamCfg.name && teamCfg.command) {
      const env: Record<string, string> = {};
      if (Array.isArray(teamCfg.env)) {
        for (const pair of teamCfg.env) {
          if (pair && typeof pair.name === 'string' && typeof pair.value === 'string') {
            env[pair.name] = pair.value;
          }
        }
      }
      desired.push({
        name: teamCfg.name,
        type: 'stdio',
        command: teamCfg.command,
        args: Array.isArray(teamCfg.args) ? teamCfg.args : [],
        env: Object.keys(env).length > 0 ? env : undefined,
      });
    }
    const projectServers = normalizeDesiredMcpServers(this.config.projectMcpServers);
    desired.push(...projectServers);

    if (desired.length === 0) {
      mainLog('[DroidSdkAgent]', 'syncMcpServersOnStartup skipped: no desired MCP servers in config');
      return;
    }

    // 2. Query what the session already knows.
    // We MUST know the current state before adding — otherwise we could create
    // duplicates or re-register servers that already exist. If this call fails
    // for any reason, abort the add phase (best-effort: do not block startup).
    let existing: McpServerSummary[];
    try {
      const { servers, error } = await this.listMcpServers();
      if (error) {
        mainWarn('[DroidSdkAgent]', 'syncMcpServersOnStartup: listMcpServers failed, aborting sync', error);
        return;
      }
      existing = servers;
    } catch (error) {
      // Defensive: listMcpServers() already catches, but belt-and-braces.
      mainWarn(
        '[DroidSdkAgent]',
        'syncMcpServersOnStartup: unexpected listMcpServers failure, aborting sync',
        error instanceof Error ? error.message : String(error)
      );
      return;
    }

    // 3. Diff & add.
    const missing = diffMissingMcpServers(
      desired,
      existing.map((s) => s.name)
    );
    if (missing.length === 0) {
      mainLog('[DroidSdkAgent]', 'syncMcpServersOnStartup: all desired MCP servers already present', {
        desired: desired.length,
        existing: existing.length,
      });
      return;
    }

    let addedOk = 0;
    let addedFail = 0;
    // Sequential add is intentional: MCP server registration mutates session
    // state (settings file + spawned subprocesses) and parallel calls have been
    // observed to race on the CLI side. Keeping order also makes the log trail
    // easier to debug when one registration fails mid-sync.
    // 串行注册是刻意行为，不要改成 Promise.all。
    for (const server of missing) {
      const params = toAddMcpServerParams(server);
      if (!params) {
        mainWarn('[DroidSdkAgent]', 'syncMcpServersOnStartup: skipping malformed MCP entry', {
          name: server.name,
          type: server.type,
        });
        addedFail += 1;
        continue;
      }
      // eslint-disable-next-line no-await-in-loop -- see block comment above
      const { success, error } = await this.addMcpServer(params);
      if (success) {
        addedOk += 1;
      } else {
        addedFail += 1;
        mainWarn('[DroidSdkAgent]', 'syncMcpServersOnStartup: addMcpServer failed', {
          name: params.name,
          error,
        });
      }
    }
    mainLog('[DroidSdkAgent]', 'syncMcpServersOnStartup complete', {
      desired: desired.length,
      existing: existing.length,
      addedOk,
      addedFail,
    });
  }

  /**
   * Normalise an SDK-thrown MCP error into the `{ success, error }` shape
   * returned by all public MCP wrappers. Also preserves the Factory 402 →
   * Chinese prompt convention used elsewhere in this file.
   */
  private createMcpErrorResult(error: unknown, op: string): { success: false; error: string } {
    let errMsg = error instanceof Error ? error.message : String(error);
    if (errMsg.includes('402') || errMsg.includes('Payment Required')) {
      errMsg = 'Factory 算力额度不足，请前往 https://app.factory.ai/settings/usage 充值后继续使用。';
    }
    mainWarn('[DroidSdkAgent]', `${op} error`, errMsg);
    return { success: false, error: errMsg };
  }

  // ── Bug report (P2-4) ───────────────────────────────────────────────
  //
  // Forward a user-triggered "report this to Factory" submission onto the
  // SDK's native `DroidClient.submitBugReport` path. The SDK only accepts
  // `{ userComment, clientLogs? }` on the wire, so we pack the UI-collected
  // title/description PLUS non-PII runtime metadata (app version, SDK
  // version, platform/arch, optional session id) into `userComment` and
  // deliberately leave `clientLogs` empty to avoid ever shipping conversation
  // content or filesystem paths to Factory.
  //
  // Hard constraints (see P2-4 in `gaps-and-guidance.md` + task spec):
  //   1. `DroidSession` in SDK 0.1.4 doesn't expose `submitBugReport`. We
  //      must reach the underlying `DroidClient` via the session's private
  //      `_client` field; instantiating a standalone `DroidClient` would
  //      require a new JSON-RPC transport handshake and is strictly worse.
  //   2. Only `DroidSdkAgent` may import SDK runtime types — IPC surfaces
  //      call this method, nothing goes direct to the SDK. That's why the
  //      IPC provider in `acpConversationBridge.ts` calls
  //      `AcpAgentManager.submitBugReport(...)` which calls this method.
  //   3. `includeSessionId` defaults to `true`. Callers can explicitly opt
  //      out by passing `false` (the renderer Modal exposes this as a
  //      checkbox).
  //   4. Errors MUST be captured as a structured `{ success: false, error }`
  //      value instead of bubbling up — the UI surfaces the message via
  //      `Message.error`, and callers never expect a thrown Error.
  //
  // 把用户填写的 title / description 以及运行时元数据（App 版本、SDK 版本、
  // 平台、可选 session id）拼装进 SDK `submitBugReport` 的 `userComment`，
  // `clientLogs` 永远不填，避免意外上传会话内容或文件路径等隐私信息。

  /**
   * Submit a bug report to Factory. The `title` + `description` are merged
   * into a single `userComment` string along with environment metadata.
   *
   * @param report.title       User-entered short title (required)
   * @param report.description User-entered long description (required)
   * @param report.includeSessionId When `false`, the current sessionId is
   *   NOT attached. Defaults to `true` — callers must opt out explicitly.
   * @returns `{ success: true, reportId }` on happy path (the SDK returns
   *   `{ bugReportId }` in its typed result, we propagate it verbatim so
   *   the UI can surface it). `{ success: false, error }` on any failure
   *   (session missing, SDK rejected, transport error, etc.).
   */
  async submitBugReport(report: {
    title: string;
    description: string;
    includeSessionId?: boolean;
  }): Promise<{ success: boolean; reportId?: string; error?: string }> {
    if (!this.session) {
      return {
        success: false,
        error: 'Droid session not initialized',
      };
    }

    // Dig through the narrow structural cast described on
    // `SessionWithInternalClient`. If `_client` / `submitBugReport` is absent
    // (older SDK, mocked session, etc.) we fail fast without touching the
    // transport — no speculative fallback to a standalone DroidClient because
    // that would need a live ProcessTransport which we do not have here.
    const internal = this.session as unknown as SessionWithInternalClient;
    const internalClient = internal._client;
    if (!internalClient || typeof internalClient.submitBugReport !== 'function') {
      return {
        success: false,
        error: 'submitBugReport is not supported by the active Droid SDK session',
      };
    }

    // Resolve runtime metadata. `app.getVersion()` reads
    // `Electron.app.getVersion()` which in turn honours `productName` /
    // `version` from the packaged app's `package.json`; in dev it falls back
    // to the source package.json. Defensive try/catch so a broken Electron
    // harness (e.g. unit test context without a real app singleton) cannot
    // block bug report submission.
    let appVersion = 'unknown';
    try {
      if (app && typeof app.getVersion === 'function') {
        appVersion = app.getVersion();
      }
    } catch (error) {
      mainWarn(
        '[DroidSdkAgent]',
        'app.getVersion() failed while preparing bug report metadata',
        error instanceof Error ? error.message : String(error)
      );
    }

    const includeSessionId = report.includeSessionId !== false;
    const sessionId = includeSessionId ? this.session.sessionId : null;
    const metadataLines = [
      `- App version: ${appVersion}`,
      `- SDK (@factory/droid-sdk): ${FACTORY_DROID_SDK_VERSION_FOR_BUG_REPORT}`,
      `- Platform: ${process.platform}`,
      `- Arch: ${process.arch}`,
    ];
    if (sessionId) {
      metadataLines.push(`- Session ID: ${sessionId}`);
    }
    // Surface the agent's diagnostics snapshot so the Factory team can
    // correlate silent SDK failures (listSkills etc.) with the user's
    // reported issue. Only non-default values are included to keep
    // `userComment` concise; zeroed counters are noise.
    const diagnostics = this.getDiagnosticsSnapshot();
    if (diagnostics.syncSdkSkillsFailureCount > 0) {
      metadataLines.push(`- syncSdkSkills failures: ${diagnostics.syncSdkSkillsFailureCount}`);
    }

    const userComment = [
      `Title: ${report.title}`,
      '',
      'Description:',
      report.description,
      '',
      'Metadata:',
      ...metadataLines,
    ].join('\n');

    try {
      // NOTE: `clientLogs` is deliberately omitted. The SDK treats a missing
      // `clientLogs` as "no logs attached"; populating it would risk leaking
      // conversation content or absolute file paths. If, in the future, the
      // product wants to attach scrubbed logs, that should be gated by a
      // second explicit user confirmation — see SKILL notes on privacy.
      // 刻意不传 clientLogs，避免误传入会话内容 / 文件路径等隐私数据。
      const result = await internalClient.submitBugReport({ userComment });
      const reportId = typeof result?.bugReportId === 'string' ? result.bugReportId : undefined;
      mainLog('[DroidSdkAgent]', 'submitBugReport ok', {
        conversation_id: this.config.id,
        sessionId: sessionId ?? null,
        reportId: reportId ?? null,
      });
      return {
        success: true,
        ...(reportId ? { reportId } : {}),
      };
    } catch (error) {
      let errMsg = error instanceof Error ? error.message : String(error);
      if (errMsg.includes('402') || errMsg.includes('Payment Required')) {
        errMsg = 'Factory 算力额度不足，请前往 https://app.factory.ai/settings/usage 充值后继续使用。';
      }
      mainWarn('[DroidSdkAgent]', 'submitBugReport failed', errMsg);
      return { success: false, error: errMsg };
    }
  }
}
