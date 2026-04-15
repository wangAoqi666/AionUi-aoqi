import React from 'react';
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
  if (!entries.length) {
    return null;
  }

  const completedCount = entries.filter((item) => item.status === 'completed').length;

  return (
    <div className={`message-plan message-plan--${variant}`}>
      <div className='message-plan__header'>
        <span className='message-plan__label'>{t('common.tasks')}</span>
        <span className='message-plan__progress'>
          {completedCount}/{entries.length}
        </span>
      </div>
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
    </div>
  );
};

export default MessagePlan;
