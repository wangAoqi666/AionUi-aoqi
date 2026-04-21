import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { TChatConversation } from '@/common/config/storage';

const navigateMock = vi.fn();
const conversationGetMock = vi.fn();
const createWithConversationMock = vi.fn();
const openTabMock = vi.fn();
const closeTabMock = vi.fn();
const closeAllTabsMock = vi.fn();
const closeTabsToLeftMock = vi.fn();
const closeTabsToRightMock = vi.fn();
const closeOtherTabsMock = vi.fn();
const switchTabMock = vi.fn();
const updateWorkspaceTimeMock = vi.fn();
const emitterEmitMock = vi.fn();
const messageErrorMock = vi.fn();
const updateTabNameMock = vi.fn();

const openTabs = [
  {
    id: 'conv-1',
    name: 'Current Chat',
    workspace: '/workspace/demo',
    type: 'acp' as const,
  },
];

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      get: {
        invoke: (...args: unknown[]) => conversationGetMock(...args),
      },
      createWithConversation: {
        invoke: (...args: unknown[]) => createWithConversationMock(...args),
      },
    },
  },
}));

vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({
    isMobile: false,
  }),
}));

vi.mock('@/renderer/pages/conversation/hooks/ConversationTabsContext', () => ({
  useConversationTabs: () => ({
    openTabs,
    activeTabId: 'conv-1',
    switchTab: switchTabMock,
    closeTab: closeTabMock,
    closeAllTabs: closeAllTabsMock,
    closeTabsToLeft: closeTabsToLeftMock,
    closeTabsToRight: closeTabsToRightMock,
    closeOtherTabs: closeOtherTabsMock,
    openTab: openTabMock,
    updateTabName: updateTabNameMock,
  }),
}));

vi.mock('@/renderer/utils/workspace/workspaceHistory', () => ({
  updateWorkspaceTime: (...args: unknown[]) => updateWorkspaceTimeMock(...args),
}));

vi.mock('@/renderer/utils/emitter', () => ({
  emitter: {
    emit: (...args: unknown[]) => emitterEmitMock(...args),
  },
}));

vi.mock('@/renderer/utils/ui/siderTooltip', () => ({
  cleanupSiderTooltips: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      if (key === 'conversation.workspace.createNewConversation') return 'Create new chat in current workspace';
      if (key === 'conversation.welcome.newConversation') return 'New Chat';
      if (key === 'conversation.createFailed') return 'Create failed';
      if (key === 'conversation.tabs.closeOthers') return 'Close Others';
      if (key === 'conversation.tabs.closeLeft') return 'Close Left';
      if (key === 'conversation.tabs.closeRight') return 'Close Right';
      if (key === 'conversation.tabs.closeAll') return 'Close All';
      return key;
    },
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('@arco-design/web-react', () => {
  // eslint-disable-next-line unicorn/consistent-function-scoping
  const Dropdown = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  // eslint-disable-next-line unicorn/consistent-function-scoping
  const Menu = Object.assign(({ children }: { children: React.ReactNode }) => <div>{children}</div>, {
    Item: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    ItemGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  });
  // eslint-disable-next-line unicorn/consistent-function-scoping
  const Modal = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  // eslint-disable-next-line unicorn/consistent-function-scoping
  const Input = () => null;

  return {
    Dropdown,
    Menu,
    Modal,
    Input,
    Message: {
      error: (...args: unknown[]) => messageErrorMock(...args),
    },
  };
});

import ConversationTabs from '@/renderer/pages/conversation/components/ConversationTabs';

const latestConversation: TChatConversation = {
  id: 'conv-1',
  type: 'acp',
  name: 'Current Chat',
  createTime: 1,
  modifyTime: 1,
  source: 'aionui',
  extra: {
    workspace: '/workspace/demo',
    customWorkspace: true,
    backend: 'droid',
    agentName: 'Factory Droid',
    acpSessionId: 'session-1',
    acpSessionConversationId: 'conv-1',
    acpSessionUpdatedAt: 123,
    pinned: true,
    pinnedAt: 456,
    cronJobId: 'cron-1',
  },
};

describe('ConversationTabs create button', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    conversationGetMock.mockResolvedValue(latestConversation);
    createWithConversationMock.mockImplementation(async ({ conversation }: { conversation: TChatConversation }) => {
      return conversation;
    });
  });

  it('creates a new tab directly in the current workspace without showing agent choices', async () => {
    render(
      <MemoryRouter initialEntries={['/conversation/conv-1']}>
        <ConversationTabs />
      </MemoryRouter>
    );

    await act(async () => {
      fireEvent.click(screen.getByTitle('Create new chat in current workspace'));
    });

    await waitFor(() => {
      expect(conversationGetMock).toHaveBeenCalledWith({ id: 'conv-1' });
      expect(createWithConversationMock).toHaveBeenCalledTimes(1);
    });

    const createArg = createWithConversationMock.mock.calls[0][0] as { conversation: TChatConversation };
    const createdExtra = createArg.conversation.extra as {
      workspace: string;
      pinned?: boolean;
      pinnedAt?: number;
      cronJobId?: string;
      acpSessionId?: string;
      acpSessionConversationId?: string;
      acpSessionUpdatedAt?: number;
    };

    expect(createArg.conversation.id).not.toBe('conv-1');
    expect(createArg.conversation.name).toBe('New Chat');
    expect(createdExtra.workspace).toBe('/workspace/demo');
    expect(createdExtra.pinned).toBe(false);
    expect(createdExtra.pinnedAt).toBeUndefined();
    expect(createdExtra.cronJobId).toBeUndefined();
    expect(createArg.conversation.type).toBe('acp');
    expect(createdExtra.acpSessionId).toBeUndefined();
    expect(createdExtra.acpSessionConversationId).toBeUndefined();
    expect(createdExtra.acpSessionUpdatedAt).toBeUndefined();

    expect(closeAllTabsMock).not.toHaveBeenCalled();
    expect(openTabMock).toHaveBeenCalledWith(createArg.conversation);
    expect(updateWorkspaceTimeMock).toHaveBeenCalledWith('/workspace/demo');
    expect(navigateMock).toHaveBeenCalledWith(`/conversation/${createArg.conversation.id}`);
    expect(emitterEmitMock).toHaveBeenCalledWith('chat.history.refresh');
  });
});
