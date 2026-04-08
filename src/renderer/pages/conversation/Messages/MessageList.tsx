/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TMessage } from '@/common/chat/chatLib';
import { useConversationContextSafe } from '@/renderer/hooks/context/ConversationContext';
import { iconColors } from '@/renderer/styles/colors';
import { CHAT_MESSAGE_JUMP_EVENT, type ChatMessageJumpDetail } from '@/renderer/utils/chat/chatMinimapEvents';
import { Image } from '@arco-design/web-react';
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
import { useAutoPreviewOfficeFiles } from '@/renderer/hooks/file/useAutoPreviewOfficeFiles';
import SelectionReplyButton from './components/SelectionReplyButton';
import {
  buildProcessedMessageList,
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

const getUnhandledMessageType = (_message: never): string => 'unknown';

const renderAssistantActivity = (activity: AssistantActivityItem): React.ReactNode => {
  if (activity.type === 'thinking') {
    return <MessageThinking key={activity.id} message={activity} />;
  }
  return <MessageToolGroupSummary key={activity.id} messages={activity.messages} />;
};

// Image preview context
export const ImagePreviewContext = createContext<{ inPreviewGroup: boolean }>({ inPreviewGroup: false });

const MessageItem: React.FC<{ message: TMessage; highlighted?: boolean }> = React.memo(
  HOC((props) => {
    const { message, highlighted } = props as { message: TMessage; highlighted?: boolean };
    return (
      <div
        id={`message-${message.id}`}
        className={classNames(
          'min-w-0 flex items-start message-item [&>div]:max-w-full px-8px m-t-10px max-w-full md:max-w-860px mx-auto',
          message.type,
          {
            'justify-center': message.position === 'center',
            'justify-end': message.position === 'right',
            'justify-start': message.position === 'left',
            'message-item--center': message.position === 'center',
            'message-item--user': message.position === 'right',
            'message-item--assistant': message.position === 'left',
          }
        )}
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

const MessageList: React.FC<{ className?: string }> = () => {
  const list = useMessageList();
  const conversationContext = useConversationContextSafe();
  useAutoPreviewOfficeFiles(conversationContext?.workspace);
  const { t } = useTranslation();
  const location = useLocation();
  const locationState = (location.state || {}) as ConversationLocationState;
  const targetMessageId = locationState.targetMessageId;
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | undefined>();
  const handledTargetKeyRef = useRef<string>('');

  // Pre-process message list to group Codex turn_diff messages
  const processedList = useMemo(() => buildProcessedMessageList(list), [list]);

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
    itemCount: processedList.length,
  });

  useEffect(() => {
    if (!targetMessageId || processedList.length === 0 || !virtuosoRef.current) {
      return;
    }

    const targetKey = `${location.key}:${targetMessageId}`;
    if (handledTargetKeyRef.current === targetKey) {
      return;
    }

    const targetIndex = processedList.findIndex((item) => matchesTargetMessage(item, targetMessageId));
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
  }, [hideScrollButton, location.key, processedList, targetMessageId, virtuosoRef]);

  useEffect(() => {
    const handleMessageJump = (event: Event) => {
      const detail = (event as CustomEvent<ChatMessageJumpDetail>).detail;
      if (!detail || !detail.conversationId) return;
      if (!conversationContext?.conversationId || detail.conversationId !== conversationContext.conversationId) return;

      const targetIndex = processedList.findIndex(
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
  }, [conversationContext?.conversationId, hideScrollButton, processedList, virtuosoRef]);

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
          className='min-w-0 flex items-start message-item message-item--assistant px-8px m-t-10px max-w-full md:max-w-860px mx-auto justify-start'
          style={highlighted ? highlightStyle : undefined}
        >
          <div className='message-turn-stack'>
            <div className='message-turn-activities'>{item.activities.map(renderAssistantActivity)}</div>
            {item.type === 'assistant_turn' && <MessageText message={item.message} />}
          </div>
        </div>
      );
    }
    if (item.type === 'file_summary' || item.type === 'tool_summary') {
      return (
        <div
          key={item.id}
          id={`message-${getProcessedItemAnchorId(item)}`}
          className={'min-w-0 message-item px-8px m-t-10px max-w-full md:max-w-860px mx-auto ' + item.type}
          style={highlighted ? highlightStyle : undefined}
        >
          {item.type === 'file_summary' && <MessageFileChanges diffsChanges={item.diffs} />}
          {item.type === 'tool_summary' && <MessageToolGroupSummary messages={item.messages}></MessageToolGroupSummary>}
        </div>
      );
    }
    return <MessageItem message={item} key={item.id} highlighted={highlighted}></MessageItem>;
  };

  return (
    <div className='relative flex-1 h-full'>
      {/* Use PreviewGroup to wrap all messages for cross-message image preview */}
      <Image.PreviewGroup actionsLayout={['zoomIn', 'zoomOut', 'originalSize', 'rotateLeft', 'rotateRight']}>
        <ImagePreviewContext.Provider value={{ inPreviewGroup: true }}>
          <Virtuoso
            ref={virtuosoRef}
            scrollerRef={handleScrollerRef}
            className='conversation-message-stream flex-1 h-full pb-16px box-border'
            data={processedList}
            initialTopMostItemIndex={processedList.length - 1}
            defaultItemHeight={40}
            atBottomThreshold={100}
            increaseViewportBy={1200}
            itemContent={renderItem}
            followOutput={handleFollowOutput}
            onScroll={handleScroll}
            atBottomStateChange={handleAtBottomStateChange}
            components={{
              Header: () => <div className='h-10px' />,
              Footer: () => <div className='h-20px' />,
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

      <SelectionReplyButton messages={list} />
    </div>
  );
};

export default MessageList;
