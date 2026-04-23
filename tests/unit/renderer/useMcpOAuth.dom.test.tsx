/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 *
 * DOM tests for useMcpOAuth — Droid session authentication flow:
 * - authenticateViaDroidSession invokes authenticateMcpServer IPC
 * - authUrl passthrough calls shell.openExternal
 * - no-authUrl path awaits mcp_auth stream
 * - VAL-IPC-020: mcp_auth state=success flips store state within one tick
 * - IPC failure surfaces Message.error with localized key
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emitter } from '@/renderer/utils/emitter';

/* ── IPC mocks ──────────────────────────────────────────────────────────── */
const mockAuthenticateMcpServerInvoke = vi.fn().mockResolvedValue({
  success: true,
  data: { success: true, authUrl: 'https://auth.example.com/oauth' },
});
const mockOpenExternalInvoke = vi.fn().mockResolvedValue(undefined);
const mockCheckOAuthStatusInvoke = vi.fn().mockResolvedValue({
  success: true,
  data: { isAuthenticated: false, needsLogin: true },
});
const mockLoginMcpOAuthInvoke = vi.fn().mockResolvedValue({
  success: true,
  data: { success: true },
});
const mockLogoutMcpOAuthInvoke = vi.fn().mockResolvedValue({ success: true });

vi.mock('@/common/adapter/ipcBridge', () => ({
  mcpService: {
    checkOAuthStatus: { invoke: (...args: unknown[]) => mockCheckOAuthStatusInvoke(...args) },
    loginMcpOAuth: { invoke: (...args: unknown[]) => mockLoginMcpOAuthInvoke(...args) },
    logoutMcpOAuth: { invoke: (...args: unknown[]) => mockLogoutMcpOAuthInvoke(...args) },
  },
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    acpConversation: {
      authenticateMcpServer: {
        invoke: (...args: unknown[]) => mockAuthenticateMcpServerInvoke(...args),
      },
    },
    shell: {
      openExternal: { invoke: (...args: unknown[]) => mockOpenExternalInvoke(...args) },
    },
  },
}));

/* ── Message / i18n mocks ───────────────────────────────────────────────── */
const mockMessageError = vi.fn();
vi.mock('@arco-design/web-react', () => ({
  Message: {
    error: (...args: unknown[]) => mockMessageError(...args),
    success: vi.fn(),
    warning: vi.fn(),
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
const mockGetActiveConversationId = vi.fn<() => string | null>().mockReturnValue('conv-oauth-001');
vi.mock('@/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync', () => ({
  getActiveConversationId: () => mockGetActiveConversationId(),
}));

/* ── Hook import (after mocks) ──────────────────────────────────────────── */
import { useMcpOAuth } from '@/renderer/hooks/mcp/useMcpOAuth';
import type { IMcpServer } from '@/common/config/storage';

const makeHttpServer = (name: string): IMcpServer => ({
  id: `mcp_${name}`,
  name,
  enabled: true,
  transport: { type: 'http' as const, url: 'https://mcp.example.com' } as IMcpServer['transport'],
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

describe('useMcpOAuth — authenticateViaDroidSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetActiveConversationId.mockReturnValue('conv-oauth-001');
    mockAuthenticateMcpServerInvoke.mockResolvedValue({
      success: true,
      data: { success: true, authUrl: 'https://auth.example.com/oauth' },
    });
  });

  // ── Button click invokes authenticateMcpServer IPC ────────────────────
  it('invokes authenticateMcpServer IPC with conversationId and server name', async () => {
    const { result } = renderHook(() => useMcpOAuth());
    const server = makeHttpServer('auth-test');

    await act(async () => {
      await result.current.authenticateViaDroidSession(server);
    });

    expect(mockAuthenticateMcpServerInvoke).toHaveBeenCalledOnce();
    expect(mockAuthenticateMcpServerInvoke).toHaveBeenCalledWith({
      conversationId: 'conv-oauth-001',
      params: { name: 'auth-test' },
    });
  });

  // ── authUrl passthrough calls shell.openExternal ──────────────────────
  it('opens authUrl via shell.openExternal when response includes authUrl', async () => {
    const { result } = renderHook(() => useMcpOAuth());
    const server = makeHttpServer('auth-url-test');

    await act(async () => {
      await result.current.authenticateViaDroidSession(server);
    });

    expect(mockOpenExternalInvoke).toHaveBeenCalledOnce();
    expect(mockOpenExternalInvoke).toHaveBeenCalledWith('https://auth.example.com/oauth');
  });

  // ── no-authUrl path does not call shell.openExternal ──────────────────
  it('does not call shell.openExternal when response has no authUrl', async () => {
    mockAuthenticateMcpServerInvoke.mockResolvedValue({
      success: true,
      data: {}, // no authUrl
    });

    const { result } = renderHook(() => useMcpOAuth());
    const server = makeHttpServer('no-url-test');

    await act(async () => {
      await result.current.authenticateViaDroidSession(server);
    });

    expect(mockOpenExternalInvoke).not.toHaveBeenCalled();
  });

  // ── IPC failure surfaces Message.error ─────────────────────────────────
  it('shows Message.error when authenticateMcpServer IPC fails', async () => {
    mockAuthenticateMcpServerInvoke.mockResolvedValue({
      success: false,
      msg: 'auth backend unavailable',
    });

    const { result } = renderHook(() => useMcpOAuth());
    const server = makeHttpServer('fail-auth');

    await act(async () => {
      await result.current.authenticateViaDroidSession(server);
    });

    expect(mockMessageError).toHaveBeenCalledOnce();
    const errorMsg = mockMessageError.mock.calls[0]?.[0] as string;
    expect(errorMsg).toContain('mcpIpcAuthFailed');
  });

  // ── Returns failure when no active session ─────────────────────────────
  it('returns failure when no active conversation', async () => {
    mockGetActiveConversationId.mockReturnValue(null);

    const { result } = renderHook(() => useMcpOAuth());
    const server = makeHttpServer('no-session');

    let authResult: { success: boolean; error?: string } | undefined;
    await act(async () => {
      authResult = await result.current.authenticateViaDroidSession(server);
    });

    expect(authResult?.success).toBe(false);
    expect(authResult?.error).toContain('No active session');
    expect(mockAuthenticateMcpServerInvoke).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// VAL-IPC-020: mcp_auth stream event flips store state within one tick
// ═══════════════════════════════════════════════════════════════════════════

describe('useMcpOAuth — mcp_auth stream completion (VAL-IPC-020)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetActiveConversationId.mockReturnValue('conv-oauth-001');
    mockCheckOAuthStatusInvoke.mockResolvedValue({
      success: true,
      data: { isAuthenticated: false, needsLogin: true },
    });
  });

  it('flips oauthStatus to authenticated when mcp_auth state=success arrives', async () => {
    const { result } = renderHook(() => useMcpOAuth());
    const server = makeHttpServer('stream-test');

    // First, set the server to needsLogin state via checkOAuthStatus
    await act(async () => {
      await result.current.checkOAuthStatus(server);
    });

    expect(result.current.oauthStatus[server.id]?.needsLogin).toBe(true);
    expect(result.current.oauthStatus[server.id]?.isAuthenticated).toBe(false);

    // Emit mcp_auth stream event with state=success
    await act(async () => {
      emitter.emit('mcp.auth.required', {
        serverName: 'stream-test',
        state: 'success',
      });
    });

    // Within one tick, the state should be flipped
    expect(result.current.oauthStatus[server.id]?.isAuthenticated).toBe(true);
    expect(result.current.oauthStatus[server.id]?.needsLogin).toBe(false);
    expect(result.current.oauthStatus[server.id]?.isChecking).toBe(false);
  });

  it('does not flip state when mcp_auth state is not success', async () => {
    const { result } = renderHook(() => useMcpOAuth());
    const server = makeHttpServer('no-flip');

    // Set the server to needsLogin state
    await act(async () => {
      await result.current.checkOAuthStatus(server);
    });

    expect(result.current.oauthStatus[server.id]?.needsLogin).toBe(true);

    // Emit mcp_auth event with state='pending' (not success)
    await act(async () => {
      emitter.emit('mcp.auth.required', {
        serverName: 'no-flip',
        state: 'pending',
      });
    });

    // State should NOT be flipped
    expect(result.current.oauthStatus[server.id]?.needsLogin).toBe(true);
    expect(result.current.oauthStatus[server.id]?.isAuthenticated).toBe(false);
  });
});
