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
  type DroidSession,
  type CreateSessionOptions,
} from '@factory/droid-sdk';
import type { IResponseMessage } from '@/common/adapter/ipcBridge';
import type { AcpModelInfo, AcpPermissionRequest, AcpResult, AcpSessionConfigOption } from '@/common/types/acpTypes';
import { AcpErrorType, createAcpError } from '@/common/types/acpTypes';
import { uuid } from '@/common/utils';
import {
  buildFactoryReasoningConfigOption,
  FACTORY_DEFAULT_MODEL_ID,
  FACTORY_REASONING_CONFIG_ID,
  getFactoryDroidModelInfo,
  resolveFactoryReasoning,
  type ReasoningLevel,
} from '@/common/config/factoryModels';
import { DroidMessageMapper } from './messageMapper';
import { mainLog, mainWarn } from '@process/utils/mainLogger';
import { getEnhancedEnv } from '@process/utils/shellEnv';

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
  onAskUserRequest?: (data: { callId: string; questions: AskUserQuestion[] }) => void;
};

const ASK_USER_TOOL_FORMAT_REMINDER =
  `<system-reminder>\n` +
  `When using the AskUser tool, the questionnaire must use the exact numbered format:\n` +
  `1. [question] Your question text\n` +
  `[topic] Short topic label\n` +
  `[option] First option\n` +
  `Use 1-4 numbered questions and never omit the leading number.\n` +
  `</system-reminder>\n\n`;

export class DroidSdkAgent {
  private config: DroidSdkAgentConfig;
  private session: DroidSession | null = null;
  private mapper: DroidMessageMapper;
  private currentModelId: string;
  private currentReasoningEffort: ReasoningLevel;
  private hasConfiguredReasoningEffort: boolean;
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

  constructor(config: DroidSdkAgentConfig) {
    this.config = config;
    this.mapper = new DroidMessageMapper(config.id);
    this.currentModelId = config.modelId || FACTORY_DEFAULT_MODEL_ID;
    const configuredReasoning = this.getConfiguredReasoningEffort();
    this.hasConfiguredReasoningEffort = configuredReasoning !== undefined;
    this.currentReasoningEffort = resolveFactoryReasoning(this.currentModelId, configuredReasoning);
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────

  async start(): Promise<void> {
    try {
      const env = getEnhancedEnv();
      const execPath = this.config.cliPath || 'droid';

      const sessionOptions: CreateSessionOptions = {
        cwd: this.config.workingDir,
        execPath,
        modelId: this.currentModelId,
        reasoningEffort: this.currentReasoningEffort as ReasoningEffort,
        env,
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
        if (this.hasConfiguredReasoningEffort) {
          await this.session.updateSettings({
            reasoningEffort: this.currentReasoningEffort as ReasoningEffort,
          });
        }
      } else {
        this.session = await createSession(sessionOptions);
        mainLog('[DroidSdkAgent]', `Created session: ${this.session.sessionId}`);
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

  async kill(): Promise<void> {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
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

  // ── Messaging ───────────────────────────────────────────────────────

  async sendMessage(data: { content: string; files?: string[]; msg_id?: string }): Promise<AcpResult> {
    if (!this.session) {
      return {
        success: false,
        error: createAcpError(AcpErrorType.CONNECTION_NOT_READY, 'Session not initialized', true),
      };
    }

    try {
      // Emit start event
      this.config.onStreamEvent({
        type: 'start',
        conversation_id: this.config.id,
        msg_id: data.msg_id || uuid(),
        data: null,
      });

      this.mapper.resetForNewTurn();

      let content = data.content;

      // Prepend file references
      if (data.files && data.files.length > 0) {
        const fileRefs = data.files.map((f) => (f.includes(' ') ? `@"${f}"` : `@${f}`)).join(' ');
        content = fileRefs + ' ' + content;
      }

      content = ASK_USER_TOOL_FORMAT_REMINDER + content;

      // Inject model switch notice
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

      // Stream the response
      this.abortController = new AbortController();
      for await (const msg of this.session.stream(content)) {
        if (this.abortController?.signal.aborted) break;

        const uiEvents = this.mapper.mapMessage(msg);
        for (const event of uiEvents) {
          this.config.onStreamEvent(event);
        }
      }

      return { success: true, data: null };
    } catch (error) {
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
  }

  cancelPrompt(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
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
    const callId =
      (typeof toolUse?.id === 'string' ? toolUse.id : undefined) || (params.toolUseId as string | undefined) || uuid();
    const title =
      (typeof toolUse?.name === 'string' ? toolUse.name : undefined) ||
      (typeof params.title === 'string' ? params.title : undefined) ||
      'Permission Request';

    if (confirmationType === 'ask_user') {
      mainLog('[DroidSdkAgent]', 'AskUser tool permission requested', {
        callId,
        hasParsedQuestions: Array.isArray(parsed?.questions),
        parseError: parseErrorMessage,
      });
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
          ...(questionnaire ? { description: questionnaire, questionnaire } : {}),
          ...(parsed ? { parsed } : {}),
          ...(parseError ? { parseError } : {}),
          ...(parseErrorMessage ? { description: `AskUser parse error: ${parseErrorMessage}` } : {}),
        },
      },
      options: [
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
    const questions = Array.isArray(params.questions) ? (params.questions as AskUserQuestion[]) : [];

    mainLog('[DroidSdkAgent]', 'AskUser requested', {
      callId,
      questionCount: questions.length,
    });

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

  answerAskUser(data: { callId: string; result: Record<string, unknown> }): Promise<AcpResult> {
    const pending = this.pendingAskUserRequests.get(data.callId);
    if (pending) {
      this.pendingAskUserRequests.delete(data.callId);
      mainLog('[DroidSdkAgent]', 'AskUser answered', {
        callId: data.callId,
        result: data.result,
      });
      pending.resolve(data.result);
      return Promise.resolve({ success: true, data: null });
    }
    return Promise.resolve({
      success: false,
      error: createAcpError(AcpErrorType.UNKNOWN, `AskUser request not found for callId: ${data.callId}`, false),
    });
  }

  // ── Model management ────────────────────────────────────────────────

  getModelInfo(): AcpModelInfo | null {
    const factoryInfo = getFactoryDroidModelInfo(this.currentModelId) as AcpModelInfo;
    const match = factoryInfo.availableModels.find((m) => m.id === this.currentModelId);
    return {
      ...factoryInfo,
      currentModelId: this.currentModelId,
      currentModelLabel: match?.label || this.currentModelId,
    };
  }

  async setModelByConfigOption(modelId: string): Promise<AcpModelInfo | null> {
    if (!this.session) {
      throw new Error('No active session');
    }

    const reasoningEffort = resolveFactoryReasoning(modelId, this.currentReasoningEffort);
    await this.session.updateSettings({
      modelId,
      reasoningEffort: reasoningEffort as ReasoningEffort,
    });
    this.currentModelId = modelId;
    this.currentReasoningEffort = reasoningEffort;
    this.hasConfiguredReasoningEffort = true;
    this.userModelOverride = modelId;
    this.pendingModelSwitchNotice = modelId;

    mainLog('[DroidSdkAgent]', `Model switched to: ${modelId}`);
    return this.getModelInfo();
  }

  // ── Config options (stub for AcpAgentManager compatibility) ─────────

  getConfigOptions(): AcpSessionConfigOption[] {
    return [buildFactoryReasoningConfigOption(this.currentModelId, this.currentReasoningEffort)];
  }

  async setConfigOption(configId: string, value: string): Promise<AcpSessionConfigOption[]> {
    if (configId !== FACTORY_REASONING_CONFIG_ID || !this.session) {
      return this.getConfigOptions();
    }

    const reasoningEffort = resolveFactoryReasoning(this.currentModelId, value);
    await this.session.updateSettings({
      reasoningEffort: reasoningEffort as ReasoningEffort,
    });
    this.currentReasoningEffort = reasoningEffort;
    this.hasConfiguredReasoningEffort = true;
    return this.getConfigOptions();
  }

  // ── Mode management ─────────────────────────────────────────────────

  async setMode(mode: string): Promise<{ success: boolean; error?: string }> {
    if (!this.session) {
      return { success: true };
    }

    try {
      // Map AionUI modes to SDK autonomy levels
      const modeToAutonomy: Record<string, AutonomyLevel> = {
        bypassPermissions: AutonomyLevel.High,
        yolo: AutonomyLevel.High,
        auto: AutonomyLevel.Medium,
        acceptEdits: AutonomyLevel.Low,
        default: AutonomyLevel.Off,
      };

      const autonomyLevel = modeToAutonomy[mode] || AutonomyLevel.Off;
      await this.session.updateSettings({ autonomyLevel });
      return { success: true };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return { success: false, error: errMsg };
    }
  }

  async enableYoloMode(): Promise<void> {
    await this.setMode('yolo');
  }

  // ── Internal helpers ────────────────────────────────────────────────

  private getConfiguredReasoningEffort(): string | undefined {
    return (
      this.config.pendingConfigOptions?.[FACTORY_REASONING_CONFIG_ID] ||
      this.config.cachedConfigOptions?.find((option) => option.id === FACTORY_REASONING_CONFIG_ID)?.currentValue ||
      this.config.cachedConfigOptions?.find((option) => option.id === FACTORY_REASONING_CONFIG_ID)?.selectedValue
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
}
