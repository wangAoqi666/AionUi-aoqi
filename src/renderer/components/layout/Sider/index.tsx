import { Button, Input, Message, Modal } from '@arco-design/web-react';
import classNames from 'classnames';
import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { usePreviewContext } from '@renderer/pages/conversation/Preview/context/PreviewContext';
import ChatWorkspace from '@renderer/pages/conversation/Workspace';
import { cleanupSiderTooltips, getSiderTooltipProps } from '@renderer/utils/ui/siderTooltip';
import { useLayoutContext } from '@renderer/hooks/context/LayoutContext';
import { useConversationHistoryContext } from '@renderer/hooks/context/ConversationHistoryContext';
import { emitter } from '@renderer/utils/emitter';
import { blurActiveElement } from '@renderer/utils/ui/focus';
import { isElectronDesktop } from '@renderer/utils/platform';
import { getWorkspaceDisplayName } from '@renderer/utils/workspace/workspace';
import { getSelectedSpaceWorkspace, SELECTED_AGENT_SPACE_KEY } from '@renderer/utils/workspace/selectedSpace';
import {
  WORKSPACE_TOGGLE_EVENT,
  dispatchWorkspaceStateEvent,
  type WorkspaceToggleDetail,
} from '@renderer/utils/workspace/workspaceEvents';
import {
  TEMP_AGENT_SPACE_ID,
  buildAgentSpaces,
  createFolderAgentSpaceId,
  getConversationAgentSpaceId,
} from '@/renderer/pages/conversation/GroupedHistory/utils/groupingHelpers';
import type { AgentSpace } from '@/renderer/pages/conversation/GroupedHistory/types';
import useSWR from 'swr';
import { ipcBridge } from '@/common';
import type { TChatConversation } from '@/common/config/storage';
import type { WorkspaceEventPrefix } from '@renderer/pages/conversation/Workspace/types';
import { WORKSPACE_EVENT_PREFIX_BY_TYPE } from '@renderer/pages/conversation/components/ChatSider';
import AgentSpaceCards from '@renderer/pages/conversation/agentSpaces/AgentSpaceCards';
import DirectorySelectionModal from '@/renderer/components/settings/DirectorySelectionModal';
import type { LayoutSection } from '../layoutSections';
import ScheduledSectionPanel from './ScheduledSectionPanel';
import SiderSearchEntry, { GLOBAL_SIDER_SEARCH_SLOT_ID } from './SiderSearchEntry';
import SiderToolbar from './SiderToolbar';
const SettingsSider = React.lazy(() => import('@renderer/pages/settings/components/SettingsSider'));

const OPENED_FOLDER_SPACES_KEY = 'conversation-opened-folder-spaces';
const CONVERSATION_SPACE_VIEW_KEY = 'conversation-space-view';
const AGENT_SPACE_DISPLAY_NAMES_KEY = 'conversation-agent-space-display-names';
const MAX_OPENED_FOLDER_SPACES = 12;

type ConversationSpaceView = 'chat' | 'files';

const getConversationWorkspacePath = (conversation?: TChatConversation): string | null => {
  const workspace = conversation?.extra?.workspace;
  return typeof workspace === 'string' && workspace.length > 0 ? workspace : null;
};

const getSelectedWorkspaceConversation = (
  space: AgentSpace | null,
  activeConversationId: string | null
): TChatConversation | undefined => {
  if (!space) {
    return undefined;
  }

  return (
    space.conversations.find(
      (conversation) => conversation.id === activeConversationId && Boolean(getConversationWorkspacePath(conversation))
    ) ?? space.conversations.find((conversation) => Boolean(getConversationWorkspacePath(conversation)))
  );
};

const loadOpenedFolderSpaces = (): string[] => {
  try {
    const saved = localStorage.getItem(OPENED_FOLDER_SPACES_KEY);
    const parsed = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
};

const loadSelectedAgentSpaceId = (): string => {
  try {
    return localStorage.getItem(SELECTED_AGENT_SPACE_KEY) || TEMP_AGENT_SPACE_ID;
  } catch {
    return TEMP_AGENT_SPACE_ID;
  }
};

const loadConversationSpaceView = (): ConversationSpaceView => {
  try {
    return localStorage.getItem(CONVERSATION_SPACE_VIEW_KEY) === 'files' ? 'files' : 'chat';
  } catch {
    return 'chat';
  }
};

const loadAgentSpaceDisplayNames = (): Record<string, string> => {
  try {
    const saved = localStorage.getItem(AGENT_SPACE_DISPLAY_NAMES_KEY);
    const parsed = saved ? JSON.parse(saved) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[0] === 'string' && typeof entry[1] === 'string'
      )
    );
  } catch {
    return {};
  }
};

const normalizeOpenedFolderSpaces = (workspaces: string[]): string[] => {
  return Array.from(new Set(workspaces.filter(Boolean))).slice(0, MAX_OPENED_FOLDER_SPACES);
};

const upsertOpenedFolderSpace = (workspaces: string[], workspace: string): string[] => {
  return normalizeOpenedFolderSpaces([workspace, ...workspaces.filter((item) => item !== workspace)]);
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
  const { conversations, isConversationGenerating, hasCompletionUnread } = useConversationHistoryContext();
  const [openedFolderSpaces, setOpenedFolderSpaces] = useState<string[]>(loadOpenedFolderSpaces);
  const [selectedSpaceId, setSelectedSpaceId] = useState<string>(loadSelectedAgentSpaceId);
  const [selectedSpaceView, setSelectedSpaceView] = useState<ConversationSpaceView>(loadConversationSpaceView);
  const [agentSpaceDisplayNames, setAgentSpaceDisplayNames] =
    useState<Record<string, string>>(loadAgentSpaceDisplayNames);
  const [showDirectorySelectionModal, setShowDirectorySelectionModal] = useState(false);
  const [renameSpaceId, setRenameSpaceId] = useState<string | null>(null);
  const [renameSpaceName, setRenameSpaceName] = useState('');
  const activeConversationId = useMemo(() => extractConversationIdFromPath(pathname), [pathname]);
  const { data: activeConversation, mutate: mutateActiveConversation } = useSWR<TChatConversation | undefined>(
    activeConversationId ? ['conversation.sidebar.active', activeConversationId] : null,
    () => ipcBridge.conversation.get.invoke({ id: activeConversationId! })
  );
  const activeConversationSpaceId = useMemo(() => {
    return activeConversation ? getConversationAgentSpaceId(activeConversation) : null;
  }, [activeConversation]);
  const agentSpaces = useMemo(() => {
    return buildAgentSpaces(conversations, openedFolderSpaces, t, agentSpaceDisplayNames);
  }, [agentSpaceDisplayNames, conversations, openedFolderSpaces, t]);
  const selectedSpace = useMemo(() => {
    const matched = agentSpaces.find((space) => space.id === selectedSpaceId);
    if (matched) {
      return matched;
    }

    if (activeConversationSpaceId) {
      return agentSpaces.find((space) => space.id === activeConversationSpaceId) ?? null;
    }

    return agentSpaces[0] ?? null;
  }, [activeConversationSpaceId, agentSpaces, selectedSpaceId]);
  const selectedWorkspaceConversation = useMemo(() => {
    return getSelectedWorkspaceConversation(selectedSpace, activeConversationId);
  }, [activeConversationId, selectedSpace]);
  const selectedWorkspacePath = useMemo(() => {
    return selectedSpace?.workspacePath ?? getConversationWorkspacePath(selectedWorkspaceConversation);
  }, [selectedSpace?.workspacePath, selectedWorkspaceConversation]);
  const workspaceEventPrefix = useMemo<WorkspaceEventPrefix>(() => {
    if (!selectedWorkspaceConversation) {
      return 'acp';
    }

    return WORKSPACE_EVENT_PREFIX_BY_TYPE[selectedWorkspaceConversation.type] ?? 'acp';
  }, [selectedWorkspaceConversation]);
  const workspaceAvailable = Boolean(selectedWorkspacePath);
  const showingWorkspacePanel = selectedSpaceView === 'files' && workspaceAvailable;
  const shouldRenderSearchEntry = isMobile ? !showingWorkspacePanel : true;

  const handleNewChat = () => {
    cleanupSiderTooltips();
    blurActiveElement();
    closePreview();
    setSelectedSpaceView('chat');
    const selectedWorkspace = selectedSpace?.workspacePath || getSelectedSpaceWorkspace();
    if (selectedWorkspace) {
      setSelectedSpaceId(createFolderAgentSpaceId(selectedWorkspace));
      Promise.resolve(
        navigate('/guid', {
          state: { workspace: selectedWorkspace },
        })
      ).catch((error) => {
        console.error('Navigation failed:', error);
      });
      onSessionClick?.();
      return;
    }

    setSelectedSpaceId(TEMP_AGENT_SPACE_ID);
    Promise.resolve(navigate('/guid')).catch((error) => {
      console.error('Navigation failed:', error);
    });
    onSessionClick?.();
  };

  const handleConversationSelect = () => {
    cleanupSiderTooltips();
    blurActiveElement();
    closePreview();
  };

  const handleCreateFolderConversation = useCallback(
    (space: AgentSpace) => {
      if (!space.workspacePath) {
        handleNewChat();
        return;
      }

      cleanupSiderTooltips();
      blurActiveElement();
      closePreview();
      setSelectedSpaceId(space.id);
      setSelectedSpaceView('chat');
      Promise.resolve(
        navigate('/guid', {
          state: { workspace: space.workspacePath },
        })
      ).catch((error) => {
        console.error('Navigation failed:', error);
      });
      onSessionClick?.();
    },
    [closePreview, handleNewChat, navigate, onSessionClick]
  );

  const handleFolderSelectionConfirm = useCallback((paths: string[] | undefined) => {
    setShowDirectorySelectionModal(false);
    const workspace = paths?.[0];
    if (!workspace) {
      return;
    }

    setOpenedFolderSpaces((prev) => upsertOpenedFolderSpace(prev, workspace));
    setSelectedSpaceId(createFolderAgentSpaceId(workspace));
    setSelectedSpaceView('chat');
  }, []);

  const handleOpenFolder = useCallback(async () => {
    cleanupSiderTooltips();
    blurActiveElement();

    if (!isElectronDesktop()) {
      setShowDirectorySelectionModal(true);
      return;
    }

    try {
      const dirs = await ipcBridge.dialog.showOpen.invoke({
        properties: ['openDirectory'],
      });
      handleFolderSelectionConfirm(dirs);
    } catch (error) {
      console.error('Failed to open directory dialog:', error);
    }
  }, [handleFolderSelectionConfirm]);

  const handleOpenSpaceFolderWith = useCallback(
    async (space: AgentSpace, tool: 'explorer' | 'terminal') => {
      if (!space.workspacePath) {
        return;
      }

      cleanupSiderTooltips();
      blurActiveElement();

      try {
        await ipcBridge.shell.openFolderWith.invoke({
          folderPath: space.workspacePath,
          tool,
        });
      } catch {
        Message.error(t('conversation.workspace.contextMenu.openFailed'));
      }
    },
    [t]
  );

  const handleDeleteSpace = useCallback(
    (space: AgentSpace) => {
      if (!space.workspacePath) {
        return;
      }

      cleanupSiderTooltips();
      blurActiveElement();

      Modal.confirm({
        title: t('conversation.history.deleteTitle'),
        content: t('conversation.history.deleteWorkspaceGroupConfirm', {
          count: space.conversations.length,
        }),
        okText: t('conversation.history.confirmDelete'),
        cancelText: t('conversation.history.cancelDelete'),
        okButtonProps: { status: 'warning' },
        onOk: async () => {
          const conversationIds = space.conversations.map((conversation) => conversation.id);

          try {
            const results = await Promise.all(
              conversationIds.map(async (conversationId) => {
                const success = await ipcBridge.conversation.remove.invoke({ id: conversationId });
                if (success) {
                  emitter.emit('conversation.deleted', conversationId);
                }
                return success;
              })
            );

            const allDeleted = results.every(Boolean);
            const shouldRemoveSpace = conversationIds.length === 0 || allDeleted;

            if (shouldRemoveSpace) {
              setOpenedFolderSpaces((prev) => prev.filter((item) => item !== space.workspacePath));
              setAgentSpaceDisplayNames((prev) => {
                const { [space.workspacePath!]: _removed, ...rest } = prev;
                return rest;
              });
            }

            if (selectedSpaceId === space.id && shouldRemoveSpace) {
              setSelectedSpaceId(TEMP_AGENT_SPACE_ID);
              setSelectedSpaceView('chat');
            }

            if (activeConversationId && conversationIds.includes(activeConversationId)) {
              closePreview();
              Promise.resolve(navigate('/')).catch((error) => {
                console.error('Navigation failed:', error);
              });
            }

            if (allDeleted) {
              Message.success(t('conversation.history.deleteSuccess'));
            } else {
              Message.error(t('conversation.history.deleteFailed'));
            }
          } catch (error) {
            console.error('Failed to delete workspace group:', error);
            Message.error(t('conversation.history.deleteFailed'));
          }
        },
        style: { borderRadius: '12px' },
        alignCenter: true,
        getPopupContainer: () => document.body,
      });
    },
    [activeConversationId, closePreview, navigate, selectedSpaceId, t]
  );

  const tooltipEnabled = !isMobile;
  const siderTooltipProps = getSiderTooltipProps(tooltipEnabled);

  useEffect(() => {
    if (!activeConversationId) return;

    return ipcBridge.conversation.listChanged.on((event) => {
      if (event.conversationId === activeConversationId) {
        void mutateActiveConversation();
      }
    });
  }, [activeConversationId, mutateActiveConversation]);

  useEffect(() => {
    if (!selectedSpace && agentSpaces.length > 0) {
      setSelectedSpaceId(agentSpaces[0].id);
    }
  }, [agentSpaces, selectedSpace]);

  useEffect(() => {
    if (!activeConversationSpaceId) {
      return;
    }

    setSelectedSpaceId(activeConversationSpaceId);
  }, [activeConversationSpaceId]);

  useEffect(() => {
    if (selectedSpaceView === 'files' && !workspaceAvailable) {
      setSelectedSpaceView('chat');
    }
  }, [selectedSpaceView, workspaceAvailable]);

  useEffect(() => {
    try {
      localStorage.setItem(OPENED_FOLDER_SPACES_KEY, JSON.stringify(normalizeOpenedFolderSpaces(openedFolderSpaces)));
    } catch {
      // ignore storage write failures
    }
  }, [openedFolderSpaces]);

  useEffect(() => {
    try {
      localStorage.setItem(SELECTED_AGENT_SPACE_KEY, selectedSpaceId);
    } catch {
      // ignore storage write failures
    }
  }, [selectedSpaceId]);

  useEffect(() => {
    try {
      localStorage.setItem(CONVERSATION_SPACE_VIEW_KEY, selectedSpaceView);
    } catch {
      // ignore storage write failures
    }
  }, [selectedSpaceView]);

  useEffect(() => {
    try {
      localStorage.setItem(AGENT_SPACE_DISPLAY_NAMES_KEY, JSON.stringify(agentSpaceDisplayNames));
    } catch {
      // ignore storage write failures
    }
  }, [agentSpaceDisplayNames]);

  useEffect(() => {
    const activeWorkspace = activeConversation?.extra?.customWorkspace ? activeConversation.extra.workspace : '';
    if (!activeWorkspace) {
      return;
    }

    setOpenedFolderSpaces((prev) => upsertOpenedFolderSpace(prev, activeWorkspace));
  }, [activeConversation?.extra?.customWorkspace, activeConversation?.extra?.workspace]);

  const handleConversationSpaceViewChange = useCallback((mode: ConversationSpaceView) => {
    cleanupSiderTooltips();
    blurActiveElement();
    setSelectedSpaceView(mode);
  }, []);

  const handleSpaceSelect = useCallback((space: AgentSpace) => {
    cleanupSiderTooltips();
    blurActiveElement();
    setSelectedSpaceId(space.id);
  }, []);

  const handleCreateConversationForSpace = useCallback(
    (space: AgentSpace) => {
      if (space.type === 'folder') {
        handleCreateFolderConversation(space);
        return;
      }

      handleNewChat();
    },
    [handleCreateFolderConversation, handleNewChat]
  );

  const handleOpenSpaceConversation = useCallback(
    (conversation: TChatConversation, space: AgentSpace) => {
      cleanupSiderTooltips();
      blurActiveElement();
      closePreview();
      setSelectedSpaceId(space.id);
      setSelectedSpaceView('chat');
      Promise.resolve(navigate(`/conversation/${conversation.id}`)).catch((error) => {
        console.error('Navigation failed:', error);
      });
      onSessionClick?.();
    },
    [closePreview, navigate, onSessionClick]
  );

  const handleRenameSpaceStart = useCallback((space: AgentSpace) => {
    if (!space.workspacePath) {
      return;
    }

    cleanupSiderTooltips();
    blurActiveElement();
    setRenameSpaceId(space.id);
    setRenameSpaceName(space.displayName);
  }, []);

  const handleRenameSpaceCancel = useCallback(() => {
    setRenameSpaceId(null);
    setRenameSpaceName('');
  }, []);

  const handleRenameSpaceConfirm = useCallback(() => {
    const workspacePath = agentSpaces.find((space) => space.id === renameSpaceId)?.workspacePath;
    if (!workspacePath) {
      handleRenameSpaceCancel();
      return;
    }

    const trimmedName = renameSpaceName.trim();
    if (!trimmedName) {
      return;
    }

    const defaultDisplayName = getWorkspaceDisplayName(workspacePath, t);
    setAgentSpaceDisplayNames((prev) => {
      if (trimmedName === defaultDisplayName) {
        const { [workspacePath]: _removed, ...rest } = prev;
        return rest;
      }

      return {
        ...prev,
        [workspacePath]: trimmedName,
      };
    });
    handleRenameSpaceCancel();
  }, [agentSpaces, handleRenameSpaceCancel, renameSpaceId, renameSpaceName, t]);

  useEffect(() => {
    if (typeof window === 'undefined' || !workspaceAvailable) {
      return undefined;
    }
    const handleWorkspaceToggle = (event: Event) => {
      const action = (event as CustomEvent<WorkspaceToggleDetail>).detail?.action ?? 'toggle';
      setSelectedSpaceView((prev) => {
        if (action === 'expand') {
          return 'files';
        }
        if (action === 'collapse') {
          return 'chat';
        }
        return prev === 'files' ? 'chat' : 'files';
      });
    };
    window.addEventListener(WORKSPACE_TOGGLE_EVENT, handleWorkspaceToggle);
    return () => {
      window.removeEventListener(WORKSPACE_TOGGLE_EVENT, handleWorkspaceToggle);
    };
  }, [workspaceAvailable]);

  useEffect(() => {
    dispatchWorkspaceStateEvent(!showingWorkspacePanel, workspaceAvailable);
  }, [showingWorkspacePanel, workspaceAvailable]);

  return (
    <div className='size-full flex flex-col'>
      {shouldRenderSearchEntry && (
        <SiderSearchEntry
          isMobile={isMobile}
          collapsed={false}
          siderTooltipProps={siderTooltipProps}
          onConversationSelect={handleConversationSelect}
          onSessionClick={onSessionClick}
          portalTargetId={isMobile ? undefined : GLOBAL_SIDER_SEARCH_SLOT_ID}
        />
      )}
      <SiderToolbar
        isMobile={isMobile}
        collapsed={false}
        siderTooltipProps={siderTooltipProps}
        onNewChat={handleNewChat}
        onOpenFolder={handleOpenFolder}
      />
      <div className='px-8px pb-8px'>
        <div className='flex items-center gap-4px rounded-12px border border-solid border-[var(--color-border-2)] bg-[var(--color-fill-1)] p-4px'>
          {(['chat', 'files'] as const).map((mode) => {
            const active = selectedSpaceView === mode;
            const disabled = mode === 'files' && !workspaceAvailable;

            return (
              <Button
                key={mode}
                size='mini'
                type='text'
                disabled={disabled}
                className={classNames(
                  'h-28px flex-1 !rounded-8px !border-none !px-0 !text-12px !font-500 transition-colors',
                  active
                    ? '!bg-[var(--color-bg-1)] !text-[var(--color-text-1)]'
                    : '!bg-transparent !text-[var(--color-text-3)] hover:!bg-[var(--color-fill-2)] hover:!text-[var(--color-text-1)]',
                  disabled && '!text-[var(--color-text-4)] hover:!bg-transparent'
                )}
                onClick={() => handleConversationSpaceViewChange(mode)}
              >
                {mode === 'chat'
                  ? t('common.conversation', { defaultValue: '对话' })
                  : t('common.workspace', { defaultValue: '工作空间' })}
              </Button>
            );
          })}
        </div>
      </div>

      <div className={classNames('flex-1 min-h-0', showingWorkspacePanel ? 'overflow-hidden' : 'overflow-y-auto')}>
        {showingWorkspacePanel && selectedWorkspacePath ? (
          <div className='size-full min-h-0'>
            <ChatWorkspace
              conversation_id={selectedWorkspaceConversation?.id ?? selectedSpace?.id ?? TEMP_AGENT_SPACE_ID}
              workspace={selectedWorkspacePath}
              eventPrefix={workspaceEventPrefix}
            />
          </div>
        ) : (
          <AgentSpaceCards
            spaces={agentSpaces}
            selectedSpaceId={selectedSpace?.id ?? null}
            onSelectSpace={handleSpaceSelect}
            onOpenConversation={handleOpenSpaceConversation}
            onCreateConversationForSpace={handleCreateConversationForSpace}
            onOpenSpaceFolderWith={handleOpenSpaceFolderWith}
            onDeleteSpace={handleDeleteSpace}
            onRenameSpace={handleRenameSpaceStart}
            isConversationGenerating={isConversationGenerating}
            hasCompletionUnread={hasCompletionUnread}
          />
        )}
      </div>

      <DirectorySelectionModal
        visible={showDirectorySelectionModal}
        onConfirm={handleFolderSelectionConfirm}
        onCancel={() => setShowDirectorySelectionModal(false)}
      />
      <Modal
        title={t('conversation.workspace.contextMenu.renameTitle')}
        visible={Boolean(renameSpaceId)}
        onOk={handleRenameSpaceConfirm}
        onCancel={handleRenameSpaceCancel}
        okButtonProps={{ disabled: !renameSpaceName.trim() }}
      >
        <Input
          autoFocus
          value={renameSpaceName}
          onChange={setRenameSpaceName}
          onPressEnter={handleRenameSpaceConfirm}
          placeholder={t('conversation.workspace.contextMenu.renamePlaceholder')}
        />
      </Modal>
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
