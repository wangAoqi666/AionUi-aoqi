/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  IMessageAcpToolCall,
  IMessageText,
  IMessageThinking,
  IMessageToolGroup,
  TMessage,
} from '@/common/chat/chatLib';
import { parseDiff, type FileChangeInfo } from './codex/MessageFileChanges';
import type { WriteFileResult } from './types';
import { uuid } from '@renderer/utils/common';

type TurnDiffContent = Extract<Extract<TMessage, { type: 'codex_tool_call' }>['content'], { subtype: 'turn_diff' }>;

export type FileSummaryItem = {
  type: 'file_summary';
  id: string;
  diffs: FileChangeInfo[];
  sourceMessageIds: string[];
};

export type ToolSummaryItem = {
  type: 'tool_summary';
  id: string;
  messages: Array<IMessageToolGroup | IMessageAcpToolCall>;
  sourceMessageIds: string[];
};

export type AssistantActivityItem = IMessageThinking | ToolSummaryItem;

export type AssistantTurnItem = {
  type: 'assistant_turn';
  id: string;
  message: IMessageText;
  activities: AssistantActivityItem[];
  sourceMessageIds: string[];
};

export type ActivityGroupItem = {
  type: 'activity_group';
  id: string;
  activities: AssistantActivityItem[];
  sourceMessageIds: string[];
};

type BaseProcessedItem = TMessage | FileSummaryItem | ToolSummaryItem;

export type ProcessedMessageItem = BaseProcessedItem | AssistantTurnItem | ActivityGroupItem;

const isActivityItem = (item: BaseProcessedItem): item is AssistantActivityItem =>
  item.type === 'thinking' || item.type === 'tool_summary';

const isAssistantTextMessage = (item: BaseProcessedItem): item is IMessageText =>
  item.type === 'text' && item.position === 'left' && item.content.teammateMessage !== true;

const uniqueIds = (sourceMessageIds: string[]): string[] => [...new Set(sourceMessageIds.filter(Boolean))];

const buildBaseProcessedList = (list: TMessage[]): BaseProcessedItem[] => {
  const result: BaseProcessedItem[] = [];
  let diffsChanges: FileChangeInfo[] = [];
  let diffsSourceMessageIds: string[] = [];
  let toolList: Array<IMessageToolGroup | IMessageAcpToolCall> = [];
  let toolSourceMessageIds: string[] = [];

  const pushFileDiffChanges = (changes: FileChangeInfo, sourceMessageId: string) => {
    if (!diffsChanges.length) {
      diffsSourceMessageIds = [];
      result.push({
        type: 'file_summary',
        id: `summary-${sourceMessageId}`,
        diffs: diffsChanges,
        sourceMessageIds: diffsSourceMessageIds,
      });
    }
    diffsChanges.push(changes);
    diffsSourceMessageIds.push(sourceMessageId);
    toolList = [];
    toolSourceMessageIds = [];
  };

  const pushToolList = (message: IMessageToolGroup | IMessageAcpToolCall) => {
    if (!toolList.length) {
      toolSourceMessageIds = [];
      result.push({
        type: 'tool_summary',
        id: `tool-summary-${message.id}`,
        messages: toolList,
        sourceMessageIds: toolSourceMessageIds,
      });
    }
    toolList.push(message);
    toolSourceMessageIds.push(message.id);
    diffsChanges = [];
    diffsSourceMessageIds = [];
  };

  for (let i = 0, len = list.length; i < len; i++) {
    const message = list[i];
    if (message.hidden || message.type === 'available_commands') continue;

    if (message.type === 'codex_tool_call' && message.content.subtype === 'turn_diff') {
      pushFileDiffChanges(parseDiff((message.content as TurnDiffContent).data.unified_diff), message.id);
      continue;
    }

    if (message.type === 'tool_group') {
      if (message.content.length === 1) {
        const writeFileResults = message.content
          .filter(
            (item) =>
              item.name === 'WriteFile' &&
              item.resultDisplay &&
              typeof item.resultDisplay === 'object' &&
              'fileDiff' in item.resultDisplay
          )
          .map((item) => item.resultDisplay as WriteFileResult);
        if (writeFileResults.length && writeFileResults[0].fileDiff) {
          pushFileDiffChanges(parseDiff(writeFileResults[0].fileDiff, writeFileResults[0].fileName), message.id);
          continue;
        }
      }
      pushToolList(message);
      continue;
    }

    if (message.type === 'acp_tool_call') {
      pushToolList(message);
      continue;
    }

    toolList = [];
    toolSourceMessageIds = [];
    diffsChanges = [];
    diffsSourceMessageIds = [];
    result.push(message);
  }

  return result;
};

export const buildProcessedMessageList = (list: TMessage[]): ProcessedMessageItem[] => {
  const baseList = buildBaseProcessedList(list);
  const result: ProcessedMessageItem[] = [];
  let pendingActivities: AssistantActivityItem[] = [];
  let pendingSourceMessageIds: string[] = [];

  const flushPendingActivities = () => {
    if (!pendingActivities.length) return;
    result.push({
      type: 'activity_group',
      id: `activity-${pendingSourceMessageIds[0] || uuid()}`,
      activities: pendingActivities,
      sourceMessageIds: uniqueIds(pendingSourceMessageIds),
    });
    pendingActivities = [];
    pendingSourceMessageIds = [];
  };

  for (const item of baseList) {
    if (isActivityItem(item)) {
      pendingActivities.push(item);
      pendingSourceMessageIds.push(...getProcessedItemSourceMessageIds(item));
      continue;
    }

    if (isAssistantTextMessage(item) && pendingActivities.length > 0) {
      result.push({
        type: 'assistant_turn',
        id: `assistant-turn-${pendingSourceMessageIds[0] || item.id}`,
        message: item,
        activities: pendingActivities,
        sourceMessageIds: uniqueIds([...pendingSourceMessageIds, item.id]),
      });
      pendingActivities = [];
      pendingSourceMessageIds = [];
      continue;
    }

    flushPendingActivities();
    result.push(item);
  }

  flushPendingActivities();

  return result;
};

export const getProcessedItemSourceMessageIds = (item: ProcessedMessageItem): string[] => {
  if ('type' in item) {
    if (
      item.type === 'tool_summary' ||
      item.type === 'file_summary' ||
      item.type === 'assistant_turn' ||
      item.type === 'activity_group'
    ) {
      return item.sourceMessageIds;
    }
  }
  return 'id' in item ? [item.id] : [];
};

export const getProcessedItemMsgIds = (item: ProcessedMessageItem): string[] => {
  const collectIds = (ids: Array<string | undefined>): string[] =>
    uniqueIds(ids.filter((value): value is string => Boolean(value)));

  if ('type' in item) {
    if (item.type === 'tool_summary') {
      return collectIds(item.messages.map((message) => message.msg_id));
    }
    if (item.type === 'assistant_turn') {
      return collectIds([
        item.message.msg_id,
        ...item.activities.flatMap((activity) =>
          activity.type === 'thinking' ? [activity.msg_id] : activity.messages.map((message) => message.msg_id)
        ),
      ]);
    }
    if (item.type === 'activity_group') {
      return collectIds(
        item.activities.flatMap((activity) =>
          activity.type === 'thinking' ? [activity.msg_id] : activity.messages.map((message) => message.msg_id)
        )
      );
    }
    if (item.type === 'file_summary') {
      return [];
    }
  }

  return 'msg_id' in item && item.msg_id ? [item.msg_id] : [];
};

export const matchesTargetMessage = (item: ProcessedMessageItem, targetMessageId?: string): boolean => {
  if (!targetMessageId) {
    return false;
  }
  return getProcessedItemSourceMessageIds(item).includes(targetMessageId);
};

export const matchesTargetMsgId = (item: ProcessedMessageItem, targetMsgId?: string): boolean => {
  if (!targetMsgId) {
    return false;
  }
  return getProcessedItemMsgIds(item).includes(targetMsgId);
};

export const getProcessedItemAnchorId = (item: ProcessedMessageItem): string => {
  const sourceIds = getProcessedItemSourceMessageIds(item);
  return sourceIds[0] || ('id' in item ? item.id : uuid());
};
