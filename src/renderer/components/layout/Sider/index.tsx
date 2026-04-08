import { Button } from '@arco-design/web-react';
import classNames from 'classnames';
import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { usePreviewContext } from '@renderer/pages/conversation/Preview/context/PreviewContext';
import { cleanupSiderTooltips, getSiderTooltipProps } from '@renderer/utils/ui/siderTooltip';
import { useLayoutContext } from '@renderer/hooks/context/LayoutContext';
import { blurActiveElement } from '@renderer/utils/ui/focus';
import {
  WORKSPACE_TOGGLE_EVENT,
  dispatchWorkspaceStateEvent,
  type WorkspaceToggleDetail,
} from '@renderer/utils/workspace/workspaceEvents';
import useSWR from 'swr';
import { ipcBridge } from '@/common';
import type { TChatConversation } from '@/common/config/storage';
import ChatSider from '@renderer/pages/conversation/components/ChatSider';
import type { LayoutSection } from '../layoutSections';
import ScheduledSectionPanel from './ScheduledSectionPanel';
import SiderSearchEntry from './SiderSearchEntry';
import SiderToolbar from './SiderToolbar';

const CONVERSATION_LEFT_PANEL_MODE_KEY = 'conversation-left-panel-mode';

const WorkspaceGroupedHistory = React.lazy(() => import('@renderer/pages/conversation/GroupedHistory'));
const SettingsSider = React.lazy(() => import('@renderer/pages/settings/components/SettingsSider'));

type ConversationLeftPanelMode = 'history' | 'workspace';

const loadConversationLeftPanelMode = (): ConversationLeftPanelMode => {
  try {
    const saved = localStorage.getItem(CONVERSATION_LEFT_PANEL_MODE_KEY);
    return saved === 'workspace' ? 'workspace' : 'history';
  } catch {
    return 'history';
  }
};

const extractConversationIdFromPath = (pathname: string): string | null => {
  const match = pathname.match(/^\/conversation\/([^/]+)/);
  return match?.[1] ?? null;
};

type ConversationSectionPanelProps = {
  onSessionClick?: () => void;
};

const ConversationSectionPanel: React.FC<ConversationSectionPanelProps> = ({ onSessionClick }) => {
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const location = useLocation();
  const { pathname } = location;

  const { t } = useTranslation();
  const navigate = useNavigate();
  const { closePreview } = usePreviewContext();
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [conversationLeftPanelMode, setConversationLeftPanelMode] =
    useState<ConversationLeftPanelMode>(loadConversationLeftPanelMode);
  const activeConversationId = useMemo(() => extractConversationIdFromPath(pathname), [pathname]);
  const {
    data: activeConversation,
    isLoading: activeConversationLoading,
    mutate: mutateActiveConversation,
  } = useSWR<TChatConversation | undefined>(
    activeConversationId ? ['conversation.sidebar.active', activeConversationId] : null,
    () => ipcBridge.conversation.get.invoke({ id: activeConversationId! })
  );

  const handleNewChat = () => {
    cleanupSiderTooltips();
    blurActiveElement();
    closePreview();
    setIsBatchMode(false);
    Promise.resolve(navigate('/guid')).catch((error) => {
      console.error('Navigation failed:', error);
    });
    onSessionClick?.();
  };

  const handleConversationSelect = () => {
    cleanupSiderTooltips();
    blurActiveElement();
    closePreview();
    setIsBatchMode(false);
  };

  const tooltipEnabled = !isMobile;
  const siderTooltipProps = getSiderTooltipProps(tooltipEnabled);
  const canShowConversationWorkspace = Boolean(activeConversationId && activeConversation?.extra?.workspace);
  const showingWorkspacePanel = canShowConversationWorkspace && conversationLeftPanelMode === 'workspace';

  const workspaceHistoryProps = {
    collapsed: false,
    tooltipEnabled,
    onSessionClick,
    batchMode: isBatchMode,
    onBatchModeChange: setIsBatchMode,
  };

  useEffect(() => {
    if (!activeConversationId) return;

    return ipcBridge.conversation.listChanged.on((event) => {
      if (event.conversationId === activeConversationId) {
        void mutateActiveConversation();
      }
    });
  }, [activeConversationId, mutateActiveConversation]);

  useEffect(() => {
    if (!activeConversationId) {
      setConversationLeftPanelMode('history');
      return;
    }
    if (activeConversationLoading || canShowConversationWorkspace) return;
    setConversationLeftPanelMode('history');
  }, [activeConversationId, activeConversationLoading, canShowConversationWorkspace]);

  useEffect(() => {
    if (!activeConversationId || activeConversationLoading) return;
    dispatchWorkspaceStateEvent(!showingWorkspacePanel, canShowConversationWorkspace);
  }, [activeConversationId, activeConversationLoading, canShowConversationWorkspace, showingWorkspacePanel]);

  useEffect(() => {
    try {
      localStorage.setItem(CONVERSATION_LEFT_PANEL_MODE_KEY, conversationLeftPanelMode);
    } catch {
      // ignore storage write failures
    }
  }, [conversationLeftPanelMode]);

  const handleConversationLeftPanelModeChange = useCallback((mode: ConversationLeftPanelMode) => {
    cleanupSiderTooltips();
    blurActiveElement();
    setConversationLeftPanelMode(mode);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !activeConversationId || !canShowConversationWorkspace) {
      return undefined;
    }
    const handleWorkspaceToggle = (event: Event) => {
      const action = (event as CustomEvent<WorkspaceToggleDetail>).detail?.action ?? 'toggle';
      setConversationLeftPanelMode((prev) => {
        if (action === 'expand') {
          return 'workspace';
        }
        if (action === 'collapse') {
          return 'history';
        }
        return prev === 'workspace' ? 'history' : 'workspace';
      });
    };
    window.addEventListener(WORKSPACE_TOGGLE_EVENT, handleWorkspaceToggle);
    return () => {
      window.removeEventListener(WORKSPACE_TOGGLE_EVENT, handleWorkspaceToggle);
    };
  }, [activeConversationId, canShowConversationWorkspace]);

  return (
    <div className='size-full flex flex-col'>
      <SiderToolbar
        isMobile={isMobile}
        isBatchMode={isBatchMode}
        collapsed={false}
        siderTooltipProps={siderTooltipProps}
        onNewChat={handleNewChat}
        onToggleBatchMode={() => setIsBatchMode((prev) => !prev)}
      />
      {canShowConversationWorkspace && (
        <div className='px-8px pb-8px'>
          <div className='flex items-center gap-4px rounded-12px border border-solid border-[var(--color-border-2)] bg-[var(--color-fill-1)] p-4px'>
            {(['history', 'workspace'] as const).map((mode) => {
              const active = conversationLeftPanelMode === mode;
              return (
                <Button
                  key={mode}
                  size='mini'
                  type='text'
                  className={classNames(
                    'h-28px flex-1 !rounded-8px !border-none !px-0 !text-12px !font-500 transition-colors',
                    active
                      ? '!bg-[var(--color-bg-1)] !text-[var(--color-text-1)]'
                      : '!bg-transparent !text-[var(--color-text-3)] hover:!bg-[var(--color-fill-2)] hover:!text-[var(--color-text-1)]'
                  )}
                  onClick={() => handleConversationLeftPanelModeChange(mode)}
                >
                  {mode === 'history'
                    ? t('preview.history', { defaultValue: '历史' })
                    : t('common.workspace', { defaultValue: '工作空间' })}
                </Button>
              );
            })}
          </div>
        </div>
      )}
      {!showingWorkspacePanel && (
        <SiderSearchEntry
          isMobile={isMobile}
          collapsed={false}
          siderTooltipProps={siderTooltipProps}
          onConversationSelect={handleConversationSelect}
          onSessionClick={onSessionClick}
        />
      )}
      <div className={classNames('flex-1 min-h-0', showingWorkspacePanel ? 'overflow-hidden' : 'overflow-y-auto')}>
        {showingWorkspacePanel ? (
          <div className='size-full min-h-0'>
            <ChatSider conversation={activeConversation} />
          </div>
        ) : (
          <Suspense fallback={<div className='min-h-200px' />}>
            <WorkspaceGroupedHistory {...workspaceHistoryProps} />
          </Suspense>
        )}
      </div>
    </div>
  );
};

const SettingsSectionPanel: React.FC = () => (
  <Suspense fallback={<div className='size-full' />}>
    <SettingsSider collapsed={false} tooltipEnabled={false} />
  </Suspense>
);

interface SiderProps {
  onSessionClick?: () => void;
  section?: LayoutSection;
}

const Sider: React.FC<SiderProps> = ({ onSessionClick, section = 'conversation' }) => {
  if (section === 'tasks') {
    return <ScheduledSectionPanel onSessionClick={onSessionClick} />;
  }

  if (section === 'settings') {
    return <SettingsSectionPanel />;
  }

  return <ConversationSectionPanel onSessionClick={onSessionClick} />;
};

export default Sider;
