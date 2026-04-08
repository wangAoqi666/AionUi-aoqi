import { render } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLayout = {
  isMobile: false,
  siderCollapsed: false,
  setSiderCollapsed: vi.fn(),
};

const mockPreviewContext = {
  isOpen: true,
};

const mockUpdateTabName = vi.fn();
const mockSetRightSiderCollapsed = vi.fn();

vi.mock('@/common/config/storage', () => ({
  ConfigStorage: {
    get: vi.fn(),
  },
}));

vi.mock('@/renderer/components/agent/AgentModeSelector', () => ({
  default: () => <div data-testid='agent-mode-selector' />,
}));

vi.mock('@/renderer/components/layout/FlexFullContainer', () => ({
  default: ({
    children,
    className,
    containerClassName,
  }: React.PropsWithChildren<{ className?: string; containerClassName?: string }>) => (
    <div className={className}>
      <div className={containerClassName}>{children}</div>
    </div>
  ),
}));

vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => mockLayout,
}));

vi.mock('@/renderer/hooks/ui/useResizableSplit', () => ({
  useResizableSplit: ({ defaultWidth }: { defaultWidth: number }) => ({
    splitRatio: defaultWidth,
    setSplitRatio: vi.fn(),
    createDragHandle: () => null,
  }),
}));

vi.mock('@/renderer/pages/conversation/components/ConversationTabs', () => ({
  default: () => <div data-testid='conversation-tabs' />,
}));

vi.mock('@/renderer/pages/conversation/components/ChatTitleEditor', () => ({
  default: () => <div data-testid='chat-title-editor' />,
}));

vi.mock('@/renderer/pages/conversation/components/ConversationTitleMinimap', () => ({
  default: () => <div data-testid='conversation-title-minimap' />,
}));

vi.mock('@/renderer/pages/conversation/components/ChatLayout/MobileWorkspaceOverlay', () => ({
  default: () => <div data-testid='mobile-workspace-overlay' />,
}));

vi.mock('@/renderer/pages/conversation/components/ChatLayout/WorkspacePanelHeader', () => ({
  default: ({ children }: React.PropsWithChildren) => <div data-testid='workspace-panel-header'>{children}</div>,
  DesktopWorkspaceToggle: () => <div data-testid='desktop-workspace-toggle' />,
}));

vi.mock('@/renderer/pages/conversation/hooks/ConversationTabsContext', () => ({
  useConversationTabs: () => ({
    openTabs: [],
    updateTabName: mockUpdateTabName,
  }),
}));

vi.mock('@/renderer/pages/conversation/hooks/useContainerWidth', () => ({
  useContainerWidth: () => ({
    containerRef: { current: null },
    containerWidth: 1200,
  }),
}));

vi.mock('@/renderer/pages/conversation/hooks/useLayoutConstraints', () => ({
  useLayoutConstraints: vi.fn(),
}));

vi.mock('@/renderer/pages/conversation/hooks/usePreviewAutoCollapse', () => ({
  usePreviewAutoCollapse: vi.fn(),
}));

vi.mock('@/renderer/pages/conversation/hooks/useTitleRename', () => ({
  useTitleRename: () => ({
    editingTitle: false,
    setEditingTitle: vi.fn(),
    titleDraft: 'Conversation',
    setTitleDraft: vi.fn(),
    renameLoading: false,
    canRenameTitle: true,
    submitTitleRename: vi.fn(),
  }),
}));

vi.mock('@/renderer/pages/conversation/hooks/useWorkspaceCollapse', () => ({
  useWorkspaceCollapse: () => ({
    rightSiderCollapsed: false,
    setRightSiderCollapsed: mockSetRightSiderCollapsed,
  }),
}));

vi.mock('@/renderer/pages/conversation/Preview', () => ({
  PreviewPanel: () => <div data-testid='preview-panel' />,
  usePreviewContext: () => mockPreviewContext,
}));

vi.mock('@/renderer/utils/workspace/workspaceEvents', () => ({
  dispatchWorkspaceToggleEvent: vi.fn(),
}));

vi.mock('@/common/types/acpTypes', () => ({
  ACP_BACKENDS_ALL: {},
}));

vi.mock('@/renderer/pages/conversation/utils/detectPlatform', () => ({
  isMacEnvironment: () => false,
  isWindowsEnvironment: () => false,
}));

vi.mock('@/renderer/pages/conversation/utils/layoutCalc', () => ({
  MIN_WORKSPACE_RATIO: 20,
  WORKSPACE_HEADER_HEIGHT: 44,
  calcLayoutMetrics: () => ({
    dynamicChatMinRatio: 40,
    dynamicChatMaxRatio: 80,
    chatFlex: 60,
    workspaceFlex: 40,
    workspaceWidthPx: 320,
    titleAreaMaxWidth: 420,
    mobileWorkspaceHandleRight: 48,
  }),
}));

vi.mock('@arco-design/web-react', () => {
  const Layout = Object.assign(
    ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
    {
      Header: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
      Content: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
    }
  );

  return { Layout };
});

vi.mock('swr', () => ({
  default: () => ({ data: null }),
}));

import ChatLayout from '@/renderer/pages/conversation/components/ChatLayout';

describe('ChatLayout preview shell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLayout.isMobile = false;
    mockPreviewContext.isOpen = true;
  });

  it('removes the extra desktop preview margins so the preview fills its split area', () => {
    const { container } = render(
      <ChatLayout
        title='Conversation'
        sider={<div>Workspace</div>}
        workspaceEnabled={false}
        conversationId='conv-1'
        backend='droid'
        agentName='Factory Droid'
      >
        <div>Body</div>
      </ChatLayout>
    );

    const previewShell = container.querySelector('.chat-layout-preview-pane');

    expect(previewShell).toBeTruthy();
    expect(previewShell?.className).not.toContain('my-[12px]');
    expect(previewShell?.className).not.toContain('mr-[12px]');
    expect(previewShell?.className).not.toContain('ml-[8px]');
    expect(previewShell?.className).not.toContain('m-[8px]');
  });

  it('keeps the mobile preview inset spacing', () => {
    mockLayout.isMobile = true;

    const { container } = render(
      <ChatLayout title='Conversation' sider={<div>Workspace</div>} workspaceEnabled={false} conversationId='conv-1'>
        <div>Body</div>
      </ChatLayout>
    );

    const previewShell = container.querySelector('.chat-layout-preview-pane');

    expect(previewShell).toBeTruthy();
    expect(previewShell?.className).toContain('m-[8px]');
  });

  it('does not render the preview shell when the preview is closed', () => {
    mockPreviewContext.isOpen = false;

    const { container } = render(
      <ChatLayout title='Conversation' sider={<div>Workspace</div>} workspaceEnabled={false} conversationId='conv-1'>
        <div>Body</div>
      </ChatLayout>
    );

    expect(container.querySelector('.chat-layout-preview-pane')).toBeNull();
  });
});
