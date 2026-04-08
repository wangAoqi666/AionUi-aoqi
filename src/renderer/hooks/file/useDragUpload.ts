/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Message } from '@arco-design/web-react';
import type { FileMetadata } from '@renderer/services/FileService';
import { isSupportedFile, FileService, MAX_UPLOAD_SIZE_MB } from '@renderer/services/FileService';
import type { FileSelectionItem } from '@renderer/utils/file/fileSelection';
import { parseWorkspaceDragItem, WORKSPACE_DRAG_MIME } from '@renderer/utils/file/fileSelection';

export interface UseDragUploadOptions {
  supportedExts?: string[];
  onFilesAdded?: (files: FileMetadata[]) => void;
  onWorkspaceItemsDropped?: (items: FileSelectionItem[]) => void;
  /** Conversation ID for WebUI file uploads */
  conversationId?: string;
}

const getTransferTypes = (event: React.DragEvent): string[] => {
  const { dataTransfer } = event.nativeEvent;
  return dataTransfer?.types ? Array.from(dataTransfer.types) : [];
};

const hasSupportedDropPayload = (event: React.DragEvent): boolean => {
  const transferTypes = getTransferTypes(event);
  return transferTypes.includes('Files') || transferTypes.includes(WORKSPACE_DRAG_MIME);
};

export const useDragUpload = ({
  supportedExts = [],
  onFilesAdded,
  onWorkspaceItemsDropped,
  conversationId,
}: UseDragUploadOptions) => {
  const { t } = useTranslation();
  const [isFileDragging, setIsFileDragging] = useState(false);

  // 拖拽计数器，防止状态闪烁
  const dragCounter = useRef(0);

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!hasSupportedDropPayload(e)) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      if (!isFileDragging) {
        setIsFileDragging(true);
        dragCounter.current += 1;
      }
    },
    [isFileDragging]
  );

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!hasSupportedDropPayload(e)) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    dragCounter.current += 1;
    setIsFileDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    dragCounter.current -= 1;

    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setIsFileDragging(false);
    }
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      if (!hasSupportedDropPayload(e)) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      // 重置状态
      dragCounter.current = 0;
      setIsFileDragging(false);

      const dataTransfer = e.nativeEvent.dataTransfer;
      const workspaceItem = parseWorkspaceDragItem(dataTransfer?.getData(WORKSPACE_DRAG_MIME) ?? '');
      if (workspaceItem) {
        onWorkspaceItemsDropped?.([workspaceItem]);
        return;
      }

      if (!onFilesAdded) return;

      try {
        const droppedFiles = dataTransfer?.files;
        if (!droppedFiles) {
          return;
        }

        // 第一步：先校验文件类型，筛选出支持的文件
        const validFiles: File[] = [];

        for (let i = 0; i < droppedFiles.length; i++) {
          const file = droppedFiles[i];
          if (supportedExts.length === 0 || isSupportedFile(file.name, supportedExts)) {
            validFiles.push(file);
          }
          // 注意：不支持的文件会被静默过滤，与原逻辑保持一致
        }

        // 第二步：只处理校验通过的文件
        if (validFiles.length > 0) {
          // 创建 FileList 对象给 processDroppedFiles
          const validFileList = Object.assign(validFiles, {
            length: validFiles.length,
            item: (index: number) => validFiles[index] || null,
          }) as unknown as FileList;
          const processedFiles = await FileService.processDroppedFiles(validFileList, conversationId);

          if (processedFiles.length > 0) {
            onFilesAdded(processedFiles);
          }
        }
      } catch (err) {
        if (err instanceof Error && err.message === 'FILE_TOO_LARGE') {
          Message.error(t('common.fileAttach.tooLarge', { max: MAX_UPLOAD_SIZE_MB }));
        } else {
          console.error('Failed to process dropped files:', err);
          Message.error(t('conversation.workspace.dragFailed', 'Failed to process dropped files'));
        }
      }
    },
    [conversationId, onFilesAdded, onWorkspaceItemsDropped, supportedExts, t]
  );

  const dragHandlers = {
    onDragOver: handleDragOver,
    onDragEnter: handleDragEnter,
    onDragLeave: handleDragLeave,
    onDrop: handleDrop,
  };

  return {
    isFileDragging,
    dragHandlers,
  };
};
