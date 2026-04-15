/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  IMessageAcpToolCall,
  IMessagePlan,
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

export type AssistantActivityItem = IMessageThinking | ToolSummaryItem | FileSummaryItem;

export type AssistantTurnItem = {
  type: 'assistant_turn';
  id: string;
  message: IMessageText;
  messageMsgIds: string[];
  activities: AssistantActivityItem[];
  sourceMessageIds: string[];
};

export type ActivityGroupItem = {
  type: 'activity_group';
  id: string;
  activities: AssistantActivityItem[];
  sourceMessageIds: string[];
};

export type TaskBoardEntry = IMessagePlan['content']['entries'][number];

export type ActiveTaskBoard = {
  entries: TaskBoardEntry[];
  source: 'plan' | 'todo_write';
  sourceMessageId: string;
  completedCount: number;
  totalCount: number;
};

type BaseProcessedItem = TMessage | FileSummaryItem | ToolSummaryItem;

export type ProcessedMessageItem = BaseProcessedItem | AssistantTurnItem | ActivityGroupItem;

const TODO_WRITE_ENTRY_PATTERN = /^\s*(?:(?:\d+\.|[-*])\s*)?\[(pending|in_progress|completed)\]\s+(.+?)\s*$/;

const isActivityItem = (item: BaseProcessedItem): item is AssistantActivityItem =>
  item.type === 'thinking' || item.type === 'tool_summary' || item.type === 'file_summary';

const isAssistantTextMessage = (item: BaseProcessedItem): item is IMessageText =>
  item.type === 'text' && item.position === 'left' && item.content.teammateMessage !== true;

const uniqueIds = (sourceMessageIds: string[]): string[] => [...new Set(sourceMessageIds.filter(Boolean))];

const appendAssistantTextContent = (current: string, next: string): string => {
  const previousContent = current;
  const nextContent = next;

  if (!previousContent) {
    return nextContent;
  }

  if (!nextContent) {
    return previousContent;
  }

  if (previousContent.endsWith('\n') || nextContent.startsWith('\n')) {
    return `${previousContent}${nextContent}`;
  }

  return `${previousContent}\n\n${nextContent}`;
};

const mergeAssistantTextMessages = (messages: IMessageText[]): { message: IMessageText; messageMsgIds: string[] } => {
  const [firstMessage, ...restMessages] = messages;

  if (!firstMessage) {
    throw new Error('Expected at least one assistant text message');
  }

  const mergedContent = restMessages.reduce(
    (combined, current) => appendAssistantTextContent(combined, current.content.content),
    firstMessage.content.content
  );
  const lastMessage = restMessages.at(-1) ?? firstMessage;

  return {
    message: {
      ...firstMessage,
      createdAt: lastMessage.createdAt ?? firstMessage.createdAt,
      content: {
        ...firstMessage.content,
        content: mergedContent,
      },
    },
    messageMsgIds: uniqueIds(messages.map((message) => message.msg_id || '')),
  };
};

const normalizeTaskEntries = (entries: TaskBoardEntry[]): TaskBoardEntry[] =>
  entries
    .map((entry) => ({
      ...entry,
      content: entry.content.trim(),
    }))
    .filter((entry) => entry.content.length > 0);

const parseTodoWriteEntries = (todos: string): TaskBoardEntry[] =>
  todos
    .split('\n')
    .map((line) => line.trim())
    .map((line) => line.match(TODO_WRITE_ENTRY_PATTERN))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({
      content: match[2].trim(),
      status: match[1] as TaskBoardEntry['status'],
    }));

const hasActiveTaskEntries = (entries: TaskBoardEntry[]): boolean =>
  entries.some((entry) => entry.status !== 'completed');

const createTaskBoard = (
  entries: TaskBoardEntry[],
  source: ActiveTaskBoard['source'],
  sourceMessageId: string
): ActiveTaskBoard | null => {
  const normalizedEntries = normalizeTaskEntries(entries);
  if (!hasActiveTaskEntries(normalizedEntries)) {
    return null;
  }

  return {
    entries: normalizedEntries,
    source,
    sourceMessageId,
    completedCount: normalizedEntries.filter((entry) => entry.status === 'completed').length,
    totalCount: normalizedEntries.length,
  };
};

const getCurrentTurnStartIndex = (list: TMessage[]): number => {
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const item = list[index];
    if (item.type === 'text' && item.position === 'right' && item.hidden !== true) {
      return index + 1;
    }
  }

  return 0;
};

const getTodoWriteBoard = (message: IMessageAcpToolCall): ActiveTaskBoard | null | undefined => {
  const todos = message.content.update.rawInput?.todos;
  if (typeof todos !== 'string') {
    return undefined;
  }

  return createTaskBoard(parseTodoWriteEntries(todos), 'todo_write', message.id);
};

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
  let pendingTexts: IMessageText[] = [];
  let pendingSourceMessageIds: string[] = [];

  const flushPendingAssistantItems = () => {
    if (!pendingActivities.length && !pendingTexts.length) return;

    const sourceMessageIds = uniqueIds(pendingSourceMessageIds);

    if (!pendingActivities.length) {
      result.push(...pendingTexts);
    } else if (!pendingTexts.length) {
      result.push({
        type: 'activity_group',
        id: `activity-${sourceMessageIds[0] || uuid()}`,
        activities: pendingActivities,
        sourceMessageIds,
      });
    } else {
      const { message, messageMsgIds } = mergeAssistantTextMessages(pendingTexts);
      result.push({
        type: 'assistant_turn',
        id: `assistant-turn-${sourceMessageIds[0] || message.id}`,
        message,
        messageMsgIds,
        activities: pendingActivities,
        sourceMessageIds,
      });
    }

    pendingActivities = [];
    pendingTexts = [];
    pendingSourceMessageIds = [];
  };

  for (const item of baseList) {
    if (isActivityItem(item)) {
      pendingActivities.push(item);
      pendingSourceMessageIds.push(...getProcessedItemSourceMessageIds(item));
      continue;
    }

    if (isAssistantTextMessage(item)) {
      pendingTexts.push(item);
      pendingSourceMessageIds.push(item.id);
      continue;
    }

    flushPendingAssistantItems();
    result.push(item);
  }

  flushPendingAssistantItems();

  return result;
};

export const getActiveTaskBoard = (list: TMessage[]): ActiveTaskBoard | null => {
  const turnStartIndex = getCurrentTurnStartIndex(list);

  for (let index = list.length - 1; index >= turnStartIndex; index -= 1) {
    const item = list[index];
    if (item.hidden) {
      continue;
    }

    if (item.type === 'plan') {
      return createTaskBoard(item.content.entries, 'plan', item.id);
    }

    if (item.type === 'acp_tool_call') {
      const taskBoard = getTodoWriteBoard(item);
      if (taskBoard !== undefined) {
        return taskBoard;
      }
    }
  }

  return null;
};

export const getCurrentTurnPlanMessageIds = (list: TMessage[]): Set<string> => {
  const turnStartIndex = getCurrentTurnStartIndex(list);
  const planMessageIds = new Set<string>();

  for (let index = turnStartIndex; index < list.length; index += 1) {
    const item = list[index];
    if (item.hidden || item.type !== 'plan') {
      continue;
    }

    planMessageIds.add(item.id);
  }

  return planMessageIds;
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
  const collectActivityMsgIds = (activity: AssistantActivityItem): string[] => {
    if (activity.type === 'thinking') {
      return collectIds([activity.msg_id]);
    }
    if (activity.type === 'tool_summary') {
      return collectIds(activity.messages.map((message) => message.msg_id));
    }
    return [];
  };

  if ('type' in item) {
    if (item.type === 'tool_summary') {
      return collectIds(item.messages.map((message) => message.msg_id));
    }
    if (item.type === 'assistant_turn') {
      return collectIds([...item.messageMsgIds, ...item.activities.flatMap(collectActivityMsgIds)]);
    }
    if (item.type === 'activity_group') {
      return collectIds(item.activities.flatMap(collectActivityMsgIds));
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
