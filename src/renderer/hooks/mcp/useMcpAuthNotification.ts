/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { Button, Notification } from '@arco-design/web-react';
import React, { useEffect } from 'react';
import { emitter } from '@/renderer/utils/emitter';
import type { McpAuthPayload } from '@/renderer/utils/emitter';

/**
 * Global listener for `mcp.auth.required` emitter events.
 *
 * Mounted at Layout-level (once, app-wide) — not per-conversation.
 *
 * Behaviour:
 * - When `authUrl` is present: `Notification.info` with an "Open" action
 *   button that triggers `ipcBridge.shell.openExternal` with the exact URL.
 * - When `authUrl` is absent: info notification with no action button.
 * - Notification `id` is unique per `serverName` so concurrent events stack.
 */
export function useMcpAuthNotification(): void {
  useEffect(() => {
    const handler = (payload: McpAuthPayload) => {
      const { serverName, authUrl, message } = payload;
      const notificationId = `mcp-auth-${serverName}`;

      Notification.info({
        id: notificationId,
        title: serverName,
        content: message,
        btn: authUrl
          ? React.createElement(
              Button,
              {
                size: 'small',
                type: 'primary',
                onClick: () => {
                  void ipcBridge.shell.openExternal.invoke(authUrl);
                },
              },
              'Open'
            )
          : undefined,
      });
    };

    emitter.on('mcp.auth.required', handler);
    return () => {
      emitter.off('mcp.auth.required', handler);
    };
  }, []);
}
