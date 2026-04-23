import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emitter } from '@/renderer/utils/emitter';

/* ── Arco Notification mock ──────────────────────────────────────────────── */
const mockNotificationInfo = vi.fn();
vi.mock('@arco-design/web-react', () => ({
  Notification: { info: (...args: unknown[]) => mockNotificationInfo(...args) },
  Button: 'button',
}));

/* ── ipcBridge mock ──────────────────────────────────────────────────────── */
const mockOpenExternal = vi.fn().mockResolvedValue(undefined);
vi.mock('@/common', () => ({
  ipcBridge: {
    shell: {
      openExternal: { invoke: (...args: unknown[]) => mockOpenExternal(...args) },
    },
  },
}));

import { useMcpAuthNotification } from '@/renderer/hooks/mcp/useMcpAuthNotification';

describe('useMcpAuthNotification (Layout-level global listener)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    emitter.removeAllListeners();
  });

  // ── VAL-STREAM-009: mcp_auth with authUrl → Notification.info + action button ──
  it('shows Notification.info with action button when authUrl is present (VAL-STREAM-009)', () => {
    renderHook(() => useMcpAuthNotification());

    act(() => {
      emitter.emit('mcp.auth.required', {
        serverName: 'github-mcp',
        authUrl: 'https://github.com/login/oauth/authorize?client_id=abc',
        message: 'Auth required',
        state: 'pending',
      });
    });

    expect(mockNotificationInfo).toHaveBeenCalledOnce();

    const callArgs = mockNotificationInfo.mock.calls[0][0];

    // Title must mention serverName
    expect(callArgs.title).toContain('github-mcp');

    // Content must contain exact payload.message
    expect(callArgs.content).toBe('Auth required');

    // id must be unique per serverName
    expect(callArgs.id).toBe('mcp-auth-github-mcp');

    // btn must be present (action button)
    expect(callArgs.btn).toBeDefined();

    // Simulate clicking the action button — it should call openExternal with exact URL
    // The btn is a React.createElement(Button, { onClick, ... }, 'Open')
    const btnElement = callArgs.btn;
    expect(btnElement).toBeTruthy();

    // Extract the onClick handler from the React element's props
    const onClick = btnElement.props?.onClick;
    expect(onClick).toBeDefined();

    // Call the onClick handler
    onClick();

    expect(mockOpenExternal).toHaveBeenCalledOnce();
    expect(mockOpenExternal).toHaveBeenCalledWith('https://github.com/login/oauth/authorize?client_id=abc');
  });

  // ── VAL-STREAM-010: mcp_auth without authUrl → no action button, no openExternal ──
  it('shows Notification.info without action button when authUrl is absent (VAL-STREAM-010)', () => {
    renderHook(() => useMcpAuthNotification());

    act(() => {
      emitter.emit('mcp.auth.required', {
        serverName: 'slack-mcp',
        message: 'Please authenticate',
      });
    });

    expect(mockNotificationInfo).toHaveBeenCalledOnce();

    const callArgs = mockNotificationInfo.mock.calls[0][0];

    // Title must mention serverName
    expect(callArgs.title).toContain('slack-mcp');

    // Content must contain exact payload.message
    expect(callArgs.content).toBe('Please authenticate');

    // id must be unique per serverName
    expect(callArgs.id).toBe('mcp-auth-slack-mcp');

    // btn must NOT be present
    expect(callArgs.btn).toBeUndefined();

    // openExternal must NOT have been called
    expect(mockOpenExternal).not.toHaveBeenCalled();
  });

  // ── Concurrent events with different serverNames stack (unique keys) ──
  it('concurrent events from different servers get unique notification ids', () => {
    renderHook(() => useMcpAuthNotification());

    act(() => {
      emitter.emit('mcp.auth.required', {
        serverName: 'github-mcp',
        authUrl: 'https://github.com/login/oauth',
        message: 'Auth needed for GitHub',
      });
      emitter.emit('mcp.auth.required', {
        serverName: 'gitlab-mcp',
        authUrl: 'https://gitlab.com/oauth',
        message: 'Auth needed for GitLab',
      });
    });

    expect(mockNotificationInfo).toHaveBeenCalledTimes(2);

    const call1 = mockNotificationInfo.mock.calls[0][0];
    const call2 = mockNotificationInfo.mock.calls[1][0];

    expect(call1.id).toBe('mcp-auth-github-mcp');
    expect(call2.id).toBe('mcp-auth-gitlab-mcp');
    expect(call1.id).not.toBe(call2.id);
  });

  // ── Cleanup: unsubscribes on unmount ──
  it('cleans up emitter listener on unmount', () => {
    const { unmount } = renderHook(() => useMcpAuthNotification());

    unmount();

    act(() => {
      emitter.emit('mcp.auth.required', {
        serverName: 'test-server',
        message: 'Should not show',
      });
    });

    expect(mockNotificationInfo).not.toHaveBeenCalled();
  });
});
