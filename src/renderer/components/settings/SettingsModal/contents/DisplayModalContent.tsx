/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { ConfigStorage } from '@/common/config/storage';
import { STORAGE_KEYS } from '@/common/config/storageKeys';
import FontSizeControl from '@/renderer/components/settings/FontSizeControl';
import { ThemeSwitcher } from '@/renderer/components/settings/ThemeSwitcher';
import CssThemeSettings from '@renderer/pages/settings/DisplaySettings/CssThemeSettings';
import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import AionCollapse from '@/renderer/components/base/AionCollapse';
import { Switch } from '@arco-design/web-react';
import { Down, Up } from '@icon-park/react';
import useSWR from 'swr';
import { useSettingsViewMode } from '../settingsViewContext';

const getAutoPreviewOfficeFallback = (): boolean => {
  try {
    return localStorage.getItem(STORAGE_KEYS.AUTO_PREVIEW_OFFICE) === 'true';
  } catch {
    return false;
  }
};

/**
 * 偏好设置行组件 / Preference row component
 * 用于显示标签和对应的控件，统一的水平布局 / Used for displaying labels and corresponding controls in a unified horizontal layout
 */
const PreferenceRow: React.FC<{
  /** 标签文本 / Label text */
  label: string;
  /** 控件元素 / Control element */
  children: React.ReactNode;
}> = ({ label, children }) => (
  <div className='flex flex-col items-stretch gap-10px py-12px md:flex-row md:items-center md:justify-between md:gap-24px'>
    <div className='text-14px text-t-primary leading-22px'>{label}</div>
    <div className='w-full flex md:flex-1 md:justify-end'>{children}</div>
  </div>
);

/**
 * 显示设置内容组件 / Display settings content component
 *
 * 提供显示相关的配置选项，包括主题、缩放比例和自定义CSS
 * Provides display-related configuration options including theme, zoom scale and custom CSS
 *
 * @features
 * - 主题切换：亮色/暗色/跟随系统 / Theme: light/dark/system
 * - 缩放比例控制 / Zoom scale control
 * - 自定义CSS编辑器 / Custom CSS editor
 */
const DisplayModalContent: React.FC = () => {
  const { t } = useTranslation();
  const viewMode = useSettingsViewMode();
  const isPageMode = viewMode === 'page';
  const autoPreviewOfficeFallback = getAutoPreviewOfficeFallback();
  const { data: autoPreviewOffice = false, mutate: mutateAutoPreviewOffice } = useSWR<boolean>(
    'workspace.autoPreviewOffice',
    async () => {
      const value = Boolean(await ConfigStorage.get('workspace.autoPreviewOffice').catch(() => false));
      try {
        localStorage.setItem(STORAGE_KEYS.AUTO_PREVIEW_OFFICE, String(value));
      } catch {
        // ignore localStorage failures
      }
      return value;
    },
    {
      fallbackData: autoPreviewOfficeFallback,
    }
  );

  // 渲染折叠面板的展开/收起图标 / Render expand/collapse icon for collapse panel
  const renderExpandIcon = (active: boolean) =>
    active ? (
      <Up theme='outline' size='16' fill='var(--text-secondary)' />
    ) : (
      <Down theme='outline' size='16' fill='var(--text-secondary)' />
    );

  const handleAutoPreviewOfficeChange = async (checked: boolean) => {
    const previous = autoPreviewOffice;
    try {
      localStorage.setItem(STORAGE_KEYS.AUTO_PREVIEW_OFFICE, String(checked));
    } catch {
      // ignore localStorage failures
    }
    void mutateAutoPreviewOffice(checked, { revalidate: false });

    try {
      await ConfigStorage.set('workspace.autoPreviewOffice', checked);
    } catch (error) {
      console.error('[DisplayModalContent] Failed to persist workspace.autoPreviewOffice:', error);
      try {
        localStorage.setItem(STORAGE_KEYS.AUTO_PREVIEW_OFFICE, String(previous));
      } catch {
        // ignore localStorage failures
      }
      void mutateAutoPreviewOffice(previous, { revalidate: false });
    }
  };

  // 显示设置项配置 / Display items configuration
  const displayItems = [
    { key: 'theme', label: t('settings.theme'), component: <ThemeSwitcher /> },
    { key: 'fontSize', label: t('settings.fontSize'), component: <FontSizeControl /> },
    {
      key: 'autoPreviewOffice',
      label: t('settings.autoPreviewOffice'),
      component: (
        <Switch checked={autoPreviewOffice} onChange={(checked) => void handleAutoPreviewOfficeChange(checked)} />
      ),
    },
  ];

  return (
    <div className='flex flex-col h-full w-full'>
      {/* 内容区域 / Content Area */}
      <AionScrollArea className='flex-1 min-h-0 pb-16px' disableOverflow={isPageMode}>
        <div className='space-y-16px'>
          {/* 显示设置 / Display Settings */}
          <div className='px-16px md:px-24px lg:px-28px py-14px md:py-16px bg-2 rd-16px space-y-10px md:space-y-12px'>
            <div className='w-full flex flex-col divide-y divide-border-2'>
              {displayItems.map((item) => (
                <PreferenceRow key={item.key} label={item.label}>
                  {item.component}
                </PreferenceRow>
              ))}
            </div>
          </div>

          {/* CSS 主题设置 / CSS Theme Settings - Collapsible */}
          <AionCollapse
            className='!bg-transparent !py-0 !px-0 !gap-0'
            bordered={false}
            defaultActiveKey={['css']}
            expandIcon={renderExpandIcon}
            expandIconPosition='right'
          >
            <AionCollapse.Item
              name='css'
              header={<span className='text-14px text-t-primary leading-22px'>{t('settings.cssSettings')}</span>}
              className='bg-2 rd-16px px-16px md:px-24px lg:px-28px py-12px md:py-14px'
              headerClassName='py-4px'
              contentStyle={{ padding: '10px 0 0' }}
            >
              <CssThemeSettings />
            </AionCollapse.Item>
          </AionCollapse>
        </div>
      </AionScrollArea>
    </div>
  );
};

export default DisplayModalContent;
