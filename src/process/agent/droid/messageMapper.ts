/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Maps Factory Droid SDK DroidMessage events to AionUI IResponseMessage stream events.
 *
 * The SDK emits typed DroidMessage events (assistant_text_delta, tool_use, etc.).
 * This module converts them into IResponseMessage objects that the existing
 * UI rendering pipeline understands.
 */

import type { IResponseMessage } from '@/common/adapter/ipcBridge';
import { uuid } from '@/common/utils';
import type {
  DroidMessage,
  AssistantTextDelta,
  ThinkingTextDelta,
  ToolUse,
  ToolResult,
  ToolProgress,
  WorkingStateChanged,
  TokenUsageUpdate,
  ErrorEvent,
  TurnComplete,
} from '@factory/droid-sdk';
import type { ToolCallUpdate } from '@/common/types/acpTypes';

export class DroidMessageMapper {
  private conversationId: string;
  private currentMsgId: string;
  private activeToolCalls = new Map<string, ToolCallUpdate>();

  constructor(conversationId: string) {
    this.conversationId = conversationId;
    this.currentMsgId = uuid();
  }

  resetForNewTurn(): void {
    this.currentMsgId = uuid();
    this.activeToolCalls.clear();
  }

  /**
   * Convert a DroidMessage into zero or more IResponseMessage events for the UI.
   * Returns null for messages that don't need UI rendering.
   */
  mapMessage(msg: DroidMessage): IResponseMessage[] {
    switch (msg.type) {
      case 'assistant_text_delta':
        return this.mapTextDelta(msg);
      case 'thinking_text_delta':
        return this.mapThinkingDelta(msg);
      case 'tool_use':
        return this.mapToolUse(msg);
      case 'tool_result':
        return this.mapToolResult(msg);
      case 'tool_progress':
        return this.mapToolProgress(msg);
      case 'working_state_changed':
        return this.mapWorkingState(msg);
      case 'token_usage_update':
        return this.mapTokenUsage(msg);
      case 'error':
        return this.mapError(msg);
      case 'turn_complete':
        return this.mapTurnComplete(msg);
      default:
        return [];
    }
  }

  private mapTextDelta(msg: AssistantTextDelta): IResponseMessage[] {
    // Emit as 'content' type — same as ACP agent_message_chunk — so the shared
    // handleStreamEvent pipeline correctly transforms and persists it.
    return [
      {
        type: 'content',
        conversation_id: this.conversationId,
        msg_id: this.currentMsgId,
        data: msg.text,
      },
    ];
  }

  private mapThinkingDelta(msg: ThinkingTextDelta): IResponseMessage[] {
    // Reset current msg ID so content after thinking gets a separate message
    this.currentMsgId = uuid();

    // Emit as 'thought' type for handleStreamEvent to process via emitThinkingMessage
    return [
      {
        type: 'thought',
        conversation_id: this.conversationId,
        msg_id: `thinking_${uuid()}`,
        data: { description: msg.text },
      },
    ];
  }

  private mapToolUse(msg: ToolUse): IResponseMessage[] {
    const toolCallId = msg.toolUseId || uuid();
    const toolCallData: ToolCallUpdate = {
      sessionId: '',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId,
        status: 'in_progress',
        title: msg.toolName || 'unknown',
        kind: 'execute',
        rawInput: msg.toolInput,
      },
    };
    this.activeToolCalls.set(toolCallId, toolCallData);
    this.currentMsgId = uuid();

    return [
      {
        type: 'acp_tool_call',
        conversation_id: this.conversationId,
        msg_id: toolCallId,
        data: toolCallData,
      },
    ];
  }

  private mapToolResult(msg: ToolResult): IResponseMessage[] {
    const toolCallId = msg.toolUseId || '';
    const existing = this.activeToolCalls.get(toolCallId);
    if (existing) {
      const outputText = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      existing.update = {
        ...existing.update,
        sessionUpdate: 'tool_call_update' as 'tool_call',
        status: msg.isError ? 'failed' : 'completed',
        content: [{ type: 'content', content: { type: 'text', text: outputText } }],
      };
      return [
        {
          type: 'acp_tool_call',
          conversation_id: this.conversationId,
          msg_id: toolCallId,
          data: existing,
        },
      ];
    }
    return [];
  }

  private mapToolProgress(msg: ToolProgress): IResponseMessage[] {
    const toolCallId = msg.toolUseId || '';
    const existing = this.activeToolCalls.get(toolCallId);
    if (existing && msg.content) {
      existing.update = {
        ...existing.update,
        content: [{ type: 'content', content: { type: 'text', text: msg.content } }],
      };
      return [
        {
          type: 'acp_tool_call',
          conversation_id: this.conversationId,
          msg_id: toolCallId,
          data: existing,
        },
      ];
    }
    return [];
  }

  private mapWorkingState(_msg: WorkingStateChanged): IResponseMessage[] {
    // SDK working states (idle, streaming_assistant_message, executing_tool, etc.)
    // are internal to the droid process. Don't emit as agent_status — the frontend
    // only understands connecting/connected/error statuses.
    return [];
  }

  private mapTokenUsage(msg: TokenUsageUpdate): IResponseMessage[] {
    return [
      {
        type: 'usage',
        conversation_id: this.conversationId,
        msg_id: `usage_${uuid()}`,
        data: {
          inputTokens: msg.inputTokens ?? 0,
          outputTokens: msg.outputTokens ?? 0,
          cacheReadTokens: msg.cacheReadTokens ?? 0,
          cacheWriteTokens: msg.cacheWriteTokens ?? 0,
        },
      },
    ];
  }

  private mapError(msg: ErrorEvent): IResponseMessage[] {
    let errorText = msg.message || 'Unknown error';

    // Detect 402 Payment Required (token/credit exhaustion)
    if (errorText.includes('402') || errorText.includes('Payment Required')) {
      errorText = 'Factory 算力额度不足，请前往 https://app.factory.ai/settings/usage 充值后继续使用。';
    }

    return [
      {
        type: 'error',
        conversation_id: this.conversationId,
        msg_id: `error_${uuid()}`,
        data: errorText,
      },
    ];
  }

  private mapTurnComplete(_msg: TurnComplete): IResponseMessage[] {
    return [
      {
        type: 'end',
        conversation_id: this.conversationId,
        msg_id: `end_${uuid()}`,
        data: null,
      },
    ];
  }
}
