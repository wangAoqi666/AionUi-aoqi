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
  this.setSkipPermissionsUnsafe = vi.fn(async () => ({ success: true }));
  this.setEnabledToolIds = vi.fn(async () => ({ success: true }));
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

  // ── setSkipPermissionsUnsafe delegation (SKILL P0-3) ──────────────────
  describe('setSkipPermissionsUnsafe', () => {
    it('rejects non-droid backends with an unsupported error', async () => {
      const manager = new AcpAgentManager({
        conversation_id: 'conv-claude',
        backend: 'claude',
        workspace: '/tmp/workspace',
      });

      const result = await manager.setSkipPermissionsUnsafe(true);
      expect(result.success).toBe(false);
      expect(result.msg).toMatch(/only supported for the Droid SDK backend/i);
    });

    it('rejects when the droid agent has not been instantiated yet', async () => {
      const manager = new AcpAgentManager({
        conversation_id: 'conv-droid-boot',
        backend: 'droid',
        workspace: '/tmp/workspace',
      });

      const result = await manager.setSkipPermissionsUnsafe(true);
      expect(result.success).toBe(false);
      expect(result.msg).toMatch(/not yet available/i);
    });

    it('delegates to DroidSdkAgent.setSkipPermissionsUnsafe when the agent is ready', async () => {
      const manager = new AcpAgentManager({
        conversation_id: 'conv-droid-yolo',
        backend: 'droid',
        workspace: '/tmp/workspace',
      });

      await manager.initAgent();
      const result = await manager.setSkipPermissionsUnsafe(true);

      expect(result.success).toBe(true);
      // Internal agent mock captured the call.
      // @ts-expect-error — accessing private agent field on a mock for assertion.
      const innerAgent = manager.agent as { setSkipPermissionsUnsafe: ReturnType<typeof vi.fn> };
      expect(innerAgent.setSkipPermissionsUnsafe).toHaveBeenCalledWith(true);
    });

    it('propagates the inner agent failure message', async () => {
      const manager = new AcpAgentManager({
        conversation_id: 'conv-droid-fail',
        backend: 'droid',
        workspace: '/tmp/workspace',
      });

      await manager.initAgent();
      // @ts-expect-error — accessing private agent field on a mock for assertion.
      const innerAgent = manager.agent as { setSkipPermissionsUnsafe: ReturnType<typeof vi.fn> };
      innerAgent.setSkipPermissionsUnsafe.mockResolvedValueOnce({
        success: false,
        error: 'CLI rejected skipPermissionsUnsafe',
      });

      const result = await manager.setSkipPermissionsUnsafe(true);
      expect(result.success).toBe(false);
      expect(result.msg).toContain('CLI rejected skipPermissionsUnsafe');
    });
  });

  // ── setEnabledToolIds delegation (SKILL P2-2 tool whitelist) ──────────
  describe('setEnabledToolIds', () => {
    it('rejects non-droid backends with an unsupported error', async () => {
      const manager = new AcpAgentManager({
        conversation_id: 'conv-claude',
        backend: 'claude',
        workspace: '/tmp/workspace',
      });

      const result = await manager.setEnabledToolIds(['read_file']);
      expect(result.success).toBe(false);
      expect(result.msg).toMatch(/only supported for the Droid SDK backend/i);
    });

    it('rejects when the droid agent has not been instantiated yet', async () => {
      const manager = new AcpAgentManager({
        conversation_id: 'conv-droid-preinit',
        backend: 'droid',
        workspace: '/tmp/workspace',
      });

      const result = await manager.setEnabledToolIds(['read_file']);
      expect(result.success).toBe(false);
      expect(result.msg).toMatch(/not yet available/i);
    });

    it('delegates three-state values verbatim to DroidSdkAgent.setEnabledToolIds', async () => {
      const manager = new AcpAgentManager({
        conversation_id: 'conv-droid-whitelist',
        backend: 'droid',
        workspace: '/tmp/workspace',
      });

      await manager.initAgent();
      // @ts-expect-error — accessing private agent field on a mock for assertion.
      const innerAgent = manager.agent as { setEnabledToolIds: ReturnType<typeof vi.fn> };

      // Happy path — whitelist array.
      const whitelistResult = await manager.setEnabledToolIds(['read_file', 'edit_file']);
      expect(whitelistResult).toEqual({ success: true });
      expect(innerAgent.setEnabledToolIds).toHaveBeenCalledWith(['read_file', 'edit_file']);

      // Empty array (disable-all).
      const emptyResult = await manager.setEnabledToolIds([]);
      expect(emptyResult).toEqual({ success: true });
      expect(innerAgent.setEnabledToolIds).toHaveBeenLastCalledWith([]);

      // Null (clear-whitelist).
      const clearResult = await manager.setEnabledToolIds(null);
      expect(clearResult).toEqual({ success: true });
      expect(innerAgent.setEnabledToolIds).toHaveBeenLastCalledWith(null);
    });

    it('propagates the inner agent failure message', async () => {
      const manager = new AcpAgentManager({
        conversation_id: 'conv-droid-whitelist-fail',
        backend: 'droid',
        workspace: '/tmp/workspace',
      });

      await manager.initAgent();
      // @ts-expect-error — accessing private agent field on a mock for assertion.
      const innerAgent = manager.agent as { setEnabledToolIds: ReturnType<typeof vi.fn> };
      innerAgent.setEnabledToolIds.mockResolvedValueOnce({
        success: false,
        error: 'CLI rejected enabledToolIds',
      });

      const result = await manager.setEnabledToolIds(['read_file']);
      expect(result.success).toBe(false);
      expect(result.msg).toContain('CLI rejected enabledToolIds');
    });
  });
});
