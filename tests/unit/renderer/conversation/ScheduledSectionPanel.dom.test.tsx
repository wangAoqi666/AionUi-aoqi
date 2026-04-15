import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ICronJob } from '@/common/adapter/ipcBridge';
import type { TChatConversation } from '@/common/config/storage';

const mockNavigate = vi.hoisted(() => vi.fn());
const mockLocationState = vi.hoisted(() => ({ pathname: '/scheduled', search: '' }));
const mockConversationUpdate = vi.hoisted(() => vi.fn());
const mockConversationHistory = vi.hoisted(() => vi.fn(() => undefined));
const mockUseAllCronJobs = vi.hoisted(() => vi.fn(() => ({ jobs: [], loading: false })));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => mockLocationState,
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      update: { invoke: (...args: unknown[]) => mockConversationUpdate(...args) },
    },
  },
}));

vi.mock('@renderer/hooks/context/ConversationHistoryContext', () => ({
  useOptionalConversationHistoryContext: () => mockConversationHistory(),
}));

vi.mock('@renderer/pages/cron/useCronJobs', () => ({
  useAllCronJobs: () => mockUseAllCronJobs(),
}));

vi.mock('@arco-design/web-react', () => ({
  Button: ({
    children,
    onClick,
    icon,
    'aria-label': ariaLabel,
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    icon?: React.ReactNode;
    'aria-label'?: string;
  }) => (
    <button type='button' onClick={onClick} aria-label={ariaLabel}>
      {icon}
      {children}
    </button>
  ),
}));

vi.mock('@icon-park/react', () => ({
  Down: () => <span data-testid='icon-down' />,
  Plus: () => <span data-testid='icon-plus' />,
  Right: () => <span data-testid='icon-right' />,
}));

vi.mock('@renderer/pages/cron/ScheduledTasksPage/CreateTaskDialog', () => ({
  default: ({ visible }: { visible: boolean }) => (visible ? <div data-testid='create-task-dialog' /> : null),
}));

const createConversation = (id: string, name: string, workspace: string, customWorkspace: boolean): TChatConversation =>
  ({
    id,
    name,
    type: 'acp',
    createTime: 1,
    modifyTime: 2,
    extra: {
      workspace,
      customWorkspace,
      backend: 'claude',
    },
  }) as TChatConversation;

const createJob = (id: string, name: string, conversationId: string): ICronJob =>
  ({
    id,
    name,
    enabled: true,
    schedule: {
      kind: 'cron',
      expr: '0 9 * * *',
      description: 'Every day at 09:00',
    },
    target: {
      payload: { kind: 'message', text: 'Run task' },
      executionMode: 'existing',
    },
    metadata: {
      conversationId,
      conversationTitle: name,
      agentType: 'claude',
      createdBy: 'user',
      createdAt: 1,
      updatedAt: 2,
    },
    state: {
      runCount: 0,
      retryCount: 0,
      maxRetries: 3,
    },
  }) as ICronJob;

describe('ScheduledSectionPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLocationState.pathname = '/scheduled';
    mockLocationState.search = '';
    mockConversationHistory.mockReturnValue(undefined);
    mockUseAllCronJobs.mockReturnValue({ jobs: [], loading: false });
  });

  it('reveals conversations and jobs progressively like a tree', async () => {
    mockConversationHistory.mockReturnValue({
      conversations: [createConversation('conv-folder', 'Project Alpha', '/project-alpha', true)],
    });
    mockUseAllCronJobs.mockReturnValue({
      jobs: [createJob('job-folder', 'Daily Summary', 'conv-folder')],
    });

    const { default: ScheduledSectionPanel } = await import('@/renderer/components/layout/Sider/ScheduledSectionPanel');
    render(<ScheduledSectionPanel />);

    expect(screen.queryByText('Project Alpha')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('common.expandMore'));

    await waitFor(() => {
      expect(screen.getByText('Project Alpha')).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByLabelText('common.expandMore')[0]);

    await waitFor(() => {
      expect(screen.getByText('Daily Summary')).toBeInTheDocument();
    });
  });

  it('navigates temporary space clicks to the temp-space filter route', async () => {
    mockConversationHistory.mockReturnValue({
      conversations: [
        createConversation('conv-temp', 'Temp Conversation', '/tmp-workspace', false),
        createConversation('conv-folder', 'Folder Conversation', '/project-alpha', true),
      ],
    });
    mockUseAllCronJobs.mockReturnValue({
      jobs: [createJob('job-temp', 'Temp Task', 'conv-temp'), createJob('job-folder', 'Folder Task', 'conv-folder')],
    });

    const { default: ScheduledSectionPanel } = await import('@/renderer/components/layout/Sider/ScheduledSectionPanel');
    render(<ScheduledSectionPanel />);

    fireEvent.click(screen.getByText('conversation.workspace.temporarySpace'));

    expect(mockNavigate).toHaveBeenCalledWith('/scheduled?space=temp');
  });

  it('cleans stale cron markers so owner conversations are restored after task deletion', async () => {
    mockConversationHistory.mockReturnValue({
      conversations: [
        {
          ...createConversation('conv-stale', 'Recovered Conversation', '/project-alpha', true),
          extra: {
            workspace: '/project-alpha',
            customWorkspace: true,
            backend: 'claude',
            cronJobId: 'deleted-job',
          },
        },
      ],
    });
    mockUseAllCronJobs.mockReturnValue({ jobs: [], loading: false });

    const { default: ScheduledSectionPanel } = await import('@/renderer/components/layout/Sider/ScheduledSectionPanel');
    render(<ScheduledSectionPanel />);

    await waitFor(() => {
      expect(mockConversationUpdate).toHaveBeenCalledWith({
        id: 'conv-stale',
        updates: {
          extra: {
            workspace: '/project-alpha',
            customWorkspace: true,
            backend: 'claude',
          },
        },
      });
    });
  });

  it('waits for the initial job load before cleaning cron markers', async () => {
    mockConversationHistory.mockReturnValue({
      conversations: [
        {
          ...createConversation('conv-run', 'Active Cron Conversation', '/project-alpha', true),
          extra: {
            workspace: '/project-alpha',
            customWorkspace: true,
            backend: 'claude',
            cronJobId: 'job-active',
          },
        },
      ],
    });
    mockUseAllCronJobs.mockReturnValue({ jobs: [], loading: true });

    const { default: ScheduledSectionPanel } = await import('@/renderer/components/layout/Sider/ScheduledSectionPanel');
    render(<ScheduledSectionPanel />);

    await waitFor(() => {
      expect(mockConversationUpdate).not.toHaveBeenCalled();
    });
  });

  it('keeps active cron-run conversations attached to their job history', async () => {
    const { getCronMarkerCleanupConversations } = await import('@renderer/pages/cron/cronOwnership');

    const cleanupTargets = getCronMarkerCleanupConversations(
      [
        createConversation('conv-owner', 'Owner Conversation', '/project-alpha', true),
        {
          ...createConversation('conv-run', 'Active Cron Conversation', '/project-alpha', true),
          extra: {
            workspace: '/project-alpha',
            customWorkspace: true,
            backend: 'claude',
            cronJobId: 'job-active',
          },
        },
      ],
      [createJob('job-active', 'Active Task', 'conv-owner')]
    );

    expect(cleanupTargets).toEqual([]);
  });
});
