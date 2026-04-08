/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { IDirOrFile } from '@/common/adapter/ipcBridge';
import { emitter, useAddEventListener } from '@/renderer/utils/emitter';
import { useCallback, useEffect, useRef } from 'react';
import type { ContextMenuState, WorkspaceEventPrefix } from '../types';

interface UseWorkspaceEventsOptions {
  conversation_id: string;
  eventPrefix: WorkspaceEventPrefix;

  // Dependencies from useWorkspaceTree
  refreshWorkspace: () => void;
  setFiles: React.Dispatch<React.SetStateAction<IDirOrFile[]>>;
  setSelected: React.Dispatch<React.SetStateAction<string[]>>;
  setExpandedKeys: React.Dispatch<React.SetStateAction<string[]>>;
  setTreeKey: React.Dispatch<React.SetStateAction<number>>;
  selectedNodeRef: React.MutableRefObject<{
    relativePath: string;
    fullPath: string;
  } | null>;
  selectedKeysRef: React.MutableRefObject<string[]>;

  // Dependencies from useWorkspaceModals
  closeContextMenu: () => void;
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState>>;
  closeRenameModal: () => void;
  closeDeleteModal: () => void;
}

/**
 * useWorkspaceEvents - 管理所有事件监听器
 * Manage all event listeners
 */
export function useWorkspaceEvents(options: UseWorkspaceEventsOptions) {
  const {
    conversation_id,
    eventPrefix,
    refreshWorkspace,
    setFiles,
    setSelected,
    setExpandedKeys,
    setTreeKey,
    selectedNodeRef,
    selectedKeysRef,
    closeContextMenu,
    setContextMenu,
    closeRenameModal,
    closeDeleteModal,
  } = options;

  /**
   * 监听对话切换事件 - 重置所有状态
   * Listen to conversation switch event - reset all states
   */
  useEffect(() => {
    setFiles([]);
    setSelected([]);
    setExpandedKeys([]);
    selectedNodeRef.current = null;
    selectedKeysRef.current = [];
    setTreeKey(Math.random());
    setContextMenu({ visible: false, x: 0, y: 0, node: null });
    closeRenameModal();
    closeDeleteModal();
    refreshWorkspace();
    emitter.emit(`${eventPrefix}.selected.file`, []);
  }, [
    conversation_id,
    eventPrefix,
    refreshWorkspace,
    setFiles,
    setSelected,
    setExpandedKeys,
    setTreeKey,
    selectedNodeRef,
    selectedKeysRef,
    setContextMenu,
    closeRenameModal,
    closeDeleteModal,
  ]);

  /**
   * 节流的刷新函数 - 避免 Agent 连续 tool_call 导致工作空间反复刷新
   * Throttled refresh - prevent rapid workspace refreshes during agent tool calls
   */
  const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef(false);
  const throttledRefresh = useCallback(() => {
    if (throttleTimerRef.current) {
      pendingRef.current = true; // Mark pending so trailing refresh fires after window
      return;
    }
    refreshWorkspace();
    throttleTimerRef.current = setTimeout(() => {
      throttleTimerRef.current = null;
      if (pendingRef.current) {
        pendingRef.current = false;
        refreshWorkspace(); // Fire trailing refresh for any calls missed during throttle window
      }
    }, 2000);
  }, [refreshWorkspace]);

  // Cleanup throttle timer on unmount
  useEffect(() => {
    return () => {
      if (throttleTimerRef.current) clearTimeout(throttleTimerRef.current);
    };
  }, []);

  /**
   * 监听 Agent 响应流 - 自动刷新工作空间（节流）
   * Listen to agent response stream - auto refresh workspace (throttled)
   */
  useEffect(() => {
    const handleResponse = (data: { type: string; conversation_id: string }) => {
      if (data.conversation_id !== conversation_id) {
        return;
      }
      if (data.type === 'tool_group' || data.type === 'tool_call' || data.type === 'acp_tool_call') {
        throttledRefresh();
      }
    };
    const unsubscribe = ipcBridge.conversation.responseStream.on(handleResponse);

    return () => {
      unsubscribe();
    };
  }, [conversation_id, throttledRefresh]);

  /**
   * 监听手动刷新工作空间事件
   * Listen to manual refresh workspace event
   */
  useAddEventListener(`${eventPrefix}.workspace.refresh`, () => refreshWorkspace(), [refreshWorkspace]);

  /**
   * 工作空间选择与发送框上下文已解耦：
   * sendbox 标签变化不再驱动文件树选中状态。
   * Workspace selection is now independent from sendbox context tags.
   */

  /**
   * 监听搜索工作空间响应
   * Listen to search workspace response
   */
  useEffect(() => {
    return ipcBridge.conversation.responseSearchWorkSpace.provider((data) => {
      if (data.match) setFiles([data.match]);
      return Promise.resolve();
    });
  }, [setFiles]);

  /**
   * 监听右键菜单外部点击 - 关闭菜单
   * Listen to clicks outside context menu - close menu
   */
  useEffect(() => {
    const handleClose = () => {
      closeContextMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeContextMenu();
      }
    };
    window.addEventListener('click', handleClose);
    window.addEventListener('scroll', handleClose, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('click', handleClose);
      window.removeEventListener('scroll', handleClose, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeContextMenu]);
}
