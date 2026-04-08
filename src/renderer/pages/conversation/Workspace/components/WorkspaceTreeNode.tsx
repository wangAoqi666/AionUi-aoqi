/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IDirOrFile } from '@/common/adapter/ipcBridge';
import { getContentTypeByExtension, getFileExtension } from '@/renderer/pages/conversation/Preview/fileUtils';
import type { FileOrFolderItem } from '@/renderer/utils/file/fileTypes';
import { serializeWorkspaceDragItem, WORKSPACE_DRAG_MIME } from '@/renderer/utils/file/fileSelection';
import {
  FileCode,
  FileExcel,
  FileJpg,
  FilePdf,
  FilePpt,
  FileText,
  FileWord,
  FileZip,
  FolderClose,
  FolderOpen,
  MoreOne,
} from '@icon-park/react';
import classNames from 'classnames';
import type { TFunction } from 'i18next';
import React, { useMemo } from 'react';

type WorkspaceTreeNodeProps = {
  t: TFunction;
  node: IDirOrFile;
  isExpanded: boolean;
  isSelected: boolean;
  isMobile: boolean;
  onOpenContextMenu: (node: IDirOrFile, x: number, y: number) => void;
};

type WorkspaceNodeVisual = 'folder' | 'code' | 'text' | 'image' | 'pdf' | 'word' | 'ppt' | 'excel' | 'archive';

const ARCHIVE_EXTENSIONS = new Set(['zip', 'tar', 'gz', 'tgz', 'rar', '7z', 'xz', 'bz2']);
const TEXT_EXTENSIONS = new Set(['txt', 'log', 'env', 'ini', 'conf', 'toml', 'csv']);

function getWorkspaceNodeVisual(node: IDirOrFile): WorkspaceNodeVisual {
  if (!node.isFile) {
    return 'folder';
  }

  const extension = getFileExtension(node.name);
  if (ARCHIVE_EXTENSIONS.has(extension)) {
    return 'archive';
  }

  if (TEXT_EXTENSIONS.has(extension)) {
    return 'text';
  }

  switch (getContentTypeByExtension(node.name)) {
    case 'markdown':
      return 'text';
    case 'image':
      return 'image';
    case 'pdf':
      return 'pdf';
    case 'word':
      return 'word';
    case 'ppt':
      return 'ppt';
    case 'excel':
      return 'excel';
    case 'html':
    case 'code':
    default:
      return 'code';
  }
}

const renderNodeIcon = (visual: WorkspaceNodeVisual, isExpanded: boolean) => {
  switch (visual) {
    case 'folder':
      return isExpanded ? (
        <FolderOpen theme='outline' size='16' fill='currentColor' />
      ) : (
        <FolderClose theme='outline' size='16' fill='currentColor' />
      );
    case 'image':
      return <FileJpg theme='outline' size='16' fill='currentColor' />;
    case 'pdf':
      return <FilePdf theme='outline' size='16' fill='currentColor' />;
    case 'word':
      return <FileWord theme='outline' size='16' fill='currentColor' />;
    case 'ppt':
      return <FilePpt theme='outline' size='16' fill='currentColor' />;
    case 'excel':
      return <FileExcel theme='outline' size='16' fill='currentColor' />;
    case 'archive':
      return <FileZip theme='outline' size='16' fill='currentColor' />;
    case 'text':
      return <FileText theme='outline' size='16' fill='currentColor' />;
    case 'code':
    default:
      return <FileCode theme='outline' size='16' fill='currentColor' />;
  }
};

const getWorkspaceNodeIconColor = (node: IDirOrFile, visual: WorkspaceNodeVisual): string => {
  switch (visual) {
    case 'folder':
      return 'var(--color-text-1)';
    case 'image':
      return 'var(--color-success)';
    case 'pdf':
      return 'var(--color-danger)';
    case 'word':
      return 'var(--color-primary)';
    case 'ppt':
      return 'var(--color-warning)';
    case 'excel':
      return 'var(--color-success)';
    case 'archive':
      return 'var(--color-warning)';
    case 'text':
      return 'var(--color-text-3)';
    case 'code':
    default: {
      const extension = getFileExtension(node.name);
      if (extension === 'py') {
        return 'var(--color-warning)';
      }
      if (['js', 'jsx', 'ts', 'tsx'].includes(extension)) {
        return 'var(--color-primary)';
      }
      return 'var(--color-text-2)';
    }
  }
};

const WorkspaceTreeNode: React.FC<WorkspaceTreeNodeProps> = ({
  t,
  node,
  isExpanded,
  isSelected,
  isMobile,
  onOpenContextMenu,
}) => {
  const visual = useMemo(() => getWorkspaceNodeVisual(node), [node]);
  const iconColor = useMemo(() => getWorkspaceNodeIconColor(node, visual), [node, visual]);
  const dragItem = useMemo<FileOrFolderItem | null>(
    () =>
      node.isFile && node.fullPath
        ? {
            path: node.fullPath,
            name: node.name,
            isFile: true,
            relativePath: node.relativePath || undefined,
          }
        : null,
    [node]
  );

  return (
    <div
      className={classNames('workspace-tree-row', {
        'workspace-tree-row--selected': isSelected,
        'workspace-tree-row--mobile': isMobile,
      })}
      draggable={Boolean(dragItem)}
      onDragStart={(event) => {
        if (!dragItem) {
          return;
        }

        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData(WORKSPACE_DRAG_MIME, serializeWorkspaceDragItem(dragItem));
        event.dataTransfer.setData('text/plain', dragItem.path);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpenContextMenu(node, event.clientX, event.clientY);
      }}
    >
      <span className='workspace-tree-row__main'>
        <span
          className={classNames('workspace-tree-row__icon', {
            'workspace-tree-row__icon--folder': visual === 'folder',
          })}
          style={{ color: iconColor }}
          aria-hidden='true'
        >
          {renderNodeIcon(visual, isExpanded)}
        </span>
        <span className='workspace-tree-row__label'>{node.name}</span>
      </span>

      {isMobile && (
        <button
          type='button'
          className='workspace-header__toggle workspace-tree-row__more workspace-node-more-btn'
          aria-label={t('common.more')}
          onMouseDown={(event) => {
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.stopPropagation();
            const rect = (event.currentTarget as HTMLButtonElement).getBoundingClientRect();
            const menuWidth = 220;
            const menuHeight = 220;
            const maxX = typeof window !== 'undefined' ? Math.max(8, window.innerWidth - menuWidth - 8) : rect.left;
            const maxY = typeof window !== 'undefined' ? Math.max(8, window.innerHeight - menuHeight - 8) : rect.bottom;
            const menuX = Math.min(Math.max(8, rect.left - menuWidth + rect.width), maxX);
            const menuY = Math.min(Math.max(8, rect.bottom + 4), maxY);
            onOpenContextMenu(node, menuX, menuY);
          }}
        >
          <MoreOne theme='outline' size='16' fill='currentColor' />
        </button>
      )}
    </div>
  );
};

export default WorkspaceTreeNode;
