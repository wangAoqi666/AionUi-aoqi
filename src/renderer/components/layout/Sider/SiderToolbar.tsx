/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Tooltip } from '@arco-design/web-react';
import { FolderOpen, Plus } from '@icon-park/react';
import classNames from 'classnames';
import type { SiderTooltipProps } from '@renderer/utils/ui/siderTooltip';
import styles from './Sider.module.css';

interface SiderToolbarProps {
  isMobile: boolean;
  collapsed: boolean;
  siderTooltipProps: SiderTooltipProps;
  onNewChat: () => void;
  onOpenFolder: () => void;
}

const SiderToolbar: React.FC<SiderToolbarProps> = ({
  isMobile,
  collapsed,
  siderTooltipProps,
  onNewChat,
  onOpenFolder,
}) => {
  const { t } = useTranslation();

  if (collapsed) {
    return (
      <div className='mb-8px shrink-0 flex flex-col items-center gap-2px w-full'>
        <Tooltip {...siderTooltipProps} content={t('conversation.welcome.newConversation')} position='right'>
          <Button
            type='text'
            aria-label={t('conversation.welcome.newConversation')}
            className={classNames(
              '!h-auto !w-full !rounded-8px !border-none !bg-transparent !px-0 !py-6px transition-colors !text-[var(--color-text-1)] hover:!bg-[var(--color-fill-3)] active:!bg-[var(--color-fill-4)]',
              styles.newChatTrigger
            )}
            onClick={onNewChat}
          >
            <Plus
              theme='outline'
              size='22'
              fill='currentColor'
              className={classNames('block leading-none', styles.newChatIcon)}
              style={{ lineHeight: 0 }}
            />
          </Button>
        </Tooltip>
        <Tooltip {...siderTooltipProps} content={t('conversation.welcome.openFolder')} position='right'>
          <Button
            type='text'
            aria-label={t('conversation.welcome.openFolder')}
            className='!h-auto !w-full !rounded-8px !border-none !bg-transparent !px-0 !py-6px transition-colors !text-[var(--color-text-1)] hover:!bg-[var(--color-fill-3)] active:!bg-[var(--color-fill-4)]'
            onClick={onOpenFolder}
          >
            <FolderOpen theme='outline' size='20' className='block leading-none' style={{ lineHeight: 0 }} />
          </Button>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className='mb-8px shrink-0 flex flex-col gap-8px'>
      <Tooltip {...siderTooltipProps} content={t('conversation.welcome.newConversation')} position='right'>
        <Button
          type='text'
          aria-label={t('conversation.welcome.newConversation')}
          className={classNames(
            styles.newChatTrigger,
            '!h-36px !flex !w-full !items-center !justify-start !gap-8px !rounded-[0.5rem] !border-none !bg-transparent !px-10px group transition-all !text-[var(--color-text-1)] hover:!bg-[var(--color-fill-3)] active:!bg-[var(--color-fill-4)]',
            isMobile && 'sider-action-btn-mobile'
          )}
          onClick={onNewChat}
        >
          <div className='size-28px rd-8px bg-aou-2 border border-solid border-[var(--color-border-2)] group-hover:bg-fill-3 group-hover:border-transparent flex items-center justify-center shrink-0 transition-colors'>
            <Plus
              theme='outline'
              size='18'
              fill='currentColor'
              className={classNames('block leading-none', styles.newChatIcon)}
              style={{ lineHeight: 0 }}
            />
          </div>
          <span className='collapsed-hidden text-t-primary text-14px font-medium leading-22px'>
            {t('conversation.welcome.newConversation')}
          </span>
        </Button>
      </Tooltip>

      <Tooltip {...siderTooltipProps} content={t('conversation.welcome.openFolder')} position='right'>
        <Button
          type='text'
          aria-label={t('conversation.welcome.openFolder')}
          className={classNames(
            styles.newChatTrigger,
            '!h-36px !flex !w-full !items-center !justify-start !gap-8px !rounded-[0.5rem] !border !border-solid !border-[var(--color-border-2)] !bg-transparent !px-10px group transition-all !text-[var(--color-text-1)] hover:!bg-[var(--color-fill-3)] active:!bg-[var(--color-fill-4)]',
            isMobile && 'sider-action-btn-mobile'
          )}
          onClick={onOpenFolder}
        >
          <div className='size-28px rd-8px bg-fill-2 border border-solid border-[var(--color-border-2)] group-hover:bg-fill-3 group-hover:border-transparent flex items-center justify-center shrink-0 transition-colors'>
            <FolderOpen
              theme='outline'
              size='18'
              fill='currentColor'
              className={classNames('block leading-none', styles.newChatIcon)}
              style={{ lineHeight: 0 }}
            />
          </div>
          <span className='collapsed-hidden text-t-primary text-14px font-medium leading-22px'>
            {t('conversation.welcome.openFolder')}
          </span>
        </Button>
      </Tooltip>
    </div>
  );
};

export default SiderToolbar;
