/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 *
 * DOM tests for MCP panel live-session sync:
 * - add / remove / toggle each fires the correct IPC invoke once
 * - config-write + IPC happen together
 * - IPC failure → Message.error with localized key
 *
 * VAL-IPC-013: live session reflects add/remove/toggle without restart
 * VAL-IPC-015: 6 IPC failure modes surfaced via Message.error/Message.warning
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* ── IPC mocks ──────────────────────────────────────────────────────────── */
const mockAddMcpServerInvoke = vi.fn().mockResolvedValue({ success: true });
const mockRemoveMcpServerInvoke = vi.fn().mockResolvedValue({ success: true });
const mockToggleMcpServerInvoke = vi.fn().mockResolvedValue({ success: true });
const mockListMcpServersInvoke = vi.fn().mockResolvedValue({ servers: [] });

vi.mock('@/common/adapter/ipcBridge', () => ({
  mcpService: {
    getAgentMcpConfigs: { invoke: vi.fn().mockResolvedValue({ success: true, data: [] }) },
  },
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    acpConversation: {
      addMcpServer: { invoke: (...args: unknown[]) => mockAddMcpServerInvoke(...args) },
      removeMcpServer: { invoke: (...args: unknown[]) => mockRemoveMcpServerInvoke(...args) },
      toggleMcpServer: { invoke: (...args: unknown[]) => mockToggleMcpServerInvoke(...args) },
      listMcpServers: { invoke: (...args: unknown[]) => mockListMcpServersInvoke(...args) },
      listMcpTools: { invoke: vi.fn().mockResolvedValue({ success: true, data: { tools: [] } }) },
    },
    extensions: { getMcpServers: { invoke: vi.fn().mockResolvedValue([]) } },
  },
}));

/* ── ConfigStorage mock ─────────────────────────────────────────────────── */
const storedConfig: Record<string, unknown> = { 'mcp.config': [], 'mcp.agentInstallStatus': {} };
vi.mock('@/common/config/storage', () => ({
  ConfigStorage: {
    get: vi.fn(async (key: string) => storedConfig[key] ?? null),
    set: vi.fn(async (key: string, value: unknown) => {
      storedConfig[key] = value;
    }),
  },
}));

/* ── Message / i18n mocks ───────────────────────────────────────────────── */
const mockMessageError = vi.fn();
const mockMessageSuccess = vi.fn();
const mockMessageWarning = vi.fn();

vi.mock('@arco-design/web-react', () => ({
  Message: {
    error: (...args: unknown[]) => mockMessageError(...args),
    success: (...args: unknown[]) => mockMessageSuccess(...args),
    warning: (...args: unknown[]) => mockMessageWarning(...args),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, string>) => {
      if (opts?.error) return `${key}:${opts.error}`;
      return key;
    },
  }),
}));

/* ── Active conversation mock ───────────────────────────────────────────── */
const mockGetActiveConversationId = vi.fn<() => string | null>().mockReturnValue('conv-active-001');
vi.mock('@/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync', () => ({
  getActiveConversationId: () => mockGetActiveConversationId(),
}));

/* ── Hook imports (after mocks) ─────────────────────────────────────────── */
import { useMcpServerCRUD } from '@/renderer/hooks/mcp/useMcpServerCRUD';
import type { IMcpServer } from '@/common/config/storage';

const makeServer = (name: string, enabled = true): IMcpServer => ({
  id: `mcp_${name}`,
  name,
  enabled,
  transport: { type: 'stdio' as const, command: 'echo', args: [] },
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

describe('useMcpServerCRUD — live-session IPC sync', () => {
  const mockSaveMcpServers = vi.fn<(arg: IMcpServer[] | ((prev: IMcpServer[]) => IMcpServer[])) => Promise<void>>(
    async (serversOrUpdater) => {
      // Simulate the state update by calling the updater if function
      if (typeof serversOrUpdater === 'function') {
        serversOrUpdater([]);
      }
    }
  );
  const mockSyncMcpToAgents = vi.fn().mockResolvedValue(undefined);
  const mockRemoveMcpFromAgents = vi.fn().mockResolvedValue(undefined);
  const mockCheckSingleServerInstallStatus = vi.fn().mockResolvedValue(undefined);
  const mockSetAgentInstallStatus = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockGetActiveConversationId.mockReturnValue('conv-active-001');
    mockAddMcpServerInvoke.mockResolvedValue({ success: true });
    mockRemoveMcpServerInvoke.mockResolvedValue({ success: true });
    mockToggleMcpServerInvoke.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── ADD: fires addMcpServer IPC once ────────────────────────────────────
  it('handleAddMcpServer calls acp.add-mcp-server IPC after config write', async () => {
    const { result } = renderHook(() =>
      useMcpServerCRUD(
        [],
        mockSaveMcpServers,
        mockSyncMcpToAgents,
        mockRemoveMcpFromAgents,
        mockCheckSingleServerInstallStatus,
        mockSetAgentInstallStatus
      )
    );

    await act(async () => {
      await result.current.handleAddMcpServer({
        name: 'test-server',
        enabled: true,
        transport: { type: 'stdio' as const, command: 'echo', args: [] },
      });
    });

    expect(mockSaveMcpServers).toHaveBeenCalledOnce();
    expect(mockAddMcpServerInvoke).toHaveBeenCalledOnce();
    expect(mockAddMcpServerInvoke).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-active-001',
        params: expect.objectContaining({ name: 'test-server' }),
      })
    );
  });

  // ── REMOVE: fires removeMcpServer IPC once ──────────────────────────────
  it('handleDeleteMcpServer calls acp.remove-mcp-server IPC', async () => {
    const server = makeServer('to-delete');
    const mockSave = vi.fn(async (updater: IMcpServer[] | ((prev: IMcpServer[]) => IMcpServer[])) => {
      if (typeof updater === 'function') updater([server]);
    });

    const { result } = renderHook(() =>
      useMcpServerCRUD(
        [server],
        mockSave,
        mockSyncMcpToAgents,
        mockRemoveMcpFromAgents,
        mockCheckSingleServerInstallStatus,
        mockSetAgentInstallStatus
      )
    );

    await act(async () => {
      await result.current.handleDeleteMcpServer(server.id);
    });

    expect(mockRemoveMcpServerInvoke).toHaveBeenCalledOnce();
    expect(mockRemoveMcpServerInvoke).toHaveBeenCalledWith({
      conversationId: 'conv-active-001',
      name: 'to-delete',
    });
  });

  // ── TOGGLE: fires toggleMcpServer IPC with correct {enabled} ────────────
  it('handleToggleMcpServer calls acp.toggle-mcp-server IPC with enabled', async () => {
    const server = makeServer('toggler', true);
    const mockSave = vi.fn(async (updater: IMcpServer[] | ((prev: IMcpServer[]) => IMcpServer[])) => {
      if (typeof updater === 'function') updater([server]);
    });

    const { result } = renderHook(() =>
      useMcpServerCRUD(
        [server],
        mockSave,
        mockSyncMcpToAgents,
        mockRemoveMcpFromAgents,
        mockCheckSingleServerInstallStatus,
        mockSetAgentInstallStatus
      )
    );

    await act(async () => {
      await result.current.handleToggleMcpServer(server.id, false);
    });

    expect(mockToggleMcpServerInvoke).toHaveBeenCalledOnce();
    expect(mockToggleMcpServerInvoke).toHaveBeenCalledWith({
      conversationId: 'conv-active-001',
      name: 'toggler',
      enabled: false,
    });
  });

  // ── No IPC when no active session ───────────────────────────────────────
  it('skips IPC calls when no active conversation', async () => {
    mockGetActiveConversationId.mockReturnValue(null);

    const { result } = renderHook(() =>
      useMcpServerCRUD(
        [],
        mockSaveMcpServers,
        mockSyncMcpToAgents,
        mockRemoveMcpFromAgents,
        mockCheckSingleServerInstallStatus,
        mockSetAgentInstallStatus
      )
    );

    await act(async () => {
      await result.current.handleAddMcpServer({
        name: 'no-session-server',
        enabled: true,
        transport: { type: 'stdio' as const, command: 'echo', args: [] },
      });
    });

    expect(mockSaveMcpServers).toHaveBeenCalledOnce();
    expect(mockAddMcpServerInvoke).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Negative tests: IPC failure → Message.error with localized key
// ═══════════════════════════════════════════════════════════════════════════

describe('useMcpServerCRUD — IPC failure surfaces Message.error', () => {
  const mockSaveMcpServers = vi.fn(async (updater: IMcpServer[] | ((prev: IMcpServer[]) => IMcpServer[])) => {
    if (typeof updater === 'function') updater([]);
  });
  const mockSyncMcpToAgents = vi.fn().mockResolvedValue(undefined);
  const mockRemoveMcpFromAgents = vi.fn().mockResolvedValue(undefined);
  const mockCheckSingleServerInstallStatus = vi.fn().mockResolvedValue(undefined);
  const mockSetAgentInstallStatus = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockGetActiveConversationId.mockReturnValue('conv-active-001');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows Message.error when addMcpServer IPC fails', async () => {
    mockAddMcpServerInvoke.mockResolvedValue({ success: false, msg: 'backend down' });

    const { result } = renderHook(() =>
      useMcpServerCRUD(
        [],
        mockSaveMcpServers,
        mockSyncMcpToAgents,
        mockRemoveMcpFromAgents,
        mockCheckSingleServerInstallStatus,
        mockSetAgentInstallStatus
      )
    );

    await act(async () => {
      await result.current.handleAddMcpServer({
        name: 'fail-add',
        enabled: true,
        transport: { type: 'stdio' as const, command: 'echo', args: [] },
      });
    });

    expect(mockMessageError).toHaveBeenCalledOnce();
    const errorMsg = mockMessageError.mock.calls[0]?.[0] as string;
    expect(errorMsg).toContain('mcpIpcAddFailed');
  });

  it('shows Message.error when removeMcpServer IPC throws', async () => {
    mockRemoveMcpServerInvoke.mockRejectedValue(new Error('network error'));
    const server = makeServer('fail-remove');
    const mockSave = vi.fn(async (updater: IMcpServer[] | ((prev: IMcpServer[]) => IMcpServer[])) => {
      if (typeof updater === 'function') updater([server]);
    });

    const { result } = renderHook(() =>
      useMcpServerCRUD(
        [server],
        mockSave,
        mockSyncMcpToAgents,
        mockRemoveMcpFromAgents,
        mockCheckSingleServerInstallStatus,
        mockSetAgentInstallStatus
      )
    );

    await act(async () => {
      await result.current.handleDeleteMcpServer(server.id);
    });

    expect(mockMessageError).toHaveBeenCalled();
    const errorMsg = mockMessageError.mock.calls[0]?.[0] as string;
    expect(errorMsg).toContain('mcpIpcRemoveFailed');
  });

  it('shows Message.error when toggleMcpServer IPC returns failure', async () => {
    mockToggleMcpServerInvoke.mockResolvedValue({ success: false, msg: 'toggle denied' });
    const server = makeServer('fail-toggle');
    const mockSave = vi.fn(async (updater: IMcpServer[] | ((prev: IMcpServer[]) => IMcpServer[])) => {
      if (typeof updater === 'function') updater([server]);
    });

    const { result } = renderHook(() =>
      useMcpServerCRUD(
        [server],
        mockSave,
        mockSyncMcpToAgents,
        mockRemoveMcpFromAgents,
        mockCheckSingleServerInstallStatus,
        mockSetAgentInstallStatus
      )
    );

    await act(async () => {
      await result.current.handleToggleMcpServer(server.id, false);
    });

    expect(mockMessageError).toHaveBeenCalled();
    const errorMsg = mockMessageError.mock.calls[0]?.[0] as string;
    expect(errorMsg).toContain('mcpIpcToggleFailed');
  });
});
