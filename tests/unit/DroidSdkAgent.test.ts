import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DroidSdkAgent } from '@/process/agent/droid/DroidSdkAgent';

const createSessionMock = vi.hoisted(() => vi.fn());
const resumeSessionMock = vi.hoisted(() => vi.fn());
const mainLogMock = vi.hoisted(() => vi.fn());
const mainWarnMock = vi.hoisted(() => vi.fn());

vi.mock('@factory/droid-sdk', () => ({
  createSession: createSessionMock,
  resumeSession: resumeSessionMock,
  ToolConfirmationOutcome: {
    ProceedOnce: 'proceed_once',
    ProceedAlways: 'proceed_always',
    Cancel: 'cancel',
  },
  AutonomyLevel: {
    High: 'high',
    Medium: 'medium',
    Low: 'low',
    Off: 'off',
  },
}));

vi.mock('@process/utils/mainLogger', () => ({
  mainLog: mainLogMock,
  mainWarn: mainWarnMock,
}));

vi.mock('@process/utils/shellEnv', () => ({
  getEnhancedEnv: () => ({}),
}));

describe('DroidSdkAgent', () => {
  beforeEach(() => {
    createSessionMock.mockReset();
    resumeSessionMock.mockReset();
    mainLogMock.mockReset();
    mainWarnMock.mockReset();
  });

  it('injects the AskUser format reminder ahead of file references', async () => {
    let streamedPrompt = '';
    const session = {
      sessionId: 'session-1',
      updateSettings: vi.fn(),
      close: vi.fn(),
      interrupt: vi.fn(),
      stream: vi.fn(async function* (prompt: string) {
        streamedPrompt = prompt;
        yield* [];
      }),
    };
    createSessionMock.mockResolvedValue(session);

    const agent = new DroidSdkAgent({
      id: 'conv-1',
      workingDir: '/tmp',
      onStreamEvent: vi.fn(),
    });

    await agent.start();
    await agent.sendMessage({
      content: '请先问我一个问题',
      files: ['/tmp/example.txt'],
      msg_id: 'msg-1',
    });

    expect(streamedPrompt).toContain('When using the AskUser tool');
    expect(streamedPrompt).toContain('@/tmp/example.txt');
    expect(streamedPrompt.indexOf('<system-reminder>')).toBeLessThan(streamedPrompt.indexOf('@/tmp/example.txt'));
  });

  it('bridges ask-user requests back through answerAskUser', async () => {
    const session = {
      sessionId: 'session-2',
      updateSettings: vi.fn(),
      close: vi.fn(),
      interrupt: vi.fn(),
      stream: vi.fn(async function* () {}),
    };
    createSessionMock.mockResolvedValue(session);
    const onAskUserRequest = vi.fn();

    const agent = new DroidSdkAgent({
      id: 'conv-2',
      workingDir: '/tmp',
      onStreamEvent: vi.fn(),
      onAskUserRequest,
    });

    await agent.start();
    const options = createSessionMock.mock.calls[0]?.[0];
    expect(options?.askUserHandler).toBeTypeOf('function');

    const askUserPromise = options.askUserHandler({
      toolCallId: 'ask-user-1',
      questions: [
        {
          index: 1,
          topic: 'Task',
          question: '需要我做什么？',
          options: ['写代码', '修 bug'],
        },
      ],
    });

    expect(onAskUserRequest).toHaveBeenCalledWith({
      callId: 'ask-user-1',
      questions: [
        {
          index: 1,
          topic: 'Task',
          question: '需要我做什么？',
          options: ['写代码', '修 bug'],
        },
      ],
    });

    await agent.answerAskUser({
      callId: 'ask-user-1',
      result: {
        cancelled: false,
        answers: [{ index: 1, question: '需要我做什么？', answer: '写代码' }],
      },
    });

    await expect(askUserPromise).resolves.toEqual({
      cancelled: false,
      answers: [{ index: 1, question: '需要我做什么？', answer: '写代码' }],
    });
  });
});
