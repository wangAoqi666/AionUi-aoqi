/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@arco-design/web-react';
import { Down, Plus, Right } from '@icon-park/react';
import classNames from 'classnames';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { ipcBridge } from '@/common';
import { useOptionalConversationHistoryContext } from '@renderer/hooks/context/ConversationHistoryContext';
import {
  buildCronOwnershipSpaces,
  buildScheduledFilterPath,
  CRON_TEMP_SPACE_FILTER,
  getCronMarkerCleanupConversations,
  isTempCronSpaceFilter,
  loadCronWorkspaceDisplayNames,
} from '@renderer/pages/cron/cronOwnership';
import CreateTaskDialog from '@renderer/pages/cron/ScheduledTasksPage/CreateTaskDialog';
import { useAllCronJobs } from '@renderer/pages/cron/useCronJobs';
import { blurActiveElement } from '@renderer/utils/ui/focus';
import { cleanupSiderTooltips } from '@renderer/utils/ui/siderTooltip';

type ScheduledSectionPanelProps = {
  onSessionClick?: () => void;
};

const ScheduledSectionPanel: React.FC<ScheduledSectionPanelProps> = ({ onSessionClick }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { jobs, loading: jobsLoading } = useAllCronJobs();
  const conversationHistory = useOptionalConversationHistoryContext();
  const conversations = conversationHistory?.conversations ?? [];
  const [createDialogVisible, setCreateDialogVisible] = useState(false);
  const [expandedSpaceIds, setExpandedSpaceIds] = useState<Set<string>>(() => new Set());
  const [expandedConversationIds, setExpandedConversationIds] = useState<Set<string>>(() => new Set());
  const sanitizedCronMarkerKeysRef = useRef<Set<string>>(new Set());
  const workspaceDisplayNames = useMemo(() => loadCronWorkspaceDisplayNames(), []);
  const ownershipSpaces = useMemo(
    () => buildCronOwnershipSpaces(jobs, conversations, t, workspaceDisplayNames),
    [conversations, jobs, t, workspaceDisplayNames]
  );
  const cronMarkerCleanupConversations = useMemo(
    () => getCronMarkerCleanupConversations(conversations, jobs),
    [conversations, jobs]
  );
  const currentSearchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const currentWorkspace = currentSearchParams.get('workspace');
  const currentConversationId = currentSearchParams.get('conversationId');
  const currentScope = currentSearchParams.get('space');
  const currentJobId = useMemo(() => {
    if (!location.pathname.startsWith('/scheduled/')) {
      return null;
    }

    const jobId = location.pathname.slice('/scheduled/'.length).trim();
    return jobId || null;
  }, [location.pathname]);

  useEffect(() => {
    if (jobsLoading) {
      return;
    }

    cronMarkerCleanupConversations.forEach((conversation) => {
      const cronJobId = (conversation.extra as { cronJobId?: string } | undefined)?.cronJobId;
      if (!cronJobId) {
        return;
      }

      const cleanupKey = `${conversation.id}:${cronJobId}`;
      if (sanitizedCronMarkerKeysRef.current.has(cleanupKey)) {
        return;
      }
      sanitizedCronMarkerKeysRef.current.add(cleanupKey);

      const nextExtra = { ...conversation.extra } as Record<string, unknown>;
      delete nextExtra.cronJobId;
      void ipcBridge.conversation.update.invoke({
        id: conversation.id,
        updates: { extra: nextExtra },
      });
    });
  }, [cronMarkerCleanupConversations, jobsLoading]);

  useEffect(() => {
    if (!currentWorkspace && !currentConversationId && !currentJobId && !isTempCronSpaceFilter(currentScope)) {
      return;
    }

    const nextExpandedSpaceIds = new Set<string>();
    const nextExpandedConversationIds = new Set<string>();

    ownershipSpaces.forEach((space) => {
      const matchedConversation = space.conversations.find((conversation) => {
        if (currentConversationId && conversation.id === currentConversationId) {
          return true;
        }

        return Boolean(currentJobId && conversation.jobs.some((job) => job.id === currentJobId));
      });

      const matchesActiveSpace =
        (currentWorkspace && space.workspacePath === currentWorkspace) ||
        (isTempCronSpaceFilter(currentScope) && space.type === 'temp');

      if (matchesActiveSpace || matchedConversation) {
        nextExpandedSpaceIds.add(space.id);
      }

      if (matchedConversation) {
        nextExpandedConversationIds.add(matchedConversation.id);
      }
    });

    if (nextExpandedSpaceIds.size > 0) {
      setExpandedSpaceIds((previous) => {
        const next = new Set(previous);
        nextExpandedSpaceIds.forEach((id) => next.add(id));
        return next;
      });
    }

    if (nextExpandedConversationIds.size > 0) {
      setExpandedConversationIds((previous) => {
        const next = new Set(previous);
        nextExpandedConversationIds.forEach((id) => next.add(id));
        return next;
      });
    }
  }, [currentConversationId, currentJobId, currentScope, currentWorkspace, ownershipSpaces]);

  const toggleSpaceExpanded = useCallback((spaceId: string) => {
    setExpandedSpaceIds((previous) => {
      const next = new Set(previous);
      if (next.has(spaceId)) {
        next.delete(spaceId);
      } else {
        next.add(spaceId);
      }
      return next;
    });
  }, []);

  const toggleConversationExpanded = useCallback((conversationId: string) => {
    setExpandedConversationIds((previous) => {
      const next = new Set(previous);
      if (next.has(conversationId)) {
        next.delete(conversationId);
      } else {
        next.add(conversationId);
      }
      return next;
    });
  }, []);

  const handleNavigate = useCallback(
    (path: string) => {
      cleanupSiderTooltips();
      blurActiveElement();
      Promise.resolve(navigate(path)).catch((error) => {
        console.error('Navigation failed:', error);
      });
      onSessionClick?.();
    },
    [navigate, onSessionClick]
  );

  return (
    <div className='size-full flex flex-col'>
      <div className='mb-8px shrink-0 flex items-center gap-8px'>
        <Button
          type='text'
          className='!h-36px !flex-1 !justify-start !rounded-8px !px-10px !text-left !text-[var(--color-text-1)] hover:!bg-[var(--color-fill-2)]'
          onClick={() => handleNavigate('/scheduled')}
        >
          <span className='text-14px font-medium leading-22px'>{t('cron.scheduledTasks')}</span>
        </Button>
        <Button
          type='text'
          aria-label={t('cron.page.newTask')}
          className='!h-36px !w-36px !rounded-8px !border-none !p-0 !text-[var(--color-text-2)] hover:!bg-[var(--color-fill-2)] hover:!text-[var(--color-text-1)]'
          icon={<Plus theme='outline' size='18' fill='currentColor' />}
          onClick={() => setCreateDialogVisible(true)}
        />
      </div>
      <div className='flex-1 min-h-0 overflow-y-auto' role='tree' aria-label={t('cron.scheduledTasks')}>
        {ownershipSpaces.length > 0 ? (
          <div className='flex flex-col gap-8px pb-8px'>
            {ownershipSpaces.map((space) => {
              const spaceActive =
                !currentConversationId &&
                (space.type === 'temp'
                  ? isTempCronSpaceFilter(currentScope)
                  : Boolean(space.workspacePath && currentWorkspace === space.workspacePath));
              const spaceExpanded = expandedSpaceIds.has(space.id);
              return (
                <div key={space.id} className='min-w-0' role='treeitem' aria-expanded={spaceExpanded}>
                  <div className='flex items-start gap-4px'>
                    <Button
                      type='text'
                      size='mini'
                      aria-label={spaceExpanded ? t('common.collapse') : t('common.expandMore')}
                      className='!mt-2px !h-24px !min-w-24px !w-24px !rounded-6px !border-none !p-0 !text-[var(--color-text-3)] hover:!bg-[var(--color-fill-2)] hover:!text-[var(--color-text-1)]'
                      icon={spaceExpanded ? <Down theme='outline' size={12} /> : <Right theme='outline' size={12} />}
                      onClick={() => toggleSpaceExpanded(space.id)}
                    />
                    <Button
                      type='text'
                      size='mini'
                      className={classNames(
                        '!h-auto !min-h-32px !flex-1 !justify-start !rounded-8px !border-none !px-6px !py-6px !text-left transition-colors',
                        spaceActive
                          ? '!bg-[rgba(var(--primary-6),0.12)] !text-[var(--color-text-1)]'
                          : '!text-[var(--color-text-2)] hover:!bg-[var(--color-fill-2)] hover:!text-[var(--color-text-1)]'
                      )}
                      onDoubleClick={() => toggleSpaceExpanded(space.id)}
                      onClick={() =>
                        handleNavigate(
                          buildScheduledFilterPath(
                            space.type === 'temp'
                              ? { scope: CRON_TEMP_SPACE_FILTER }
                              : { workspacePath: space.workspacePath }
                          )
                        )
                      }
                    >
                      <span className='flex min-w-0 flex-1 items-center gap-8px'>
                        <span
                          className={classNames(
                            'h-6px w-6px shrink-0 rounded-full',
                            spaceActive ? 'bg-[rgb(var(--primary-6))]' : 'bg-[var(--color-fill-3)]'
                          )}
                        />
                        <span className='min-w-0 flex-1 truncate text-13px font-medium'>{space.displayName}</span>
                      </span>
                      <span className='ml-8px shrink-0 rounded-full bg-[var(--color-fill-2)] px-6px py-1px text-11px leading-16px text-[var(--color-text-3)]'>
                        {space.totalJobs}
                      </span>
                    </Button>
                  </div>
                  {spaceExpanded && (
                    <div
                      className='mt-2px ml-11px flex flex-col gap-2px border-l border-[var(--color-border-2)] pl-10px'
                      role='group'
                    >
                      {space.conversations.map((conversation) => {
                        const conversationActive = currentConversationId === conversation.id;
                        const conversationExpanded = expandedConversationIds.has(conversation.id);
                        return (
                          <div
                            key={conversation.id}
                            className='min-w-0'
                            role='treeitem'
                            aria-expanded={conversationExpanded}
                          >
                            <div className='flex items-start gap-4px'>
                              <Button
                                type='text'
                                size='mini'
                                aria-label={conversationExpanded ? t('common.collapse') : t('common.expandMore')}
                                className='!mt-1px !h-22px !min-w-22px !w-22px !rounded-6px !border-none !p-0 !text-[var(--color-text-3)] hover:!bg-[var(--color-fill-2)] hover:!text-[var(--color-text-1)]'
                                icon={
                                  conversationExpanded ? (
                                    <Down theme='outline' size={12} />
                                  ) : (
                                    <Right theme='outline' size={12} />
                                  )
                                }
                                onClick={() => toggleConversationExpanded(conversation.id)}
                              />
                              <Button
                                type='text'
                                size='mini'
                                className={classNames(
                                  '!h-auto !min-h-30px !flex-1 !justify-start !rounded-8px !border-none !px-6px !py-5px !text-left transition-colors',
                                  conversationActive
                                    ? '!bg-[rgba(var(--primary-6),0.12)] !text-[var(--color-text-1)]'
                                    : '!text-[var(--color-text-2)] hover:!bg-[var(--color-fill-2)] hover:!text-[var(--color-text-1)]'
                                )}
                                onDoubleClick={() => toggleConversationExpanded(conversation.id)}
                                onClick={() =>
                                  handleNavigate(
                                    buildScheduledFilterPath({
                                      workspacePath: space.workspacePath,
                                      conversationId: conversation.id,
                                      scope: space.type === 'temp' ? CRON_TEMP_SPACE_FILTER : undefined,
                                    })
                                  )
                                }
                              >
                                <span className='flex min-w-0 flex-1 items-center gap-8px'>
                                  <span className='h-5px w-5px shrink-0 rounded-full bg-[var(--color-border-3)]' />
                                  <span className='min-w-0 flex-1 truncate text-13px'>{conversation.displayName}</span>
                                </span>
                                <span className='ml-8px shrink-0 rounded-full bg-[var(--color-fill-2)] px-6px py-1px text-11px leading-16px text-[var(--color-text-3)]'>
                                  {conversation.jobs.length}
                                </span>
                              </Button>
                            </div>
                            {conversationExpanded && (
                              <div
                                className='mt-2px ml-10px flex flex-col gap-2px border-l border-[var(--color-border-2)] pl-10px'
                                role='group'
                              >
                                {conversation.jobs.map((job) => {
                                  const jobActive = location.pathname === `/scheduled/${job.id}`;
                                  return (
                                    <Button
                                      key={job.id}
                                      type='text'
                                      size='mini'
                                      role='treeitem'
                                      aria-selected={jobActive}
                                      className={classNames(
                                        '!h-auto !min-h-28px !w-full !justify-start !rounded-8px !border-none !px-10px !py-5px !text-left transition-colors',
                                        jobActive
                                          ? '!bg-[rgba(var(--primary-6),0.12)] !text-[var(--color-text-1)]'
                                          : '!text-[var(--color-text-3)] hover:!bg-[var(--color-fill-2)] hover:!text-[var(--color-text-1)]'
                                      )}
                                      onClick={() => handleNavigate(`/scheduled/${job.id}`)}
                                    >
                                      <span className='flex min-w-0 flex-1 items-center gap-8px'>
                                        <span className='h-4px w-4px shrink-0 rounded-full bg-[var(--color-fill-3)]' />
                                        <span className='min-w-0 flex-1 truncate text-12px leading-18px'>
                                          {job.name}
                                        </span>
                                      </span>
                                    </Button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div
            className={classNames(
              'flex min-h-120px items-center justify-center rounded-12px border border-dashed border-[var(--color-border-2)] bg-[var(--color-fill-1)] px-12px text-center text-13px leading-20px text-[var(--color-text-3)]'
            )}
          >
            {t('cron.noTasks')}
          </div>
        )}
      </div>
      <CreateTaskDialog
        visible={createDialogVisible}
        onClose={() => setCreateDialogVisible(false)}
        defaultWorkspacePath={currentWorkspace || undefined}
        defaultConversationId={currentConversationId || undefined}
      />
    </div>
  );
};

export default ScheduledSectionPanel;
