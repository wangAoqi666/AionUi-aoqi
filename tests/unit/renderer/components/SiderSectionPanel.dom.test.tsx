import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { TChatConversation } from '@/common/config/storage';
import { Message, Modal } from '@arco-design/web-react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GLOBAL_SIDER_SEARCH_SLOT_ID } from '@/renderer/components/layout/Sider/SiderSearchEntry';

const navigateMock = vi.fn();
const closePreviewMock = vi.fn();
const dispatchWorkspaceStateEventMock = vi.fn();
const mutateActiveConversationMock = vi.fn();
const openFolderWithInvokeMock = vi.fn();
const removeConversationInvokeMock = vi.fn(async () => true);

const makeConversation = (id: string, name: string, workspace: string, customWorkspace: boolean): TChatConversation =>
  ({
    id,
    name,
    type: 'acp',
    createTime: 0,
    modifyTime: 0,
    extra: {
      workspace,
      customWorkspace,
      backend: 'claude',
    },
  }) as unknown as TChatConversation;

const tempConversation = makeConversation('conv-temp-1', 'Temp 1', '/tmp/claude-temp-1000', false);
const folderConversation1 = makeConversation('conv-folder-1', 'Folder 1', '/work/project-a', true);
const folderConversation2 = makeConversation('conv-folder-2', 'Folder 2', '/work/project-a', true);

let activeConversation: TChatConversation | undefined = folderConversation1;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('swr', () => ({
  default: () => ({
    data: activeConversation,
    mutate: mutateActiveConversationMock,
  }),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      get: { invoke: vi.fn() },
      listChanged: { on: vi.fn(() => vi.fn()) },
      remove: { invoke: (...args: unknown[]) => removeConversationInvokeMock(...args) },
    },
    dialog: {
      showOpen: { invoke: vi.fn() },
    },
    shell: {
      openFolderWith: { invoke: (...args: unknown[]) => openFolderWithInvokeMock(...args) },
    },
  },
}));

vi.mock('@renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({
    isMobile: false,
  }),
}));

vi.mock('@renderer/hooks/context/ConversationHistoryContext', () => ({
  useConversationHistoryContext: () => ({
    conversations: [tempConversation, folderConversation1, folderConversation2],
    isConversationGenerating: () => false,
    hasCompletionUnread: () => false,
  }),
}));

vi.mock('@renderer/pages/conversation/Preview/context/PreviewContext', () => ({
  usePreviewContext: () => ({
    closePreview: closePreviewMock,
  }),
}));

vi.mock('@renderer/utils/platform', () => ({
  isElectronDesktop: () => false,
}));

vi.mock('@renderer/utils/workspace/workspaceEvents', () => ({
  WORKSPACE_TOGGLE_EVENT: 'aionui-workspace-toggle',
  dispatchWorkspaceStateEvent: (...args: unknown[]) => dispatchWorkspaceStateEventMock(...args),
}));

vi.mock('@renderer/pages/conversation/Workspace', () => ({
  default: ({
    conversation_id,
    workspace,
    eventPrefix,
  }: {
    conversation_id: string;
    workspace: string;
    eventPrefix?: string;
  }) => (
    <div
      data-testid='chat-workspace'
      data-conversation-id={conversation_id}
      data-workspace={workspace}
      data-event-prefix={eventPrefix}
    />
  ),
}));

vi.mock('@renderer/pages/conversation/components/ChatSider', () => ({
  WORKSPACE_EVENT_PREFIX_BY_TYPE: {
    acp: 'acp',
  },
}));

vi.mock('@/renderer/components/settings/DirectorySelectionModal', () => ({
  default: ({ visible, onConfirm }: { visible: boolean; onConfirm: (paths: string[] | undefined) => void }) =>
    visible ? (
      <button type='button' onClick={() => onConfirm(['/work/project-b'])}>
        confirm-directory
      </button>
    ) : null,
}));

vi.mock('@/renderer/components/layout/Sider/SiderToolbar', () => ({
  default: ({ onNewChat, onOpenFolder }: { onNewChat: () => void; onOpenFolder: () => void }) => (
    <div data-testid='sider-toolbar'>
      <button type='button' onClick={onNewChat}>
        toolbar-new
      </button>
      <button type='button' onClick={onOpenFolder}>
        toolbar-open-folder
      </button>
    </div>
  ),
}));

vi.mock('@renderer/pages/conversation/GroupedHistory/ConversationSearchPopover', () => ({
  default: ({ label }: { label?: string }) => <div data-testid='sider-search'>{label ?? 'search'}</div>,
}));

vi.mock('@/renderer/components/layout/Sider/ScheduledSectionPanel', () => ({
  default: () => <div data-testid='scheduled-panel' />,
}));

vi.mock('@renderer/pages/settings/components/SettingsSider', () => ({
  default: () => <div data-testid='settings-sider' />,
}));

import Sider from '@/renderer/components/layout/Sider';

const renderConversationSider = (initialEntries: string[] = ['/conversation/conv-folder-1']) =>
  render(
    <div>
      <div id={GLOBAL_SIDER_SEARCH_SLOT_ID} data-testid='global-search-slot' />
      <MemoryRouter initialEntries={initialEntries}>
        <Sider section='conversation' />
      </MemoryRouter>
    </div>
  );

const clickFirstTextMatch = (text: string) => {
  const match = screen.getAllByText(text)[0];
  if (!match) {
    throw new Error(`No element found for text: ${text}`);
  }
  fireEvent.click(match);
};

const clickFirstButtonByText = (text: string) => {
  const button = screen
    .getAllByText(text)
    .map((node) => node.closest('button'))
    .find((element): element is HTMLButtonElement => Boolean(element));

  if (!button) {
    throw new Error(`No button found for text: ${text}`);
  }

  fireEvent.click(button);
};

describe('conversation Sider section panel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    activeConversation = folderConversation1;
  });

  it('defaults to the active folder card and shows a compact preview for its recent conversations', () => {
    renderConversationSider();

    expect(screen.getByText('Folder 1')).toBeInTheDocument();
    expect(screen.getByText('Folder 2')).toBeInTheDocument();
    expect(screen.getAllByText('/work/project-a').length).toBeGreaterThan(0);
    expect(screen.queryByText('Temp 1')).not.toBeInTheDocument();
  });

  it('renders the search entry into the titlebar search slot on desktop', () => {
    renderConversationSider();

    expect(within(screen.getByTestId('global-search-slot')).getByTestId('sider-search')).toBeInTheDocument();
  });

  it('switches the expanded preview when the temp space card is clicked', () => {
    renderConversationSider();

    clickFirstTextMatch('conversation.workspace.temporarySpace');

    expect(screen.getByText('Temp 1')).toBeInTheDocument();
    expect(screen.queryByText('Folder 1')).not.toBeInTheDocument();
  });

  it('opens the selected folder workspace view when switching to the workspace tab', () => {
    renderConversationSider();

    clickFirstButtonByText('工作空间');

    expect(screen.getByTestId('chat-workspace')).toHaveAttribute('data-workspace', '/work/project-a');
    expect(screen.getByTestId('chat-workspace')).toHaveAttribute('data-conversation-id', 'conv-folder-1');
  });

  it('allows the temp space to open its temporary workspace view', () => {
    renderConversationSider();

    clickFirstTextMatch('conversation.workspace.temporarySpace');
    clickFirstButtonByText('工作空间');

    expect(screen.getByTestId('chat-workspace')).toHaveAttribute('data-workspace', '/tmp/claude-temp-1000');
    expect(screen.getByTestId('chat-workspace')).toHaveAttribute('data-conversation-id', 'conv-temp-1');
  });

  it('uses the selected folder workspace for the toolbar new-conversation action', () => {
    renderConversationSider();

    fireEvent.click(screen.getByText('toolbar-new'));

    expect(navigateMock).toHaveBeenCalledWith('/guid', {
      state: { workspace: '/work/project-a' },
    });
  });

  it('adds explicitly opened folders to the space list even before they have conversations', () => {
    activeConversation = undefined;

    renderConversationSider(['/guid']);

    fireEvent.click(screen.getByText('toolbar-open-folder'));
    fireEvent.click(screen.getByText('confirm-directory'));

    expect(screen.getAllByText('/work/project-b').length).toBeGreaterThan(0);
  });

  it('allows renaming a folder display name while preserving its workspace path', async () => {
    renderConversationSider();

    fireEvent.contextMenu(screen.getAllByText('/work/project-a')[0] as HTMLElement);
    fireEvent.click(await screen.findByText('conversation.history.rename'));

    const input = await screen.findByPlaceholderText('conversation.workspace.contextMenu.renamePlaceholder');
    fireEvent.change(input, { target: { value: '合同智能体' } });
    const confirmButton = document.body.querySelector('.arco-btn-primary');
    if (!(confirmButton instanceof HTMLButtonElement)) {
      throw new Error('Rename confirm button not found');
    }
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(screen.getByText('合同智能体')).toBeInTheDocument();
    });
    expect(screen.getAllByText('/work/project-a').length).toBeGreaterThan(0);
    expect(localStorage.getItem('conversation-agent-space-display-names')).toContain('合同智能体');
  });

  it('offers folder context actions to open the workspace from the project card', async () => {
    renderConversationSider();

    fireEvent.contextMenu(screen.getAllByText('/work/project-a')[0] as HTMLElement);
    fireEvent.click(await screen.findByText('conversation.workspace.contextMenu.openFolder'));

    await waitFor(() => {
      expect(openFolderWithInvokeMock).toHaveBeenCalledWith({
        folderPath: '/work/project-a',
        tool: 'explorer',
      });
    });
  });

  it('offers a delete action for the folder card menu', async () => {
    const confirmSpy = vi.spyOn(Modal, 'confirm').mockImplementation((config) => {
      void config.onOk?.();
      return {} as never;
    });
    const messageSuccessSpy = vi.spyOn(Message, 'success').mockImplementation(() => undefined as never);
    const messageErrorSpy = vi.spyOn(Message, 'error').mockImplementation(() => undefined as never);

    renderConversationSider();

    fireEvent.contextMenu(screen.getAllByText('/work/project-a')[0] as HTMLElement);
    fireEvent.click(await screen.findByText('common.delete'));

    await waitFor(() => {
      expect(removeConversationInvokeMock).toHaveBeenCalledTimes(2);
    });
    expect(removeConversationInvokeMock).toHaveBeenNthCalledWith(1, { id: 'conv-folder-1' });
    expect(removeConversationInvokeMock).toHaveBeenNthCalledWith(2, { id: 'conv-folder-2' });

    confirmSpy.mockRestore();
    messageSuccessSpy.mockRestore();
    messageErrorSpy.mockRestore();
  });

  it('opens the clicked preview conversation from the selected project card', () => {
    renderConversationSider();

    fireEvent.click(screen.getByText('Folder 2'));

    expect(navigateMock).toHaveBeenCalledWith('/conversation/conv-folder-2');
  });
});
