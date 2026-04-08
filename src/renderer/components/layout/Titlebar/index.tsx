import React, { useEffect, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import { ArrowCircleLeft, ExpandLeft, ExpandRight, MenuFold, MenuUnfold, Plus } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';

import { ipcBridge } from '@/common';
import AppBrandLogo from '@renderer/assets/logos/brand/app.png';
import WindowControls from '../WindowControls';
import { WORKSPACE_STATE_EVENT, dispatchWorkspaceToggleEvent } from '@renderer/utils/workspace/workspaceEvents';
import type { WorkspaceStateDetail } from '@renderer/utils/workspace/workspaceEvents';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { usePreviewContext } from '@/renderer/pages/conversation/Preview';
import { isElectronDesktop, isMacOS } from '@/renderer/utils/platform';
import { DESKTOP_NAVIGATION_WIDTH, PRIMARY_RAIL_WIDTH } from '../layoutSections';
import './titlebar.css';

interface TitlebarProps {
  workspaceAvailable: boolean;
}

const AionLogoMark: React.FC = () => (
  <img src={AppBrandLogo} alt='智能体工厂' className='app-titlebar__brand-logo' aria-hidden='true' />
);

const Titlebar: React.FC<TitlebarProps> = ({ workspaceAvailable }) => {
  const { t } = useTranslation();
  const appTitle = useMemo(() => '智能体工厂', []);
  const [workspaceCollapsed, setWorkspaceCollapsed] = useState(true);
  const [workspaceButtonAvailable, setWorkspaceButtonAvailable] = useState(workspaceAvailable);
  const [mobileCenterTitle, setMobileCenterTitle] = useState(appTitle);
  const [mobileCenterOffset, setMobileCenterOffset] = useState(0);
  const layout = useLayoutContext();
  const { isOpen: isPreviewOpen, tabs: previewTabs, showPreviewPanel, hidePreviewPanel } = usePreviewContext();
  const location = useLocation();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);

  // 监听工作空间折叠状态，保持按钮图标一致 / Sync workspace collapsed state for toggle button
  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }
    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<WorkspaceStateDetail>;
      if (typeof customEvent.detail?.collapsed === 'boolean') {
        setWorkspaceCollapsed(customEvent.detail.collapsed);
      }
      if (typeof customEvent.detail?.available === 'boolean') {
        setWorkspaceButtonAvailable(customEvent.detail.available);
      }
    };
    window.addEventListener(WORKSPACE_STATE_EVENT, handler as EventListener);
    return () => {
      window.removeEventListener(WORKSPACE_STATE_EVENT, handler as EventListener);
    };
  }, []);

  useEffect(() => {
    setWorkspaceButtonAvailable(workspaceAvailable);
  }, [workspaceAvailable, location.pathname]);

  const isDesktopRuntime = isElectronDesktop();
  const isMacRuntime = isDesktopRuntime && isMacOS();
  // Windows/Linux 显示自定义窗口按钮；macOS 在标题栏给工作区一个切换入口
  const showWindowControls = isDesktopRuntime && !isMacRuntime;
  const showPreviewButton = previewTabs.length > 0 && workspaceAvailable && (!isDesktopRuntime || isMacRuntime);
  // WebUI 和 macOS 桌面都需要在标题栏放工作区开关；有预览时改为预览开关
  const showWorkspaceButton = !showPreviewButton && workspaceButtonAvailable && (!isDesktopRuntime || isMacRuntime);

  const workspaceTooltip = workspaceCollapsed
    ? t('common.expandMore', { defaultValue: 'Expand workspace' })
    : t('common.collapse', { defaultValue: 'Collapse workspace' });
  const previewTooltip = isPreviewOpen
    ? t('preview.collapsePanel', { defaultValue: 'Collapse panel' })
    : t('preview.openInPanelTooltip', { defaultValue: 'View in preview panel' });
  const newConversationTooltip = t('conversation.workspace.createNewConversation');
  const backToChatTooltip = t('common.back', { defaultValue: 'Back to Chat' });
  const isSettingsRoute = layout?.activeSection === 'settings' || location.pathname.startsWith('/settings');
  const iconSize = layout?.isMobile ? 24 : 18;
  // 统一在标题栏左侧展示主侧栏开关 / Always expose sidebar toggle on titlebar left side
  const showSiderToggle = Boolean(layout?.setSiderCollapsed) && !(layout?.isMobile && isSettingsRoute);
  const showBackToChatButton = Boolean(layout?.isMobile && isSettingsRoute);
  const showNewConversationButton = Boolean(layout?.isMobile && workspaceAvailable);
  const hasMobileConversationChrome = showNewConversationButton || showWorkspaceButton || showPreviewButton;
  const siderTooltip = layout?.siderCollapsed
    ? t('common.expandMore', { defaultValue: 'Expand sidebar' })
    : t('common.collapse', { defaultValue: 'Collapse sidebar' });

  const handleSiderToggle = () => {
    if (!showSiderToggle || !layout?.setSiderCollapsed) return;
    layout.setSiderCollapsed(!layout.siderCollapsed);
  };

  const handleWorkspaceToggle = () => {
    if (!workspaceButtonAvailable) {
      return;
    }
    if (location.pathname.startsWith('/conversation/') && layout?.siderCollapsed && layout?.setSiderCollapsed) {
      layout.setSiderCollapsed(false);
    }
    dispatchWorkspaceToggleEvent(workspaceCollapsed ? 'expand' : 'collapse');
  };

  const handlePreviewToggle = () => {
    if (previewTabs.length === 0) {
      return;
    }
    if (isPreviewOpen) {
      hidePreviewPanel();
      return;
    }
    showPreviewPanel();
  };

  const handleCreateConversation = () => {
    void navigate('/guid');
  };

  const handleBackToChat = () => {
    const target = layout?.getSectionRoute?.(layout.lastNonSettingsSection);
    if (target && !target.startsWith('/settings')) {
      void navigate(target);
      return;
    }
    void navigate(-1);
  };

  useEffect(() => {
    if (!layout?.isMobile) {
      setMobileCenterTitle(appTitle);
      return;
    }

    // Team mode: show team name
    const teamMatch = location.pathname.match(/^\/team\/([^/]+)/);
    const teamId = teamMatch?.[1];
    if (teamId) {
      let cancelled = false;
      void ipcBridge.team.get
        .invoke({ id: teamId })
        .then((team) => {
          if (cancelled) return;
          setMobileCenterTitle(team?.name || appTitle);
        })
        .catch(() => {
          if (cancelled) return;
          setMobileCenterTitle(appTitle);
        });
      return () => {
        cancelled = true;
      };
    }

    // Single agent mode: show conversation name
    const match = location.pathname.match(/^\/conversation\/([^/]+)/);
    const conversationId = match?.[1];
    if (!conversationId) {
      setMobileCenterTitle(appTitle);
      return;
    }

    let cancelled = false;
    void ipcBridge.conversation.get
      .invoke({ id: conversationId })
      .then((conversation) => {
        if (cancelled) return;
        setMobileCenterTitle(conversation?.name || appTitle);
      })
      .catch(() => {
        if (cancelled) return;
        setMobileCenterTitle(appTitle);
      });

    return () => {
      cancelled = true;
    };
  }, [appTitle, layout?.isMobile, location.pathname]);

  useEffect(() => {
    if (!layout?.isMobile) {
      setMobileCenterOffset(0);
      return;
    }

    const updateOffset = () => {
      const leftWidth = menuRef.current?.offsetWidth || 0;
      const rightWidth = toolbarRef.current?.offsetWidth || 0;
      setMobileCenterOffset((leftWidth - rightWidth) / 2);
    };

    updateOffset();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateOffset);
      return () => window.removeEventListener('resize', updateOffset);
    }

    const observer = new ResizeObserver(() => updateOffset());
    if (containerRef.current) observer.observe(containerRef.current);
    if (menuRef.current) observer.observe(menuRef.current);
    if (toolbarRef.current) observer.observe(toolbarRef.current);

    return () => observer.disconnect();
  }, [
    layout?.isMobile,
    showBackToChatButton,
    showNewConversationButton,
    showWorkspaceButton,
    showPreviewButton,
    mobileCenterTitle,
  ]);

  const mobileCenterStyle = layout?.isMobile
    ? ({
        '--app-titlebar-mobile-center-offset': `${hasMobileConversationChrome ? mobileCenterOffset : 0}px`,
      } as React.CSSProperties)
    : undefined;

  const menuStyle: React.CSSProperties = useMemo(() => {
    if (!isMacRuntime || !showSiderToggle) return {};

    const marginLeft = layout?.isMobile
      ? '0px'
      : layout?.siderCollapsed
        ? `${PRIMARY_RAIL_WIDTH - 4}px`
        : `${DESKTOP_NAVIGATION_WIDTH - 40}px`;
    return {
      marginLeft,
      transition: 'margin-left 0.28s cubic-bezier(0.4, 0, 0.2, 1)',
    };
  }, [isMacRuntime, showSiderToggle, layout?.isMobile, layout?.siderCollapsed]);

  return (
    <div
      ref={containerRef}
      style={mobileCenterStyle}
      className={classNames('flex items-center gap-8px app-titlebar bg-2 border-b border-[var(--border-base)]', {
        'app-titlebar--mobile': layout?.isMobile,
        'app-titlebar--mobile-conversation': layout?.isMobile && hasMobileConversationChrome,
        'app-titlebar--desktop': isDesktopRuntime,
        'app-titlebar--mac': isMacRuntime,
      })}
    >
      <div ref={menuRef} className='app-titlebar__menu' style={menuStyle}>
        {showBackToChatButton && (
          <button
            type='button'
            className={classNames('app-titlebar__button', layout?.isMobile && 'app-titlebar__button--mobile')}
            onClick={handleBackToChat}
            aria-label={backToChatTooltip}
          >
            <ArrowCircleLeft theme='outline' size={iconSize} fill='currentColor' />
          </button>
        )}
        {showSiderToggle && (
          <button
            type='button'
            className={classNames('app-titlebar__button', layout?.isMobile && 'app-titlebar__button--mobile')}
            onClick={handleSiderToggle}
            aria-label={siderTooltip}
          >
            {layout?.siderCollapsed ? (
              <MenuUnfold theme='outline' size={iconSize} fill='currentColor' />
            ) : (
              <MenuFold theme='outline' size={iconSize} fill='currentColor' />
            )}
          </button>
        )}
      </div>
      <div
        className='app-titlebar__brand'
        aria-label={layout?.isMobile ? mobileCenterTitle : appTitle}
        title={layout?.isMobile ? mobileCenterTitle : appTitle}
      >
        {layout?.isMobile ? (
          <span className='app-titlebar__brand-mobile'>
            <AionLogoMark />
            <span className='app-titlebar__brand-text'>{mobileCenterTitle}</span>
          </span>
        ) : (
          appTitle
        )}
      </div>
      <div ref={toolbarRef} className='app-titlebar__toolbar'>
        {showNewConversationButton && (
          <button
            type='button'
            className={classNames('app-titlebar__button', layout?.isMobile && 'app-titlebar__button--mobile')}
            onClick={handleCreateConversation}
            aria-label={newConversationTooltip}
          >
            <Plus theme='outline' size={iconSize} fill='currentColor' />
          </button>
        )}
        {showPreviewButton && (
          <button
            type='button'
            className={classNames('app-titlebar__button', layout?.isMobile && 'app-titlebar__button--mobile')}
            onClick={handlePreviewToggle}
            aria-label={previewTooltip}
          >
            {isPreviewOpen ? (
              <ExpandLeft theme='outline' size={iconSize} fill='currentColor' />
            ) : (
              <ExpandRight theme='outline' size={iconSize} fill='currentColor' />
            )}
          </button>
        )}
        {showWorkspaceButton && (
          <button
            type='button'
            className={classNames('app-titlebar__button', layout?.isMobile && 'app-titlebar__button--mobile')}
            onClick={handleWorkspaceToggle}
            aria-label={workspaceTooltip}
          >
            {workspaceCollapsed ? (
              <ExpandRight theme='outline' size={iconSize} fill='currentColor' />
            ) : (
              <ExpandLeft theme='outline' size={iconSize} fill='currentColor' />
            )}
          </button>
        )}
        {showWindowControls && <WindowControls />}
      </div>
    </div>
  );
};

export default Titlebar;
