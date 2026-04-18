import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { IMessagePlan } from '@/common/chat/chatLib';

type TaskEntry = IMessagePlan['content']['entries'][number];

type MessagePlanProps = {
  message?: IMessagePlan;
  entries?: TaskEntry[];
  variant?: 'inline' | 'sticky';
};

const MessagePlan: React.FC<MessagePlanProps> = ({ message, entries: entriesProp, variant = 'inline' }) => {
  const { t } = useTranslation();
  const entries = entriesProp ?? message?.content.entries ?? [];
  // sticky variant starts collapsed; inline always shows
  const [expanded, setExpanded] = useState(variant !== 'sticky');

  if (!entries.length) {
    return null;
  }

  const completedCount = entries.filter((item) => item.status === 'completed').length;
  const inProgressCount = entries.filter((item) => item.status === 'in_progress').length;

  return (
    <div className={`message-plan message-plan--${variant}`}>
      <div
        className={`message-plan__header${variant === 'sticky' ? ' cursor-pointer select-none' : ''}`}
        onClick={variant === 'sticky' ? () => setExpanded((v) => !v) : undefined}
        role={variant === 'sticky' ? 'button' : undefined}
        tabIndex={variant === 'sticky' ? 0 : undefined}
        onKeyDown={
          variant === 'sticky'
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setExpanded((v) => !v);
                }
              }
            : undefined
        }
        aria-expanded={variant === 'sticky' ? expanded : undefined}
      >
        <span className='message-plan__label'>{t('common.tasks')}</span>
        <span className='message-plan__progress'>
          {completedCount}/{entries.length}
        </span>
        {variant === 'sticky' && inProgressCount > 0 && !expanded && (
          <span className='message-plan__running-hint'>{entries.find((e) => e.status === 'in_progress')?.content}</span>
        )}
        {variant === 'sticky' && (
          <span className='message-plan__toggle-arrow' aria-hidden='true'>
            {expanded ? '▲' : '▼'}
          </span>
        )}
      </div>
      {expanded && (
        <div className='message-plan__items'>
          {entries.map((item, index) => {
            return (
              <div className={`message-plan__item message-plan__item--${item.status}`} key={`${item.content}-${index}`}>
                <span className='message-plan__marker' aria-hidden='true'></span>
                <span className='message-plan__text'>{item.content}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default MessagePlan;
