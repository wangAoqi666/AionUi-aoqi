/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IMessageText, TMessage } from '@/common/chat/chatLib';
import { useConversationContextSafe } from '@/renderer/hooks/context/ConversationContext';
import { iconColors } from '@/renderer/styles/colors';
import { CHAT_MESSAGE_JUMP_EVENT, type ChatMessageJumpDetail } from '@/renderer/utils/chat/chatMinimapEvents';
import { Badge, Image } from '@arco-design/web-react';
import { IconDown, IconRight } from '@arco-design/web-react/icon';
import { Down } from '@icon-park/react';
import MessageAcpPermission from '@renderer/pages/conversation/Messages/acp/MessageAcpPermission';
import MessageAcpToolCall from '@renderer/pages/conversation/Messages/acp/MessageAcpToolCall';
import classNames from 'classnames';
import React, { createContext, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { Virtuoso } from 'react-virtuoso';
import './messages.css';
import HOC from '@renderer/utils/ui/HOC';
import MessageCodexToolCall from './codex/MessageCodexToolCall';
import MessageFileChanges from './codex/MessageFileChanges';
import { useMessageList } from './hooks';
import MessageAgentStatus from './components/MessageAgentStatus';
import MessagePlan from './components/MessagePlan';
import MessageTips from './components/MessageTips';
import MessageToolCall from './components/MessageToolCall';
import MessageToolGroup from './components/MessageToolGroup';
import MessageToolGroupSummary from './components/MessageToolGroupSummary';
import MessageCronTrigger from './components/MessageCronTrigger';
import MessageSkillSuggest from './components/MessageSkillSuggest';
import MessageText from './components/MessagetText';
import MessageThinking from './components/MessageThinking';
import { useAutoScroll } from './useAutoScroll';

import SelectionReplyButton from './components/SelectionReplyButton';
import {
  buildProcessedMessageList,
  getActiveTaskBoard,
  getCurrentTurnPlanMessageIds,
  getProcessedItemAnchorId,
  matchesTargetMsgId,
  matchesTargetMessage,
  type AssistantActivityItem,
  type ProcessedMessageItem,
} from './listProcessing';

type ConversationLocationState = {
  targetMessageId?: string;
  fromConversationSearch?: boolean;
};

const highlightStyle: React.CSSProperties = {
  backgroundColor: 'var(--color-aou-1)',
  boxShadow: '0 0 0 1px var(--color-aou-6-brand) inset',
  borderRadius: '12px',
};

type ActivityBadgeStatus = 'default' | 'success' | 'processing' | 'error';
type MessagePosition = TMessage['position'];

const MESSAGE_ROW_BASE_CLASS = 'min-w-0 flex items-start message-item w-full m-t-4px [&>div]:max-w-full';

const getUnhandledMessageType = (_message: never): string => 'unknown';

export const getConversationMessageRowClassName = (position: MessagePosition, extraClassName?: string): string =>
  classNames(MESSAGE_ROW_BASE_CLASS, extraClassName, {
    'justify-center': position === 'center',
    'justify-end': position === 'right',
    'justify-start': position === 'left',
    'message-item--center': position === 'center',
    'message-item--user': position === 'right',
    'message-item--assistant': position === 'left',
  });

const getFirstLine = (content: string): string => {
  const firstLine = content.split('\n')[0] || '';
  return firstLine.length > 80 ? `${firstLine.slice(0, 80)}...` : firstLine;
};

const formatDuration = (ms: number): string => {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m ${remaining}s`;
};

const buildToolParamSummary = (kind: string, rawInput?: Record<string, unknown>): string | undefined => {
  if (!rawInput) return undefined;

  if (kind === 'read' || kind === 'edit' || kind === 'write') {
    return (rawInput.file_path as string) || (rawInput.path as string) || (rawInput.fileName as string);
  }
  if (kind === 'execute') {
    return rawInput.command as string;
  }
  if (kind === 'search' || kind === 'grep') {
    const parts: string[] = [];
    if (rawInput.pattern) parts.push(`"${rawInput.pattern}"`);
    if (rawInput.path) parts.push(`in ${rawInput.path}`);
    return parts.length > 0 ? parts.join(' ') : undefined;
  }

  for (const key of ['file_path', 'command', 'path', 'pattern', 'query', 'url']) {
    if (rawInput[key] && typeof rawInput[key] === 'string') {
      return rawInput[key] as string;
    }
  }

  return undefined;
};

/** Map a tool kind string to its i18n action label key. */
const kindToActionKey = (kind: string): string => {
  const map: Record<string, string> = {
    read: 'conversation.toolAction.read',
    edit: 'conversation.toolAction.edit',
    write: 'conversation.toolAction.write',
    execute: 'conversation.toolAction.execute',
    search: 'conversation.toolAction.search',
    grep: 'conversation.toolAction.grep',
    glob: 'conversation.toolAction.glob',
    mcp: 'conversation.toolAction.mcp',
    skill: 'conversation.toolAction.skill',
    web_search: 'conversation.toolAction.web_search',
    fetch: 'conversation.toolAction.fetch',
  };
  return map[kind] || 'conversation.toolAction.default';
};

const getToolActivityMeta = (
  activity: Extract<AssistantActivityItem, { type: 'tool_summary' }>,
  t: (key: string, options?: Record<string, unknown>) => string
): { title: string; detail?: string; status: ActivityBadgeStatus; count: number } => {
  const count = activity.messages.reduce((total, message) => {
    return total + (message.type === 'tool_group' ? message.content.length : 1);
  }, 0);
  const latestMessage = activity.messages.at(-1);

  if (!latestMessage) {
    return { title: 'Tool', status: 'default', count: Math.max(count, 1) };
  }

  if (latestMessage.type === 'acp_tool_call') {
    const update = latestMessage.content.update;
    const isRunning = update.status !== 'completed' && update.status !== 'failed';
    const actionLabel = t(kindToActionKey(update.kind), { defaultValue: update.title });
    return {
      title: isRunning ? actionLabel : update.title,
      detail: buildToolParamSummary(update.kind, update.rawInput),
      status:
        update.status === 'completed' ? 'success' : update.status === 'failed' ? 'error' : ('processing' as const),
      count: Math.max(count, 1),
    };
  }

  const latestTool = latestMessage.content.at(-1);
  if (!latestTool) {
    return { title: 'Tool', status: 'default', count: Math.max(count, 1) };
  }

  const confirmationDetails = latestTool.confirmationDetails;
  let detail = latestTool.description.slice(0, 100);
  if (confirmationDetails?.type === 'edit') detail = confirmationDetails.fileName;
  if (confirmationDetails?.type === 'exec') detail = confirmationDetails.command;
  if (confirmationDetails?.type === 'info') detail = confirmationDetails.urls?.join(';') || confirmationDetails.title;
  if (confirmationDetails?.type === 'mcp') detail = `${confirmationDetails.serverName}:${confirmationDetails.toolName}`;

  const isRunning =
    latestTool.status !== 'Success' && latestTool.status !== 'Error' && latestTool.status !== 'Canceled';
  // Derive action label from confirmation type or tool name
  const toolKind =
    confirmationDetails?.type === 'exec'
      ? 'execute'
      : confirmationDetails?.type === 'mcp'
        ? 'mcp'
        : confirmationDetails?.type === 'edit'
          ? 'edit'
          : latestTool.name.toLowerCase();
  const actionLabel = t(kindToActionKey(toolKind), { defaultValue: latestTool.name });

  return {
    title: isRunning ? actionLabel : latestTool.name,
    detail,
    status:
      latestTool.status === 'Success'
        ? 'success'
        : latestTool.status === 'Error'
          ? 'error'
          : latestTool.status === 'Canceled'
            ? 'default'
            : 'processing',
    count: Math.max(count, 1),
  };
};

const getActivityMeta = (
  activity: AssistantActivityItem,
  t: (key: string, options?: Record<string, unknown>) => string
): { title: string; detail?: string; status: ActivityBadgeStatus; count: number } => {
  if (activity.type === 'thinking') {
    const isDone = activity.content.status === 'done';
    return {
      title: isDone
        ? t('conversation.thinking.completed', { defaultValue: 'Completed' })
        : t('common.processing', { defaultValue: 'Processing...' }),
      detail:
        activity.content.subject ||
        getFirstLine(activity.content.content) ||
        (isDone ? formatDuration(activity.content.duration || 0) : undefined),
      status: isDone ? 'success' : 'processing',
      count: 1,
    };
  }

  if (activity.type === 'tool_summary') {
    return getToolActivityMeta(activity, t);
  }

  return {
    title: t('messages.fileChangesCount', { count: activity.diffs.length }),
    detail: activity.diffs[0]?.fileName,
    status: 'success',
    count: Math.max(activity.diffs.length, 1),
  };
};

const renderAssistantActivityDetail = (activity: AssistantActivityItem): React.ReactNode => {
  if (activity.type === 'thinking') {
    return <MessageThinking key={activity.id} message={activity} />;
  }
  if (activity.type === 'tool_summary') {
    return <MessageToolGroupSummary key={activity.id} messages={activity.messages} />;
  }
  return <MessageFileChanges key={activity.id} diffsChanges={activity.diffs} />;
};

export const MessageActivitySummaryCard: React.FC<{ activities: AssistantActivityItem[] }> = ({ activities }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const summary = useMemo<{
    title: string;
    detail: string;
    status: ActivityBadgeStatus;
    count: number;
  }>(() => {
    const items = activities.map((activity) => getActivityMeta(activity, t));
    const latest = items.at(-1);
    const hasRunning = items.some((item) => item.status === 'processing');
    // Use latest item's status for done state — a later success overrides an earlier error
    const latestDoneStatus = latest?.status ?? 'success';

    return {
      title: hasRunning
        ? (latest?.title ?? t('conversation.toolAction.default', { defaultValue: 'Running' }))
        : latestDoneStatus === 'error'
          ? t('common.failed', { defaultValue: 'Failed' })
          : t('conversation.thinking.completed', { defaultValue: 'Completed' }),
      detail: latest ? (latest.detail ? `${latest.title} · ${latest.detail}` : latest.title) : '',
      status: hasRunning ? 'processing' : latestDoneStatus === 'error' ? 'error' : 'success',
      count: items.reduce((total, item) => total + item.count, 0),
    };
  }, [activities, t]);
  const titleLabel = summary.status === 'processing' ? summary.title.replace(/(?:\.{3}|…)+$/u, '') : summary.title;

  return (
    <div className='activity-box'>
      <div
        className='activity-box__header'
        onClick={() => setExpanded((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setExpanded((value) => !value);
          }
        }}
        role='button'
        tabIndex={0}
        aria-expanded={expanded}
      >
        <Badge
          status={summary.status}
          className={summary.status === 'processing' ? 'activity-box__badge--processing' : undefined}
        />
        <div className='activity-box__summary'>
          <div className='activity-box__title-row'>
            <span
              className={classNames('activity-box__title', {
                'activity-box__title--processing': summary.status === 'processing',
              })}
            >
              {titleLabel}
            </span>
            <span className='activity-box__count'>{summary.count}</span>
          </div>
          {summary.detail && <span className='activity-box__desc'>{summary.detail}</span>}
        </div>
        {expanded ? <IconDown className='activity-box__arrow' /> : <IconRight className='activity-box__arrow' />}
      </div>
      {expanded && <div className='activity-box__details'>{activities.map(renderAssistantActivityDetail)}</div>}
    </div>
  );
};

// Image preview context
export const ImagePreviewContext = createContext<{ inPreviewGroup: boolean }>({ inPreviewGroup: false });

const MessageItem: React.FC<{ message: TMessage; highlighted?: boolean }> = React.memo(
  HOC((props) => {
    const { message, highlighted } = props as { message: TMessage; highlighted?: boolean };
    return (
      <div
        id={`message-${message.id}`}
        className={getConversationMessageRowClassName(message.position, message.type)}
        style={highlighted ? highlightStyle : undefined}
      >
        {props.children}
      </div>
    );
  })(({ message }) => {
    const { t } = useTranslation();
    switch (message.type) {
      case 'text':
        return <MessageText message={message}></MessageText>;
      case 'tips':
        return <MessageTips message={message}></MessageTips>;
      case 'tool_call':
        return <MessageToolCall message={message}></MessageToolCall>;
      case 'tool_group':
        return <MessageToolGroup message={message}></MessageToolGroup>;
      case 'agent_status':
        return <MessageAgentStatus message={message}></MessageAgentStatus>;
      case 'acp_permission':
        return <MessageAcpPermission message={message}></MessageAcpPermission>;
      case 'acp_tool_call':
        return <MessageAcpToolCall message={message}></MessageAcpToolCall>;
      case 'codex_permission':
        // Permission UI is now handled by ConversationChatConfirm component
        return null;
      case 'codex_tool_call':
        return <MessageCodexToolCall message={message}></MessageCodexToolCall>;
      case 'plan':
        return <MessagePlan message={message}></MessagePlan>;
      case 'thinking':
        return <MessageThinking message={message}></MessageThinking>;
      case 'skill_suggest':
        return <MessageSkillSuggest message={message} />;
      case 'cron_trigger':
        return <MessageCronTrigger message={message} />;
      case 'available_commands':
        return null;
      default:
        return <div>{t('messages.unknownMessageType', { type: getUnhandledMessageType(message) })}</div>;
    }
  }),
  (prev, next) =>
    prev.message.id === next.message.id &&
    prev.message.content === next.message.content &&
    prev.message.position === next.message.position &&
    prev.message.type === next.message.type &&
    prev.highlighted === next.highlighted
);

/**
 * Collapsible section for intermediate process text (tool call narration).
 * Default collapsed; shows step count summary.
 */
const IntermediateTextCollapse: React.FC<{ texts: IMessageText[] }> = ({ texts }) => {
  const [open, setOpen] = React.useState(false);
  const { t } = useTranslation();
  if (!texts.length) return null;

  const label = t('chat.intermediateSteps', {
    defaultValue: '{{count}} intermediate steps',
    count: texts.length,
  });

  return (
    <div className='mb-4px'>
      <button
        type='button'
        className='flex items-center gap-4px text-12px color-text-3 cursor-pointer bg-transparent border-none p-0 hover:color-text-1'
        onClick={() => setOpen(!open)}
      >
        {open ? <IconDown style={{ fontSize: 12 }} /> : <IconRight style={{ fontSize: 12 }} />}
        <span>{label}</span>
      </button>
      {open && (
        <div className='mt-4px pl-16px border-l-2px border-fill-3'>
          {texts.map((msg) => (
            <div key={msg.id} className='text-13px color-text-3 mb-4px whitespace-pre-wrap'>
              {msg.content.content}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const MessageList: React.FC<{ className?: string }> = ({ className }) => {
  const list = useMessageList();
  const conversationContext = useConversationContextSafe();

  const { t } = useTranslation();
  const location = useLocation();
  const locationState = (location.state || {}) as ConversationLocationState;
  const targetMessageId = locationState.targetMessageId;
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | undefined>();
  const handledTargetKeyRef = useRef<string>('');

  // Pre-process message list to group Codex turn_diff messages
  const processedList = useMemo(() => buildProcessedMessageList(list), [list]);
  const activeTaskBoard = useMemo(() => getActiveTaskBoard(list), [list]);
  const currentTurnPlanMessageIds = useMemo(() => getCurrentTurnPlanMessageIds(list), [list]);
  const visibleProcessedList = useMemo(() => {
    if (!activeTaskBoard || currentTurnPlanMessageIds.size === 0) {
      return processedList;
    }

    return processedList.filter((item) => !(item.type === 'plan' && currentTurnPlanMessageIds.has(item.id)));
  }, [activeTaskBoard, currentTurnPlanMessageIds, processedList]);

  // Use auto-scroll hook
  const {
    virtuosoRef,
    handleScrollerRef,
    handleScroll,
    handleAtBottomStateChange,
    handleFollowOutput,
    showScrollButton,
    scrollToBottom,
    hideScrollButton,
  } = useAutoScroll({
    messages: list,
    itemCount: visibleProcessedList.length,
  });

  useEffect(() => {
    if (!targetMessageId) {
      return;
    }

    const targetKey = `${location.key}:${targetMessageId}`;
    if (handledTargetKeyRef.current === targetKey) {
      return;
    }

    if (activeTaskBoard && activeTaskBoard.sourceMessageId === targetMessageId) {
      handledTargetKeyRef.current = targetKey;
      setHighlightedMessageId(targetMessageId);
      hideScrollButton();

      const timer = window.setTimeout(() => {
        setHighlightedMessageId((current) => (current === targetMessageId ? undefined : current));
      }, 2400);

      return () => window.clearTimeout(timer);
    }

    if (visibleProcessedList.length === 0) {
      return;
    }

    if (!virtuosoRef.current) {
      return;
    }

    const targetIndex = visibleProcessedList.findIndex((item) => matchesTargetMessage(item, targetMessageId));
    if (targetIndex === -1) {
      return;
    }

    handledTargetKeyRef.current = targetKey;
    setHighlightedMessageId(targetMessageId);
    hideScrollButton();

    requestAnimationFrame(() => {
      virtuosoRef.current?.scrollToIndex({
        index: targetIndex,
        behavior: 'smooth',
        align: 'center',
      });
    });

    const timer = window.setTimeout(() => {
      setHighlightedMessageId((current) => (current === targetMessageId ? undefined : current));
    }, 2400);

    return () => window.clearTimeout(timer);
  }, [activeTaskBoard, hideScrollButton, location.key, targetMessageId, visibleProcessedList, virtuosoRef]);

  useEffect(() => {
    const handleMessageJump = (event: Event) => {
      const detail = (event as CustomEvent<ChatMessageJumpDetail>).detail;
      if (!detail || !detail.conversationId) return;
      if (!conversationContext?.conversationId || detail.conversationId !== conversationContext.conversationId) return;

      const targetId = detail.messageId || detail.msgId;
      if (activeTaskBoard && targetId && targetId === activeTaskBoard.sourceMessageId) {
        setHighlightedMessageId(targetId);
        window.setTimeout(() => {
          setHighlightedMessageId((current) => (current === targetId ? undefined : current));
        }, 2400);
        return;
      }

      const targetIndex = visibleProcessedList.findIndex(
        (item) => matchesTargetMessage(item, detail.messageId) || matchesTargetMsgId(item, detail.msgId)
      );
      if (targetIndex < 0) return;

      hideScrollButton();
      requestAnimationFrame(() => {
        virtuosoRef.current?.scrollToIndex({
          index: targetIndex,
          align: detail.align || 'start',
          behavior: detail.behavior || 'smooth',
        });
      });
    };

    window.addEventListener(CHAT_MESSAGE_JUMP_EVENT, handleMessageJump);
    return () => {
      window.removeEventListener(CHAT_MESSAGE_JUMP_EVENT, handleMessageJump);
    };
  }, [activeTaskBoard, conversationContext?.conversationId, hideScrollButton, visibleProcessedList, virtuosoRef]);

  // Click scroll button
  const handleScrollButtonClick = () => {
    hideScrollButton();
    scrollToBottom('smooth');
  };

  const renderItem = (_index: number, item: ProcessedMessageItem) => {
    const highlighted = matchesTargetMessage(item, highlightedMessageId);
    if (item.type === 'assistant_turn' || item.type === 'activity_group') {
      return (
        <div
          key={item.id}
          id={`message-${getProcessedItemAnchorId(item)}`}
          className={getConversationMessageRowClassName('left', 'message-item--assistant')}
          style={highlighted ? highlightStyle : undefined}
        >
          <div className='message-turn-stack'>
            <MessageActivitySummaryCard activities={item.activities} />
            {item.type === 'assistant_turn' && (
              <>
                {item.intermediateTexts && item.intermediateTexts.length > 0 && (
                  <IntermediateTextCollapse texts={item.intermediateTexts} />
                )}
                <MessageText message={item.finalMessage ?? item.message} />
              </>
            )}
          </div>
        </div>
      );
    }
    if (item.type === 'file_summary' || item.type === 'tool_summary') {
      return (
        <div
          key={item.id}
          id={`message-${getProcessedItemAnchorId(item)}`}
          className={getConversationMessageRowClassName('left', item.type)}
          style={highlighted ? highlightStyle : undefined}
        >
          <MessageActivitySummaryCard activities={[item]} />
        </div>
      );
    }
    return <MessageItem message={item} key={item.id} highlighted={highlighted}></MessageItem>;
  };

  return (
    <div className={classNames('relative flex-1 h-full min-h-0 flex flex-col', className)}>
      {activeTaskBoard && (
        <div
          id={`task-board-${activeTaskBoard.sourceMessageId}`}
          className='conversation-task-board'
          style={highlightedMessageId === activeTaskBoard.sourceMessageId ? highlightStyle : undefined}
        >
          <MessagePlan entries={activeTaskBoard.entries} variant='sticky' />
        </div>
      )}

      <div className='relative flex-1 min-h-0'>
        {/* Use PreviewGroup to wrap all messages for cross-message image preview */}
        <Image.PreviewGroup actionsLayout={['zoomIn', 'zoomOut', 'originalSize', 'rotateLeft', 'rotateRight']}>
          <ImagePreviewContext.Provider value={{ inPreviewGroup: true }}>
            <Virtuoso
              ref={virtuosoRef}
              scrollerRef={handleScrollerRef}
              className='conversation-message-stream flex-1 h-full pb-12px box-border'
              data={visibleProcessedList}
              initialTopMostItemIndex={visibleProcessedList.length > 0 ? visibleProcessedList.length - 1 : 0}
              defaultItemHeight={40}
              atBottomThreshold={100}
              increaseViewportBy={1200}
              itemContent={renderItem}
              followOutput={handleFollowOutput}
              onScroll={handleScroll}
              atBottomStateChange={handleAtBottomStateChange}
              components={{
                Header: () => <div className='h-4px' />,
                Footer: () => <div className='h-8px' />,
              }}
            />
          </ImagePreviewContext.Provider>
        </Image.PreviewGroup>

        {showScrollButton && (
          <>
            {/* Gradient mask */}
            <div className='absolute bottom-0 left-0 right-0 h-100px pointer-events-none' />
            {/* Scroll button */}
            <div className='absolute bottom-20px left-50% transform -translate-x-50% z-100'>
              <div
                className='flex items-center justify-center w-40px h-40px rd-full bg-base shadow-lg cursor-pointer hover:bg-1 transition-all hover:scale-110 border-1 border-solid border-3'
                onClick={handleScrollButtonClick}
                title={t('messages.scrollToBottom')}
                style={{ lineHeight: 0 }}
              >
                <Down theme='filled' size='20' fill={iconColors.secondary} style={{ display: 'block' }} />
              </div>
            </div>
          </>
        )}
      </div>

      <SelectionReplyButton messages={list} />
    </div>
  );
};

export default MessageList;
