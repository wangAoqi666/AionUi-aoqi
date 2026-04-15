import type { TMessage } from '@/common/chat/chatLib';
import {
  buildProcessedMessageList,
  matchesTargetMessage,
  matchesTargetMsgId,
} from '@/renderer/pages/conversation/Messages/listProcessing';

describe('buildProcessedMessageList', () => {
  it('groups thinking and tool activity into the following assistant turn', () => {
    const messages = [
      {
        id: 'user-1',
        type: 'text',
        position: 'right',
        conversation_id: 'conv-1',
        content: { content: '帮我写个 HTML' },
      },
      {
        id: 'thinking-1',
        msg_id: 'thinking-msg',
        type: 'thinking',
        position: 'left',
        conversation_id: 'conv-1',
        content: { content: '先确认需求', subject: '分析需求', status: 'thinking' as const },
      },
      {
        id: 'tool-1',
        msg_id: 'tool-msg',
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
      },
      {
        id: 'assistant-1',
        msg_id: 'assistant-msg',
        type: 'text',
        position: 'left',
        conversation_id: 'conv-1',
        content: { content: '我已经创建好了 HTML 文件。' },
      },
    ] as TMessage[];

    const processed = buildProcessedMessageList(messages);

    expect(processed).toHaveLength(2);
    expect(processed[0]).toMatchObject({ id: 'user-1', type: 'text' });
    expect(processed[1]).toMatchObject({
      type: 'assistant_turn',
      message: { id: 'assistant-1', type: 'text' },
      sourceMessageIds: ['thinking-1', 'tool-1', 'assistant-1'],
    });
    if (processed[1].type !== 'assistant_turn') {
      throw new Error('Expected assistant_turn');
    }
    expect(processed[1].activities.map((activity) => activity.type)).toEqual(['thinking', 'tool_summary']);
  });

  it('keeps live activity visible even before assistant text arrives', () => {
    const messages = [
      {
        id: 'thinking-1',
        msg_id: 'thinking-msg',
        type: 'thinking',
        position: 'left',
        conversation_id: 'conv-1',
        content: { content: '正在分析中', subject: '分析需求', status: 'thinking' as const },
      },
    ] as TMessage[];

    const processed = buildProcessedMessageList(messages);

    expect(processed).toEqual([
      {
        type: 'activity_group',
        id: 'activity-thinking-1',
        activities: [messages[0]],
        sourceMessageIds: ['thinking-1'],
      },
    ]);
  });

  it('groups file summaries into the same assistant turn', () => {
    const messages = [
      {
        id: 'diff-1',
        type: 'codex_tool_call',
        position: 'left',
        conversation_id: 'conv-1',
        content: {
          subtype: 'turn_diff',
          data: {
            unified_diff: ['--- a/index.html', '+++ b/index.html', '@@ -0,0 +1 @@', '+<h1>Hello</h1>'].join('\n'),
          },
        },
      },
      {
        id: 'assistant-1',
        msg_id: 'assistant-msg',
        type: 'text',
        position: 'left',
        conversation_id: 'conv-1',
        content: { content: '文件已经更新。' },
      },
    ] as TMessage[];

    const processed = buildProcessedMessageList(messages);

    expect(processed).toHaveLength(1);
    expect(processed[0]).toMatchObject({
      type: 'assistant_turn',
      sourceMessageIds: ['diff-1', 'assistant-1'],
    });
    if (processed[0].type !== 'assistant_turn') {
      throw new Error('Expected assistant_turn');
    }
    expect(processed[0].activities.map((activity) => activity.type)).toEqual(['file_summary']);
    expect(matchesTargetMessage(processed[0], 'diff-1')).toBe(true);
  });

  it('keeps file summaries visible in a live activity group before assistant text arrives', () => {
    const messages = [
      {
        id: 'diff-1',
        type: 'codex_tool_call',
        position: 'left',
        conversation_id: 'conv-1',
        content: {
          subtype: 'turn_diff',
          data: {
            unified_diff: ['--- a/index.html', '+++ b/index.html', '@@ -0,0 +1 @@', '+<h1>Hello</h1>'].join('\n'),
          },
        },
      },
    ] as TMessage[];

    const processed = buildProcessedMessageList(messages);

    expect(processed).toHaveLength(1);
    expect(processed[0]).toMatchObject({
      type: 'activity_group',
      sourceMessageIds: ['diff-1'],
    });
    if (processed[0].type !== 'activity_group') {
      throw new Error('Expected activity_group');
    }
    expect(processed[0].activities.map((activity) => activity.type)).toEqual(['file_summary']);
  });

  it('matches grouped activity by both message id and msg_id', () => {
    const messages = [
      {
        id: 'thinking-1',
        msg_id: 'thinking-msg',
        type: 'thinking',
        position: 'left',
        conversation_id: 'conv-1',
        content: { content: '正在分析中', subject: '分析需求', status: 'thinking' as const },
      },
      {
        id: 'assistant-1',
        msg_id: 'assistant-msg',
        type: 'text',
        position: 'left',
        conversation_id: 'conv-1',
        content: { content: '我已经处理好了。' },
      },
    ] as TMessage[];

    const processed = buildProcessedMessageList(messages);

    expect(processed).toHaveLength(1);
    expect(matchesTargetMessage(processed[0], 'assistant-1')).toBe(true);
    expect(matchesTargetMessage(processed[0], 'thinking-1')).toBe(true);
    expect(matchesTargetMsgId(processed[0], 'assistant-msg')).toBe(true);
    expect(matchesTargetMsgId(processed[0], 'thinking-msg')).toBe(true);
  });

  it('merges assistant text before and after tool activity into one turn with line breaks', () => {
    const messages = [
      {
        id: 'assistant-1',
        msg_id: 'assistant-msg-1',
        type: 'text',
        position: 'left',
        conversation_id: 'conv-1',
        content: { content: 'Step 1: Search the workspace.' },
      },
      {
        id: 'tool-1',
        msg_id: 'tool-msg-1',
        type: 'acp_tool_call',
        position: 'left',
        conversation_id: 'conv-1',
        content: {
          update: {
            toolCallId: 'call-1',
            title: 'LS',
            kind: 'read',
            status: 'completed',
            rawInput: { directory_path: '/tmp/workspace' },
          },
        },
      },
      {
        id: 'assistant-2',
        msg_id: 'assistant-msg-2',
        type: 'text',
        position: 'left',
        conversation_id: 'conv-1',
        content: { content: 'Step 2: Download the selected files.' },
      },
    ] as TMessage[];

    const processed = buildProcessedMessageList(messages);

    expect(processed).toHaveLength(1);
    expect(processed[0]).toMatchObject({
      type: 'assistant_turn',
      sourceMessageIds: ['assistant-1', 'tool-1', 'assistant-2'],
    });
    if (processed[0].type !== 'assistant_turn') {
      throw new Error('Expected assistant_turn');
    }
    expect(processed[0].message.content.content).toBe(
      'Step 1: Search the workspace.\n\nStep 2: Download the selected files.'
    );
    expect(matchesTargetMsgId(processed[0], 'assistant-msg-2')).toBe(true);
  });
});
