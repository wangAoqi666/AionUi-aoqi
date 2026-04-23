import { useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { IMcpServer } from '@/common/config/storage';
import { emitter } from '@/renderer/utils/emitter';
import type { McpStatusServer } from '@/renderer/utils/emitter';

/**
 * Consume `mcp.status.updated` emitter events and merge live status into
 * the shared `useMcpServers` state by `server.name` (NOT index).
 *
 * Merge semantics:
 * - Existing entries matched by name → updated in-place (status / toolCount / error).
 * - Untouched entries → preserved as-is.
 * - New entries (name not in current list) → appended.
 *
 * This ensures `toolCount` badge re-renders in real time without page reload
 * or id reassignment.
 */
export function useDroidMcpLiveStatus(
  _mcpServers: IMcpServer[],
  setMcpServers: Dispatch<SetStateAction<IMcpServer[]>>
): void {
  useEffect(() => {
    const handler = (payload: { servers: McpStatusServer[] }) => {
      const incoming = payload.servers;
      if (!incoming?.length) return;

      setMcpServers((prev) => {
        const nameMap = new Map<string, IMcpServer>();
        for (const server of prev) {
          nameMap.set(server.name, server);
        }

        const merged: IMcpServer[] = [];
        const updatedNames = new Set<string>();

        // First pass: preserve existing order, apply updates in-place
        for (const existing of prev) {
          const update = incoming.find((s) => s.name === existing.name);
          if (update) {
            updatedNames.add(update.name);
            merged.push(applyUpdate(existing, update));
          } else {
            merged.push(existing);
          }
        }

        // Second pass: append new entries not in existing list
        for (const inc of incoming) {
          if (!updatedNames.has(inc.name) && !nameMap.has(inc.name)) {
            merged.push(createFromEvent(inc));
          }
        }

        return merged;
      });
    };

    emitter.on('mcp.status.updated', handler);
    return () => {
      emitter.off('mcp.status.updated', handler);
    };
  }, [setMcpServers]);
}

/** Apply status/toolCount/error fields from event onto existing server entry. */
function applyUpdate(existing: IMcpServer, update: McpStatusServer): IMcpServer {
  const statusField = mapStatus(update.status);
  const tools =
    update.toolCount !== undefined
      ? Array.from({ length: update.toolCount }, (_, i) => existing.tools?.[i] ?? { name: `tool-${i}` })
      : existing.tools;

  return {
    ...existing,
    status: statusField,
    tools,
    updatedAt: Date.now(),
  };
}

/** Create a minimal IMcpServer from an event entry (new server not previously known). */
function createFromEvent(server: McpStatusServer): IMcpServer {
  const now = Date.now();
  return {
    id: server.name,
    name: server.name,
    enabled: true,
    transport: { type: 'stdio', command: '' },
    status: mapStatus(server.status),
    tools: server.toolCount ? Array.from({ length: server.toolCount }, (_, i) => ({ name: `tool-${i}` })) : [],
    createdAt: now,
    updatedAt: now,
    originalJson: '{}',
  };
}

/** Map SDK status string to IMcpServer status union. */
function mapStatus(status: string): IMcpServer['status'] {
  switch (status) {
    case 'connected':
      return 'connected';
    case 'error':
    case 'failed':
      return 'error';
    case 'testing':
    case 'connecting':
      return 'testing';
    default:
      return 'disconnected';
  }
}
