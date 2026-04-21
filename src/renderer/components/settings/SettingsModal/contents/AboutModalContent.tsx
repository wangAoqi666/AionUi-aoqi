/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import { Divider, Typography, Button, Switch } from '@arco-design/web-react';
import { Bug } from '@icon-park/react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import { useSettingsViewMode } from '../settingsViewContext';
import { ipcBridge } from '@/common';
import { isElectronDesktop, openExternalUrl } from '@/renderer/utils/platform';
import packageJson from '../../../../../../package.json';
import DroidBugReportModal from '@/renderer/components/settings/DroidBugReportModal';

const openAboutUpdateModal = () => {
  // 使用 window 自定义事件在渲染进程内部通信（buildEmitter 只支持主进程->渲染进程）
  // Use window custom event for renderer-side communication (buildEmitter only works main->renderer)
  window.dispatchEvent(new CustomEvent('aionui-open-update-modal', { detail: { source: 'about' } }));
};

const AboutModalContent: React.FC = () => {
  const { t } = useTranslation();
  const viewMode = useSettingsViewMode();
  const isPageMode = viewMode === 'page';
  const isElectron = isElectronDesktop();

  const [appVersion, setAppVersion] = useState(packageJson.version);
  const [includePrerelease, setIncludePrerelease] = useState(false);

  // Droid bug report Modal — opens via the "feedback" button below. The
  // Modal itself gates access to the submit button based on whether the
  // current URL points to a Droid-backed conversation (see the modal for
  // details). Here we just hand it the open/close control.
  //
  // Droid 反馈弹窗，按钮点击后打开；是否允许提交由 Modal 内部根据当前会话 backend 判断。
  const [droidBugReportCtrl, droidBugReportContext] = DroidBugReportModal.useModal({});

  useEffect(() => {
    const saved = localStorage.getItem('update.includePrerelease');
    setIncludePrerelease(saved === 'true');
  }, []);

  useEffect(() => {
    let cancelled = false;

    ipcBridge.application.getVersion
      .invoke()
      .then((version) => {
        if (!cancelled && version) {
          setAppVersion(version);
        }
      })
      .catch((error) => {
        console.error('Failed to get app version:', error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handlePrereleaseChange = (val: boolean) => {
    setIncludePrerelease(val);
    localStorage.setItem('update.includePrerelease', String(val));
  };

  const openLink = async (url: string) => {
    try {
      await openExternalUrl(url);
    } catch (error) {
      console.log('Failed to open link:', error);
    }
  };

  const linkItems: { title: string; url: string; icon: React.ReactNode }[] = [];

  return (
    <div className='flex flex-col h-full w-full'>
      {droidBugReportContext}
      {/* Content Area */}
      <div
        className={classNames(
          'flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-24px',
          isPageMode && 'px-0 overflow-visible'
        )}
      >
        <div className='flex flex-col max-w-500px mx-auto'>
          {/* App Info Section */}
          <div className='flex flex-col items-center pb-24px'>
            <Typography.Title heading={3} className='text-24px font-bold text-t-primary mb-8px'>
              智能体工厂
            </Typography.Title>
            <div className='flex items-center justify-center gap-8px mb-16px'>
              <span className='px-10px py-4px rd-6px text-13px bg-fill-2 text-t-primary font-500'>v{appVersion}</span>
            </div>

            {/* Check Update Section */}
            {isElectron && (
              <div className='flex flex-col items-center gap-12px w-full max-w-300px bg-fill-2 p-16px rounded-lg'>
                <Button type='primary' long onClick={openAboutUpdateModal}>
                  {t('settings.checkForUpdates')}
                </Button>
                <div className='flex items-center justify-between w-full'>
                  <Typography.Text className='text-12px text-t-secondary'>
                    {t('settings.includePrereleaseUpdates')}
                  </Typography.Text>
                  <Switch size='small' checked={includePrerelease} onChange={handlePrereleaseChange} />
                </div>
              </div>
            )}

            {/* Feedback Section (P2-4) — opens the Droid bug-report Modal. The
                Modal internally checks that the current conversation is a live
                Droid one before allowing submit, so we render the entry point
                unconditionally here (consistent with the "feedback" label the
                user already sees in existing copy). */}
            <div className='flex flex-col items-center gap-8px w-full max-w-300px mt-16px'>
              <Button long icon={<Bug theme='outline' size={16} />} onClick={() => droidBugReportCtrl.open()}>
                {t('settings.droidBugReport.button', {
                  defaultValue: '提交 Droid 使用反馈',
                })}
              </Button>
              <Typography.Text className='text-12px text-t-secondary text-center'>
                {t('settings.droidBugReport.buttonHint', {
                  defaultValue: '仅 Droid 后端会话可用；不会上传任何会话内容或文件路径。',
                })}
              </Typography.Text>
            </div>
          </div>

          {/* Divider */}
          <Divider className='my-16px' />

          {/* Links Section */}
          <div className='flex flex-col gap-4px pt-8px'>
            {linkItems.map((item, index) => (
              <div
                key={index}
                className='flex items-center justify-between px-16px py-12px rd-8px hover:bg-fill-2 transition-all cursor-pointer group'
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  openLink(item.url).catch((error) => console.error('Failed to open link:', error));
                }}
              >
                <Typography.Text className='text-14px text-t-primary'>{item.title}</Typography.Text>
                <div className='text-t-secondary group-hover:text-t-primary transition-colors'>{item.icon}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AboutModalContent;
