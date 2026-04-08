import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { IMessageAcpToolCall } from '@/common/chat/chatLib';
import MessageToolGroupSummary from '@/renderer/pages/conversation/Messages/components/MessageToolGroupSummary';
import { vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('MessageToolGroupSummary', () => {
  it('stays collapsed by default and expands on click', async () => {
    const message: IMessageAcpToolCall = {
      id: 'tool-1',
      msg_id: 'tool-msg-1',
      type: 'acp_tool_call',
      position: 'left',
      conversation_id: 'conv-1',
      content: {
        update: {
          toolCallId: 'call-1',
          title: 'Read',
          kind: 'read',
          status: 'completed',
          rawInput: { file_path: '/tmp/index.html' },
          content: [{ type: 'content', content: { text: 'done' } }],
        },
      },
    };

    render(<MessageToolGroupSummary messages={[message]} />);

    expect(screen.getByText('Read')).toBeInTheDocument();
    expect(screen.getByText('/tmp/index.html')).toBeInTheDocument();
    expect(screen.queryByText('Input')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('/tmp/index.html'));

    expect(screen.getAllByText('/tmp/index.html')).toHaveLength(2);
    fireEvent.click(screen.getAllByText('/tmp/index.html')[1]);

    expect(await screen.findByText('tools.labels.arguments')).toBeInTheDocument();
    expect(screen.getByText('tools.labels.result')).toBeInTheDocument();
    expect(screen.getByText(/done/)).toBeInTheDocument();
  });
});
