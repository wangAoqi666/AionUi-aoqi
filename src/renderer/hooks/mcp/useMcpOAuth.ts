import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Message } from '@arco-design/web-react';
import { ipcBridge } from '@/common';
import { mcpService } from '@/common/adapter/ipcBridge';
import type { IMcpServer } from '@/common/config/storage';
import { getActiveConversationId } from '@/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync';
import { emitter } from '@/renderer/utils/emitter';
import type { McpAuthPayload } from '@/renderer/utils/emitter';

export interface McpOAuthStatus {
  isAuthenticated: boolean;
  needsLogin: boolean;
  isChecking: boolean;
  error?: string;
}

/**
 * MCP OAuth 管理 Hook
 * 处理 MCP 服务器的 OAuth 认证状态检查和登录流程
 *
 * Includes `authenticateViaDroidSession` which invokes
 * `acp.authenticate-mcp-server` IPC, opens `authUrl` via
 * `shell.openExternal`, and listens for `mcp_auth` stream
 * completion events (VAL-IPC-020).
 */
export const useMcpOAuth = () => {
  const { t } = useTranslation();
  const [oauthStatus, setOAuthStatus] = useState<Record<string, McpOAuthStatus>>({});
  const [loggingIn, setLoggingIn] = useState<Record<string, boolean>>({});

  // Listen for mcp_auth stream events (VAL-IPC-020)
  // When state === 'success', flip store state within one tick.
  useEffect(() => {
    const handler = (payload: McpAuthPayload) => {
      if (payload.state === 'success' && payload.serverName) {
        setOAuthStatus((prev) => {
          // Find the server entry by name — look through all entries
          const updated = { ...prev };
          for (const key of Object.keys(updated)) {
            if (updated[key]?.needsLogin) {
              // We can't perfectly match by name here (key is serverId),
              // but the emitter payload includes serverName. We update all
              // entries that are in needsLogin state.
              updated[key] = {
                isAuthenticated: true,
                needsLogin: false,
                isChecking: false,
              };
            }
          }
          return updated;
        });
      }
    };

    emitter.on('mcp.auth.required', handler);
    return () => {
      emitter.off('mcp.auth.required', handler);
    };
  }, []);

  // 检查 OAuth 状态
  const checkOAuthStatus = useCallback(async (server: IMcpServer) => {
    // 只检查 HTTP/SSE 类型的服务器
    if (server.transport.type !== 'http' && server.transport.type !== 'sse') {
      return;
    }

    setOAuthStatus((prev) => ({
      ...prev,
      [server.id]: {
        isAuthenticated: false,
        needsLogin: false,
        isChecking: true,
      },
    }));

    try {
      const response = await mcpService.checkOAuthStatus.invoke(server);

      if (response.success && response.data) {
        setOAuthStatus((prev) => ({
          ...prev,
          [server.id]: {
            isAuthenticated: response.data.isAuthenticated,
            needsLogin: response.data.needsLogin,
            isChecking: false,
            error: response.data.error,
          },
        }));
      } else {
        setOAuthStatus((prev) => ({
          ...prev,
          [server.id]: {
            isAuthenticated: false,
            needsLogin: false,
            isChecking: false,
            error: response.msg,
          },
        }));
      }
    } catch (error) {
      console.error('Failed to check OAuth status:', error);
      setOAuthStatus((prev) => ({
        ...prev,
        [server.id]: {
          isAuthenticated: false,
          needsLogin: false,
          isChecking: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      }));
    }
  }, []);

  // 执行 OAuth 登录 (legacy mcpService path)
  const login = useCallback(async (server: IMcpServer): Promise<{ success: boolean; error?: string }> => {
    setLoggingIn((prev) => ({ ...prev, [server.id]: true }));

    try {
      const response = await mcpService.loginMcpOAuth.invoke({
        server,
        config: undefined, // 使用自动发现
      });

      if (response.success && response.data?.success) {
        // 登录成功，更新状态
        setOAuthStatus((prev) => ({
          ...prev,
          [server.id]: {
            isAuthenticated: true,
            needsLogin: false,
            isChecking: false,
          },
        }));
        return { success: true };
      } else {
        return {
          success: false,
          error: response.data?.error || response.msg || 'Login failed',
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    } finally {
      setLoggingIn((prev) => ({ ...prev, [server.id]: false }));
    }
  }, []);

  /**
   * Authenticate an MCP server via the live Droid session.
   *
   * 1. Calls `acp.authenticate-mcp-server` IPC.
   * 2. If the response includes `authUrl` → opens it via `shell.openExternal`.
   * 3. Otherwise waits for the `mcp_auth` stream event (handled by the
   *    useEffect listener above).
   * 4. On IPC failure → surfaces a localised `Message.error`.
   */
  const authenticateViaDroidSession = useCallback(
    async (server: IMcpServer): Promise<{ success: boolean; error?: string }> => {
      const conversationId = getActiveConversationId();
      if (!conversationId) {
        return { success: false, error: 'No active session' };
      }

      setLoggingIn((prev) => ({ ...prev, [server.id]: true }));

      try {
        const result = await ipcBridge.acpConversation.authenticateMcpServer.invoke({
          conversationId,
          params: { name: server.name },
        });

        if (result && result.success) {
          // The SDK may include authUrl when OAuth is required (passthrough
          // from backend DroidSdkAgent). If present, open it in the
          // external browser; otherwise the `mcp_auth` stream notification
          // handler (useMcpAuthNotification) takes care of surfacing it.
          const authUrl = (result.data as Record<string, unknown> | undefined)?.authUrl;
          if (typeof authUrl === 'string' && authUrl) {
            await ipcBridge.shell.openExternal.invoke(authUrl);
          }
          // Auth will complete via mcp_auth stream event (handled by useEffect)
          return { success: true };
        } else {
          const errorMsg = result?.msg || 'Authentication failed';
          Message.error(t('settings.mcpIpcAuthFailed', { error: errorMsg }));
          return { success: false, error: errorMsg };
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        Message.error(t('settings.mcpIpcAuthFailed', { error: errorMsg }));
        return { success: false, error: errorMsg };
      } finally {
        setLoggingIn((prev) => ({ ...prev, [server.id]: false }));
      }
    },
    [t]
  );

  // 登出
  const logout = useCallback(
    async (serverName: string, serverId: string): Promise<{ success: boolean; error?: string }> => {
      try {
        const response = await mcpService.logoutMcpOAuth.invoke(serverName);

        if (response.success) {
          // 登出成功，更新状态
          setOAuthStatus((prev) => ({
            ...prev,
            [serverId]: {
              isAuthenticated: false,
              needsLogin: true,
              isChecking: false,
            },
          }));
          return { success: true };
        } else {
          return {
            success: false,
            error: response.msg || 'Logout failed',
          };
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
    []
  );

  // 批量检查多个服务器的 OAuth 状态
  const checkMultipleServers = useCallback(
    async (servers: IMcpServer[]) => {
      const httpServers = servers.filter((s) => s.transport.type === 'http' || s.transport.type === 'sse');

      await Promise.all(httpServers.map((server) => checkOAuthStatus(server)));
    },
    [checkOAuthStatus]
  );

  return {
    oauthStatus,
    loggingIn,
    checkOAuthStatus,
    checkMultipleServers,
    login,
    logout,
    authenticateViaDroidSession,
  };
};
