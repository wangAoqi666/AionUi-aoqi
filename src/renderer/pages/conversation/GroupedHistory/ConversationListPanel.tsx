/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import DirectorySelectionModal from '@/renderer/components/settings/DirectorySelectionModal';
import { useConversationHistoryContext } from '@/renderer/hooks/context/ConversationHistoryContext';
import { Button, Empty, Input, Modal } from '@arco-design/web-react';
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';

import ConversationRow from './ConversationRow';
import { useBatchSelection } from './hooks/useBatchSelection';
import { useConversationActions } from './hooks/useConversationActions';
import { useExport } from './hooks/useExport';
import type { ConversationRowProps } from './types';
import { isConversationPinned } from './utils/groupingHelpers';
import { useCronJobsMap } from '@/renderer/pages/cron';

type ConversationListPanelProps = {
  conversations: TChatConversation[];
  onSessionClick?: () => void;
  collapsed?: boolean;
  tooltipEnabled?: boolean;
  batchMode?: boolean;
  onBatchModeChange?: (value: boolean) => void;
  emptyDescription: string;
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
};

const ConversationListPanel: React.FC<ConversationListPanelProps> = ({
  conversations,
  onSessionClick,
  collapsed = false,
  tooltipEnabled = false,
  batchMode = false,
  onBatchModeChange,
  emptyDescription,
  emptyActionLabel,
  onEmptyAction,
}) => {
  const { t } = useTranslation();
  const { id: activeConversationId } = useParams();
  const { getJobStatus, markAsRead } = useCronJobsMap();
  const { isConversationGenerating, hasCompletionUnread } = useConversationHistoryContext();

  const {
    selectedConversationIds,
    setSelectedConversationIds,
    selectedCount,
    allSelected,
    toggleSelectedConversation,
    handleToggleSelectAll,
  } = useBatchSelection(batchMode, conversations);

  const {
    renameModalVisible,
    renameModalName,
    setRenameModalName,
    renameLoading,
    dropdownVisibleId,
    handleConversationClick,
    handleDeleteClick,
    handleBatchDelete,
    handleEditStart,
    handleRenameConfirm,
    handleRenameCancel,
    handleTogglePin,
    handleMenuVisibleChange,
    handleOpenMenu,
  } = useConversationActions({
    batchMode,
    onSessionClick,
    onBatchModeChange,
    selectedConversationIds,
    setSelectedConversationIds,
    toggleSelectedConversation,
    markAsRead,
  });

  const {
    exportTask,
    exportModalVisible,
    exportTargetPath,
    exportModalLoading,
    showExportDirectorySelector,
    setShowExportDirectorySelector,
    closeExportModal,
    handleSelectExportDirectoryFromModal,
    handleSelectExportFolder,
    handleExportConversation,
    handleBatchExport,
    handleConfirmExport,
  } = useExport({
    conversations,
    selectedConversationIds,
    setSelectedConversationIds,
    onBatchModeChange,
  });

  const pinnedConversations = useMemo(
    () => conversations.filter((conversation) => isConversationPinned(conversation)),
    [conversations]
  );
  const regularConversations = useMemo(
    () => conversations.filter((conversation) => !isConversationPinned(conversation)),
    [conversations]
  );

  const getConversationRowProps = (conversation: TChatConversation): ConversationRowProps => ({
    conversation,
    isGenerating: isConversationGenerating(conversation.id),
    hasCompletionUnread: hasCompletionUnread(conversation.id),
    collapsed,
    tooltipEnabled,
    batchMode,
    checked: selectedConversationIds.has(conversation.id),
    selected: activeConversationId === conversation.id,
    menuVisible: dropdownVisibleId === conversation.id,
    onToggleChecked: toggleSelectedConversation,
    onConversationClick: handleConversationClick,
    onOpenMenu: handleOpenMenu,
    onMenuVisibleChange: handleMenuVisibleChange,
    onEditStart: handleEditStart,
    onDelete: handleDeleteClick,
    onExport: handleExportConversation,
    onTogglePin: handleTogglePin,
    getJobStatus,
  });

  const renderConversation = (conversation: TChatConversation) => {
    return <ConversationRow key={conversation.id} {...getConversationRowProps(conversation)} />;
  };

  return (
    <>
      <Modal
        title={t('conversation.history.renameTitle')}
        visible={renameModalVisible}
        onOk={handleRenameConfirm}
        onCancel={handleRenameCancel}
        okText={t('conversation.history.saveName')}
        cancelText={t('conversation.history.cancelEdit')}
        confirmLoading={renameLoading}
        okButtonProps={{ disabled: !renameModalName.trim() }}
        style={{ borderRadius: '12px' }}
        alignCenter
        getPopupContainer={() => document.body}
      >
        <Input
          autoFocus
          value={renameModalName}
          onChange={setRenameModalName}
          onPressEnter={handleRenameConfirm}
          placeholder={t('conversation.history.renamePlaceholder')}
          allowClear
        />
      </Modal>

      <Modal
        visible={exportModalVisible}
        title={t('conversation.history.exportDialogTitle')}
        onCancel={closeExportModal}
        footer={null}
        style={{ borderRadius: '12px' }}
        className='conversation-export-modal'
        alignCenter
        getPopupContainer={() => document.body}
      >
        <div className='py-8px'>
          <div className='text-14px mb-16px text-t-secondary'>
            {exportTask?.mode === 'batch'
              ? t('conversation.history.exportDialogBatchDescription', { count: exportTask.conversationIds.length })
              : t('conversation.history.exportDialogSingleDescription')}
          </div>

          <div className='mb-16px p-16px rounded-12px bg-fill-1'>
            <div className='text-14px mb-8px text-t-primary'>{t('conversation.history.exportTargetFolder')}</div>
            <Button
              type='text'
              className='!h-auto !w-full !justify-between !px-12px !py-10px !rounded-8px'
              style={{
                backgroundColor: 'var(--color-bg-1)',
                border: '1px solid var(--color-border-2)',
                cursor: exportModalLoading ? 'not-allowed' : 'pointer',
                opacity: exportModalLoading ? 0.55 : 1,
              }}
              onClick={() => {
                void handleSelectExportFolder();
              }}
            >
              <span
                className='text-14px overflow-hidden text-ellipsis whitespace-nowrap'
                style={{ color: exportTargetPath ? 'var(--color-text-1)' : 'var(--color-text-3)' }}
              >
                {exportTargetPath || t('conversation.history.exportSelectFolder')}
              </span>
              <span className='text-14px text-t-secondary'>{'>'}</span>
            </Button>
          </div>

          <div className='flex items-center gap-8px mb-20px text-14px text-t-secondary'>
            <span>·</span>
            <span>{t('conversation.history.exportDialogHint')}</span>
          </div>

          <div className='flex gap-12px justify-end'>
            <Button onClick={closeExportModal}>{t('common.cancel')}</Button>
            <Button type='primary' onClick={() => void handleConfirmExport()} loading={exportModalLoading}>
              {exportModalLoading ? t('conversation.history.exporting') : t('common.confirm')}
            </Button>
          </div>
        </div>
      </Modal>

      <DirectorySelectionModal
        visible={showExportDirectorySelector}
        onConfirm={handleSelectExportDirectoryFromModal}
        onCancel={() => setShowExportDirectorySelector(false)}
      />

      {batchMode && !collapsed && (
        <div className='px-12px pb-8px'>
          <div className='rd-8px bg-fill-1 p-10px flex flex-col gap-8px border border-solid border-[rgba(var(--primary-6),0.08)]'>
            <div className='text-12px leading-18px text-t-secondary'>
              {t('conversation.history.selectedCount', { count: selectedCount })}
            </div>
            <div className='grid grid-cols-2 gap-6px'>
              <Button
                className='!col-span-2 !w-full !justify-center !min-w-0 !h-30px !px-8px !text-12px whitespace-nowrap'
                size='mini'
                type='secondary'
                onClick={handleToggleSelectAll}
              >
                {allSelected ? t('common.cancel') : t('conversation.history.selectAll')}
              </Button>
              <Button
                className='!w-full !justify-center !min-w-0 !h-30px !px-8px !text-12px whitespace-nowrap'
                size='mini'
                type='secondary'
                onClick={handleBatchExport}
              >
                {t('conversation.history.batchExport')}
              </Button>
              <Button
                className='!w-full !justify-center !min-w-0 !h-30px !px-8px !text-12px whitespace-nowrap'
                size='mini'
                status='warning'
                onClick={handleBatchDelete}
              >
                {t('conversation.history.batchDelete')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {conversations.length === 0 ? (
        <div className='flex h-full items-center justify-center px-16px'>
          <div className='w-full rounded-12px border border-dashed border-[var(--color-border-2)] bg-[var(--color-fill-1)] px-16px py-20px text-center'>
            <Empty description={emptyDescription} />
            {emptyActionLabel && onEmptyAction && (
              <Button type='primary' size='small' className='mt-12px' onClick={onEmptyAction}>
                {emptyActionLabel}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className='flex flex-col gap-8px min-w-0'>
          {pinnedConversations.length > 0 && (
            <div className='min-w-0'>
              {!collapsed && (
                <div className='px-12px py-6px text-12px text-t-secondary font-medium'>
                  {t('conversation.history.pinnedSection')}
                </div>
              )}
              <div className='min-w-0'>{pinnedConversations.map(renderConversation)}</div>
            </div>
          )}

          {regularConversations.length > 0 && (
            <div className='min-w-0'>
              {!collapsed && pinnedConversations.length > 0 && (
                <div className='px-12px py-6px text-12px text-t-secondary font-medium'>
                  {t('conversation.history.recents')}
                </div>
              )}
              <div className='min-w-0'>{regularConversations.map(renderConversation)}</div>
            </div>
          )}
        </div>
      )}
    </>
  );
};

export default ConversationListPanel;
