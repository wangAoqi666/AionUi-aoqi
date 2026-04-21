/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Tooltip } from '@arco-design/web-react';
import { AlarmClock, MessageOne, SettingTwo } from '@icon-park/react';
import classNames from 'classnames';
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { getSiderTooltipProps } from '@renderer/utils/ui/siderTooltip';
import { type LayoutSection } from './layoutSections';

type PrimaryRailProps = {
  activeSection: LayoutSection;
  isMobile: boolean;
  onSelectSection: (section: LayoutSection) => void;
};

type RailItem = {
  section: LayoutSection;
  label: string;
  icon: React.ReactElement;
  placement: 'top' | 'bottom';
};

const PrimaryRail: React.FC<PrimaryRailProps> = ({ activeSection, isMobile, onSelectSection }) => {
  const { t } = useTranslation();
  const tooltipProps = getSiderTooltipProps(!isMobile);

  const items = useMemo<RailItem[]>(
    () => [
      {
        section: 'conversation',
        label: t('common.conversation'),
        icon: <MessageOne theme='outline' size='20' fill='currentColor' />,
        placement: 'top',
      },
      {
        section: 'tasks',
        label: t('common.tasks'),
        icon: <AlarmClock theme='outline' size='20' fill='currentColor' />,
        placement: 'top',
      },
      {
        section: 'settings',
        label: t('common.settings'),
        icon: <SettingTwo theme='outline' size='20' fill='currentColor' />,
        placement: 'bottom',
      },
    ],
    [t]
  );

  const renderButton = (item: RailItem) => {
    const active = item.section === activeSection;

    return (
      <Tooltip key={item.section} {...tooltipProps} content={item.label} position='right'>
        <Button
          type='text'
          aria-label={item.label}
          aria-pressed={active}
          className={classNames(
            '!h-44px !w-44px !rounded-12px !border-none !p-0 transition-colors',
            active
              ? '!bg-[rgba(var(--primary-6),0.12)] !text-[rgb(var(--primary-6))]'
              : '!text-[var(--color-text-2)] hover:!bg-[var(--color-fill-2)] hover:!text-[var(--color-text-1)]'
          )}
          icon={item.icon}
          onClick={() => onSelectSection(item.section)}
        />
      </Tooltip>
    );
  };

  return (
    <div className='layout-primary-rail flex h-full w-full flex-col items-center px-10px py-12px'>
      <div className='flex w-full flex-col items-center gap-8px'>
        {items.filter((item) => item.placement === 'top').map(renderButton)}
      </div>
      <div className='mt-auto mb-12px flex w-full flex-col items-center gap-8px'>
        {items.filter((item) => item.placement === 'bottom').map(renderButton)}
      </div>
    </div>
  );
};

export default PrimaryRail;
