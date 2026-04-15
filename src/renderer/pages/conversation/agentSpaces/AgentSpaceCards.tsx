/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import { Button, Dropdown, Empty, Menu, Spin } from '@arco-design/web-react';
import { Delete, EditTwo, FolderOpen, MessageOne, Plus, Terminal } from '@icon-park/react';
import classNames from 'classnames';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentSpace } from '@renderer/pages/conversation/GroupedHistory/types';

type AgentSpaceCardsProps = {
  spaces: AgentSpace[];
  selectedSpaceId: string | null;
  onSelectSpace: (space: AgentSpace) => void;
  onOpenConversation: (conversation: TChatConversation, space: AgentSpace) => void;
  onCreateConversationForSpace: (space: AgentSpace) => void;
  onOpenSpaceFolderWith?: (space: AgentSpace, tool: 'explorer' | 'terminal') => void;
  onDeleteSpace?: (space: AgentSpace) => void;
  onRenameSpace?: (space: AgentSpace) => void;
  isConversationGenerating: (conversationId: string) => boolean;
  hasCompletionUnread: (conversationId: string) => boolean;
  previewLimit?: number;
};

const getConversationName = (conversation: TChatConversation, fallbackName: string): string => {
  return conversation.name || fallbackName;
};

const AgentSpaceCards: React.FC<AgentSpaceCardsProps> = ({
  spaces,
  selectedSpaceId,
  onSelectSpace,
  onOpenConversation,
  onCreateConversationForSpace,
  onOpenSpaceFolderWith,
  onDeleteSpace,
  onRenameSpace,
  isConversationGenerating,
  hasCompletionUnread,
  previewLimit = 2,
}) => {
  const { t } = useTranslation();
  const [expandedSpaceId, setExpandedSpaceId] = React.useState<string | null>(null);

  React.useEffect(() => {
    setExpandedSpaceId(null);
  }, [selectedSpaceId]);

  if (spaces.length === 0) {
    return (
      <div className='flex h-full items-center justify-center px-16px'>
        <div className='w-full rounded-12px border border-dashed border-[var(--color-border-2)] bg-[var(--color-fill-1)] px-16px py-20px text-center'>
          <Empty description={t('conversation.history.noHistory')} />
        </div>
      </div>
    );
  }

  return (
    <div className='flex flex-col gap-6px px-6px pb-6px'>
      {spaces.map((space) => {
        const isSelected = selectedSpaceId === space.id;
        const showingAllConversations = expandedSpaceId === space.id;
        const previewConversations = isSelected
          ? showingAllConversations
            ? space.conversations
            : space.conversations.slice(0, previewLimit)
          : [];
        const unreadCount = space.conversations.filter((conversation) => hasCompletionUnread(conversation.id)).length;
        const generatingCount = space.conversations.filter((conversation) =>
          isConversationGenerating(conversation.id)
        ).length;
        const spaceSubtitle = space.workspacePath || t('conversation.workspace.temporarySpace');
        const folderMenu =
          space.type === 'folder' ? (
            <Menu
              onClickMenuItem={(key) => {
                switch (key) {
                  case 'new-conversation':
                    onCreateConversationForSpace(space);
                    break;
                  case 'open-folder':
                    onOpenSpaceFolderWith?.(space, 'explorer');
                    break;
                  case 'open-terminal':
                    onOpenSpaceFolderWith?.(space, 'terminal');
                    break;
                  case 'delete':
                    onDeleteSpace?.(space);
                    break;
                  case 'rename':
                    onRenameSpace?.(space);
                    break;
                  default:
                    break;
                }
              }}
            >
              <Menu.Item key='new-conversation'>
                <div className='flex items-center gap-8px'>
                  <Plus theme='outline' size='14' />
                  <span>{t('conversation.welcome.newConversation')}</span>
                </div>
              </Menu.Item>
              <Menu.Item key='open-folder'>
                <div className='flex items-center gap-8px'>
                  <FolderOpen theme='outline' size='14' />
                  <span>{t('conversation.workspace.contextMenu.openFolder')}</span>
                </div>
              </Menu.Item>
              <Menu.Item key='open-terminal'>
                <div className='flex items-center gap-8px'>
                  <Terminal theme='outline' size='14' />
                  <span>{t('conversation.workspace.openWith.terminal')}</span>
                </div>
              </Menu.Item>
              <Menu.Item key='delete'>
                <div className='flex items-center gap-8px'>
                  <Delete theme='outline' size='14' />
                  <span>{t('common.delete')}</span>
                </div>
              </Menu.Item>
              {onRenameSpace ? (
                <Menu.Item key='rename'>
                  <div className='flex items-center gap-8px'>
                    <EditTwo theme='outline' size='14' />
                    <span>{t('conversation.history.rename')}</span>
                  </div>
                </Menu.Item>
              ) : null}
            </Menu>
          ) : null;

        return (
          <Dropdown
            key={space.id}
            trigger='contextMenu'
            position='br'
            getPopupContainer={() => document.body}
            droplist={folderMenu}
          >
            <div
              className={classNames(
                'overflow-hidden rounded-14px border border-solid transition-colors',
                isSelected
                  ? 'border-[rgba(var(--primary-6),0.18)] bg-[rgba(var(--primary-6),0.06)]'
                  : 'border-[var(--color-border-2)] bg-[var(--color-bg-1)]'
              )}
            >
              <Button
                type='text'
                className='!h-auto !w-full !justify-start !rounded-none !border-none !bg-transparent !p-0 hover:!bg-[var(--color-fill-2)]'
                onClick={() => onSelectSpace(space)}
              >
                <div className='flex w-full items-start gap-8px px-10px py-10px text-left'>
                  <div
                    className={classNames(
                      'flex h-32px w-32px shrink-0 items-center justify-center rounded-10px border border-solid',
                      isSelected
                        ? 'border-[rgba(var(--primary-6),0.2)] bg-[var(--color-bg-1)]'
                        : 'border-[var(--color-border-2)] bg-[var(--color-bg-1)]'
                    )}
                  >
                    {space.type === 'temp' ? (
                      <MessageOne theme='outline' size='16' />
                    ) : (
                      <FolderOpen theme='outline' size='16' />
                    )}
                  </div>
                  <div className='min-w-0 flex-1'>
                    <div className='truncate text-13px font-semibold leading-20px text-t-primary'>
                      {space.displayName}
                    </div>
                    <div className='truncate pt-1px text-11px leading-16px text-t-secondary'>{spaceSubtitle}</div>
                  </div>
                  <div className='flex shrink-0 items-center gap-5px pt-1px'>
                    {generatingCount > 0 && <span className='h-7px w-7px rounded-full bg-[rgb(var(--primary-6))]' />}
                    {unreadCount > 0 && (
                      <span className='h-7px w-7px rounded-full bg-[rgb(var(--primary-6))] shadow-[0_0_0_2px_rgba(var(--primary-6),0.14)]' />
                    )}
                    <span className='min-w-20px rounded-full bg-[var(--color-bg-1)] px-5px text-center text-10px leading-18px text-t-secondary'>
                      {space.conversations.length}
                    </span>
                  </div>
                </div>
              </Button>

              {isSelected && (
                <div className='flex flex-col gap-2px border-t border-solid border-[rgba(var(--primary-6),0.1)] px-10px pb-8px pt-4px'>
                  {previewConversations.length > 0 ? (
                    <>
                      {previewConversations.map((conversation) => {
                        const conversationName = getConversationName(
                          conversation,
                          t('conversation.welcome.newConversation')
                        );
                        const conversationGenerating = isConversationGenerating(conversation.id);
                        const conversationUnread = hasCompletionUnread(conversation.id);

                        return (
                          <Button
                            key={conversation.id}
                            type='text'
                            className='!h-auto !w-full !justify-start !rounded-10px !border-none !bg-transparent !p-0 hover:!bg-[rgba(var(--primary-6),0.08)]'
                            onClick={() => onOpenConversation(conversation, space)}
                          >
                            <div className='flex w-full items-center gap-6px px-8px py-6px text-left'>
                              <div className='flex h-18px w-18px shrink-0 items-center justify-center text-t-secondary'>
                                {conversationGenerating ? <Spin size={12} /> : <MessageOne theme='outline' size='14' />}
                              </div>
                              <div className='min-w-0 flex-1'>
                                <div className='truncate text-12px font-medium leading-18px text-t-primary'>
                                  {conversationName}
                                </div>
                              </div>
                              {conversationUnread && (
                                <span className='h-7px w-7px shrink-0 rounded-full bg-[rgb(var(--primary-6))] shadow-[0_0_0_2px_rgba(var(--primary-6),0.14)]' />
                              )}
                            </div>
                          </Button>
                        );
                      })}
                      {space.conversations.length > previewLimit && (
                        <div className='flex justify-end pt-1px'>
                          <Button
                            size='mini'
                            type='text'
                            className='!h-22px !rounded-8px !px-6px !text-11px !text-[var(--color-text-3)]'
                            onClick={() => setExpandedSpaceId(showingAllConversations ? null : space.id)}
                          >
                            {showingAllConversations ? t('common.collapse') : t('common.more')}
                          </Button>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className='flex items-center justify-between gap-8px rounded-10px border border-dashed border-[var(--color-border-2)] bg-[var(--color-bg-1)] px-10px py-8px'>
                      <div className='text-11px text-t-secondary'>{t('conversation.history.noHistory')}</div>
                      <Button size='mini' type='secondary' onClick={() => onCreateConversationForSpace(space)}>
                        {t('conversation.welcome.newConversation')}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </Dropdown>
        );
      })}
    </div>
  );
};

export default AgentSpaceCards;
