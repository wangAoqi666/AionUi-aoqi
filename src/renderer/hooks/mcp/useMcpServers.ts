import { useState, useEffect, useCallback } from 'react';
import { Message } from '@arco-design/web-react';
import type { IMcpServer } from '@/common/config/storage';
import { ipcBridge } from '@/common';
import { getActiveConversationId } from '@/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync';

/**
 * MCP服务器状态管理Hook
 * 管理MCP服务器列表的加载、保存和状态更新
 * 包含用户配置的 MCP servers 和扩展贡献的 MCP servers
 *
 * When a live Droid session is active, the hook also calls
 * `acp.list-mcp-servers` to populate the list from the live session.
 * Config-file state is shown as fallback when no session is active.
 */
export const useMcpServers = () => {
  const [mcpServers, setMcpServers] = useState<IMcpServer[]>([]);
  /** Extension-contributed MCP servers (read-only, from extensions) */
  const [extensionMcpServers, setExtensionMcpServers] = useState<IMcpServer[]>([]);

  // 加载MCP服务器配置 — 从 ~/.factory/mcp.json 读取
  useEffect(() => {
    void ipcBridge.fs.readMcpJsonFile
      .invoke()
      .then((data) => {
        if (data && data.length > 0) {
          setMcpServers(data);
        }
      })
      .catch((error) => {
        console.error('[useMcpServers] Failed to load mcp.json:', error);
      });

    // Load extension-contributed MCP servers
    void ipcBridge.extensions.getMcpServers
      .invoke()
      .then((extServers) => {
        if (extServers && extServers.length > 0) {
          const converted: IMcpServer[] = extServers.map((s) => ({
            id: String(s.id || ''),
            name: String(s.name || ''),
            description: s.description as string | undefined,
            enabled: s.enabled !== false,
            transport: s.transport as IMcpServer['transport'],
            status: 'connected' as const,
            createdAt: (s.createdAt as number) || Date.now(),
            updatedAt: (s.updatedAt as number) || Date.now(),
            originalJson: String(s.originalJson || '{}'),
            _source: 'extension' as const,
            _extensionName: s._extensionName as string | undefined,
          })) as IMcpServer[];
          setExtensionMcpServers(converted);
        }
      })
      .catch((error) => {
        console.error('[useMcpServers] Failed to load extension MCP servers:', error);
      });
  }, []);

  /**
   * Refresh the server list from the live Droid session (if active).
   * Merges live status into the config-based list by server name.
   * Safe to call at any time — silently no-ops when no session is active.
   */
  const refreshFromLiveSession = useCallback(async () => {
    const conversationId = getActiveConversationId();
    if (!conversationId) return; // no active session — config-only fallback

    try {
      const result = await ipcBridge.acpConversation.listMcpServers.invoke({ conversationId });
      if (result && result.success && result.data && Array.isArray(result.data.servers)) {
        // Merge live status into the existing config-based server list
        setMcpServers((prev) => {
          const liveByName = new Map<string, Record<string, unknown>>();
          for (const ls of result.data!.servers as Array<Record<string, unknown>>) {
            if (ls.name && typeof ls.name === 'string') {
              liveByName.set(ls.name, ls);
            }
          }

          return prev.map((server) => {
            const live = liveByName.get(server.name);
            if (!live) return server;
            return {
              ...server,
              // Merge live status fields if present
              ...(live.status != null && typeof live.status === 'string'
                ? { status: live.status as IMcpServer['status'] }
                : {}),
              ...(live.toolCount != null && typeof live.toolCount === 'number' ? { toolCount: live.toolCount } : {}),
              ...(live.error != null && typeof live.error === 'string' ? { error: live.error } : {}),
              ...(live.needsLogin != null && typeof live.needsLogin === 'boolean'
                ? { needsLogin: live.needsLogin }
                : {}),
            };
          });
        });
      } else if (result && result.data && result.data.error) {
        // IPC returned an error — surface to user
        Message.warning(result.data.error);
      }
      // Also fetch live tools list to enrich server entries
      try {
        const toolsResult = await ipcBridge.acpConversation.listMcpTools.invoke({ conversationId });
        if (toolsResult?.success && toolsResult.data && Array.isArray(toolsResult.data.tools)) {
          // Tools fetched — consumers can use this for AllowedToolsSelector hints
          // (state enrichment deferred to a follow-up feature)
        }
      } catch {
        // listMcpTools is best-effort — ignore failures silently
      }
    } catch {
      // Silently ignore — live session may have ended
    }
  }, []);

  // Try to refresh from live session on mount
  useEffect(() => {
    void refreshFromLiveSession();
  }, [refreshFromLiveSession]);

  // 保存MCP服务器配置到 ~/.factory/mcp.json（仅保存用户配置的，不保存扩展的）
  const saveMcpServers = useCallback((serversOrUpdater: IMcpServer[] | ((prev: IMcpServer[]) => IMcpServer[])) => {
    return new Promise<void>((resolve, reject) => {
      setMcpServers((prev) => {
        const newServers = typeof serversOrUpdater === 'function' ? serversOrUpdater(prev) : serversOrUpdater;

        queueMicrotask(() => {
          ipcBridge.fs.writeMcpJsonFile
            .invoke({ servers: newServers })
            .then(() => resolve())
            .catch((error) => {
              console.error('Failed to save mcp.json:', error);
              reject(error);
            });
        });

        return newServers;
      });
    });
  }, []);

  // 合并后的完整列表（用户配置 + 扩展贡献）
  const allMcpServers = [...mcpServers, ...extensionMcpServers];

  return {
    mcpServers,
    allMcpServers,
    extensionMcpServers,
    setMcpServers,
    saveMcpServers,
    refreshFromLiveSession,
  };
};
