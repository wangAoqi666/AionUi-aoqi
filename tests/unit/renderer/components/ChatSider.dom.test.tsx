import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

const mockChatWorkspace = vi.fn(
  ({
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
      data-event-prefix={eventPrefix ?? 'gemini'}
    />
  )
);

vi.mock('@arco-design/web-react', () => ({
  Message: {
    useMessage: () => [{}, <div key='message-context' data-testid='message-context' />],
  },
}));

vi.mock('@/renderer/pages/conversation/Workspace', () => ({
  default: (props: { conversation_id: string; workspace: string; eventPrefix?: string }) => mockChatWorkspace(props),
}));

import type { TChatConversation } from '@/common/config/storage';
import ChatSider from '@/renderer/pages/conversation/components/ChatSider';

const makeConversation = (type: TChatConversation['type'], workspace = '/tmp/workspace'): TChatConversation =>
  ({
    id: `${type}-conversation`,
    type,
    extra: { workspace },
  }) as unknown as TChatConversation;

describe('ChatSider', () => {
  it.each([
    ['remote', 'remote'],
    ['nanobot', 'nanobot'],
    ['openclaw-gateway', 'openclaw-gateway'],
  ] as const)('mounts workspace for %s conversations with the correct event prefix', (type, eventPrefix) => {
    render(<ChatSider conversation={makeConversation(type)} />);

    expect(screen.getByTestId('message-context')).toBeInTheDocument();
    expect(screen.getByTestId('chat-workspace')).toHaveAttribute('data-event-prefix', eventPrefix);
    expect(screen.getByTestId('chat-workspace')).toHaveAttribute('data-conversation-id', `${type}-conversation`);
  });

  it('renders an empty placeholder when the conversation has no workspace', () => {
    const { container } = render(<ChatSider conversation={makeConversation('remote', '')} />);

    expect(screen.queryByTestId('chat-workspace')).not.toBeInTheDocument();
    expect(container.firstChild).toBeInstanceOf(HTMLDivElement);
  });
});
