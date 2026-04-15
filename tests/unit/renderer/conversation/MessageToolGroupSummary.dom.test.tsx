import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { IMessageAcpToolCall } from '@/common/chat/chatLib';
import type { AssistantActivityItem } from '@/renderer/pages/conversation/Messages/listProcessing';
import {
  getConversationMessageRowClassName,
  MessageActivitySummaryCard,
} from '@/renderer/pages/conversation/Messages/MessageList';
import MessageToolGroupSummary from '@/renderer/pages/conversation/Messages/components/MessageToolGroupSummary';
import { vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('MessageToolGroupSummary', () => {
  it('renders tool items directly and expands inline details on click', async () => {
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
    expect(screen.queryByText('tools.labels.arguments')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('/tmp/index.html'));

    expect(await screen.findByText('tools.labels.arguments')).toBeInTheDocument();
    expect(screen.getByText('tools.labels.result')).toBeInTheDocument();
    expect(screen.getByText(/done/)).toBeInTheDocument();
  });

  it('renders a flat second layer inside the activity box for multiple assistant activities', () => {
    const toolMessage: IMessageAcpToolCall = {
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
        },
      },
    };

    const activities: AssistantActivityItem[] = [
      {
        id: 'thinking-1',
        msg_id: 'thinking-msg-1',
        type: 'thinking',
        position: 'left',
        conversation_id: 'conv-1',
        content: {
          content: '先确认 HTML 结构',
          subject: '分析需求',
          status: 'thinking',
        },
      },
      {
        type: 'tool_summary',
        id: 'tool-summary-1',
        messages: [toolMessage],
        sourceMessageIds: ['tool-1'],
      },
    ];

    render(<MessageActivitySummaryCard activities={activities} />);

    expect(screen.getByText('common.processing')).toBeInTheDocument();
    expect(screen.getByText('Read · /tmp/index.html')).toBeInTheDocument();
    expect(screen.queryByText('分析需求')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByText('分析需求')).toBeInTheDocument();
    expect(screen.getByText('Read')).toBeInTheDocument();
    expect(screen.getAllByText('/tmp/index.html').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('uses full-width message rows so bubbles can align to pane edges', () => {
    const assistantRowClassName = getConversationMessageRowClassName('left', 'text');
    const userRowClassName = getConversationMessageRowClassName('right', 'text');

    expect(assistantRowClassName).toContain('w-full');
    expect(assistantRowClassName).toContain('justify-start');
    expect(assistantRowClassName).not.toContain('mx-auto');
    expect(assistantRowClassName).not.toContain('md:max-w-860px');
    expect(userRowClassName).toContain('justify-end');
    expect(userRowClassName).toContain('message-item--user');
  });
});
