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
    ProceedAutoRunMedium: 'proceed_auto_run_medium',
    Cancel: 'cancel',
  },
  AutonomyLevel: {
    High: 'high',
    Medium: 'medium',
    Low: 'low',
    Off: 'off',
  },
  DroidInteractionMode: {
    Auto: 'auto',
    Spec: 'spec',
  },
}));

vi.mock('@process/utils/mainLogger', () => ({
  mainLog: mainLogMock,
  mainWarn: mainWarnMock,
}));

vi.mock('@process/utils/shellEnv', () => ({
  getEnhancedEnv: () => ({}),
}));

vi.mock('@process/agent/droid/cliRuntime', () => ({
  resolveWorkingDroidCli: vi.fn((execPath?: string | null) => ({
    execPath: execPath || 'droid',
    cliPath: execPath || 'droid',
    source: 'system',
    version: '1.0.0',
  })),
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

  it('injects a spec-mode planning reminder instead of the generic AskUser reminder', async () => {
    let streamedPrompt = '';
    const session = {
      sessionId: 'session-spec-1',
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
      id: 'conv-spec-1',
      workingDir: '/tmp',
      sessionMode: 'spec',
      onStreamEvent: vi.fn(),
    });

    await agent.start();
    await agent.sendMessage({
      content: '帮我创建一个飞机大战小游戏。',
      msg_id: 'msg-spec-1',
    });

    expect(streamedPrompt).toContain('Specification Mode is active');
    expect(streamedPrompt).toContain('ExitSpecMode tool');
    expect(streamedPrompt).not.toContain('When using the AskUser tool');
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

  it('maps spec mode to SDK interaction settings', async () => {
    const session = {
      sessionId: 'session-3',
      updateSettings: vi.fn(),
      close: vi.fn(),
      interrupt: vi.fn(),
      stream: vi.fn(async function* () {}),
    };
    createSessionMock.mockResolvedValue(session);

    const agent = new DroidSdkAgent({
      id: 'conv-3',
      workingDir: '/tmp',
      sessionMode: 'spec',
      onStreamEvent: vi.fn(),
    });

    await agent.start();

    expect(createSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        interactionMode: 'spec',
        autonomyLevel: 'off',
      })
    );

    await agent.setMode('auto');

    expect(session.updateSettings).toHaveBeenLastCalledWith({
      interactionMode: 'auto',
      autonomyLevel: 'medium',
    });
  });

  it('applies configured spec-mode model settings immediately after session creation', async () => {
    const session = {
      sessionId: 'session-spec-config',
      updateSettings: vi.fn(),
      close: vi.fn(),
      interrupt: vi.fn(),
      stream: vi.fn(async function* () {}),
    };
    createSessionMock.mockResolvedValue(session);

    const agent = new DroidSdkAgent({
      id: 'conv-spec-config',
      workingDir: '/tmp',
      modelId: 'claude-opus-4-6',
      pendingConfigOptions: {
        spec_mode_model: 'claude-sonnet-4-6',
        spec_mode_reasoning_effort: 'low',
      },
      onStreamEvent: vi.fn(),
    });

    await agent.start();

    expect(createSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: 'claude-opus-4-6',
      })
    );
    expect(session.updateSettings).toHaveBeenCalledWith({
      specModeModelId: 'claude-sonnet-4-6',
      specModeReasoningEffort: 'low',
    });
  });

  it('updates the prompt preamble after switching into spec mode', async () => {
    let streamedPrompt = '';
    const session = {
      sessionId: 'session-spec-2',
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
      id: 'conv-spec-2',
      workingDir: '/tmp',
      onStreamEvent: vi.fn(),
    });

    await agent.start();
    await agent.setMode('spec');
    await agent.sendMessage({
      content: '实现一个新功能',
      msg_id: 'msg-spec-2',
    });

    expect(streamedPrompt).toContain('Specification Mode is active');
    expect(streamedPrompt).not.toContain('When using the AskUser tool');
  });

  it('preserves SDK permission options for spec approval requests', async () => {
    const session = {
      sessionId: 'session-4',
      updateSettings: vi.fn(),
      close: vi.fn(),
      interrupt: vi.fn(),
      stream: vi.fn(async function* () {}),
    };
    createSessionMock.mockResolvedValue(session);
    const onStreamEvent = vi.fn();

    const agent = new DroidSdkAgent({
      id: 'conv-4',
      workingDir: '/tmp',
      onStreamEvent,
    });

    await agent.start();
    const options = createSessionMock.mock.calls[0]?.[0];
    expect(options?.permissionHandler).toBeTypeOf('function');

    const permissionPromise = options.permissionHandler({
      toolUses: [
        {
          toolUse: {
            id: 'spec-review-1',
            name: 'ExitSpecMode',
            input: {},
          },
          confirmationType: 'exit_spec_mode',
          details: {
            type: 'exit_spec_mode',
            plan: '# 计划\n\n- 添加 SPEC 按钮',
            title: 'SPEC Review',
            optionNames: ['继续', '保留'],
          },
        },
      ],
      options: [
        { label: 'Proceed with implementation', value: 'proceed_once' },
        { label: 'Proceed, and allow reversible commands (Medium)', value: 'proceed_auto_run_medium' },
        { label: 'No, keep iterating on spec', value: 'cancel' },
      ],
    });

    expect(onStreamEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'acp_permission',
        data: expect.objectContaining({
          options: [
            {
              optionId: 'proceed_once',
              name: 'Proceed with implementation',
              kind: 'allow_once',
            },
            {
              optionId: 'proceed_auto_run_medium',
              name: 'Proceed, and allow reversible commands (Medium)',
              kind: 'allow_once',
            },
            {
              optionId: 'cancel',
              name: 'No, keep iterating on spec',
              kind: 'reject_once',
            },
          ],
          toolCall: expect.objectContaining({
            title: 'SPEC Review',
            kind: 'exit_spec_mode',
            rawInput: expect.objectContaining({
              plan: '# 计划\n\n- 添加 SPEC 按钮',
              description: '# 计划\n\n- 添加 SPEC 按钮',
              title: 'SPEC Review',
              optionNames: ['继续', '保留'],
            }),
          }),
        }),
      })
    );

    await agent.confirmMessage({
      confirmKey: 'cancel',
      callId: 'spec-review-1',
    });

    await expect(permissionPromise).resolves.toBe('cancel');
  });
});
