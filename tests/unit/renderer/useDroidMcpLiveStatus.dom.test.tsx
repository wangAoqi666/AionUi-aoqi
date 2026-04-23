import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emitter } from '@/renderer/utils/emitter';
import { useDroidMcpLiveStatus } from '@/renderer/hooks/mcp/useDroidMcpLiveStatus';
import type { IMcpServer } from '@/common/config/storage';

/** Helper to create a minimal IMcpServer stub with only required fields. */
function stubServer(overrides: Partial<IMcpServer> & { name: string }): IMcpServer {
  return {
    id: overrides.id ?? overrides.name,
    name: overrides.name,
    enabled: overrides.enabled ?? true,
    transport: overrides.transport ?? { type: 'stdio', command: 'echo' },
    status: overrides.status ?? 'disconnected',
    createdAt: overrides.createdAt ?? Date.now(),
    updatedAt: overrides.updatedAt ?? Date.now(),
    originalJson: overrides.originalJson ?? '{}',
    tools: overrides.tools,
  };
}

describe('useDroidMcpLiveStatus', () => {
  let setMcpServers: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setMcpServers = vi.fn();
  });

  afterEach(() => {
    emitter.removeAllListeners();
  });

  // ─── VAL-STREAM-006: merge by server name ──────────────────────────────
  it('merges live status into mcpServers by server name (VAL-STREAM-006)', () => {
    const initial: IMcpServer[] = [
      stubServer({ name: 'sequential-thinking', status: 'testing', tools: [] }),
      stubServer({
        name: 'filesystem',
        status: 'connected',
        tools: Array.from({ length: 3 }, (_, i) => ({ name: `t${i}` })),
      }),
    ];

    renderHook(() => useDroidMcpLiveStatus(initial, setMcpServers));

    // Emit mcp.status.updated with 1 update + 1 new server
    act(() => {
      emitter.emit('mcp.status.updated', {
        servers: [
          { name: 'sequential-thinking', status: 'connected', toolCount: 5 },
          { name: 'github-mcp', status: 'connected', toolCount: 12 },
        ],
      });
    });

    expect(setMcpServers).toHaveBeenCalledOnce();

    // Extract the updater function or value passed to setMcpServers
    const updater = setMcpServers.mock.calls[0][0];
    // setMcpServers is called with a functional updater: (prev) => next
    expect(typeof updater).toBe('function');

    const result: IMcpServer[] = updater(initial);

    // sequential-thinking: updated status + toolCount
    const st = result.find((s) => s.name === 'sequential-thinking');
    expect(st).toBeDefined();
    expect(st!.status).toBe('connected');
    expect(st!.tools).toHaveLength(5);

    // filesystem: preserved untouched
    const fs = result.find((s) => s.name === 'filesystem');
    expect(fs).toBeDefined();
    expect(fs!.status).toBe('connected');
    expect(fs!.tools).toHaveLength(3);

    // github-mcp: appended as new entry
    const gh = result.find((s) => s.name === 'github-mcp');
    expect(gh).toBeDefined();
    expect(gh!.status).toBe('connected');
    expect(gh!.tools).toHaveLength(12);

    // Total: 3 servers
    expect(result).toHaveLength(3);
  });

  // ─── VAL-STREAM-007: toolCount badge re-renders in real time ────────────
  it('updates toolCount from 2 to 7 without remount (VAL-STREAM-007)', () => {
    const initial: IMcpServer[] = [
      stubServer({
        name: 'sequential-thinking',
        status: 'connected',
        tools: [{ name: 't1' }, { name: 't2' }],
      }),
    ];

    renderHook(() => useDroidMcpLiveStatus(initial, setMcpServers));

    act(() => {
      emitter.emit('mcp.status.updated', {
        servers: [{ name: 'sequential-thinking', status: 'connected', toolCount: 7 }],
      });
    });

    expect(setMcpServers).toHaveBeenCalledOnce();

    const updater = setMcpServers.mock.calls[0][0];
    const result: IMcpServer[] = updater(initial);

    const st = result.find((s) => s.name === 'sequential-thinking');
    expect(st).toBeDefined();
    expect(st!.tools).toHaveLength(7);

    // IDs should NOT be reassigned — same id preserved
    expect(st!.id).toBe('sequential-thinking');
  });

  // ─── Cleanup: unsubscribes on unmount ───────────────────────────────────
  it('cleans up emitter listener on unmount', () => {
    const initial: IMcpServer[] = [];
    const { unmount } = renderHook(() => useDroidMcpLiveStatus(initial, setMcpServers));

    unmount();

    // After unmount, emitting should NOT call setMcpServers
    act(() => {
      emitter.emit('mcp.status.updated', {
        servers: [{ name: 'test', status: 'connected', toolCount: 1 }],
      });
    });

    expect(setMcpServers).not.toHaveBeenCalled();
  });

  // ─── Preserves existing server fields not in event ──────────────────────
  it('preserves existing server fields (id, transport, enabled) on update', () => {
    const initial: IMcpServer[] = [
      stubServer({
        id: 'custom-id-123',
        name: 'my-server',
        enabled: false,
        transport: { type: 'sse', url: 'http://localhost:3000' },
        status: 'disconnected',
        tools: [],
      }),
    ];

    renderHook(() => useDroidMcpLiveStatus(initial, setMcpServers));

    act(() => {
      emitter.emit('mcp.status.updated', {
        servers: [{ name: 'my-server', status: 'connected', toolCount: 3, error: undefined }],
      });
    });

    const updater = setMcpServers.mock.calls[0][0];
    const result: IMcpServer[] = updater(initial);

    const s = result.find((srv) => srv.name === 'my-server');
    expect(s).toBeDefined();
    // Updated fields
    expect(s!.status).toBe('connected');
    expect(s!.tools).toHaveLength(3);
    // Preserved fields
    expect(s!.id).toBe('custom-id-123');
    expect(s!.enabled).toBe(false);
    expect(s!.transport).toEqual({ type: 'sse', url: 'http://localhost:3000' });
  });

  // ─── Error field update ─────────────────────────────────────────────────
  it('updates error field from event data', () => {
    const initial: IMcpServer[] = [stubServer({ name: 'broken-server', status: 'connected', tools: [] })];

    renderHook(() => useDroidMcpLiveStatus(initial, setMcpServers));

    act(() => {
      emitter.emit('mcp.status.updated', {
        servers: [{ name: 'broken-server', status: 'error', toolCount: 0, error: 'Connection refused' }],
      });
    });

    const updater = setMcpServers.mock.calls[0][0];
    const result: IMcpServer[] = updater(initial);

    const s = result.find((srv) => srv.name === 'broken-server');
    expect(s).toBeDefined();
    expect(s!.status).toBe('error');
  });
});
