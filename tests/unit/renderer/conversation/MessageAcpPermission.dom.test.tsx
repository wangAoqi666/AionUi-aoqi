import React from 'react';
import { render, screen } from '@testing-library/react';
import type { IMessageAcpPermission } from '@/common/chat/chatLib';
import MessageAcpPermission from '@/renderer/pages/conversation/Messages/acp/MessageAcpPermission';

const confirmInvokeMock = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  conversation: {
    confirmMessage: {
      invoke: confirmInvokeMock,
    },
  },
}));

vi.mock('@/renderer/components/Markdown', () => ({
  __esModule: true,
  default: ({ children }: { children: string }) => <div data-testid='markdown-view'>{children}</div>,
}));

describe('MessageAcpPermission', () => {
  beforeEach(() => {
    confirmInvokeMock.mockReset();
  });

  it('renders spec reviews as read-only markdown cards', () => {
    const message: IMessageAcpPermission = {
      id: 'permission-1',
      msg_id: 'permission-1',
      type: 'acp_permission',
      position: 'left',
      conversation_id: 'conv-1',
      content: {
        sessionId: 'session-1',
        toolCall: {
          toolCallId: 'spec-call',
          title: 'Specification Review',
          kind: 'exit_spec_mode',
          rawInput: {
            plan: '# Plan\n\n- Review the implementation steps',
          },
        },
        options: [{ optionId: 'proceed_once', name: 'Proceed', kind: 'allow_once' }],
      },
    };

    render(<MessageAcpPermission message={message} />);

    expect(screen.getByText('Specification Review')).toBeInTheDocument();
    expect(screen.getByTestId('markdown-view')).toHaveTextContent('Review the implementation steps');
    expect(screen.queryByText('messages.chooseAction')).toBeNull();
    expect(screen.queryByRole('button', { name: 'messages.confirm' })).toBeNull();
  });

  it('keeps action controls for normal permissions', () => {
    const message: IMessageAcpPermission = {
      id: 'permission-2',
      msg_id: 'permission-2',
      type: 'acp_permission',
      position: 'left',
      conversation_id: 'conv-1',
      content: {
        sessionId: 'session-1',
        toolCall: {
          toolCallId: 'exec-call',
          title: 'python3',
          kind: 'execute',
          rawInput: {
            command: 'python3 -V',
          },
        },
        options: [{ optionId: 'proceed_once', name: 'Proceed', kind: 'allow_once' }],
      },
    };

    render(<MessageAcpPermission message={message} />);

    expect(screen.getByText('messages.chooseAction')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'messages.confirm' })).toBeInTheDocument();
  });
});
