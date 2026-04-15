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

import type { AskUserQuestion, ReasoningEffort } from '@factory/droid-sdk';
import {
  createSession,
  resumeSession,
  ToolConfirmationOutcome,
  AutonomyLevel,
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
import { DroidMessageMapper } from './messageMapper';
import { mainLog, mainWarn } from '@process/utils/mainLogger';
import { getEnhancedEnv } from '@process/utils/shellEnv';
import { resolveWorkingDroidCli } from './cliRuntime';
import { loadDroidRuntimeConfigForSource, getDroidRuntimeScopeKey, isDroidChannelPlatform } from './runtime/config';
import { DroidPermissionPolicy } from './runtime/DroidPermissionPolicy';
import { DroidTextAskBridge, type DroidAskUserAnswerPayload } from './runtime/DroidTextAskBridge';
import type { DroidRuntimeScheduler, DroidRuntimeTurnController } from './runtime/DroidRuntimeScheduler';
import { getDroidRuntimeScheduler } from './runtime/DroidRuntimeScheduler';

type DroidSessionSettings = Parameters<DroidSession['updateSettings']>[0];

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

  constructor(config: DroidSdkAgentConfig) {
    this.config = config;
    this.mapper = new DroidMessageMapper(config.id);
    this.currentModelId = getFactoryModelById(config.modelId || '')?.id || getFactoryDefaultModelId();
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
      if (!cliRuntime.version) {
        throw new Error(cliRuntime.error || 'Droid CLI is unavailable');
      }

      const execPath = cliRuntime.execPath;
      const modeSettings = this.getSessionSettingsForMode(this.currentSessionMode);

      const sessionOptions: CreateSessionOptions = {
        cwd: this.config.workingDir,
        execPath,
        modelId: this.currentModelId,
        reasoningEffort: this.currentReasoningEffort as ReasoningEffort,
        env,
        ...modeSettings,
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
          ...modeSettings,
          ...(this.hasConfiguredReasoningEffort
            ? { reasoningEffort: this.currentReasoningEffort as ReasoningEffort }
            : {}),
          ...this.buildUpdateSessionSpecModeSettings(),
        });
      } else {
        this.session = await createSession(sessionOptions);
        mainLog('[DroidSdkAgent]', `Created session: ${this.session.sessionId}`);
        const specModeSettings = this.buildUpdateSessionSpecModeSettings();
        if (Object.keys(specModeSettings).length > 0) {
          await this.session.updateSettings(specModeSettings);
        }
      }

      this._isConnected = true;
      this.config.onSessionIdUpdate?.(this.session.sessionId);
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
    if (this.session) {
      try {
        await this.session.close();
      } catch {
        // Best-effort cleanup
      }
      this.session = null;
    }
    this._isConnected = false;
  }

  // ── Messaging ───────────────────────────────────────────────────────

  async sendMessage(data: { content: string; files?: string[]; msg_id?: string }): Promise<AcpResult> {
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

      let content = data.content;

      if (data.files && data.files.length > 0) {
        const fileRefs = data.files.map((f) => (f.includes(' ') ? `@"${f}"` : `@${f}`)).join(' ');
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
      for await (const msg of this.session.stream(content)) {
        if (this.abortController?.signal.aborted) {
          break;
        }

        const uiEvents = this.mapper.mapMessage(msg);
        for (const event of uiEvents) {
          this.config.onStreamEvent(event);
        }
      }

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
      await this.session.updateSettings(modeSettings);
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

  private emitError(message: string): void {
    this.config.onStreamEvent({
      type: 'error',
      conversation_id: this.config.id,
      msg_id: `error_${uuid()}`,
      data: message,
    });
  }

  private getSessionSettingsForMode(
    mode: string | undefined
  ): Pick<CreateSessionOptions, 'interactionMode' | 'autonomyLevel'> {
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
      case 'yolo':
        return {
          interactionMode: DroidInteractionMode.Auto,
          autonomyLevel: AutonomyLevel.High,
        };
      case 'default':
      default:
        return {
          interactionMode: DroidInteractionMode.Auto,
          autonomyLevel: AutonomyLevel.Off,
        };
    }
  }
}
