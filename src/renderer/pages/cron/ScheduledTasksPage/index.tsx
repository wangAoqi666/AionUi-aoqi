/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import classNames from 'classnames';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, Empty, Message, Spin, Switch, Tooltip } from '@arco-design/web-react';
import { Plus } from '@icon-park/react';
import { useLayoutContext } from '@renderer/hooks/context/LayoutContext';
import { useOptionalConversationHistoryContext } from '@renderer/hooks/context/ConversationHistoryContext';
import {
  buildCronOwnershipSpaces,
  buildScheduledFilterPath,
  CRON_TEMP_SPACE_FILTER,
  getCronMarkerCleanupConversations,
  isTempCronSpaceFilter,
  loadCronWorkspaceDisplayNames,
} from '@renderer/pages/cron/cronOwnership';
import { useAllCronJobs } from '@renderer/pages/cron/useCronJobs';
import { formatNextRun, formatSchedule } from '@renderer/pages/cron/cronUtils';
import { systemSettings, type ICronJob } from '@/common/adapter/ipcBridge';
import { ipcBridge } from '@/common';
import { ACP_BACKENDS_ALL, type AcpBackendAll } from '@/common/types/acpTypes';
import { getAgentLogo } from '@renderer/utils/model/agentLogo';
import CronStatusTag from './CronStatusTag';
import CreateTaskDialog from './CreateTaskDialog';

function normalizeAgentBackend(agent: string | undefined): AcpBackendAll | undefined {
  if (!agent) return undefined;
  return agent.replace(/^cli:/, '').replace(/^preset:/, '') as AcpBackendAll;
}

function getJobAgentMeta(job: ICronJob): { name?: string; logo?: string | null } {
  const backend = job.metadata.agentConfig?.backend || normalizeAgentBackend(job.metadata.agentType);
  if (!backend) return {};

  return {
    name: job.metadata.agentConfig?.name || ACP_BACKENDS_ALL[backend]?.name || backend,
    logo: getAgentLogo(backend),
  };
}

const ScheduledTasksPage: React.FC = () => {
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { jobs, loading, pauseJob, resumeJob } = useAllCronJobs();
  const conversationHistory = useOptionalConversationHistoryContext();
  const conversations = conversationHistory?.conversations ?? [];
  const [createDialogVisible, setCreateDialogVisible] = useState(false);
  const [keepAwake, setKeepAwake] = useState(false);
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
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const currentWorkspace = searchParams.get('workspace');
  const currentConversationId = searchParams.get('conversationId');
  const currentScope = searchParams.get('space');

  useEffect(() => {
    systemSettings.getKeepAwake
      .invoke()
      .then(setKeepAwake)
      .catch(() => {});
  }, []);

  useEffect(() => {
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
  }, [cronMarkerCleanupConversations]);

  const filteredSpaces = useMemo(() => {
    if (!currentWorkspace && !currentConversationId && !isTempCronSpaceFilter(currentScope)) {
      return ownershipSpaces;
    }

    return ownershipSpaces
      .filter((space) => {
        if (currentWorkspace) {
          return space.workspacePath === currentWorkspace;
        }

        if (isTempCronSpaceFilter(currentScope)) {
          return space.type === 'temp';
        }

        return true;
      })
      .map((space) => {
        if (!currentConversationId) {
          return space;
        }

        const conversationsForSpace = space.conversations.filter(
          (conversation) => conversation.id === currentConversationId
        );
        return {
          id: space.id,
          type: space.type,
          displayName: space.displayName,
          workspacePath: space.workspacePath,
          lastActiveAt: space.lastActiveAt,
          conversations: conversationsForSpace,
          totalJobs: conversationsForSpace.reduce((sum, conversation) => sum + conversation.jobs.length, 0),
        };
      })
      .filter((space) => space.conversations.length > 0);
  }, [currentConversationId, currentScope, currentWorkspace, ownershipSpaces]);

  const currentFilterLabel = useMemo(() => {
    const matchedSpace = currentWorkspace
      ? ownershipSpaces.find((space) => space.workspacePath === currentWorkspace)
      : isTempCronSpaceFilter(currentScope)
        ? ownershipSpaces.find((space) => space.type === 'temp')
        : ownershipSpaces.find((space) =>
            currentConversationId
              ? space.conversations.some((conversation) => conversation.id === currentConversationId)
              : true
          );
    if (!matchedSpace) {
      return null;
    }

    if (!currentConversationId) {
      return matchedSpace.displayName;
    }

    const matchedConversation = matchedSpace.conversations.find(
      (conversation) => conversation.id === currentConversationId
    );
    if (!matchedConversation) {
      return matchedSpace.displayName;
    }

    return `${matchedSpace.displayName} / ${matchedConversation.displayName}`;
  }, [currentConversationId, currentScope, currentWorkspace, ownershipSpaces]);

  const handleKeepAwakeChange = useCallback(async (enabled: boolean) => {
    try {
      await systemSettings.setKeepAwake.invoke({ enabled });
      setKeepAwake(enabled);
    } catch (err) {
      Message.error(String(err));
    }
  }, []);

  const handleGoToDetail = useCallback(
    (job: ICronJob) => {
      navigate(`/scheduled/${job.id}`);
    },
    [navigate]
  );

  const handleToggleEnabled = useCallback(
    async (job: ICronJob) => {
      try {
        if (job.enabled) {
          await pauseJob(job.id);
          Message.success(t('cron.pauseSuccess'));
        } else {
          await resumeJob(job.id);
          Message.success(t('cron.resumeSuccess'));
        }
      } catch (err) {
        Message.error(String(err));
      }
    },
    [pauseJob, resumeJob, t]
  );

  return (
    <div
      className={classNames(
        'w-full min-h-full box-border overflow-y-auto',
        isMobile ? 'px-16px py-14px' : 'px-12px py-24px md:px-40px md:py-32px'
      )}
    >
      <div
        className={classNames(
          'mx-auto flex w-full max-w-920px box-border flex-col',
          isMobile ? 'gap-14px' : 'gap-16px'
        )}
      >
        <div className={classNames('flex w-full flex-col', isMobile ? 'gap-6px' : 'gap-8px')}>
          <div className='flex w-full items-start justify-between gap-12px sm:gap-16px max-[520px]:flex-wrap'>
            <div className='min-w-0 flex-1'>
              <h1
                className={classNames(
                  'm-0 min-w-0 flex-1 font-bold text-text-1',
                  isMobile ? 'text-24px leading-[1.2]' : 'text-28px leading-[1.15]'
                )}
              >
                {t('cron.scheduledTasks')}
              </h1>
              {currentFilterLabel && (
                <div className='mt-8px flex flex-wrap items-center gap-8px'>
                  <span className='rounded-full bg-fill-2 px-10px py-4px text-12px leading-18px text-text-2'>
                    {currentFilterLabel}
                  </span>
                  <Button type='text' size='mini' onClick={() => navigate('/scheduled')}>
                    {t('cron.allScheduledTasks')}
                  </Button>
                </div>
              )}
            </div>
            <Button
              type='primary'
              shape='round'
              className='shrink-0'
              icon={<Plus theme='outline' size={14} />}
              onClick={() => setCreateDialogVisible(true)}
            >
              {t('cron.page.newTask')}
            </Button>
          </div>
          <p
            className={classNames(
              'm-0 w-full text-text-3',
              isMobile ? 'text-13px leading-20px' : 'text-14px leading-22px'
            )}
          >
            {t('cron.page.description')}
          </p>
        </div>

        <div className='grid w-full box-border grid-cols-[minmax(0,1fr)_auto] items-center gap-x-12px gap-y-10px rounded-12px border border-solid border-[var(--color-border-2)] bg-fill-2 px-14px py-12px sm:rounded-14px sm:px-16px max-[520px]:grid-cols-1'>
          <span
            className={classNames(
              'min-w-0 text-text-2',
              isMobile ? 'text-12px leading-18px' : 'text-13px leading-20px'
            )}
          >
            {t('cron.page.awakeBanner')}
          </span>
          <div className='justify-self-end max-[520px]:justify-self-start'>
            <Tooltip content={t('cron.page.keepAwakeTooltip')}>
              <div className='flex items-center gap-8px text-text-3 text-12px leading-18px sm:text-13px'>
                <span>{t('cron.page.keepAwake')}</span>
                <Switch size='small' checked={keepAwake} onChange={handleKeepAwakeChange} />
              </div>
            </Tooltip>
          </div>
        </div>

        {loading ? (
          <div className='flex min-h-220px items-center justify-center rounded-16px border border-dashed border-border-2 bg-fill-1'>
            <Spin />
          </div>
        ) : filteredSpaces.length === 0 ? (
          <div className='flex min-h-220px items-center justify-center rounded-16px border border-dashed border-border-2 bg-fill-1'>
            <Empty description={t('cron.noTasks')} />
          </div>
        ) : (
          <div className='flex flex-col gap-16px'>
            {filteredSpaces.map((space) => (
              <section
                key={space.id}
                className='rounded-16px border border-solid border-[var(--color-border-2)] bg-fill-1 px-16px py-16px sm:px-20px sm:py-18px'
              >
                <div className='mb-16px flex items-center justify-between gap-12px'>
                  <div className='min-w-0'>
                    <h2 className='m-0 truncate text-16px font-semibold leading-24px text-text-1'>
                      {space.displayName}
                    </h2>
                    <p className='m-0 mt-4px text-12px leading-18px text-text-3'>
                      {t('cron.taskCount', { count: space.totalJobs })}
                    </p>
                  </div>
                  {(space.workspacePath || space.type === 'temp') &&
                    !currentWorkspace &&
                    !isTempCronSpaceFilter(currentScope) && (
                      <Button
                        type='text'
                        size='mini'
                        onClick={() =>
                          navigate(
                            buildScheduledFilterPath(
                              space.type === 'temp'
                                ? { scope: CRON_TEMP_SPACE_FILTER }
                                : { workspacePath: space.workspacePath }
                            )
                          )
                        }
                      >
                        {t('cron.allScheduledTasks')}
                      </Button>
                    )}
                </div>

                <div className='flex flex-col gap-18px'>
                  {space.conversations.map((conversation) => (
                    <div key={conversation.id} className='flex flex-col gap-12px'>
                      <div className='flex items-center justify-between gap-10px'>
                        <div className='min-w-0'>
                          <h3 className='m-0 truncate text-14px font-medium leading-22px text-text-1'>
                            {conversation.displayName}
                          </h3>
                          <p className='m-0 mt-2px text-12px leading-18px text-text-3'>
                            {t('cron.taskCount', { count: conversation.jobs.length })}
                          </p>
                        </div>
                        {conversation.conversation && !currentConversationId && (
                          <div className='flex items-center gap-8px'>
                            <Button
                              type='text'
                              size='mini'
                              onClick={() =>
                                navigate(
                                  buildScheduledFilterPath({
                                    workspacePath: space.workspacePath,
                                    conversationId: conversation.id,
                                    scope: space.type === 'temp' ? CRON_TEMP_SPACE_FILTER : undefined,
                                  })
                                )
                              }
                            >
                              {t('cron.scheduledTasks')}
                            </Button>
                            <Button
                              type='text'
                              size='mini'
                              onClick={() => navigate(`/conversation/${conversation.id}`)}
                            >
                              {t('cron.goToConversation')}
                            </Button>
                          </div>
                        )}
                      </div>

                      <div
                        className={classNames(
                          'grid w-full items-start grid-cols-1 gap-12px',
                          isMobile ? '' : 'sm:grid-cols-2 xl:grid-cols-3'
                        )}
                      >
                        {conversation.jobs.map((job) => {
                          const agentMeta = getJobAgentMeta(job);
                          const isManualOnly = job.schedule.kind === 'cron' && !job.schedule.expr;
                          const executionModeLabel =
                            job.target.executionMode === 'new_conversation'
                              ? t('cron.page.form.newConversation')
                              : t('cron.page.form.existingConversation');

                          return (
                            <div
                              key={job.id}
                              className={classNames(
                                'group flex cursor-pointer flex-col border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-1)] transition-colors duration-200 hover:border-[var(--color-border-3)] hover:shadow-sm',
                                isMobile ? 'rounded-12px px-16px py-16px' : 'rounded-12px px-20px py-18px'
                              )}
                              onClick={() => handleGoToDetail(job)}
                            >
                              <div className='mb-12px flex items-center justify-between gap-8px'>
                                <span
                                  className={classNames(
                                    'mr-8px min-w-0 flex-1 font-medium text-text-1',
                                    isMobile ? 'truncate text-14px leading-20px' : 'truncate text-15px leading-22px'
                                  )}
                                >
                                  {job.name}
                                </span>
                                <CronStatusTag job={job} />
                              </div>

                              <div
                                className={classNames(
                                  'min-w-0 break-words text-text-2',
                                  isMobile ? 'text-13px leading-20px' : 'text-14px leading-22px'
                                )}
                                title={formatSchedule(job, t)}
                              >
                                {formatSchedule(job, t)}
                              </div>

                              <div
                                className='mt-16px min-w-0 break-words text-text-2 text-13px leading-20px'
                                title={
                                  job.state.nextRunAtMs
                                    ? `${t('cron.nextRun')} ${formatNextRun(job.state.nextRunAtMs)}`
                                    : '-'
                                }
                              >
                                {job.state.nextRunAtMs
                                  ? `${t('cron.nextRun')} ${formatNextRun(job.state.nextRunAtMs)}`
                                  : '-'}
                              </div>

                              <div className='mt-14px flex items-center justify-between gap-10px'>
                                <div className='min-w-0 flex items-center gap-6px text-12px leading-18px text-text-3'>
                                  {agentMeta.name ? (
                                    <Tooltip content={agentMeta.name}>
                                      <div className='flex h-16px w-16px shrink-0 items-center justify-center text-text-3'>
                                        {agentMeta.logo ? (
                                          <img
                                            src={agentMeta.logo}
                                            alt={agentMeta.name}
                                            className='h-16px w-16px shrink-0 rounded-50%'
                                          />
                                        ) : (
                                          <span className='flex h-16px w-16px items-center justify-center rounded-50% text-10px font-medium text-text-3'>
                                            {agentMeta.name.slice(0, 1)}
                                          </span>
                                        )}
                                      </div>
                                    </Tooltip>
                                  ) : null}
                                  <span className='min-w-0 truncate'>{executionModeLabel}</span>
                                </div>

                                <div className='shrink-0' onClick={(event) => event.stopPropagation()}>
                                  {!isManualOnly && (
                                    <Switch
                                      size='small'
                                      checked={job.enabled}
                                      onChange={() => handleToggleEnabled(job)}
                                    />
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        <CreateTaskDialog
          visible={createDialogVisible}
          onClose={() => setCreateDialogVisible(false)}
          defaultWorkspacePath={currentWorkspace || undefined}
          defaultConversationId={currentConversationId || undefined}
        />
      </div>
    </div>
  );
};

export default ScheduledTasksPage;
