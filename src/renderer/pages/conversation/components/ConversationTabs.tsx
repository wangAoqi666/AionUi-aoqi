/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { TChatConversation } from '@/common/config/storage';
import { uuid } from '@/common/utils';
import { emitter } from '@/renderer/utils/emitter';
import { cleanupSiderTooltips } from '@/renderer/utils/ui/siderTooltip';
import { updateWorkspaceTime } from '@/renderer/utils/workspace/workspaceHistory';
import { Dropdown, Menu, Message } from '@arco-design/web-react';
import { Close, Plus } from '@icon-park/react';
import classNames from 'classnames';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useConversationTabs } from '../hooks/ConversationTabsContext';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { iconColors } from '@/renderer/styles/colors';

const TAB_OVERFLOW_THRESHOLD = 10;

interface TabFadeState {
  left: boolean;
  right: boolean;
}

interface ConversationTabViewProps {
  tabId: string;
  tabName: string;
  isActive: boolean;
  isMobile: boolean;
  contextMenu: React.ReactNode;
  onSwitch: (tabId: string) => void;
  onClose: (tabId: string) => void;
}

const ConversationTabView: React.FC<ConversationTabViewProps> = ({
  tabId,
  tabName,
  isActive,
  isMobile,
  contextMenu,
  onSwitch,
  onClose,
}) => {
  const tabClassName = classNames(
    'flex items-center gap-8px px-14px my-6px h-36px max-w-260px cursor-pointer transition-all duration-200 shrink-0 rounded-[14px] border border-solid backdrop-blur-sm',
    isActive
      ? 'bg-[color:var(--color-bg-1)] text-[color:var(--color-text-1)] font-medium border-[color:color-mix(in_srgb,var(--color-border-2)_78%,transparent)] shadow-[0_12px_28px_color-mix(in_srgb,var(--color-text-1)_10%,transparent)]'
      : 'bg-[color:color-mix(in_srgb,var(--color-bg-1)_55%,transparent)] text-[color:var(--color-text-3)] border-[color:transparent] hover:text-[color:var(--color-text-1)] hover:bg-[color:color-mix(in_srgb,var(--color-bg-1)_82%,transparent)]'
  );

  return (
    <Dropdown droplist={contextMenu} trigger='contextMenu' position='bl'>
      <div className={tabClassName} onClick={() => onSwitch(tabId)} title={isMobile ? undefined : tabName}>
        <span className='text-14px whitespace-nowrap overflow-hidden text-ellipsis select-none flex-1'>{tabName}</span>
        <span
          className='flex h-20px w-20px shrink-0 items-center justify-center rounded-full text-[var(--color-text-3)] transition-all duration-200 hover:bg-[color:color-mix(in_srgb,var(--color-fill-2)_78%,transparent)] hover:text-[rgb(var(--danger-6))]'
          onClick={(event) => {
            event.stopPropagation();
            onClose(tabId);
          }}
        >
          <Close theme='outline' size='14' fill='currentColor' />
        </span>
      </div>
    </Dropdown>
  );
};

interface CreateConversationTriggerProps {
  disabled: boolean;
  title: string;
  onClick: () => void;
}

const CreateConversationTrigger: React.FC<CreateConversationTriggerProps> = ({ disabled, title, onClick }) => (
  <div
    className={`flex items-center justify-center w-40px h-40px shrink-0 rounded-[14px] border border-solid border-transparent transition-all duration-200 ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer bg-[color:color-mix(in_srgb,var(--color-bg-1)_55%,transparent)] hover:bg-[color:var(--color-bg-1)] hover:border-[color:color-mix(in_srgb,var(--color-border-2)_80%,transparent)] hover:shadow-[0_12px_24px_color-mix(in_srgb,var(--color-text-1)_8%,transparent)]'}`}
    title={title}
    aria-disabled={disabled}
    onClick={() => {
      if (disabled) {
        return;
      }
      onClick();
    }}
  >
    <Plus theme='outline' size='16' fill={iconColors.primary} strokeWidth={3} />
  </div>
);

const cloneConversationForNewTab = (source: TChatConversation, name: string): TChatConversation => {
  const now = Date.now();
  const nextExtra = {
    ...source.extra,
    pinned: false,
    pinnedAt: undefined,
    cronJobId: undefined,
  } as TChatConversation['extra'] & {
    acpSessionId?: string;
    acpSessionConversationId?: string;
    acpSessionUpdatedAt?: number;
    sessionKey?: string;
  };

  if ('acpSessionId' in nextExtra) {
    nextExtra.acpSessionId = undefined;
    nextExtra.acpSessionConversationId = undefined;
    nextExtra.acpSessionUpdatedAt = undefined;
  }

  if ('sessionKey' in nextExtra) {
    nextExtra.sessionKey = undefined;
  }

  return {
    ...source,
    id: uuid(),
    name,
    createTime: now,
    modifyTime: now,
    extra: nextExtra,
  } as TChatConversation;
};

/**
 * 会话 Tabs 栏组件
 * Conversation tabs bar component
 *
 * 显示所有打开的会话 tabs，支持切换、关闭和新建会话
 * Displays all open conversation tabs, supports switching, closing, and creating new conversations
 */
const ConversationTabs: React.FC = () => {
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const {
    openTabs,
    activeTabId,
    switchTab,
    closeTab,
    closeAllTabs,
    closeTabsToLeft,
    closeTabsToRight,
    closeOtherTabs,
    openTab,
  } = useConversationTabs();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const tabsContainerRef = useRef<HTMLDivElement>(null);
  const [tabFadeState, setTabFadeState] = useState<TabFadeState>({ left: false, right: false });
  const defaultConversationName = t('conversation.welcome.newConversation');
  const isCreatingRef = useRef(false);

  // 更新 Tab 溢出状态
  const updateTabOverflow = useCallback(() => {
    const container = tabsContainerRef.current;
    if (!container) return;

    const { scrollLeft, scrollWidth, clientWidth } = container;
    const hasOverflow = scrollWidth > clientWidth + 1;

    const nextState: TabFadeState = {
      left: hasOverflow && scrollLeft > TAB_OVERFLOW_THRESHOLD,
      right: hasOverflow && scrollLeft + clientWidth < scrollWidth - TAB_OVERFLOW_THRESHOLD,
    };

    setTabFadeState((prev) => {
      if (prev.left === nextState.left && prev.right === nextState.right) return prev;
      return nextState;
    });
  }, []);

  // 当 tabs 变化时更新溢出状态
  useEffect(() => {
    updateTabOverflow();
  }, [updateTabOverflow, openTabs.length]);

  // 监听滚动和窗口大小变化
  useEffect(() => {
    const container = tabsContainerRef.current;
    if (!container) return;

    const handleScroll = () => updateTabOverflow();
    container.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', updateTabOverflow);

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => updateTabOverflow());
      resizeObserver.observe(container);
    }

    return () => {
      container.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', updateTabOverflow);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, [updateTabOverflow]);

  // 切换 tab 并导航
  const handleSwitchTab = useCallback(
    (tabId: string) => {
      cleanupSiderTooltips();
      switchTab(tabId);
      void navigate(`/conversation/${tabId}`);
    },
    [switchTab, navigate]
  );

  // 关闭 tab
  const handleCloseTab = useCallback(
    (tabId: string) => {
      cleanupSiderTooltips();
      closeTab(tabId);
      // 如果关闭的是当前 tab，导航将由 context 自动处理（切换到最后一个）
      // 如果没有 tab 了，导航到欢迎页
      if (openTabs.length === 1 && tabId === activeTabId) {
        void navigate('/guid');
      }
    },
    [closeTab, openTabs.length, activeTabId, navigate]
  );

  // 创建新会话 - 直接基于当前工作空间和当前智能体配置创建
  const handleCreateConversation = useCallback(async () => {
    if (isCreatingRef.current) return;
    isCreatingRef.current = true;

    const currentTab = openTabs.find((tab) => tab.id === activeTabId);
    if (!currentTab?.workspace) {
      isCreatingRef.current = false;
      void navigate('/guid');
      return;
    }

    const workspace = currentTab.workspace;

    try {
      const latestConversation = await ipcBridge.conversation.get.invoke({ id: currentTab.id }).catch((): null => null);
      if (!latestConversation?.extra?.workspace) {
        Message.error(t('conversation.createFailed'));
        return;
      }

      const draftConversation = cloneConversationForNewTab(latestConversation, defaultConversationName);
      const newConversation = await ipcBridge.conversation.createWithConversation.invoke({
        conversation: draftConversation,
      });

      updateWorkspaceTime(workspace);
      openTab(newConversation);
      void navigate(`/conversation/${newConversation.id}`);
      emitter.emit('chat.history.refresh');
    } catch (error) {
      console.error('Failed to create conversation:', error);
      Message.error(t('conversation.createFailed'));
    } finally {
      isCreatingRef.current = false;
    }
  }, [activeTabId, defaultConversationName, navigate, openTab, openTabs, t]);

  // 生成右键菜单内容
  const getContextMenu = useCallback(
    (tabId: string) => {
      const tabIndex = openTabs.findIndex((tab) => tab.id === tabId);
      const hasLeftTabs = tabIndex > 0;
      const hasRightTabs = tabIndex < openTabs.length - 1;
      const hasOtherTabs = openTabs.length > 1;

      return (
        <Menu
          onClickMenuItem={(key) => {
            switch (key) {
              case 'close-all':
                closeAllTabs();
                void navigate('/guid');
                break;
              case 'close-left':
                closeTabsToLeft(tabId);
                break;
              case 'close-right':
                closeTabsToRight(tabId);
                break;
              case 'close-others':
                closeOtherTabs(tabId);
                void navigate(`/conversation/${tabId}`);
                break;
            }
          }}
        >
          <Menu.Item key='close-others' disabled={!hasOtherTabs}>
            {t('conversation.tabs.closeOthers')}
          </Menu.Item>
          <Menu.Item key='close-left' disabled={!hasLeftTabs}>
            {t('conversation.tabs.closeLeft')}
          </Menu.Item>
          <Menu.Item key='close-right' disabled={!hasRightTabs}>
            {t('conversation.tabs.closeRight')}
          </Menu.Item>
          <Menu.Item key='close-all'>{t('conversation.tabs.closeAll')}</Menu.Item>
        </Menu>
      );
    },
    [openTabs, closeAllTabs, closeTabsToLeft, closeTabsToRight, closeOtherTabs, navigate, t]
  );

  const { left: showLeftFade, right: showRightFade } = tabFadeState;
  // 检查当前激活的 tab 是否在 openTabs 中
  // Check if current active tab is in openTabs
  const isActiveTabInList = openTabs.some((tab) => tab.id === activeTabId);

  // 如果没有打开的 tabs，或者当前激活的会话不在 tabs 中（说明切换到了非工作空间会话），不显示此组件
  // If no open tabs, or active conversation is not in tabs (switched to non-workspace chat), hide component
  if (openTabs.length === 0 || !isActiveTabInList) {
    return null;
  }

  const isCreateDisabled = isCreatingRef.current || !activeTabId;

  return (
    <div className='relative shrink-0 bg-transparent px-12px pb-12px'>
      <div className='relative flex items-center gap-6px h-48px w-full rounded-[20px] border border-solid border-[color:color-mix(in_srgb,var(--color-border-2)_76%,transparent)] bg-[color:color-mix(in_srgb,var(--color-bg-2)_92%,transparent)] px-6px shadow-[0_18px_44px_color-mix(in_srgb,var(--color-text-1)_10%,transparent)]'>
        {/* Tabs 滚动区域 */}
        <div
          ref={tabsContainerRef}
          className='flex items-center gap-4px h-full flex-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden'
        >
          {openTabs.map((tab) => (
            <ConversationTabView
              key={tab.id}
              tabId={tab.id}
              tabName={tab.name}
              isActive={tab.id === activeTabId}
              isMobile={isMobile}
              contextMenu={getContextMenu(tab.id)}
              onSwitch={handleSwitchTab}
              onClose={handleCloseTab}
            />
          ))}
        </div>

        {/* 新建会话按钮 - 直接在当前工作空间创建标签 */}
        <CreateConversationTrigger
          disabled={isCreateDisabled}
          title={t('conversation.workspace.createNewConversation')}
          onClick={() => void handleCreateConversation()}
        />

        {/* 左侧渐变指示器 */}
        {showLeftFade && (
          <div className='pointer-events-none absolute left-6px top-0 bottom-0 w-36px [background:linear-gradient(90deg,color-mix(in_srgb,var(--color-bg-2)_96%,transparent)_0%,transparent_100%)]' />
        )}

        {/* 右侧渐变指示器 */}
        {showRightFade && (
          <div className='pointer-events-none absolute right-46px top-0 bottom-0 w-36px [background:linear-gradient(270deg,color-mix(in_srgb,var(--color-bg-2)_96%,transparent)_0%,transparent_100%)]' />
        )}
      </div>
    </div>
  );
};

export default ConversationTabs;
