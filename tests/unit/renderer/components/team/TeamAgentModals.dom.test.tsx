import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockTeamCreate = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue || key,
  }),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    dialog: {
      showOpen: { invoke: vi.fn() },
    },
    team: {
      create: { invoke: (...args: unknown[]) => mockTeamCreate(...args) },
    },
  },
}));

vi.mock('@renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('@renderer/pages/conversation/hooks/useConversationAgents', () => ({
  useConversationAgents: () => ({
    cliAgents: [
      { backend: 'claude', name: 'Claude', cliPath: '/usr/bin/claude' },
      { backend: 'droid', name: 'Factory Droid', cliPath: '/usr/bin/droid' },
    ],
    presetAssistants: [],
  }),
}));

vi.mock('@renderer/utils/model/agentLogo', () => ({
  getAgentLogo: () => null,
}));

vi.mock('@/renderer/pages/guid/constants', () => ({
  CUSTOM_AVATAR_IMAGE_MAP: {},
}));

vi.mock('@icon-park/react', () => ({
  Robot: () => <span data-testid='robot-icon' />,
  FolderOpen: () => <span data-testid='folder-icon' />,
}));

vi.mock('@renderer/components/base/AionModal', () => ({
  default: ({
    visible,
    children,
    onCancel,
    footer,
    header,
  }: {
    visible: boolean;
    children: React.ReactNode;
    onCancel?: () => void;
    footer?: React.ReactNode;
    header?: React.ReactNode;
  }) =>
    visible ? (
      <div data-testid='aion-modal'>
        <div>{typeof header === 'string' ? header : header}</div>
        {children}
        {footer}
        <button onClick={onCancel}>close</button>
      </div>
    ) : null,
}));

vi.mock('@arco-design/web-react', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    loading: _loading,
    type: _type,
    icon: _icon,
    ...props
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    loading?: boolean;
    type?: string;
    icon?: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <button onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  ),
  Input: ({
    value,
    onChange,
    placeholder,
    ...props
  }: {
    value?: string;
    onChange?: (value: string) => void;
    placeholder?: string;
    [key: string]: unknown;
  }) => (
    <input value={value} placeholder={placeholder} onChange={(event) => onChange?.(event.target.value)} {...props} />
  ),
  Modal: ({
    visible,
    children,
    onCancel,
    title,
  }: {
    visible: boolean;
    children: React.ReactNode;
    onCancel?: () => void;
    title?: React.ReactNode;
  }) =>
    visible ? (
      <div data-testid='modal'>
        <div>{title}</div>
        {children}
        <button onClick={onCancel}>close</button>
      </div>
    ) : null,
  Message: {
    error: vi.fn(),
  },
}));

import AddAgentModal from '@/renderer/pages/team/components/AddAgentModal';
import TeamCreateModal from '@/renderer/pages/team/components/TeamCreateModal';

describe('team agent modals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defaults add-agent modal to Factory Droid without showing a selector', () => {
    const onConfirm = vi.fn();

    render(<AddAgentModal visible={true} onClose={vi.fn()} onConfirm={onConfirm} />);

    expect(screen.getByText('Factory Droid')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Enter agent name'), {
      target: { value: 'Analyst' },
    });
    fireEvent.click(screen.getByText('Add'));

    expect(onConfirm).toHaveBeenCalledWith({
      agentName: 'Analyst',
      agentKey: 'cli::droid',
    });
  });

  it('creates teams with Factory Droid as the hidden default dispatch agent', async () => {
    mockTeamCreate.mockResolvedValue({
      id: 'team-1',
      name: 'Operations',
      agents: [],
    });

    const onCreated = vi.fn();

    render(<TeamCreateModal visible={true} onClose={vi.fn()} onCreated={onCreated} />);

    expect(screen.getByText('Factory Droid')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Team name'), {
      target: { value: 'Operations' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Team' }));

    await waitFor(() => {
      expect(mockTeamCreate).toHaveBeenCalledTimes(1);
    });

    expect(mockTeamCreate.mock.calls[0][0]).toMatchObject({
      name: 'Operations',
      agents: [
        expect.objectContaining({
          agentType: 'droid',
          agentName: 'Factory Droid',
        }),
      ],
    });
    expect(onCreated).toHaveBeenCalled();
  });
});
