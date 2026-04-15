import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { GLOBAL_SIDER_SEARCH_SLOT_ID } from '@/renderer/components/layout/Sider/SiderSearchEntry';

const mockDispatchWorkspaceToggleEvent = vi.fn();
const mockShowPreviewPanel = vi.fn();
const mockHidePreviewPanel = vi.fn();
const mockNavigateToSection = vi.fn();

const mockLayout = {
  isMobile: false,
  siderCollapsed: true,
  setSiderCollapsed: vi.fn(),
  activeSection: 'conversation' as const,
  lastNonSettingsSection: 'conversation' as const,
  getSectionRoute: vi.fn(() => '/guid'),
  navigateToSection: mockNavigateToSection,
};

const mockPreviewContext: {
  isOpen: boolean;
  tabs: Array<{ id: string }>;
  showPreviewPanel: () => void;
  hidePreviewPanel: () => void;
} = {
  isOpen: false,
  tabs: [],
  showPreviewPanel: mockShowPreviewPanel,
  hidePreviewPanel: mockHidePreviewPanel,
};

vi.mock('@/common', () => ({
  ipcBridge: {
    team: {
      get: { invoke: vi.fn().mockResolvedValue(null) },
    },
    conversation: {
      get: { invoke: vi.fn().mockResolvedValue(null) },
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => mockLayout,
}));

vi.mock('@/renderer/pages/conversation/Preview', () => ({
  usePreviewContext: () => mockPreviewContext,
}));

vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: () => false,
  isMacOS: () => false,
}));

vi.mock('@/renderer/utils/workspace/workspaceEvents', () => ({
  WORKSPACE_STATE_EVENT: 'aionui-workspace-state',
  dispatchWorkspaceToggleEvent: (...args: unknown[]) => mockDispatchWorkspaceToggleEvent(...args),
}));

vi.mock('@/renderer/components/layout/WindowControls', () => ({
  default: () => <div data-testid='window-controls' />,
}));

import Titlebar from '@/renderer/components/layout/Titlebar';

const LocationProbe: React.FC = () => {
  const location = useLocation();
  return (
    <>
      <div data-testid='location-path'>{location.pathname}</div>
      <div data-testid='location-state'>{JSON.stringify(location.state ?? null)}</div>
    </>
  );
};

describe('Titlebar controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockLayout.isMobile = false;
    mockLayout.siderCollapsed = true;
    mockLayout.setSiderCollapsed = vi.fn();
    mockLayout.activeSection = 'conversation';
    mockLayout.lastNonSettingsSection = 'conversation';
    mockLayout.getSectionRoute = vi.fn(() => '/guid');
    mockPreviewContext.isOpen = false;
    mockPreviewContext.tabs = [];
  });

  it('expands the main sider before opening the conversation workspace', () => {
    render(
      <MemoryRouter initialEntries={['/conversation/conv-1']}>
        <Titlebar workspaceAvailable={true} />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByLabelText('Expand workspace'));

    expect(mockLayout.setSiderCollapsed).toHaveBeenCalledWith(false);
    expect(mockDispatchWorkspaceToggleEvent).toHaveBeenCalledWith('expand');
  });

  it('collapses the visible workspace instead of sending a blind toggle', () => {
    mockLayout.siderCollapsed = false;

    render(
      <MemoryRouter initialEntries={['/conversation/conv-1']}>
        <Titlebar workspaceAvailable={true} />
      </MemoryRouter>
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent('aionui-workspace-state', {
          detail: { collapsed: false, available: true },
        })
      );
    });

    fireEvent.click(screen.getByLabelText('Collapse workspace'));

    expect(mockLayout.setSiderCollapsed).not.toHaveBeenCalled();
    expect(mockDispatchWorkspaceToggleEvent).toHaveBeenCalledWith('collapse');
  });

  it('collapses the preview panel instead of toggling workspace when preview exists', () => {
    mockPreviewContext.isOpen = true;
    mockPreviewContext.tabs = [{ id: 'preview-1' }];

    render(
      <MemoryRouter initialEntries={['/conversation/conv-1']}>
        <Titlebar workspaceAvailable={true} />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByLabelText('Collapse panel'));

    expect(mockHidePreviewPanel).toHaveBeenCalledTimes(1);
    expect(mockDispatchWorkspaceToggleEvent).not.toHaveBeenCalled();
  });

  it('reopens the hidden preview panel from titlebar when preview tabs still exist', () => {
    mockPreviewContext.tabs = [{ id: 'preview-1' }];

    render(
      <MemoryRouter initialEntries={['/conversation/conv-1']}>
        <Titlebar workspaceAvailable={true} />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByLabelText('View in preview panel'));

    expect(mockShowPreviewPanel).toHaveBeenCalledTimes(1);
    expect(mockDispatchWorkspaceToggleEvent).not.toHaveBeenCalled();
  });

  it('uses the remembered non-settings route for the mobile settings back button', () => {
    mockLayout.isMobile = true;
    mockLayout.activeSection = 'settings';
    mockLayout.lastNonSettingsSection = 'tasks';
    mockLayout.getSectionRoute = vi.fn(() => '/scheduled/job-42');

    render(
      <MemoryRouter initialEntries={['/settings/agent']}>
        <Titlebar workspaceAvailable={false} />
        <LocationProbe />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByLabelText('Back to Chat'));

    expect(mockLayout.getSectionRoute).toHaveBeenCalledWith('tasks');
    expect(screen.getByTestId('location-path')).toHaveTextContent('/scheduled/job-42');
  });

  it('uses the selected folder workspace for the mobile new conversation button', () => {
    localStorage.setItem('conversation-selected-agent-space', 'folder:/work/project-a');
    mockLayout.isMobile = true;

    render(
      <MemoryRouter initialEntries={['/conversation/conv-1']}>
        <Titlebar workspaceAvailable={true} />
        <LocationProbe />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByLabelText('conversation.workspace.createNewConversation'));

    expect(screen.getByTestId('location-path')).toHaveTextContent('/guid');
    expect(screen.getByTestId('location-state')).toHaveTextContent('/work/project-a');
  });

  it('shows the titlebar search slot for the desktop conversation section when sider is expanded', () => {
    mockLayout.siderCollapsed = false;

    render(
      <MemoryRouter initialEntries={['/guid']}>
        <Titlebar workspaceAvailable={false} />
      </MemoryRouter>
    );

    expect(screen.getByTestId('titlebar-search-slot')).toHaveAttribute('id', GLOBAL_SIDER_SEARCH_SLOT_ID);
  });
});
