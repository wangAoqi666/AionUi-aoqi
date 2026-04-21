import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockEmitAgentMessage, mockEmitResponseStream, mockGetDatabase, mockTransformMessage, mockUuid } = vi.hoisted(
  () => ({
    mockEmitAgentMessage: vi.fn(),
    mockEmitResponseStream: vi.fn(),
    mockGetDatabase: vi.fn(),
    mockTransformMessage: vi.fn(() => null),
    mockUuid: vi.fn(() => 'mock-uuid'),
  })
);

vi.mock('@process/agent/acp', () => ({
  AcpAgent: vi.fn(),
}));

vi.mock('@process/agent/droid', () => ({
  DroidSdkAgent: vi.fn(),
}));

vi.mock('@process/agent/droid/runtime/config', () => ({
  isDroidChannelPlatform: vi.fn((source?: string) => ['telegram', 'lark', 'dingtalk', 'weixin'].includes(source ?? '')),
}));

vi.mock('@process/channels/agent/ChannelEventBus', () => ({
  channelEventBus: {
    emitAgentMessage: mockEmitAgentMessage,
  },
}));

vi.mock('@process/team/teamEventBus', () => ({
  teamEventBus: {
    emit: vi.fn(),
  },
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    acpConversation: {
      responseStream: {
        emit: mockEmitResponseStream,
      },
    },
  },
}));

vi.mock('@/common/chat/chatLib', () => ({
  transformMessage: mockTransformMessage,
  uuid: mockUuid,
}));

vi.mock('@/common/utils', () => ({
  parseError: vi.fn((error: unknown) => String(error)),
  uuid: mockUuid,
}));

vi.mock('@process/services/database', () => ({
  getDatabase: mockGetDatabase,
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
  cronBusyGuard: {
    setProcessing: vi.fn(),
  },
}));

vi.mock('@process/utils/mainLogger', () => ({
  mainLog: vi.fn(),
  mainWarn: vi.fn(),
  mainError: vi.fn(),
}));

vi.mock('@process/extensions', () => ({
  ExtensionRegistry: {
    getInstance: vi.fn(() => ({ getEnabledExtensions: vi.fn(() => []) })),
  },
}));

vi.mock('@process/utils/initStorage', () => ({
  ProcessConfig: {
    get: vi.fn(),
  },
}));

vi.mock('@process/task/codexConfig', () => ({
  getCodexSandboxModeForSessionMode: vi.fn(),
  writeCodexSandboxMode: vi.fn(),
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

vi.mock('@process/task/IpcAgentEventEmitter', () => ({
  IpcAgentEventEmitter: class {
    emitConfirmationAdd() {}
    emitConfirmationUpdate() {}
    emitConfirmationRemove() {}
  },
}));

vi.mock('@process/services/cron/SkillSuggestWatcher', () => ({
  skillSuggestWatcher: {
    onFinish: vi.fn(),
  },
}));

vi.mock('@process/task/ThinkTagDetector', () => ({
  extractAndStripThinkTags: vi.fn((text: string) => ({ thinking: '', content: text })),
}));

vi.mock('@process/task/agentUtils', () => ({
  prepareFirstMessageWithSkillsIndex: vi.fn(async (content: string) => content),
}));

vi.mock('@process/task/MessageMiddleware', () => ({
  extractTextFromMessage: vi.fn(() => ''),
  processCronInMessage: vi.fn(),
}));

import AcpAgentManager from '@process/task/AcpAgentManager';
import type { AcpBackend } from '@/common/types/acpTypes';

function createManager(overrides?: { source?: string; channelPluginId?: string }) {
  return new AcpAgentManager({
    conversation_id: 'conv-ask-user',
    backend: 'droid' as AcpBackend,
    workspace: '/tmp/workspace',
    source: overrides?.source,
    channelPluginId: overrides?.channelPluginId,
  });
}

describe('AcpAgentManager ask-user fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDatabase.mockResolvedValue({
      getConversation: vi.fn(() => ({ success: false })),
      updateConversation: vi.fn(),
    });
  });

  it('emits plain-text prompt for channel conversations', () => {
    const manager = createManager({ source: 'telegram', channelPluginId: 'telegram_default' });
    const addConfirmationSpy = vi.spyOn(
      manager as unknown as { addConfirmation: (data: unknown) => void },
      'addConfirmation'
    );
    const handleAskUserRequest = Reflect.get(manager, 'handleAskUserRequest').bind(manager) as (
      callId: string,
      questions: Array<{ index: number; topic: string; question: string; options: string[] }>,
      data: { source?: string; channelPluginId?: string }
    ) => void;

    handleAskUserRequest(
      'call-1',
      [{ index: 0, topic: 'Mode', question: 'Which mode should I use?', options: ['Fast', 'Safe'] }],
      { source: 'telegram', channelPluginId: 'telegram_default' }
    );

    expect(addConfirmationSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        callId: 'call-1',
        description: expect.stringContaining('I need a quick reply before I can continue:'),
        interaction: {
          type: 'ask_user',
          questions: [{ index: 0, topic: 'Mode', question: 'Which mode should I use?', options: ['Fast', 'Safe'] }],
        },
      })
    );
    expect(mockEmitAgentMessage).toHaveBeenCalledWith(
      'conv-ask-user',
      expect.objectContaining({
        type: 'content',
        conversation_id: 'conv-ask-user',
        msg_id: 'ask_user_call-1',
        data: expect.stringContaining('Reply with an option number, the option text, or your own short answer.'),
      })
    );
  });

  it('keeps interactive confirmation text for local conversations', () => {
    const manager = createManager({ source: 'aionui' });
    const addConfirmationSpy = vi.spyOn(
      manager as unknown as { addConfirmation: (data: unknown) => void },
      'addConfirmation'
    );
    const handleAskUserRequest = Reflect.get(manager, 'handleAskUserRequest').bind(manager) as (
      callId: string,
      questions: Array<{ index: number; topic: string; question: string; options: string[] }>,
      data: { source?: string; channelPluginId?: string }
    ) => void;

    handleAskUserRequest(
      'call-2',
      [{ index: 0, topic: 'Mode', question: 'Which mode should I use?', options: ['Fast', 'Safe'] }],
      { source: 'aionui' }
    );

    expect(addConfirmationSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        callId: 'call-2',
        description: 'Which mode should I use?',
      })
    );
    expect(mockEmitAgentMessage).not.toHaveBeenCalled();
  });
});
