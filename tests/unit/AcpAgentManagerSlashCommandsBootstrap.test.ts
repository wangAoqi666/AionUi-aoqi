import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoist the shared mock for ipcBridge.acpConversation.responseStream.emit so
// individual cases can assert emit behaviour while the factory is evaluated
// during the initial import pass.
const { mockEmit } = vi.hoisted(() => ({
  mockEmit: vi.fn(),
}));

// --- Module mocks ---

vi.mock('@/common/platform', () => ({
  getPlatformServices: () => ({
    paths: { isPackaged: () => false, getAppPath: () => null },
    worker: {
      fork: vi.fn(() => ({
        on: vi.fn().mockReturnThis(),
        postMessage: vi.fn(),
        kill: vi.fn(),
      })),
    },
  }),
}));

vi.mock('@process/utils/shellEnv', () => ({
  getEnhancedEnv: vi.fn(() => ({})),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    acpConversation: { responseStream: { emit: mockEmit } },
    conversation: {
      confirmation: {
        add: { emit: vi.fn() },
        update: { emit: vi.fn() },
        remove: { emit: vi.fn() },
      },
      responseStream: { emit: vi.fn() },
    },
  },
}));

vi.mock('@process/channels/agent/ChannelEventBus', () => ({
  channelEventBus: { emitAgentMessage: vi.fn() },
}));

vi.mock('@process/services/database', () => ({
  getDatabase: vi.fn(async () => ({ updateConversation: vi.fn() })),
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
  handlePreviewOpenEvent: vi.fn(),
}));

vi.mock('@process/services/cron/CronBusyGuard', () => ({
  cronBusyGuard: { setProcessing: vi.fn() },
}));

vi.mock('@process/utils/mainLogger', () => ({
  mainLog: vi.fn(),
  mainWarn: vi.fn(),
  mainError: vi.fn(),
}));

vi.mock('@process/extensions', () => ({
  ExtensionRegistry: { getInstance: () => ({ getAcpAdapters: () => [] }) },
}));

vi.mock('@/common/utils', () => ({
  parseError: vi.fn((e: unknown) => String(e)),
  uuid: vi.fn(() => 'mock-uuid'),
}));

vi.mock('@process/task/MessageMiddleware', () => ({
  extractTextFromMessage: vi.fn(),
  processCronInMessage: vi.fn(),
}));

vi.mock('@process/task/ThinkTagDetector', () => ({
  stripThinkTags: vi.fn((s: string) => s),
}));

vi.mock('@process/task/CronCommandDetector', () => ({
  hasCronCommands: vi.fn(() => false),
}));

vi.mock('@process/utils/initAgent', () => ({
  hasNativeSkillSupport: vi.fn(() => true),
  setupAssistantWorkspace: vi.fn(),
}));

vi.mock('@process/task/agentUtils', () => ({
  prepareFirstMessageWithSkillsIndex: vi.fn(async (c: string) => c),
  buildSystemInstructions: vi.fn(async () => undefined),
}));

// Keep the AcpAgent / DroidSdkAgent mocks lightweight — we never actually
// bootstrap them because `handleStreamEvent` is exercised directly.
vi.mock('@process/agent/acp', () => ({
  AcpAgent: vi.fn().mockImplementation(() => ({
    sendMessage: vi.fn(async () => ({ success: true })),
    getModelInfo: vi.fn(() => null),
    getSessionState: vi.fn(() => null),
    stop: vi.fn(),
    kill: vi.fn(),
    on: vi.fn().mockReturnThis(),
  })),
}));

import AcpAgentManager from '@process/task/AcpAgentManager';

type AcpAgentManagerInternals = {
  bootstrapping: boolean;
  handleStreamEvent: (message: Record<string, unknown>, data: Record<string, unknown>) => void;
  options: Record<string, unknown>;
};

function createBootstrappingDroidManager(): {
  manager: InstanceType<typeof AcpAgentManager>;
  internals: AcpAgentManagerInternals;
} {
  const data = {
    conversation_id: 'test-conv',
    backend: 'droid' as const,
    workspace: '/tmp/test-workspace',
  };
  // @ts-expect-error - backend type narrowing
  const manager = new AcpAgentManager(data);
  const internals = manager as unknown as AcpAgentManagerInternals;
  // Force the bootstrap gate into the `true` state so we can observe the
  // whitelist behaviour in isolation — exactly the condition hit on the
  // fresh-conversation boot path that VAL-CROSS-001 was failing against.
  internals.bootstrapping = true;
  return { manager, internals };
}

describe('AcpAgentManager.handleStreamEvent — slash_commands_updated whitelist during bootstrap (VAL-CROSS-001)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards slash_commands_updated events to ipcBridge while bootstrapping=true', () => {
    const { internals } = createBootstrappingDroidManager();

    const payload = {
      type: 'slash_commands_updated',
      conversation_id: 'test-conv',
      msg_id: '',
      data: {
        source: 'droid-sdk',
        sessionId: 'sess-42',
        sdkSkills: Array.from({ length: 101 }, (_, i) => ({
          name: `skill-${i + 1}`,
          description: `description ${i + 1}`,
          kind: 'skill' as const,
          location: 'user' as const,
        })),
      },
    };

    internals.handleStreamEvent(payload, internals.options);

    // The whitelist must allow the event to propagate verbatim — this is the
    // fix for the failing VAL-CROSS-001 case where the renderer tap never saw
    // a `slash_commands_updated` during fresh-conversation boot.
    expect(mockEmit).toHaveBeenCalledTimes(1);
    expect(mockEmit).toHaveBeenCalledWith(payload);
  });

  it('forwards slash_commands_updated events carrying an `error` (listSkills rejection path) during bootstrap', () => {
    const { internals } = createBootstrappingDroidManager();

    const payload = {
      type: 'slash_commands_updated',
      conversation_id: 'test-conv',
      msg_id: '',
      data: {
        source: 'droid-sdk',
        sessionId: null,
        error: 'simulated listSkills rejection',
        sdkSkills: [],
      },
    };

    internals.handleStreamEvent(payload, internals.options);

    // Both DroidSdkAgent emit sites (success @ ~line 1837 and failure
    // @ ~line 1780) route through handleStreamEvent, so the whitelist must
    // cover the failure payload shape as well.
    expect(mockEmit).toHaveBeenCalledTimes(1);
    expect(mockEmit).toHaveBeenCalledWith(payload);
  });

  it('drops non-whitelisted event types (e.g. user_message_chunk) while bootstrapping=true — regression guard', () => {
    const { internals } = createBootstrappingDroidManager();

    const payload = {
      type: 'user_message_chunk',
      conversation_id: 'test-conv',
      msg_id: 'msg-xyz',
      data: { content: 'fragment' },
    };

    internals.handleStreamEvent(payload, internals.options);

    // The whitelist must be narrow: every other event type still obeys the
    // existing bootstrap guard so we do not leak partial turn state, DB
    // writes, or thinking-tag UI noise into the renderer before the session
    // is fully initialized.
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it('drops non-whitelisted event types (e.g. content) while bootstrapping=true — regression guard', () => {
    const { internals } = createBootstrappingDroidManager();

    const payload = {
      type: 'content',
      conversation_id: 'test-conv',
      msg_id: 'msg-abc',
      data: 'partial reply text',
    };

    internals.handleStreamEvent(payload, internals.options);

    expect(mockEmit).not.toHaveBeenCalled();
  });
});
