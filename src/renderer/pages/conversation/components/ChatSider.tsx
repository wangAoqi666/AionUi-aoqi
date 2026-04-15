/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import ChatWorkspace from '@/renderer/pages/conversation/Workspace';
import type { WorkspaceEventPrefix } from '@/renderer/pages/conversation/Workspace/types';
import { Message } from '@arco-design/web-react';
import React from 'react';

export const WORKSPACE_EVENT_PREFIX_BY_TYPE: Partial<Record<TChatConversation['type'], WorkspaceEventPrefix>> = {
  gemini: 'gemini',
  acp: 'acp',
  codex: 'codex',
  aionrs: 'aionrs',
  remote: 'remote',
  nanobot: 'nanobot',
  'openclaw-gateway': 'openclaw-gateway',
};

const ChatSider: React.FC<{
  conversation?: TChatConversation;
}> = ({ conversation }) => {
  const [messageApi, messageContext] = Message.useMessage({ maxCount: 1 });

  const workspace = conversation?.extra?.workspace;
  const eventPrefix = conversation ? WORKSPACE_EVENT_PREFIX_BY_TYPE[conversation.type] : undefined;

  const workspaceNode =
    conversation && workspace && eventPrefix ? (
      <ChatWorkspace
        conversation_id={conversation.id}
        workspace={workspace}
        eventPrefix={eventPrefix}
        messageApi={messageApi}
      ></ChatWorkspace>
    ) : null;

  if (!workspaceNode) {
    return <div></div>;
  }

  return (
    <>
      {messageContext}
      {workspaceNode}
    </>
  );
};

export default ChatSider;
