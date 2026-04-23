import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAcpMessage } from '@/renderer/pages/conversation/platforms/acp/useAcpMessage';

const mockAddOrUpdateMessage = vi.fn();
const mockConversationGetInvoke = vi.fn();
const mockConversationUpdateInvoke = vi.fn();
const mockResponseStreamOn = vi.fn(() => () => {});
const mockUpdateTabName = vi.fn();
const mockEmitterEmit = vi.fn();

vi.mock('@/renderer/pages/conversation/Messages/hooks', () => ({
  useAddOrUpdateMessage: () => mockAddOrUpdateMessage,
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      get: {
        invoke: (...args: unknown[]) => mockConversationGetInvoke(...args),
      },
      update: {
        invoke: (...args: unknown[]) => mockConversationUpdateInvoke(...args),
      },
    },
    acpConversation: {
      responseStream: {
        on: (...args: unknown[]) => mockResponseStreamOn(...args),
      },
    },
  },
}));

vi.mock('@/renderer/pages/conversation/hooks/ConversationTabsContext', () => ({
  useConversationTabs: () => ({ updateTabName: mockUpdateTabName }),
}));

vi.mock('@/renderer/utils/emitter', () => ({
  emitter: { emit: (...args: unknown[]) => mockEmitterEmit(...args) },
}));

describe('useAcpMessage — conversation hydration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConversationGetInvoke.mockResolvedValue({
      status: 'idle',
      type: 'acp',
    });
  });

  it('does not clear aiProcessing when get resolves non-running after setAiProcessing(true)', async () => {
    let resolveGet!: (value: unknown) => void;
    mockConversationGetInvoke.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveGet = resolve;
        })
    );

    const { result } = renderHook(() => useAcpMessage('conv-hydrate-1'));

    await waitFor(() => {
      expect(mockConversationGetInvoke).toHaveBeenCalledWith({ id: 'conv-hydrate-1' });
    });

    result.current.setAiProcessing(true);

    resolveGet({ status: 'idle', type: 'acp' });

    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });

    expect(result.current.aiProcessing).toBe(true);
    expect(result.current.running).toBe(false);
  });

  it('sets aiProcessing when backend reports status running', async () => {
    mockConversationGetInvoke.mockResolvedValue({
      status: 'running',
      type: 'acp',
    });

    const { result } = renderHook(() => useAcpMessage('conv-running'));

    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });

    expect(result.current.aiProcessing).toBe(true);
    expect(result.current.running).toBe(true);
  });

  it('clears aiProcessing when conversation.get returns null', async () => {
    mockConversationGetInvoke.mockResolvedValue(null);

    const { result } = renderHook(() => useAcpMessage('conv-missing'));

    result.current.setAiProcessing(true);

    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });

    expect(result.current.aiProcessing).toBe(false);
    expect(result.current.running).toBe(false);
  });

  it('clears aiProcessing when switching conversation_id', async () => {
    mockConversationGetInvoke.mockResolvedValue({ status: 'idle', type: 'acp' });

    const { result, rerender } = renderHook(({ id }: { id: string }) => useAcpMessage(id), {
      initialProps: { id: 'conv-switch-a' },
    });

    await waitFor(() => expect(result.current.hasHydratedRunningState).toBe(true));

    result.current.setAiProcessing(true);
    await waitFor(() => expect(result.current.aiProcessing).toBe(true));

    rerender({ id: 'conv-switch-b' });

    await waitFor(() => {
      expect(mockConversationGetInvoke).toHaveBeenLastCalledWith({ id: 'conv-switch-b' });
    });

    await waitFor(() => expect(result.current.aiProcessing).toBe(false));
    expect(result.current.hasThinkingMessage).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Mission events — 6 cases before default (VAL-MISSION-013)
// ═════════════════════════════════════════════════════════════════════════════

describe('useAcpMessage — mission events', () => {
  let capturedHandler: ((msg: Record<string, unknown>) => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedHandler = null;
    mockConversationGetInvoke.mockResolvedValue({ status: 'idle', type: 'acp' });
    mockResponseStreamOn.mockImplementation((handler: (msg: Record<string, unknown>) => void) => {
      capturedHandler = handler;
      return () => {};
    });
  });

  const MISSION_TYPES = [
    'mission_state',
    'mission_features',
    'mission_progress',
    'mission_heartbeat',
    'mission_worker_started',
    'mission_worker_completed',
  ] as const;

  it.each(MISSION_TYPES)('%s does NOT set running=true (not treated as default)', async (type) => {
    const onMissionEvent = vi.fn();
    const { result } = renderHook(() => useAcpMessage('conv-mission', onMissionEvent));

    await waitFor(() => expect(result.current.hasHydratedRunningState).toBe(true));

    // Simulate the mission event
    capturedHandler?.({
      type,
      conversation_id: 'conv-mission',
      msg_id: `${type}_test`,
      data: { state: 'running', featureId: 'f1', timestamp: '2025-01-01T00:00:00Z', features: [], success: true },
    });

    // running should remain false — mission events don't flip running
    await waitFor(() => {
      expect(result.current.running).toBe(false);
    });
  });

  it.each(MISSION_TYPES)('%s calls onMissionEvent callback', async (type) => {
    const onMissionEvent = vi.fn();
    const { result } = renderHook(() => useAcpMessage('conv-mission-cb', onMissionEvent));

    await waitFor(() => expect(result.current.hasHydratedRunningState).toBe(true));

    const msg = {
      type,
      conversation_id: 'conv-mission-cb',
      msg_id: `${type}_cb`,
      data: { state: 'planning' },
    };
    capturedHandler?.(msg);

    await waitFor(() => {
      expect(onMissionEvent).toHaveBeenCalledWith(msg);
    });
  });

  it('filters mission events by conversation_id', async () => {
    const onMissionEvent = vi.fn();
    const { result } = renderHook(() => useAcpMessage('conv-filter', onMissionEvent));

    await waitFor(() => expect(result.current.hasHydratedRunningState).toBe(true));

    capturedHandler?.({
      type: 'mission_state',
      conversation_id: 'different-conv',
      msg_id: 'filter_test',
      data: { state: 'running' },
    });

    // Should not call onMissionEvent because conversation_id differs
    expect(onMissionEvent).not.toHaveBeenCalled();
  });

  it('unknown_future_type still reaches default (legacy preserved)', async () => {
    const onMissionEvent = vi.fn();
    const { result } = renderHook(() => useAcpMessage('conv-unknown', onMissionEvent));

    await waitFor(() => expect(result.current.hasHydratedRunningState).toBe(true));

    capturedHandler?.({
      type: 'unknown_future_type',
      conversation_id: 'conv-unknown',
      msg_id: 'unknown_test',
      data: {},
    });

    // Default branch should set running=true
    await waitFor(() => {
      expect(result.current.running).toBe(true);
    });

    // Mission handler should NOT be called
    expect(onMissionEvent).not.toHaveBeenCalled();
    // addOrUpdateMessage should be called
    expect(mockAddOrUpdateMessage).toHaveBeenCalled();
  });

  it('mission events after finish do NOT resurrect running', async () => {
    const onMissionEvent = vi.fn();
    const { result } = renderHook(() => useAcpMessage('conv-finish', onMissionEvent));

    await waitFor(() => expect(result.current.hasHydratedRunningState).toBe(true));

    // Simulate a finish event
    capturedHandler?.({
      type: 'finish',
      conversation_id: 'conv-finish',
      msg_id: 'finish_1',
      data: {},
    });

    await waitFor(() => {
      expect(result.current.running).toBe(false);
    });

    // Now send a mission_progress event — should NOT set running=true
    capturedHandler?.({
      type: 'mission_progress',
      conversation_id: 'conv-finish',
      msg_id: 'mp_after_finish',
      data: { entries: [{ text: 'Worker 1 progress' }] },
    });

    expect(result.current.running).toBe(false);
  });
});

// ── VAL-STREAM-001..003: session_title event consumer ─────────────────────
describe('useAcpMessage — session_title event', () => {
  let capturedHandler: ((msg: Record<string, unknown>) => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedHandler = null;
    mockConversationGetInvoke.mockResolvedValue({
      id: 'C1',
      name: '新对话',
      messages: [],
      platform: 'acp',
    });
    mockResponseStreamOn.mockImplementation(((handler: (msg: Record<string, unknown>) => void) => {
      capturedHandler = handler;
      return () => {};
    }) as typeof mockResponseStreamOn);
  });

  // VAL-STREAM-001: session_title updates conversation name end-to-end
  it('invokes IPC update, updateTabName, and emitter on matching session_title', async () => {
    const { result } = renderHook(() => useAcpMessage('C1'));
    await waitFor(() => expect(result.current.hasHydratedRunningState).toBe(true));

    capturedHandler?.({
      type: 'session_title',
      conversation_id: 'C1',
      msg_id: 'session_title_abc',
      data: { sessionId: 'sess-1', title: 'AionUi deep integration' },
    });

    await waitFor(() => {
      // (1) IPC conversation.update called with correct args
      expect(mockConversationUpdateInvoke).toHaveBeenCalledOnce();
      expect(mockConversationUpdateInvoke).toHaveBeenCalledWith({
        id: 'C1',
        updates: { name: 'AionUi deep integration' },
      });
      // (2) Tab name updated
      expect(mockUpdateTabName).toHaveBeenCalledOnce();
      expect(mockUpdateTabName).toHaveBeenCalledWith('C1', 'AionUi deep integration');
      // (3) Sidebar refresh emitted
      expect(mockEmitterEmit).toHaveBeenCalledWith('chat.history.refresh');
    });

    // MUST NOT call addOrUpdateMessage
    expect(mockAddOrUpdateMessage).not.toHaveBeenCalled();
  });

  // VAL-STREAM-002: session_title is filtered by conversation_id
  it('does NOT invoke IPC/emitter when conversation_id does not match', async () => {
    const { result } = renderHook(() => useAcpMessage('C1'));
    await waitFor(() => expect(result.current.hasHydratedRunningState).toBe(true));

    // Event for a DIFFERENT conversation C2
    capturedHandler?.({
      type: 'session_title',
      conversation_id: 'C2',
      msg_id: 'session_title_xyz',
      data: { sessionId: 'sess-2', title: 'Other title' },
    });

    // Give it a tick
    await waitFor(() => expect(result.current.hasHydratedRunningState).toBe(true));

    expect(mockConversationUpdateInvoke).not.toHaveBeenCalled();
    expect(mockUpdateTabName).not.toHaveBeenCalled();
    expect(mockEmitterEmit).not.toHaveBeenCalled();
    expect(mockAddOrUpdateMessage).not.toHaveBeenCalled();
  });

  // VAL-STREAM-003: session_title does NOT flip running/aiProcessing state
  it('does NOT change running or aiProcessing state', async () => {
    const { result } = renderHook(() => useAcpMessage('C1'));
    await waitFor(() => expect(result.current.hasHydratedRunningState).toBe(true));

    // Confirm initial idle state
    expect(result.current.running).toBe(false);

    capturedHandler?.({
      type: 'session_title',
      conversation_id: 'C1',
      msg_id: 'session_title_noflip',
      data: { sessionId: 'sess-1', title: 'New Title' },
    });

    // running must remain false — the handler MUST NOT set running or aiProcessing
    await waitFor(() => {
      expect(mockConversationUpdateInvoke).toHaveBeenCalledOnce();
    });
    expect(result.current.running).toBe(false);
  });
});

// ── VAL-STREAM-004..005: settings_updated event consumer ──────────────────
describe('useAcpMessage — settings_updated event', () => {
  let capturedHandler: ((msg: Record<string, unknown>) => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedHandler = null;
    mockConversationGetInvoke.mockResolvedValue({
      id: 'C1',
      name: 'Test Conversation',
      messages: [],
      platform: 'acp',
    });
    mockResponseStreamOn.mockImplementation(((handler: (msg: Record<string, unknown>) => void) => {
      capturedHandler = handler;
      return () => {};
    }) as typeof mockResponseStreamOn);
  });

  // VAL-STREAM-004: settings_updated emits acp.settings.updated with authoritative currentModelId
  it('emits acp.settings.updated with currentModelId on matching settings_updated', async () => {
    const { result } = renderHook(() => useAcpMessage('C1'));
    await waitFor(() => expect(result.current.hasHydratedRunningState).toBe(true));

    capturedHandler?.({
      type: 'settings_updated',
      conversation_id: 'C1',
      msg_id: 'settings_updated_1',
      data: {
        sessionId: 'sess-1',
        changed: { modelId: 'claude-opus-4.7', reasoningEffort: 'high' },
        currentModelId: 'claude-opus-4.7',
      },
    });

    await waitFor(() => {
      expect(mockEmitterEmit).toHaveBeenCalledWith('acp.settings.updated', {
        conversationId: 'C1',
        currentModelId: 'claude-opus-4.7',
      });
    });

    // MUST NOT call addOrUpdateMessage — no phantom message row
    expect(mockAddOrUpdateMessage).not.toHaveBeenCalled();
  });

  // VAL-STREAM-004 (filter): settings_updated is filtered by conversation_id
  it('does NOT emit when conversation_id does not match', async () => {
    const { result } = renderHook(() => useAcpMessage('C1'));
    await waitFor(() => expect(result.current.hasHydratedRunningState).toBe(true));

    capturedHandler?.({
      type: 'settings_updated',
      conversation_id: 'C2',
      msg_id: 'settings_updated_other',
      data: {
        sessionId: 'sess-2',
        changed: { modelId: 'gpt-5' },
        currentModelId: 'gpt-5',
      },
    });

    // Give it a tick
    await waitFor(() => expect(result.current.hasHydratedRunningState).toBe(true));

    expect(mockEmitterEmit).not.toHaveBeenCalled();
    expect(mockAddOrUpdateMessage).not.toHaveBeenCalled();
  });

  // VAL-STREAM-005: settings_updated mid-turn does NOT flip running/aiProcessing
  it('does NOT flip running or aiProcessing when received mid-turn', async () => {
    const { result } = renderHook(() => useAcpMessage('C1'));
    await waitFor(() => expect(result.current.hasHydratedRunningState).toBe(true));

    // Simulate a start event to set running=true (mid-turn)
    capturedHandler?.({
      type: 'start',
      conversation_id: 'C1',
      msg_id: 'start_1',
      data: {},
    });

    await waitFor(() => {
      expect(result.current.running).toBe(true);
    });

    // Now send settings_updated mid-turn
    capturedHandler?.({
      type: 'settings_updated',
      conversation_id: 'C1',
      msg_id: 'settings_updated_midturn',
      data: {
        sessionId: 'sess-1',
        changed: { modelId: 'claude-opus-4.7' },
        currentModelId: 'claude-opus-4.7',
      },
    });

    // running should STILL be true — settings_updated must not toggle it
    expect(result.current.running).toBe(true);

    // The emitter should still fire for selector refresh
    await waitFor(() => {
      expect(mockEmitterEmit).toHaveBeenCalledWith('acp.settings.updated', {
        conversationId: 'C1',
        currentModelId: 'claude-opus-4.7',
      });
    });

    // addOrUpdateMessage should NOT have been called by settings_updated
    expect(mockAddOrUpdateMessage).not.toHaveBeenCalled();
  });

  // VAL-STREAM-005 (idle): settings_updated when idle does NOT set running=true
  it('does NOT set running=true when received while idle', async () => {
    const { result } = renderHook(() => useAcpMessage('C1'));
    await waitFor(() => expect(result.current.hasHydratedRunningState).toBe(true));

    // Confirm initial idle state
    expect(result.current.running).toBe(false);

    capturedHandler?.({
      type: 'settings_updated',
      conversation_id: 'C1',
      msg_id: 'settings_updated_idle',
      data: {
        sessionId: 'sess-1',
        changed: { modelId: 'gpt-5' },
        currentModelId: 'gpt-5',
      },
    });

    // running must remain false — settings_updated MUST NOT set running
    await waitFor(() => {
      expect(mockEmitterEmit).toHaveBeenCalledWith('acp.settings.updated', {
        conversationId: 'C1',
        currentModelId: 'gpt-5',
      });
    });
    expect(result.current.running).toBe(false);
    expect(mockAddOrUpdateMessage).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// mcp_status — VAL-STREAM-006..008
// ═══════════════════════════════════════════════════════════════════════════
describe('useAcpMessage — mcp_status stream event', () => {
  let capturedHandler: ((msg: Record<string, unknown>) => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedHandler = null;
    mockConversationGetInvoke.mockResolvedValue({
      id: 'C1',
      name: 'Test Conversation',
      messages: [],
      platform: 'acp',
    });
    mockResponseStreamOn.mockImplementation(((handler: (msg: Record<string, unknown>) => void) => {
      capturedHandler = handler;
      return () => {};
    }) as typeof mockResponseStreamOn);
  });

  // VAL-STREAM-006: mcp_status emits mcp.status.updated with server data
  it('emits mcp.status.updated with servers on matching mcp_status', async () => {
    const { result } = renderHook(() => useAcpMessage('C1'));
    await waitFor(() => expect(result.current.hasHydratedRunningState).toBe(true));

    const servers = [
      { name: 'sequential-thinking', status: 'connected', toolCount: 5 },
      { name: 'github-mcp', status: 'connected', toolCount: 12 },
    ];

    capturedHandler?.({
      type: 'mcp_status',
      conversation_id: 'C1',
      msg_id: 'mcp_status_1',
      data: {
        sessionId: 'sess-1',
        servers,
        summary: { total: 2, connected: 2, connecting: 0, failed: 0 },
      },
    });

    await waitFor(() => {
      expect(mockEmitterEmit).toHaveBeenCalledWith('mcp.status.updated', {
        servers,
      });
    });

    // MUST NOT call addOrUpdateMessage
    expect(mockAddOrUpdateMessage).not.toHaveBeenCalled();
  });

  // VAL-STREAM-007: mcp_status is filtered by conversation_id
  it('does NOT emit when conversation_id does not match', async () => {
    const { result } = renderHook(() => useAcpMessage('C1'));
    await waitFor(() => expect(result.current.hasHydratedRunningState).toBe(true));

    capturedHandler?.({
      type: 'mcp_status',
      conversation_id: 'OTHER',
      msg_id: 'mcp_status_other',
      data: {
        sessionId: 'sess-1',
        servers: [{ name: 'test', status: 'connected', toolCount: 1 }],
      },
    });

    // Wait a tick to ensure no async handler fires
    await waitFor(() => expect(result.current.hasHydratedRunningState).toBe(true));
    expect(mockEmitterEmit).not.toHaveBeenCalledWith('mcp.status.updated', expect.anything());
    expect(mockAddOrUpdateMessage).not.toHaveBeenCalled();
  });

  // VAL-STREAM-008: mcp_status does not flip running/aiProcessing
  it('does NOT set running=true when received while idle', async () => {
    const { result } = renderHook(() => useAcpMessage('C1'));
    await waitFor(() => expect(result.current.hasHydratedRunningState).toBe(true));

    expect(result.current.running).toBe(false);

    capturedHandler?.({
      type: 'mcp_status',
      conversation_id: 'C1',
      msg_id: 'mcp_status_idle',
      data: {
        sessionId: 'sess-1',
        servers: [{ name: 'test', status: 'connected', toolCount: 1 }],
      },
    });

    await waitFor(() => {
      expect(mockEmitterEmit).toHaveBeenCalledWith('mcp.status.updated', {
        servers: [{ name: 'test', status: 'connected', toolCount: 1 }],
      });
    });

    // running and aiProcessing must remain unchanged
    expect(result.current.running).toBe(false);
    expect(mockAddOrUpdateMessage).not.toHaveBeenCalled();
  });
});

// ── VAL-STREAM-009..010 (useAcpMessage side): mcp_auth emitter relay ────────
describe('useAcpMessage — mcp_auth event relay', () => {
  let capturedHandler: ((msg: Record<string, unknown>) => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedHandler = null;
    mockConversationGetInvoke.mockResolvedValue({ status: 'idle', type: 'acp' });
    mockResponseStreamOn.mockImplementation((handler: (msg: Record<string, unknown>) => void) => {
      capturedHandler = handler;
      return () => {};
    });
  });

  // mcp_auth emits mcp.auth.required on the emitter (app-global, no conversation filter)
  it('emits mcp.auth.required when mcp_auth arrives', async () => {
    const { result } = renderHook(() => useAcpMessage('C1'));
    await waitFor(() => expect(result.current.hasHydratedRunningState).toBe(true));

    capturedHandler?.({
      type: 'mcp_auth',
      conversation_id: 'C1',
      msg_id: 'mcp_auth_1',
      data: {
        sessionId: 'sess-1',
        serverName: 'github-mcp',
        authUrl: 'https://github.com/login/oauth/authorize',
        message: 'Auth required',
        state: 'pending',
      },
    });

    await waitFor(() => {
      expect(mockEmitterEmit).toHaveBeenCalledWith('mcp.auth.required', {
        serverName: 'github-mcp',
        authUrl: 'https://github.com/login/oauth/authorize',
        message: 'Auth required',
        state: 'pending',
      });
    });

    // MUST NOT call addOrUpdateMessage
    expect(mockAddOrUpdateMessage).not.toHaveBeenCalled();
  });

  // mcp_auth does NOT flip running/aiProcessing
  it('does NOT set running=true when mcp_auth received while idle', async () => {
    const { result } = renderHook(() => useAcpMessage('C1'));
    await waitFor(() => expect(result.current.hasHydratedRunningState).toBe(true));

    expect(result.current.running).toBe(false);

    capturedHandler?.({
      type: 'mcp_auth',
      conversation_id: 'C1',
      msg_id: 'mcp_auth_idle',
      data: {
        sessionId: 'sess-1',
        serverName: 'test-server',
        message: 'Auth needed',
      },
    });

    await waitFor(() => {
      expect(mockEmitterEmit).toHaveBeenCalledWith('mcp.auth.required', expect.anything());
    });

    expect(result.current.running).toBe(false);
    expect(mockAddOrUpdateMessage).not.toHaveBeenCalled();
  });

  // mcp_auth is app-global: fires even for a different conversation_id
  it('emits mcp.auth.required even for a different conversation_id (app-global)', async () => {
    const { result } = renderHook(() => useAcpMessage('C1'));
    await waitFor(() => expect(result.current.hasHydratedRunningState).toBe(true));

    capturedHandler?.({
      type: 'mcp_auth',
      conversation_id: 'C2',
      msg_id: 'mcp_auth_other',
      data: {
        sessionId: 'sess-2',
        serverName: 'slack-mcp',
        message: 'Please authenticate',
      },
    });

    await waitFor(() => {
      expect(mockEmitterEmit).toHaveBeenCalledWith('mcp.auth.required', {
        serverName: 'slack-mcp',
        authUrl: undefined,
        message: 'Please authenticate',
        state: undefined,
      });
    });

    expect(mockAddOrUpdateMessage).not.toHaveBeenCalled();
  });
});

// ── VAL-STREAM-012: stream-default-branch invariant lock test ───────────────
describe('useAcpMessage — stream-default-branch invariant (VAL-STREAM-012)', () => {
  let capturedHandler: ((msg: Record<string, unknown>) => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedHandler = null;
    mockConversationGetInvoke.mockResolvedValue({ status: 'idle', type: 'acp' });
    mockResponseStreamOn.mockImplementation((handler: (msg: Record<string, unknown>) => void) => {
      capturedHandler = handler;
      return () => {};
    });
  });

  // All 4 new stream metadata types MUST NOT reach the default branch
  it.each([
    ['session_title', { title: 'Test' }],
    ['settings_updated', { changed: {}, currentModelId: 'gpt-4' }],
    ['mcp_status', { servers: [{ name: 'test', status: 'connected' }] }],
    ['mcp_auth', { serverName: 'test-mcp', message: 'Auth needed' }],
  ] as const)('%s does NOT reach default branch (no addOrUpdateMessage, no running flip)', async (eventType, data) => {
    const { result } = renderHook(() => useAcpMessage('C1'));
    await waitFor(() => expect(result.current.hasHydratedRunningState).toBe(true));

    expect(result.current.running).toBe(false);

    capturedHandler?.({
      type: eventType,
      conversation_id: 'C1',
      msg_id: `${eventType}_test`,
      data: { sessionId: 'sess-1', ...data },
    });

    // Wait a tick to ensure async handlers settle
    await waitFor(() => expect(result.current.hasHydratedRunningState).toBe(true));

    // The default branch sets running=true and calls addOrUpdateMessage.
    // Neither must happen for these event types.
    expect(result.current.running).toBe(false);
    expect(mockAddOrUpdateMessage).not.toHaveBeenCalled();
  });

  // Synthetic unknown type STILL reaches default branch
  it('unknown event type reaches default branch (sets running, calls addOrUpdateMessage)', async () => {
    const { result } = renderHook(() => useAcpMessage('C1'));
    await waitFor(() => expect(result.current.hasHydratedRunningState).toBe(true));

    expect(result.current.running).toBe(false);

    capturedHandler?.({
      type: 'totally_unknown_event',
      conversation_id: 'C1',
      msg_id: 'unknown_1',
      content: 'Some content',
    });

    await waitFor(() => {
      expect(result.current.running).toBe(true);
    });

    expect(mockAddOrUpdateMessage).toHaveBeenCalled();
  });
});

// ── VAL-STREAM-013: remount reconciliation + listener cleanup ───────────────
describe('useAcpMessage — remount reconciliation (VAL-STREAM-013)', () => {
  let capturedHandler: ((msg: Record<string, unknown>) => void) | null = null;
  let cleanupSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedHandler = null;
    cleanupSpy = vi.fn();
    mockResponseStreamOn.mockImplementation((handler: (msg: Record<string, unknown>) => void) => {
      capturedHandler = handler;
      return cleanupSpy;
    });
  });

  // All .on() subscriptions paired with .off() cleanup on unmount
  it('responseStream.on cleanup is called on unmount (no listener leak)', async () => {
    mockConversationGetInvoke.mockResolvedValue({ status: 'idle', type: 'acp' });

    const { unmount } = renderHook(() => useAcpMessage('C1'));
    await waitFor(() => expect(mockResponseStreamOn).toHaveBeenCalled());

    unmount();

    // The cleanup function returned by responseStream.on must be called
    expect(cleanupSpy).toHaveBeenCalled();
  });

  // turnFinishedRef reseeds from DB on remount (running=true → hydration reflects it)
  it('reseeds running state from DB on remount', async () => {
    // First mount: idle
    mockConversationGetInvoke.mockResolvedValue({ status: 'idle', type: 'acp' });
    const { result, unmount } = renderHook(() => useAcpMessage('C1'));
    await waitFor(() => expect(result.current.hasHydratedRunningState).toBe(true));
    expect(result.current.running).toBe(false);

    unmount();

    // Second mount: backend reports running
    mockConversationGetInvoke.mockResolvedValue({ status: 'running', type: 'acp' });
    const { result: result2 } = renderHook(() => useAcpMessage('C1'));
    await waitFor(() => expect(result2.current.hasHydratedRunningState).toBe(true));
    expect(result2.current.running).toBe(true);
  });

  // Previously applied effects not duplicated on remount
  it('does not duplicate session_title effect on remount', async () => {
    mockConversationGetInvoke.mockResolvedValue({ status: 'idle', type: 'acp' });

    // First mount
    const { unmount } = renderHook(() => useAcpMessage('C1'));
    await waitFor(() => expect(mockResponseStreamOn).toHaveBeenCalled());

    capturedHandler?.({
      type: 'session_title',
      conversation_id: 'C1',
      msg_id: 'title_1',
      data: { sessionId: 'sess-1', title: 'First Title' },
    });

    await waitFor(() => {
      expect(mockConversationUpdateInvoke).toHaveBeenCalledOnce();
    });

    unmount();

    // Reset mocks and remount
    vi.clearAllMocks();
    mockConversationGetInvoke.mockResolvedValue({ status: 'idle', type: 'acp' });
    mockResponseStreamOn.mockImplementation((handler: (msg: Record<string, unknown>) => void) => {
      capturedHandler = handler;
      return vi.fn();
    });

    renderHook(() => useAcpMessage('C1'));
    await waitFor(() => expect(mockResponseStreamOn).toHaveBeenCalled());

    // The title update from the previous mount should NOT have been replayed
    expect(mockConversationUpdateInvoke).not.toHaveBeenCalled();
  });
});
