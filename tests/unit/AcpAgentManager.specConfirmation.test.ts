import { beforeEach, describe, expect, it, vi } from 'vitest';

function MockAcpAgent(..._args: unknown[]) {}
function MockDroidSdkAgent(..._args: unknown[]) {}
function MockIpcAgentEventEmitter(..._args: unknown[]) {}

const { addConfirmationMock, addOrUpdateMessageMock, responseStreamEmitMock, teamResponseEmitMock, channelEmitMock } =
  vi.hoisted(() => ({
    addConfirmationMock: vi.fn(),
    addOrUpdateMessageMock: vi.fn(),
    responseStreamEmitMock: vi.fn(),
    teamResponseEmitMock: vi.fn(),
    channelEmitMock: vi.fn(),
  }));

vi.mock('@/common', async () => {
  const actual = await vi.importActual<typeof import('@/common')>('@/common');

  return {
    ...actual,
    ipcBridge: {
      ...actual.ipcBridge,
      acpConversation: {
        ...actual.ipcBridge.acpConversation,
        responseStream: { emit: responseStreamEmitMock },
      },
      conversation: {
        ...actual.ipcBridge.conversation,
        confirmation: {
          add: { emit: vi.fn() },
          update: { emit: vi.fn() },
          remove: { emit: vi.fn() },
        },
        responseStream: { emit: vi.fn() },
      },
    },
  };
});

vi.mock('@process/agent/acp', () => ({
  AcpAgent: MockAcpAgent,
}));

vi.mock('@process/agent/droid', () => ({
  DroidSdkAgent: MockDroidSdkAgent,
}));

vi.mock('@process/channels/agent/ChannelEventBus', () => ({
  channelEventBus: { emitAgentMessage: channelEmitMock },
}));

vi.mock('@process/team/teamEventBus', () => ({
  teamEventBus: { emit: teamResponseEmitMock },
}));

vi.mock('@process/extensions', () => ({
  ExtensionRegistry: { getInstance: vi.fn(() => ({ getAcpAdapters: vi.fn(() => []) })) },
}));

vi.mock('@process/services/database', () => ({
  getDatabase: vi.fn(async () => ({
    getConversation: vi.fn(() => ({ success: true, data: { type: 'acp', extra: {} } })),
    updateConversation: vi.fn(),
  })),
}));

vi.mock('@process/utils/initStorage', () => ({
  ProcessConfig: { get: vi.fn(async () => null), set: vi.fn(async () => {}) },
}));

vi.mock('@process/utils/message', () => ({
  addMessage: vi.fn(),
  addOrUpdateMessage: addOrUpdateMessageMock,
  nextTickToLocalFinish: vi.fn(),
}));

vi.mock('@process/utils/previewUtils', () => ({
  handlePreviewOpenEvent: vi.fn(() => false),
}));

vi.mock('@process/services/cron/CronBusyGuard', () => ({
  cronBusyGuard: { setProcessing: vi.fn(), isProcessing: vi.fn(() => false) },
}));

vi.mock('@process/services/cron/SkillSuggestWatcher', () => ({
  skillSuggestWatcher: { onFinish: vi.fn() },
}));

vi.mock('@process/utils/mainLogger', () => ({
  mainLog: vi.fn(),
  mainWarn: vi.fn(),
  mainError: vi.fn(),
}));

vi.mock('@process/task/codexConfig', () => ({
  getCodexSandboxModeForSessionMode: vi.fn(),
  writeCodexSandboxMode: vi.fn(),
}));

vi.mock('@process/task/CronCommandDetector', () => ({
  hasCronCommands: vi.fn(() => false),
}));

vi.mock('@process/task/ThinkTagDetector', () => ({
  extractAndStripThinkTags: vi.fn((content: string) => ({ thinking: '', content })),
}));

vi.mock('@process/task/MessageMiddleware', () => ({
  extractTextFromMessage: vi.fn(() => ''),
  processCronInMessage: vi.fn(),
}));

vi.mock('@process/task/IpcAgentEventEmitter', () => ({
  IpcAgentEventEmitter: MockIpcAgentEventEmitter,
}));

vi.mock('@process/task/BaseAgentManager', () => ({
  default: class {
    conversation_id = '';
    workspace = '';
    status: string | undefined;
    protected yoloMode = false;
    protected confirmations: unknown[] = [];
    protected _lastActivityAt = Date.now();

    constructor(_type: string, data: Record<string, unknown>, _emitter: unknown) {
      this.conversation_id = (data.conversation_id as string) || '';
      this.workspace = (data.workspace as string) || '';
      if ('yoloMode' in data) {
        this.yoloMode = Boolean(data.yoloMode);
      }
    }

    addConfirmation(data: unknown) {
      const confirmation = data as { id: string; callId: string; options?: Array<{ value: unknown }> };
      if (this.yoloMode && confirmation.options && confirmation.options.length > 0) {
        void this.confirm(confirmation.id, confirmation.callId, confirmation.options[0].value);
        return;
      }

      addConfirmationMock(data);
      this.confirmations.push(data);
    }

    confirm() {}

    getConfirmations() {
      return this.confirmations;
    }
  },
}));

vi.mock('@/common/utils', () => ({
  parseError: vi.fn((error: unknown) => String(error)),
  uuid: vi.fn(() => 'mock-uuid'),
}));

import AcpAgentManager from '@process/task/AcpAgentManager';

type TestableAcpAgentManager = AcpAgentManager & {
  handleStreamEvent: (message: unknown, data: unknown) => void;
};

describe('AcpAgentManager spec confirmation history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persists and emits spec review cards before showing the confirmation overlay', () => {
    const manager = new AcpAgentManager({
      conversation_id: 'conv-spec',
      backend: 'droid',
      workspace: '/tmp/workspace',
    });

    const message = {
      type: 'acp_permission',
      conversation_id: 'conv-spec',
      msg_id: 'spec-msg',
      data: {
        sessionId: 'session-1',
        toolCall: {
          toolCallId: 'spec-call',
          title: 'Specification Review',
          kind: 'exit_spec_mode',
          rawInput: {
            plan: '# Plan\n\n- Review the implementation steps',
            description: '# Plan\n\n- Review the implementation steps',
          },
        },
        options: [{ optionId: 'proceed_once', name: 'Proceed', kind: 'allow_once' }],
      },
    } as const;

    (manager as unknown as TestableAcpAgentManager).handleStreamEvent(message, {
      conversation_id: 'conv-spec',
      backend: 'droid',
      workspace: '/tmp/workspace',
    });

    expect(addOrUpdateMessageMock).toHaveBeenCalledWith(
      'conv-spec',
      expect.objectContaining({
        type: 'acp_permission',
        msg_id: 'spec-msg',
      }),
      'droid'
    );
    expect(responseStreamEmitMock).toHaveBeenCalledWith(message);
    expect(teamResponseEmitMock).toHaveBeenCalledWith('responseStream', message);
    expect(addConfirmationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'spec-msg',
        descriptionFormat: 'markdown',
        description: '# Plan\n\n- Review the implementation steps',
      })
    );
  });

  it('keeps non-spec permissions out of the message history', () => {
    const manager = new AcpAgentManager({
      conversation_id: 'conv-spec',
      backend: 'droid',
      workspace: '/tmp/workspace',
    });

    const message = {
      type: 'acp_permission',
      conversation_id: 'conv-spec',
      msg_id: 'exec-msg',
      data: {
        sessionId: 'session-1',
        toolCall: {
          toolCallId: 'exec-call',
          title: 'python3',
          kind: 'execute',
          rawInput: {
            command: 'python3 -V',
            description: 'Run python3 -V',
          },
        },
        options: [{ optionId: 'proceed_once', name: 'Proceed', kind: 'allow_once' }],
      },
    } as const;

    (manager as unknown as TestableAcpAgentManager).handleStreamEvent(message, {
      conversation_id: 'conv-spec',
      backend: 'droid',
      workspace: '/tmp/workspace',
    });

    expect(addOrUpdateMessageMock).not.toHaveBeenCalled();
    expect(responseStreamEmitMock).not.toHaveBeenCalled();
    expect(teamResponseEmitMock).not.toHaveBeenCalled();
    expect(addConfirmationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'exec-msg',
        descriptionFormat: 'text',
        description: 'Run python3 -V',
      })
    );
  });

  it('keeps manager-layer auto-approval disabled for droid even when yoloMode is forced', () => {
    const manager = new AcpAgentManager({
      conversation_id: 'conv-spec',
      backend: 'droid',
      workspace: '/tmp/workspace',
      yoloMode: true,
    });
    const confirmSpy = vi.spyOn(manager, 'confirm').mockResolvedValue();

    const message = {
      type: 'acp_permission',
      conversation_id: 'conv-spec',
      msg_id: 'spec-msg',
      data: {
        sessionId: 'session-1',
        toolCall: {
          toolCallId: 'spec-call',
          title: 'Specification Review',
          kind: 'exit_spec_mode',
          rawInput: {
            plan: '# Plan\n\n- Review the implementation steps',
            description: '# Plan\n\n- Review the implementation steps',
          },
        },
        options: [{ optionId: 'proceed_once', name: 'Proceed', kind: 'allow_once' }],
      },
    } as const;

    (manager as unknown as TestableAcpAgentManager).handleStreamEvent(message, {
      conversation_id: 'conv-spec',
      backend: 'droid',
      workspace: '/tmp/workspace',
    });

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(addConfirmationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'spec-msg',
      })
    );
  });

  it('does not auto-approve team tool confirmations for droid sessions', async () => {
    vi.useFakeTimers();
    try {
      const manager = new AcpAgentManager({
        conversation_id: 'conv-spec',
        backend: 'droid',
        workspace: '/tmp/workspace',
      });
      const confirmSpy = vi.spyOn(manager, 'confirm').mockResolvedValue();

      const message = {
        type: 'acp_permission',
        conversation_id: 'conv-spec',
        msg_id: 'team-msg',
        data: {
          sessionId: 'session-1',
          toolCall: {
            toolCallId: 'team-call',
            title: 'aionui-team-123',
            kind: 'mcp_tool',
            rawInput: {
              description: 'Run the shared team helper',
            },
          },
          options: [{ optionId: 'proceed_once', name: 'Proceed', kind: 'allow_once' }],
        },
      } as const;

      (manager as unknown as TestableAcpAgentManager).handleStreamEvent(message, {
        conversation_id: 'conv-spec',
        backend: 'droid',
        workspace: '/tmp/workspace',
      });

      await vi.advanceTimersByTimeAsync(60);

      expect(confirmSpy).not.toHaveBeenCalled();
      expect(addConfirmationMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'team-msg',
          description: 'Run the shared team helper',
        })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('switches droid mode to the approved autonomy level after spec approval', async () => {
    const manager = new AcpAgentManager({
      conversation_id: 'conv-spec',
      backend: 'droid',
      workspace: '/tmp/workspace',
    });
    const confirmMessageMock = vi.fn(async () => ({ success: true }));
    const rememberSessionModeMock = vi.fn();

    (manager as unknown as { confirmations: unknown[] }).confirmations = [
      {
        id: 'spec-msg',
        callId: 'spec-call',
        descriptionFormat: 'markdown',
      },
    ];
    (
      manager as unknown as {
        agent: { confirmMessage: typeof confirmMessageMock; rememberSessionMode: typeof rememberSessionModeMock };
      }
    ).agent = {
      confirmMessage: confirmMessageMock,
      rememberSessionMode: rememberSessionModeMock,
    };
    (manager as unknown as { bootstrap: Promise<unknown> }).bootstrap = Promise.resolve(
      (manager as unknown as { agent: unknown }).agent
    );

    await manager.confirm('spec-msg', 'spec-call', {
      optionId: 'proceed_auto_run_high',
      name: 'Proceed, and allow all commands',
      kind: 'allow_once',
    });

    expect(confirmMessageMock).toHaveBeenCalledWith({
      confirmKey: 'proceed_auto_run_high',
      callId: 'spec-call',
    });
    expect(rememberSessionModeMock).toHaveBeenCalledWith('yolo');
    expect(manager.getMode()).toEqual({ mode: 'yolo', initialized: true });
  });

  it('re-syncs the droid SDK mode on the next explicit mode set after spec approval', async () => {
    const manager = new AcpAgentManager({
      conversation_id: 'conv-spec',
      backend: 'droid',
      workspace: '/tmp/workspace',
    });
    const confirmMessageMock = vi.fn(async () => ({ success: true }));
    const rememberSessionModeMock = vi.fn();
    const setModeMock = vi.fn(async () => ({ success: true }));

    (manager as unknown as { confirmations: unknown[] }).confirmations = [
      {
        id: 'spec-msg',
        callId: 'spec-call',
        descriptionFormat: 'markdown',
      },
    ];
    (
      manager as unknown as {
        agent: {
          confirmMessage: typeof confirmMessageMock;
          rememberSessionMode: typeof rememberSessionModeMock;
          setMode: typeof setModeMock;
        };
      }
    ).agent = {
      confirmMessage: confirmMessageMock,
      rememberSessionMode: rememberSessionModeMock,
      setMode: setModeMock,
    };
    (manager as unknown as { bootstrap: Promise<unknown> }).bootstrap = Promise.resolve(
      (manager as unknown as { agent: unknown }).agent
    );

    await manager.confirm('spec-msg', 'spec-call', {
      optionId: 'proceed_auto_run_low',
      name: 'Proceed, and allow file edits and read-only commands (Low)',
      kind: 'allow_once',
    });

    await manager.setMode('acceptEdits');

    expect(setModeMock).toHaveBeenCalledWith('acceptEdits');
    expect(manager.getMode()).toEqual({ mode: 'acceptEdits', initialized: true });
  });
});
