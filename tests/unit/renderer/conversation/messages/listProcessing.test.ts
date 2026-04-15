import type { IMessageAcpToolCall, IMessagePlan, IMessageText, TMessage } from '@/common/chat/chatLib';
import { getActiveTaskBoard } from '@/renderer/pages/conversation/Messages/listProcessing';

const createUserMessage = (id: string): IMessageText => ({
  id,
  msg_id: id,
  conversation_id: 'conversation-1',
  type: 'text',
  position: 'right',
  content: {
    content: 'hello',
  },
});

const createPlanMessage = (id: string, entries: IMessagePlan['content']['entries']): IMessagePlan => ({
  id,
  msg_id: id,
  conversation_id: 'conversation-1',
  type: 'plan',
  position: 'left',
  content: {
    sessionId: 'session-1',
    entries,
  },
});

const createTodoWriteMessage = (
  id: string,
  todos: string,
  title = 'TodoWrite',
  status: IMessageAcpToolCall['content']['update']['status'] = 'in_progress'
): IMessageAcpToolCall => ({
  id,
  msg_id: id,
  conversation_id: 'conversation-1',
  type: 'acp_tool_call',
  position: 'left',
  content: {
    sessionId: 'session-1',
    update: {
      sessionUpdate: 'tool_call',
      toolCallId: id,
      status,
      title,
      kind: 'execute',
      rawInput: {
        todos,
      },
    },
  },
});

describe('getActiveTaskBoard', () => {
  it('prefers current-turn plan messages when active tasks exist', () => {
    const list: TMessage[] = [
      createUserMessage('user-1'),
      createPlanMessage('plan-1', [
        { content: 'Read repo', status: 'completed' },
        { content: 'Build top board', status: 'in_progress' },
      ]),
    ];

    expect(getActiveTaskBoard(list)).toEqual({
      entries: [
        { content: 'Read repo', status: 'completed' },
        { content: 'Build top board', status: 'in_progress' },
      ],
      source: 'plan',
      sourceMessageId: 'plan-1',
      completedCount: 1,
      totalCount: 2,
    });
  });

  it('parses TodoWrite input from tool calls', () => {
    const list: TMessage[] = [
      createUserMessage('user-1'),
      createTodoWriteMessage(
        'todo-1',
        '1. [completed] Read repo\n2. [in_progress] Build top board\n3. [pending] Run checks',
        'Todo Write'
      ),
    ];

    expect(getActiveTaskBoard(list)).toEqual({
      entries: [
        { content: 'Read repo', status: 'completed' },
        { content: 'Build top board', status: 'in_progress' },
        { content: 'Run checks', status: 'pending' },
      ],
      source: 'todo_write',
      sourceMessageId: 'todo-1',
      completedCount: 1,
      totalCount: 3,
    });
  });

  it('hides completed plans and ignores older turns', () => {
    const completedPlanList: TMessage[] = [
      createUserMessage('user-1'),
      createPlanMessage('plan-1', [{ content: 'Done', status: 'completed' }]),
    ];
    const olderTurnList: TMessage[] = [
      createUserMessage('user-1'),
      createPlanMessage('plan-1', [{ content: 'Still old', status: 'in_progress' }]),
      createUserMessage('user-2'),
    ];

    expect(getActiveTaskBoard(completedPlanList)).toBeNull();
    expect(getActiveTaskBoard(olderTurnList)).toBeNull();
  });

  it('does not fall back to an older TodoWrite board after the latest update completes all tasks', () => {
    const list: TMessage[] = [
      createUserMessage('user-1'),
      createTodoWriteMessage('todo-1', '1. [in_progress] Build top board', 'Todo Write', 'in_progress'),
      createTodoWriteMessage('todo-2', '1. [completed] Build top board', 'Todo Write', 'completed'),
    ];

    expect(getActiveTaskBoard(list)).toBeNull();
  });
});
