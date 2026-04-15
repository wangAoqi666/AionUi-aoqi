import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: vi.fn(() => '/tmp') } }));

const mocks = vi.hoisted(() => ({
  getDatabase: vi.fn(),
  processConfigGet: vi.fn(),
  getChannelDefaultModel: vi.fn(async () => ({ id: 'provider-1', useModel: 'gemini-2.5-pro' })),
  handlePairingShow: vi.fn(async () => ({ success: true })),
  createConversation: vi.fn(),
  workerTaskManagerGetTask: vi.fn(),
  buildChatErrorResponse: vi.fn((message: string) => ({
    text: `❌ ${message}`,
    parseMode: 'HTML' as const,
    replyMarkup: undefined,
  })),
  messageService: {
    sendMessage: vi.fn(async () => 'stream-complete'),
  },
}));

vi.mock('@process/services/database', () => ({
  getDatabase: mocks.getDatabase,
}));

vi.mock('@process/utils/initStorage', () => ({
  ProcessConfig: { get: mocks.processConfigGet },
}));

vi.mock('@process/services/conversationServiceSingleton', () => ({
  conversationServiceSingleton: {
    createConversation: mocks.createConversation,
  },
}));

vi.mock('@process/channels/actions/SystemActions', () => ({
  getChannelDefaultModel: mocks.getChannelDefaultModel,
  systemActions: [],
}));

vi.mock('@process/channels/actions/PlatformActions', () => ({
  handlePairingShow: mocks.handlePairingShow,
  platformActions: [],
}));

vi.mock('@process/channels/actions/ChatActions', () => ({
  buildChatErrorResponse: mocks.buildChatErrorResponse,
  chatActions: [],
}));

vi.mock('@process/channels/agent/ChannelMessageService', () => ({
  getChannelMessageService: vi.fn(() => mocks.messageService),
}));

vi.mock('@process/task/workerTaskManagerSingleton', () => ({
  workerTaskManager: {
    getTask: mocks.workerTaskManagerGetTask,
  },
}));

import { ActionExecutor } from '@process/channels/gateway/ActionExecutor';
import type { IChannelSession, IChannelUser, IUnifiedIncomingMessage } from '@process/channels/types';
import type { TChatConversation } from '@/common/config/storage';

describe('ActionExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.processConfigGet.mockResolvedValue(undefined);
    mocks.getChannelDefaultModel.mockResolvedValue({ id: 'provider-1', useModel: 'gemini-2.5-pro' });
    mocks.handlePairingShow.mockResolvedValue({ success: true });
    mocks.createConversation.mockReset();
    mocks.messageService.sendMessage.mockResolvedValue('stream-complete');
    mocks.workerTaskManagerGetTask.mockReset();
    mocks.workerTaskManagerGetTask.mockReturnValue(undefined);
  });

  it('recreates a stale session when the bound conversation has been removed', async () => {
    const channelUser: IChannelUser = {
      id: 'channel-user-1',
      pluginId: 'telegram_default',
      platformUserId: 'telegram-user-1',
      platformType: 'telegram',
      displayName: 'Tester',
      authorizedAt: Date.now(),
    };
    const staleSession: IChannelSession = {
      id: 'session-old',
      pluginId: 'telegram_default',
      userId: channelUser.id,
      agentType: 'gemini',
      conversationId: 'conv-old',
      chatId: 'chat-1',
      createdAt: 1,
      lastActivity: 1,
    };
    const recoveredSession: IChannelSession = {
      ...staleSession,
      id: 'session-new',
      conversationId: 'conv-new',
    };
    const recoveredConversation = {
      id: 'conv-new',
      type: 'gemini',
      name: 'tg-gemini-chat-1',
      source: 'telegram',
      channelChatId: 'chat-1',
      extra: { workspace: '/tmp/channel-ws' },
      model: { id: 'provider-1', useModel: 'gemini-2.5-pro' },
    } as unknown as TChatConversation;
    const plugin = {
      type: 'telegram',
      sendMessage: vi.fn(async () => 'thinking-1'),
      editMessage: vi.fn(async () => {}),
    };
    const pluginManager = {
      getPlugin: vi.fn(() => plugin),
      getAllPlugins: vi.fn(() => [plugin]),
    };
    const sessionManager = {
      getSession: vi.fn(() => staleSession),
      clearSession: vi.fn(async () => true),
      createSessionWithConversation: vi.fn(async () => recoveredSession),
      updateSessionActivity: vi.fn(async () => {}),
    };
    const pairingService = {
      isUserAuthorized: vi.fn(async () => true),
    };
    const db = {
      getChannelUserByPlatform: vi.fn(() => ({ success: true, data: channelUser })),
      getConversation: vi.fn((id: string) =>
        id === 'conv-old' ? { success: false, error: 'Conversation not found' } : { success: true, data: null }
      ),
      findChannelConversation: vi.fn(() => ({ success: true, data: recoveredConversation })),
    };
    mocks.getDatabase.mockResolvedValue(db);

    const executor = new ActionExecutor(
      pluginManager as ConstructorParameters<typeof ActionExecutor>[0],
      sessionManager as ConstructorParameters<typeof ActionExecutor>[1],
      pairingService as ConstructorParameters<typeof ActionExecutor>[2]
    );
    const message: IUnifiedIncomingMessage = {
      id: 'incoming-1',
      pluginId: 'telegram_default',
      platform: 'telegram',
      chatId: 'chat-1',
      user: {
        id: 'telegram-user-1',
        displayName: 'Tester',
      },
      content: {
        type: 'text',
        text: 'hello from telegram',
      },
      timestamp: Date.now(),
    };

    const handleIncomingMessage = Reflect.get(executor, 'handleIncomingMessage') as (
      input: IUnifiedIncomingMessage
    ) => Promise<void>;
    await handleIncomingMessage.call(executor, message);

    expect(sessionManager.clearSession).toHaveBeenCalledWith(channelUser.id, 'chat-1');
    expect(db.findChannelConversation).toHaveBeenCalledWith('telegram', 'telegram_default', 'chat-1', 'acp', 'droid');
    expect(sessionManager.createSessionWithConversation).toHaveBeenCalledWith(
      channelUser,
      'conv-new',
      'acp',
      undefined,
      'chat-1'
    );
    expect(mocks.messageService.sendMessage).toHaveBeenCalledWith(
      'session-new',
      'conv-new',
      'hello from telegram',
      expect.any(Function)
    );
    expect(plugin.sendMessage).toHaveBeenCalledWith(
      'chat-1',
      expect.objectContaining({
        text: '⏳ Thinking...',
      })
    );
  });

  it('routes the next inbound text into a pending Droid AskUser confirmation', async () => {
    const channelUser: IChannelUser = {
      id: 'channel-user-2',
      pluginId: 'telegram_default',
      platformUserId: 'telegram-user-2',
      platformType: 'telegram',
      displayName: 'Tester',
      authorizedAt: Date.now(),
    };
    const session: IChannelSession = {
      id: 'session-ask',
      pluginId: 'telegram_default',
      userId: channelUser.id,
      agentType: 'gemini',
      conversationId: 'conv-ask',
      chatId: 'chat-ask',
      createdAt: 1,
      lastActivity: 1,
    };
    const plugin = {
      type: 'telegram',
      sendMessage: vi.fn(async () => 'msg-1'),
      editMessage: vi.fn(async () => {}),
    };
    const pluginManager = {
      getPlugin: vi.fn(() => plugin),
      getAllPlugins: vi.fn(() => [plugin]),
    };
    const sessionManager = {
      getSession: vi.fn(() => session),
      clearSession: vi.fn(async () => true),
      createSessionWithConversation: vi.fn(async () => session),
      updateSessionActivity: vi.fn(async () => {}),
    };
    const pairingService = {
      isUserAuthorized: vi.fn(async () => true),
    };
    const db = {
      getChannelUserByPlatform: vi.fn(() => ({ success: true, data: channelUser })),
      getConversation: vi.fn(() => ({ success: true, data: { id: 'conv-ask' } })),
      findChannelConversation: vi.fn(),
    };
    const confirm = vi.fn();
    mocks.getDatabase.mockResolvedValue(db);
    mocks.workerTaskManagerGetTask.mockReturnValue({
      getConfirmations: () => [
        {
          id: 'confirm-1',
          callId: 'ask-call-1',
          description: 'Please answer',
          options: [],
          interaction: {
            type: 'ask_user',
            questions: [{ index: 0, topic: 'Mode', question: 'Pick one', options: ['Fast', 'Safe'] }],
          },
        },
      ],
      confirm,
    });

    const executor = new ActionExecutor(
      pluginManager as ConstructorParameters<typeof ActionExecutor>[0],
      sessionManager as ConstructorParameters<typeof ActionExecutor>[1],
      pairingService as ConstructorParameters<typeof ActionExecutor>[2]
    );
    const message: IUnifiedIncomingMessage = {
      id: 'incoming-ask',
      pluginId: 'telegram_default',
      platform: 'telegram',
      chatId: 'chat-ask',
      user: {
        id: 'telegram-user-2',
        displayName: 'Tester',
      },
      content: {
        type: 'text',
        text: '2',
      },
      timestamp: Date.now(),
    };

    const handleIncomingMessage = Reflect.get(executor, 'handleIncomingMessage') as (
      input: IUnifiedIncomingMessage
    ) => Promise<void>;
    await handleIncomingMessage.call(executor, message);

    expect(confirm).toHaveBeenCalledWith('confirm-1', 'ask-call-1', {
      answers: [{ index: 0, question: 'Pick one', answer: 'Safe' }],
    });
    expect(mocks.messageService.sendMessage).not.toHaveBeenCalled();
    expect(plugin.sendMessage).not.toHaveBeenCalled();
  });
});
