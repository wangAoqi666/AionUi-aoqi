import { beforeEach, describe, expect, it, vi } from 'vitest';

function MockAcpAgent(..._args: unknown[]) {}
function MockIpcAgentEventEmitter(..._args: unknown[]) {}

const { mockUpdateConversation, mockGetConversation, listChangedEmitMock, mockDroidCtor } = vi.hoisted(() => ({
  mockUpdateConversation: vi.fn(),
  mockGetConversation: vi.fn(() => ({
    success: true,
    data: {
      type: 'acp',
      extra: { existing: true },
    },
  })),
  listChangedEmitMock: vi.fn(),
  mockDroidCtor: vi.fn(),
}));

function MockDroidSdkAgent(this: Record<string, unknown>, ...args: unknown[]) {
  mockDroidCtor(...args);
  this.start = vi.fn(() => Promise.resolve());
  this.setMode = vi.fn(async () => ({ success: true }));
  this.getModelInfo = vi.fn(() => null);
  this.setModelByConfigOption = vi.fn(async () => null);
}

vi.mock('@/common', async () => {
  const actual = await vi.importActual<typeof import('@/common')>('@/common');

  return {
    ...actual,
    ipcBridge: {
      ...actual.ipcBridge,
      acpConversation: {
        ...actual.ipcBridge.acpConversation,
        responseStream: { emit: vi.fn() },
      },
      conversation: {
        ...actual.ipcBridge.conversation,
        confirmation: {
          add: { emit: vi.fn() },
          update: { emit: vi.fn() },
          remove: { emit: vi.fn() },
        },
        listChanged: { emit: listChangedEmitMock },
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
  channelEventBus: { emitAgentMessage: vi.fn() },
}));

vi.mock('@process/team/teamEventBus', () => ({
  teamEventBus: { emit: vi.fn() },
}));

vi.mock('@process/extensions', () => ({
  ExtensionRegistry: { getInstance: vi.fn(() => ({ getAcpAdapters: vi.fn(() => []) })) },
}));

vi.mock('@process/services/database', () => ({
  getDatabase: vi.fn(async () => ({
    getConversation: mockGetConversation,
    updateConversation: mockUpdateConversation,
  })),
}));

vi.mock('@process/utils/initStorage', () => ({
  ProcessConfig: { get: vi.fn(async () => null), set: vi.fn(async () => {}) },
}));

vi.mock('@process/utils/message', () => ({
  addMessage: vi.fn(),
  addOrUpdateMessage: vi.fn(),
  nextTickToLocalFinish: vi.fn(),
}));

vi.mock('@process/utils/previewUtils', () => ({
  handlePreviewOpenEvent: vi.fn(() => false),
}));

vi.mock('@process/services/cron/CronBusyGuard', () => ({
  cronBusyGuard: { setProcessing: vi.fn() },
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
  extractAndStripThinkTags: vi.fn(() => ({ thinking: '', content: '' })),
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

    constructor(_type: string, data: Record<string, unknown>, _emitter: unknown) {
      this.conversation_id = (data.conversation_id as string) || '';
      this.workspace = (data.workspace as string) || '';
    }

    addConfirmation() {}
    confirm() {}
    getConfirmations() {
      return [];
    }
  },
}));

vi.mock('@/common/utils', () => ({
  parseError: vi.fn((error: unknown) => String(error)),
  uuid: vi.fn(() => 'mock-uuid'),
}));

import AcpAgentManager, { shouldResumeAcpSession } from '@process/task/AcpAgentManager';

describe('AcpAgentManager.setMode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConversation.mockReturnValue({
      success: true,
      data: {
        type: 'acp',
        extra: { existing: true },
      },
    });
  });

  it('drops legacy droid session ids when workspace metadata is missing or mismatched', () => {
    expect(
      shouldResumeAcpSession({
        backend: 'droid',
        workspace: '/tmp/workspace',
        acpSessionId: 'session-1',
      })
    ).toBe(false);

    expect(
      shouldResumeAcpSession({
        backend: 'droid',
        workspace: '/tmp/workspace',
        acpSessionId: 'session-1',
        acpSessionWorkspace: '/tmp/workspace',
      })
    ).toBe(true);

    expect(
      shouldResumeAcpSession({
        backend: 'droid',
        workspace: '/tmp/workspace',
        acpSessionId: 'session-1',
        acpSessionWorkspace: '/tmp/other-workspace',
      })
    ).toBe(false);
  });

  it('passes undefined session id to Droid startup when the workspace metadata is missing', async () => {
    const manager = new AcpAgentManager({
      conversation_id: 'conv-droid',
      backend: 'droid',
      workspace: '/tmp/workspace',
      acpSessionId: 'session-legacy',
    });

    await manager.initAgent();

    expect(mockDroidCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        acpSessionId: undefined,
      })
    );
  });

  it('persists droid spec mode before the agent is initialized', async () => {
    const manager = new AcpAgentManager({
      conversation_id: 'conv-spec',
      backend: 'droid',
      workspace: '/tmp/workspace',
    });
    const initAgentSpy = vi.spyOn(manager, 'initAgent');

    const result = await manager.setMode('spec');

    expect(result).toEqual({
      success: true,
      data: { mode: 'spec' },
    });
    expect(initAgentSpy).not.toHaveBeenCalled();
    expect(manager.getMode()).toEqual({
      mode: 'spec',
      initialized: false,
    });

    await Promise.resolve();

    expect(mockUpdateConversation).toHaveBeenCalledWith(
      'conv-spec',
      expect.objectContaining({
        extra: expect.objectContaining({
          existing: true,
          sessionMode: 'spec',
        }),
      })
    );
    expect(listChangedEmitMock).toHaveBeenCalledWith({
      conversationId: 'conv-spec',
      action: 'updated',
      source: 'aionui',
    });
  });
});
