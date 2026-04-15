/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import { iconColors } from '@/renderer/styles/colors';
import { emitter } from '@/renderer/utils/emitter';
import { ipcBridge } from '@/common';
import type { ICronJob } from '@/common/adapter/ipcBridge';
import { Button, Popover, Tooltip } from '@arco-design/web-react';
import { AlarmClock } from '@icon-park/react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useCronJobs } from '../useCronJobs';
import { getJobStatusFlags } from '../cronUtils';

interface CronJobManagerProps {
  conversationId: string;
  /** When provided (e.g. from conversation.extra.cronJobId), fetch the job directly */
  cronJobId?: string;
}

/**
 * Cron job manager component for ChatLayout headerExtra
 * Shows scheduled task status for the current conversation.
 */
const CronJobManager: React.FC<CronJobManagerProps> = ({ conversationId, cronJobId }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // For child conversations spawned by a cron job, fetch the job directly by ID
  const [directJob, setDirectJob] = useState<ICronJob | null>(null);
  const [directLoading, setDirectLoading] = useState(!!cronJobId);

  useEffect(() => {
    if (!cronJobId) return;
    setDirectLoading(true);
    ipcBridge.cron.getJob
      .invoke({ jobId: cronJobId })
      .then((job) => setDirectJob(job ?? null))
      .catch(() => setDirectJob(null))
      .finally(() => setDirectLoading(false));
  }, [cronJobId]);

  // For regular conversations, use the existing hook
  const { jobs, loading: listLoading, hasJobs } = useCronJobs(cronJobId ? undefined : conversationId);

  const ownerJobs = cronJobId ? (directJob ? [directJob] : []) : jobs;
  const job = ownerJobs[0] ?? null;
  const loading = cronJobId ? directLoading : listLoading;
  const found = cronJobId ? !!directJob : hasJobs;
  const isMultiJobOwner = !cronJobId && ownerJobs.length > 1;

  // Handle unconfigured state (no jobs)
  if (!found && !loading) {
    const handleCreateClick = () => {
      emitter.emit('sendbox.fill', t('cron.status.defaultPrompt'));
    };

    return (
      <Popover
        trigger='hover'
        position='bottom'
        content={
          <div className='flex flex-col gap-8px p-4px max-w-240px'>
            <div className='text-13px text-t-secondary'>{t('cron.status.unconfiguredHint')}</div>
            <Button type='primary' size='mini' onClick={handleCreateClick}>
              {t('cron.status.createNow')}
            </Button>
          </div>
        }
      >
        <Button
          type='text'
          size='small'
          className='cron-job-manager-button chat-header-cron-pill !h-auto !w-auto !min-w-0 !px-0 !py-0'
        >
          <span className='inline-flex items-center gap-2px rounded-full px-8px py-2px bg-2'>
            <AlarmClock theme='outline' size={16} fill={iconColors.disabled} />
            <span className='ml-4px w-8px h-8px rounded-full bg-[#86909c]' />
          </span>
        </Button>
      </Popover>
    );
  }

  if (loading || !job) return null;

  const hasError = ownerJobs.some((entry) => getJobStatusFlags(entry).hasError);
  const allPaused = ownerJobs.every((entry) => getJobStatusFlags(entry).isPaused);
  const tooltipContent = isMultiJobOwner
    ? t('cron.taskCount', { count: ownerJobs.length })
    : allPaused
      ? t('cron.status.paused')
      : hasError
        ? t('cron.status.error')
        : job.name;
  const statusClass = hasError ? 'bg-[#f53f3f]' : allPaused ? 'bg-[#ff7d00]' : 'bg-[#00b42a]';
  const handleNavigate = () => {
    if (isMultiJobOwner) {
      navigate(`/scheduled?conversationId=${conversationId}`);
      return;
    }

    navigate(`/scheduled/${job.id}`);
  };

  return (
    <Tooltip content={tooltipContent}>
      <Button
        type='text'
        size='small'
        className='cron-job-manager-button chat-header-cron-pill !h-auto !w-auto !min-w-0 !px-0 !py-0'
        onClick={handleNavigate}
      >
        <span className='inline-flex items-center gap-2px rounded-full px-8px py-2px bg-2'>
          <AlarmClock theme='outline' size={16} fill={iconColors.primary} />
          {isMultiJobOwner ? (
            <span
              className={`ml-4px min-w-16px rounded-full px-4px text-center text-10px leading-16px text-white ${statusClass}`}
            >
              {ownerJobs.length}
            </span>
          ) : (
            <span className={`ml-4px h-8px w-8px rounded-full ${statusClass}`} />
          )}
        </span>
      </Button>
    </Tooltip>
  );
};

export default CronJobManager;
