/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@arco-design/web-react';
import { Plus } from '@icon-park/react';
import classNames from 'classnames';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import CreateTaskDialog from '@renderer/pages/cron/ScheduledTasksPage/CreateTaskDialog';
import { useAllCronJobs } from '@renderer/pages/cron/useCronJobs';
import { blurActiveElement } from '@renderer/utils/ui/focus';
import { cleanupSiderTooltips } from '@renderer/utils/ui/siderTooltip';
import CronJobSiderSection from './CronJobSiderSection';

type ScheduledSectionPanelProps = {
  onSessionClick?: () => void;
};

const ScheduledSectionPanel: React.FC<ScheduledSectionPanelProps> = ({ onSessionClick }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { jobs } = useAllCronJobs();
  const [createDialogVisible, setCreateDialogVisible] = useState(false);

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
      <div className='flex-1 min-h-0 overflow-y-auto'>
        {jobs.length > 0 ? (
          <CronJobSiderSection jobs={jobs} pathname={location.pathname} onNavigate={handleNavigate} />
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
      <CreateTaskDialog visible={createDialogVisible} onClose={() => setCreateDialogVisible(false)} />
    </div>
  );
};

export default ScheduledSectionPanel;
