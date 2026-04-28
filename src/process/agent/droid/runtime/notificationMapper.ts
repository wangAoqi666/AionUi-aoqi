/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Droid SDK 服务端推送（`session.onNotification`）→ UI 事件映射。
 * Maps server → client SDK notifications (push from `session.onNotification`) to
 * structured results that `DroidSdkAgent` can then emit as `IResponseMessage`
 * events on the shared stream pipeline.
 *
 * 硬约束（见 `.factory/skills/droid-sdk-integration/references/gaps-and-guidance.md`
 * 的 P0-2 / P2-1 章节）：
 * - **纯函数**：只做 notification → mapped result 的转换，不做 IPC、不做存储、
 *   不做跨进程副作用。DroidSdkAgent 订阅 callback 里再决定怎么发 UI 事件。
 * - **不 import 运行期 `@factory/droid-sdk`**。类型导入可用 `import type`，
 *   枚举字符串值直接写在源码里（与 SDK enum 的字符串值逐一对齐）。
 * - **绝不抛错**：未知 type 返回 `{ kind: 'ignored', type }`；字段缺失用
 *   安全的可选链和 fallback。mapper 在 JSON-RPC 推送路径上，任何抛错都会
 *   污染调用方。
 *
 * 当前覆盖的 10 个 notification type（其余 type 本轮不处理，直接 ignored）：
 * - `session_title_updated`      → `session_title`
 * - `settings_updated`           → `settings_updated`
 * - `mcp_status_changed`         → `mcp_status`
 * - `mcp_auth_required`          → `mcp_auth_required`
 * - `mission_state_changed`      → `mission_state`        (P2-1)
 * - `mission_features_changed`   → `mission_features`     (P2-1)
 * - `mission_progress_entry`     → `mission_progress`     (P2-1)
 * - `mission_heartbeat`          → `mission_heartbeat`    (P2-1)
 * - `mission_worker_started`     → `mission_worker_started`   (P2-1)
 * - `mission_worker_completed`   → `mission_worker_completed` (P2-1)
 */

// 仅类型导入；运行期 NotificationCallback 是 `(notification: Record<string, unknown>) => void`。
// Only types are imported — no runtime dependency on the SDK here.
import type { UpdateSessionSettingsRequestParams } from '@factory/droid-sdk';
import { normalizeBackendErrorMessage } from './backendErrorMessage';

/**
 * SDK `SessionNotificationType` 的枚举字符串值，与 `index.d.ts` L41-L62 一一对应。
 * Subset of SDK `SessionNotificationType` string literals actually consumed here.
 * Keep in sync with `node_modules/@factory/droid-sdk/dist/index.d.ts` around line 41.
 */
export const DroidNotificationTypeLiteral = {
  SessionTitleUpdated: 'session_title_updated',
  SettingsUpdated: 'settings_updated',
  McpStatusChanged: 'mcp_status_changed',
  McpAuthRequired: 'mcp_auth_required',
  // P2-1 mission / decomp notifications. String values match SDK
  // `SessionNotificationType.MISSION_*` literals in `index.d.ts` L54-L59.
  MissionStateChanged: 'mission_state_changed',
  MissionFeaturesChanged: 'mission_features_changed',
  MissionProgressEntry: 'mission_progress_entry',
  MissionHeartbeat: 'mission_heartbeat',
  MissionWorkerStarted: 'mission_worker_started',
  MissionWorkerCompleted: 'mission_worker_completed',
  // BYOK fix (2026-04-23): backend-pushed error notifications must surface in
  // the UI instead of being silently dropped as `ignored`. Matches the SDK's
  // lowercased `error` type literal.
  Error: 'error',
} as const;

/**
 * MCP 服务器状态条目（mapper 输出子结构）。
 * Minimal structural copy of the SDK's MCP server status info — intentionally
 * kept loose (`string` instead of enum) because mapper must never explode on
 * unexpected server-reported values.
 */
export interface MappedMcpServerStatus {
  name: string;
  status: string;
  source?: string;
  error?: string;
  toolCount?: number;
  serverType?: string;
  hasAuthTokens?: boolean;
  isManaged?: boolean;
}

export interface MappedMcpStatusSummary {
  total: number;
  connected: number;
  connecting: number;
  failed: number;
  disabled?: number;
}

/**
 * Mission feature entry (loose structural copy of SDK `MissionFeature`).
 *
 * Kept intentionally permissive (`string` / optional) so mapper never explodes
 * on schema-skew from a newer CLI build. Pass-through fields retained via
 * `extra?: Record<string, unknown>` for callers that want richer detail
 * without upgrading the mapper.
 */
export interface MappedMissionFeature {
  id: string;
  description?: string;
  status?: string;
  skillName?: string;
  preconditions?: string[];
  expectedBehavior?: string[];
  verificationSteps?: string[];
  fulfills?: string[];
  milestone?: string;
  workerSessionIds?: string[];
  currentWorkerSessionId?: string | null;
  completedWorkerSessionId?: string | null;
}

/**
 * Normalised shape of an entry extracted from `mission_progress_entry.progressLog`.
 * The SDK sends a discriminated array (see `ProgressLogEntryType`); we flatten
 * it into a single shape so UI consumers don't have to re-parse the union.
 */
export interface MappedMissionProgressEntry {
  /** Raw progress log entry `type` (e.g. `mission_run_started`, `worker_started`). */
  type?: string;
  /** RFC-3339 timestamp string emitted by the SDK. */
  timestamp?: string;
  /** Optional free-form text (mission run started message / worker-completed salient summary / etc.). */
  text?: string;
  /** Optional worker session id (worker_started / worker_selected_feature / worker_completed / worker_failed / worker_paused). */
  workerSessionId?: string;
  /** Optional feature id (worker_started / worker_selected_feature / worker_completed / ...). */
  featureId?: string;
  /** Optional severity / level-style hint (currently never set by SDK; reserved for future). */
  level?: string;
}

/**
 * `mapDroidNotification` 的 discriminated union 输出。
 * Discriminated-union payload returned by `mapDroidNotification`.
 */
export type NotificationMappedResult =
  | {
      kind: 'session_title';
      title: string;
    }
  | {
      kind: 'settings_updated';
      /**
       * 只包含 mapper 能提取出的字段，跟 SDK `UpdateSessionSettingsRequestParams` 一一对应。
       * Only contains the subset of fields that were actually present on the
       * inbound notification payload (plus the recognised enum-style fields).
       */
      changed: Partial<UpdateSessionSettingsRequestParams>;
    }
  | {
      kind: 'mcp_status';
      servers: MappedMcpServerStatus[];
      summary?: MappedMcpStatusSummary;
    }
  | {
      kind: 'mcp_auth_required';
      serverName: string;
      authUrl?: string;
      message?: string;
      state?: string;
    }
  // ── P2-1 mission / decomp notifications ────────────────────────────
  | {
      kind: 'mission_state';
      /**
       * Canonical `MissionState` string ("awaiting_input" | "initializing" |
       * "running" | "paused" | "orchestrator_turn" | "completed"). Kept as
       * plain `string` to remain tolerant to SDK-side additions.
       */
      state: string;
      /** Passthrough `missionId` if the SDK echoed it (not in the public schema, but the payload is `z.passthrough`). */
      missionId?: string;
    }
  | {
      kind: 'mission_features';
      features: MappedMissionFeature[];
      missionId?: string;
    }
  | {
      kind: 'mission_progress';
      /**
       * Normalised view of the latest progress entry for quick UI consumption.
       * Falls back to the last entry in `progressLog` when present; otherwise
       * a synthetic `{}` so consumers can still render a "progress ticked" cue.
       */
      entry: MappedMissionProgressEntry;
      /** Full progress log passthrough (may be truncated by SDK); useful for replay UIs. */
      progressLog: MappedMissionProgressEntry[];
      missionId?: string;
    }
  | {
      kind: 'mission_heartbeat';
      /** Epoch ms if the timestamp parsed; otherwise undefined. */
      at?: number;
      /** Raw ISO timestamp passthrough. */
      timestamp?: string;
      missionId?: string;
    }
  | {
      kind: 'mission_worker_started';
      workerSessionId?: string;
      featureId?: string;
      spawnId?: string;
      missionId?: string;
    }
  | {
      kind: 'mission_worker_completed';
      workerSessionId?: string;
      featureId?: string;
      /** Process / session exit code from the SDK payload (undefined if missing). */
      exitCode?: number;
      /** Optional success state passthrough (passthrough schema). */
      successState?: string;
      /** Free-form summary if the CLI ships one in the passthrough payload. */
      result?: string;
      missionId?: string;
    }
  | {
      /**
       * BYOK fix (2026-04-23): surface backend-pushed `error` notifications
       * through the UI pipeline instead of dropping them in `ignored`. Message
       * is already normalised (payment-required rewrite applied) so callers
       * can forward it verbatim to `onStreamEvent({ type: 'error', data })`.
       */
      kind: 'error';
      message: string;
      /** Optional SDK-supplied error code (HTTP status, provider error code, …). */
      code?: string;
    }
  | {
      kind: 'ignored';
      type: string;
    };

/**
 * 取 notification 里的 payload（`notification.params.notification` 或扁平结构）。
 * `onNotification` 的 raw callback 入参是整个 JSON-RPC notification，
 * payload 位于 `params.notification`；但防御性地兼容传入已脱壳的 payload。
 *
 * Returns the actual `SessionNotificationPayload` object, resolving:
 * 1. Full JSON-RPC envelope: `{ params: { notification: <payload> } }`
 * 2. Half-unwrapped (just `params`): `{ notification: <payload> }`
 * 3. Already-unwrapped payload: `{ type: '...', ... }`
 */
function extractPayload(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== 'object') return null;
  const obj = input as Record<string, unknown>;

  // Case 1: JSON-RPC envelope
  const params = obj.params;
  if (params && typeof params === 'object') {
    const nested = (params as Record<string, unknown>).notification;
    if (nested && typeof nested === 'object' && typeof (nested as Record<string, unknown>).type === 'string') {
      return nested as Record<string, unknown>;
    }
  }

  // Case 2: half-unwrapped (just `params` passed directly)
  const directNotification = obj.notification;
  if (
    directNotification &&
    typeof directNotification === 'object' &&
    typeof (directNotification as Record<string, unknown>).type === 'string'
  ) {
    return directNotification as Record<string, unknown>;
  }

  // Case 3: already-unwrapped payload
  if (typeof obj.type === 'string') {
    return obj;
  }

  return null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function mapSettingsUpdated(payload: Record<string, unknown>): NotificationMappedResult {
  const rawSettings = payload.settings;
  if (!rawSettings || typeof rawSettings !== 'object') {
    return { kind: 'settings_updated', changed: {} };
  }
  const settings = rawSettings as Record<string, unknown>;
  const changed: Partial<UpdateSessionSettingsRequestParams> = {};

  const modelId = asString(settings.modelId);
  if (modelId !== undefined) changed.modelId = modelId;
  // reasoningEffort / interactionMode / autonomyLevel / autonomyMode are enum
  // strings in the SDK schema; narrowing to the enum type here would require a
  // runtime import of the enum. Cast via the loose "settings" surface and let
  // the consumer compare against known string values.
  const reasoningEffort = asString(settings.reasoningEffort);
  if (reasoningEffort !== undefined) {
    changed.reasoningEffort = reasoningEffort as UpdateSessionSettingsRequestParams['reasoningEffort'];
  }
  const interactionMode = asString(settings.interactionMode);
  if (interactionMode !== undefined) {
    changed.interactionMode = interactionMode as UpdateSessionSettingsRequestParams['interactionMode'];
  }
  const autonomyLevel = asString(settings.autonomyLevel);
  if (autonomyLevel !== undefined) {
    changed.autonomyLevel = autonomyLevel as UpdateSessionSettingsRequestParams['autonomyLevel'];
  }
  const autonomyMode = asString(settings.autonomyMode);
  if (autonomyMode !== undefined) {
    changed.autonomyMode = autonomyMode as UpdateSessionSettingsRequestParams['autonomyMode'];
  }
  const specModeModelId = settings.specModeModelId;
  if (specModeModelId === null) {
    changed.specModeModelId = null;
  } else if (typeof specModeModelId === 'string') {
    changed.specModeModelId = specModeModelId;
  }
  const specModeReasoningEffort = settings.specModeReasoningEffort;
  if (specModeReasoningEffort === null) {
    changed.specModeReasoningEffort = null;
  } else if (typeof specModeReasoningEffort === 'string') {
    changed.specModeReasoningEffort =
      specModeReasoningEffort as UpdateSessionSettingsRequestParams['specModeReasoningEffort'];
  }

  return { kind: 'settings_updated', changed };
}

function mapMcpStatus(payload: Record<string, unknown>): NotificationMappedResult {
  const rawServers = Array.isArray(payload.servers) ? payload.servers : [];
  const servers: MappedMcpServerStatus[] = rawServers
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => {
      const server: MappedMcpServerStatus = {
        name: asString(item.name) ?? '',
        status: asString(item.status) ?? 'unknown',
      };
      const source = asString(item.source);
      if (source !== undefined) server.source = source;
      const error = asString(item.error);
      if (error !== undefined) server.error = error;
      const toolCount = asNumber(item.toolCount);
      if (toolCount !== undefined) server.toolCount = toolCount;
      const serverType = asString(item.serverType);
      if (serverType !== undefined) server.serverType = serverType;
      const hasAuthTokens = asBoolean(item.hasAuthTokens);
      if (hasAuthTokens !== undefined) server.hasAuthTokens = hasAuthTokens;
      const isManaged = asBoolean(item.isManaged);
      if (isManaged !== undefined) server.isManaged = isManaged;
      return server;
    });

  let summary: MappedMcpStatusSummary | undefined;
  const rawSummary = payload.summary;
  if (rawSummary && typeof rawSummary === 'object') {
    const summaryObj = rawSummary as Record<string, unknown>;
    summary = {
      total: asNumber(summaryObj.total) ?? servers.length,
      connected: asNumber(summaryObj.connected) ?? 0,
      connecting: asNumber(summaryObj.connecting) ?? 0,
      failed: asNumber(summaryObj.failed) ?? 0,
    };
    const disabled = asNumber(summaryObj.disabled);
    if (disabled !== undefined) summary.disabled = disabled;
  }

  return { kind: 'mcp_status', servers, summary };
}

function mapMcpAuthRequired(payload: Record<string, unknown>): NotificationMappedResult {
  return {
    kind: 'mcp_auth_required',
    serverName: asString(payload.serverName) ?? '',
    authUrl: asString(payload.authUrl),
    message: asString(payload.message),
    state: asString(payload.state),
  };
}

/**
 * Extract the optional, passthrough `missionId` field. The SDK schemas are
 * `z.passthrough()` so the CLI may echo missionId alongside the documented
 * fields even though the public TS types don't surface it. We opportunistically
 * pick it up for UI correlation (e.g. multiple mission tabs).
 */
function extractMissionId(payload: Record<string, unknown>): string | undefined {
  return asString(payload.missionId) ?? asString(payload.mission_id);
}

/** Safely map a mission feature entry. Unknown fields are dropped. */
function mapMissionFeature(raw: unknown): MappedMissionFeature | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const id = asString(item.id);
  if (!id) return null;
  const feature: MappedMissionFeature = { id };
  const description = asString(item.description);
  if (description !== undefined) feature.description = description;
  const status = asString(item.status);
  if (status !== undefined) feature.status = status;
  const skillName = asString(item.skillName);
  if (skillName !== undefined) feature.skillName = skillName;
  if (Array.isArray(item.preconditions)) {
    feature.preconditions = item.preconditions.filter((v): v is string => typeof v === 'string');
  }
  if (Array.isArray(item.expectedBehavior)) {
    feature.expectedBehavior = item.expectedBehavior.filter((v): v is string => typeof v === 'string');
  }
  if (Array.isArray(item.verificationSteps)) {
    feature.verificationSteps = item.verificationSteps.filter((v): v is string => typeof v === 'string');
  }
  if (Array.isArray(item.fulfills)) {
    feature.fulfills = item.fulfills.filter((v): v is string => typeof v === 'string');
  }
  const milestone = asString(item.milestone);
  if (milestone !== undefined) feature.milestone = milestone;
  if (Array.isArray(item.workerSessionIds)) {
    feature.workerSessionIds = item.workerSessionIds.filter((v): v is string => typeof v === 'string');
  }
  if (item.currentWorkerSessionId === null) {
    feature.currentWorkerSessionId = null;
  } else {
    const current = asString(item.currentWorkerSessionId);
    if (current !== undefined) feature.currentWorkerSessionId = current;
  }
  if (item.completedWorkerSessionId === null) {
    feature.completedWorkerSessionId = null;
  } else {
    const completed = asString(item.completedWorkerSessionId);
    if (completed !== undefined) feature.completedWorkerSessionId = completed;
  }
  return feature;
}

/**
 * Flatten a single `progressLog` entry into our normalised shape. Unknown
 * entry types still produce a `{ type }` entry so UI consumers can render a
 * generic "step happened" cue without having to special-case every SDK addition.
 */
function mapMissionProgressLogEntry(raw: unknown): MappedMissionProgressEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const entry: MappedMissionProgressEntry = {};
  const type = asString(item.type);
  if (type !== undefined) entry.type = type;
  const timestamp = asString(item.timestamp);
  if (timestamp !== undefined) entry.timestamp = timestamp;
  // Prefer an explicit `text` field, otherwise fall back to common variants
  // SDK entries use (mission_run_started → `message`; mission_accepted → `title`;
  // worker_completed handoff → `salientSummary`).
  const text =
    asString(item.text) ??
    asString(item.message) ??
    asString(item.title) ??
    asString((item.handoff as Record<string, unknown> | undefined)?.salientSummary);
  if (text !== undefined) entry.text = text;
  const workerSessionId = asString(item.workerSessionId);
  if (workerSessionId !== undefined) entry.workerSessionId = workerSessionId;
  const featureId = asString(item.featureId);
  if (featureId !== undefined) entry.featureId = featureId;
  const level = asString(item.level);
  if (level !== undefined) entry.level = level;
  return entry;
}

function mapMissionState(payload: Record<string, unknown>): NotificationMappedResult {
  const result: Extract<NotificationMappedResult, { kind: 'mission_state' }> = {
    kind: 'mission_state',
    state: asString(payload.state) ?? '',
  };
  const missionId = extractMissionId(payload);
  if (missionId !== undefined) result.missionId = missionId;
  return result;
}

function mapMissionFeatures(payload: Record<string, unknown>): NotificationMappedResult {
  const rawFeatures = Array.isArray(payload.features) ? payload.features : [];
  const features: MappedMissionFeature[] = [];
  for (const raw of rawFeatures) {
    const feature = mapMissionFeature(raw);
    if (feature) features.push(feature);
  }
  const result: Extract<NotificationMappedResult, { kind: 'mission_features' }> = {
    kind: 'mission_features',
    features,
  };
  const missionId = extractMissionId(payload);
  if (missionId !== undefined) result.missionId = missionId;
  return result;
}

function mapMissionProgress(payload: Record<string, unknown>): NotificationMappedResult {
  const rawLog = Array.isArray(payload.progressLog) ? payload.progressLog : [];
  const progressLog: MappedMissionProgressEntry[] = [];
  for (const raw of rawLog) {
    const mapped = mapMissionProgressLogEntry(raw);
    if (mapped) progressLog.push(mapped);
  }
  const entry = progressLog.length > 0 ? progressLog[progressLog.length - 1] : ({} as MappedMissionProgressEntry);
  const result: Extract<NotificationMappedResult, { kind: 'mission_progress' }> = {
    kind: 'mission_progress',
    entry,
    progressLog,
  };
  const missionId = extractMissionId(payload);
  if (missionId !== undefined) result.missionId = missionId;
  return result;
}

function mapMissionHeartbeat(payload: Record<string, unknown>): NotificationMappedResult {
  const result: Extract<NotificationMappedResult, { kind: 'mission_heartbeat' }> = { kind: 'mission_heartbeat' };
  const timestamp = asString(payload.timestamp);
  if (timestamp !== undefined) {
    result.timestamp = timestamp;
    const parsed = Date.parse(timestamp);
    if (Number.isFinite(parsed)) result.at = parsed;
  }
  const missionId = extractMissionId(payload);
  if (missionId !== undefined) result.missionId = missionId;
  return result;
}

function mapMissionWorkerStarted(payload: Record<string, unknown>): NotificationMappedResult {
  const result: Extract<NotificationMappedResult, { kind: 'mission_worker_started' }> = {
    kind: 'mission_worker_started',
  };
  const workerSessionId = asString(payload.workerSessionId);
  if (workerSessionId !== undefined) result.workerSessionId = workerSessionId;
  const featureId = asString(payload.featureId);
  if (featureId !== undefined) result.featureId = featureId;
  const spawnId = asString(payload.spawnId);
  if (spawnId !== undefined) result.spawnId = spawnId;
  const missionId = extractMissionId(payload);
  if (missionId !== undefined) result.missionId = missionId;
  return result;
}

/**
 * Map the SDK's server-pushed `error` notification into a renderer-friendly
 * shape. Accepts a handful of payload field names (`message`, `error`,
 * `detail`, nested `error.message`) because different CLI builds have
 * historically used different keys for the human-readable text.
 */
function mapErrorNotification(payload: Record<string, unknown>): NotificationMappedResult {
  const nestedError =
    payload.error && typeof payload.error === 'object' ? (payload.error as Record<string, unknown>) : undefined;
  const rawMessage =
    asString(payload.message) ??
    asString(payload.error) ??
    asString(payload.detail) ??
    asString(nestedError?.message) ??
    asString(nestedError?.detail) ??
    '';
  const code =
    asString(payload.code) ?? asString(payload.status) ?? asString(nestedError?.code) ?? asString(nestedError?.status);
  const result: Extract<NotificationMappedResult, { kind: 'error' }> = {
    kind: 'error',
    message: normalizeBackendErrorMessage(rawMessage),
  };
  if (code !== undefined) result.code = code;
  return result;
}

function mapMissionWorkerCompleted(payload: Record<string, unknown>): NotificationMappedResult {
  const result: Extract<NotificationMappedResult, { kind: 'mission_worker_completed' }> = {
    kind: 'mission_worker_completed',
  };
  const workerSessionId = asString(payload.workerSessionId);
  if (workerSessionId !== undefined) result.workerSessionId = workerSessionId;
  const featureId = asString(payload.featureId);
  if (featureId !== undefined) result.featureId = featureId;
  const exitCode = asNumber(payload.exitCode);
  if (exitCode !== undefined) result.exitCode = exitCode;
  const successState = asString(payload.successState);
  if (successState !== undefined) result.successState = successState;
  // `result` is the structured summary the CLI may attach in passthrough mode;
  // fall back to handoff.salientSummary if present.
  const resultText =
    asString(payload.result) ?? asString((payload.handoff as Record<string, unknown> | undefined)?.salientSummary);
  if (resultText !== undefined) result.result = resultText;
  const missionId = extractMissionId(payload);
  if (missionId !== undefined) result.missionId = missionId;
  return result;
}

/**
 * Convert an inbound `session.onNotification` payload into a discriminated
 * `NotificationMappedResult`. Safe for any shape; unknown / malformed inputs
 * produce `{ kind: 'ignored' }` instead of throwing.
 */
export function mapDroidNotification(notification: unknown): NotificationMappedResult {
  const payload = extractPayload(notification);
  if (!payload) {
    return { kind: 'ignored', type: '<unknown>' };
  }
  const type = asString(payload.type) ?? '<unknown>';
  switch (type) {
    case DroidNotificationTypeLiteral.SessionTitleUpdated: {
      const title = asString(payload.title) ?? '';
      return { kind: 'session_title', title };
    }
    case DroidNotificationTypeLiteral.SettingsUpdated:
      return mapSettingsUpdated(payload);
    case DroidNotificationTypeLiteral.McpStatusChanged:
      return mapMcpStatus(payload);
    case DroidNotificationTypeLiteral.McpAuthRequired:
      return mapMcpAuthRequired(payload);
    // ── P2-1 mission / decomp notifications ────────────────────────
    case DroidNotificationTypeLiteral.MissionStateChanged:
      return mapMissionState(payload);
    case DroidNotificationTypeLiteral.MissionFeaturesChanged:
      return mapMissionFeatures(payload);
    case DroidNotificationTypeLiteral.MissionProgressEntry:
      return mapMissionProgress(payload);
    case DroidNotificationTypeLiteral.MissionHeartbeat:
      return mapMissionHeartbeat(payload);
    case DroidNotificationTypeLiteral.MissionWorkerStarted:
      return mapMissionWorkerStarted(payload);
    case DroidNotificationTypeLiteral.MissionWorkerCompleted:
      return mapMissionWorkerCompleted(payload);
    case DroidNotificationTypeLiteral.Error:
      return mapErrorNotification(payload);
    default:
      return { kind: 'ignored', type };
  }
}
