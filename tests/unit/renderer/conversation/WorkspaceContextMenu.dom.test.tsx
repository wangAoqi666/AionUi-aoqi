import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

import type { IDirOrFile } from '@/common/adapter/ipcBridge';
import WorkspaceContextMenu from '@/renderer/pages/conversation/Workspace/components/WorkspaceContextMenu';

const baseStyle = { top: 12, left: 24 };

const createProps = (node: IDirOrFile) => {
  return {
    visible: true,
    style: baseStyle,
    node,
    t: (key: string) => key,
    handleOpenNode: vi.fn(async () => {}),
    handleOpenFolderWith: vi.fn(async () => {}),
    handleRevealNode: vi.fn(async () => {}),
    handlePreviewFile: vi.fn(async () => {}),
    handleDownloadFile: vi.fn(async () => {}),
    handleAddToChat: vi.fn(),
    handleDeleteNode: vi.fn(),
    openRenameModal: vi.fn(),
    closeContextMenu: vi.fn(),
  };
};

describe('WorkspaceContextMenu', () => {
  it('shows folder-specific actions for directories', () => {
    const folderNode: IDirOrFile = {
      name: 'docs',
      fullPath: '/workspace/docs',
      relativePath: 'docs',
      isDir: true,
      isFile: false,
    };
    const props = createProps(folderNode);

    render(<WorkspaceContextMenu {...props} />);

    expect(screen.getByText('conversation.workspace.contextMenu.openFolder')).toBeInTheDocument();
    expect(screen.getByText('conversation.workspace.openWith.terminal')).toBeInTheDocument();
    expect(screen.getByText('conversation.workspace.contextMenu.addToChat')).toBeInTheDocument();
    expect(screen.getByText('conversation.workspace.contextMenu.rename')).toBeInTheDocument();
    expect(screen.getByText('common.delete')).toBeInTheDocument();
    expect(screen.queryByText('conversation.workspace.contextMenu.open')).not.toBeInTheDocument();
    expect(screen.queryByText('conversation.workspace.contextMenu.openLocation')).not.toBeInTheDocument();
    expect(screen.queryByText('conversation.workspace.contextMenu.preview')).not.toBeInTheDocument();
    expect(screen.queryByText('conversation.workspace.contextMenu.download')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('conversation.workspace.openWith.terminal'));

    expect(props.handleOpenFolderWith).toHaveBeenCalledWith(folderNode, 'terminal');
    expect(props.closeContextMenu).toHaveBeenCalledTimes(1);
  });

  it('shows file-specific actions for previewable files', () => {
    const fileNode: IDirOrFile = {
      name: 'note.md',
      fullPath: '/workspace/note.md',
      relativePath: 'note.md',
      isDir: false,
      isFile: true,
    };
    const props = createProps(fileNode);

    render(<WorkspaceContextMenu {...props} />);

    expect(screen.getByText('conversation.workspace.contextMenu.open')).toBeInTheDocument();
    expect(screen.getByText('conversation.workspace.contextMenu.openLocation')).toBeInTheDocument();
    expect(screen.getByText('conversation.workspace.contextMenu.preview')).toBeInTheDocument();
    expect(screen.getByText('conversation.workspace.contextMenu.download')).toBeInTheDocument();
    expect(screen.getByText('conversation.workspace.contextMenu.addToChat')).toBeInTheDocument();
    expect(screen.queryByText('conversation.workspace.openWith.explorer')).not.toBeInTheDocument();
    expect(screen.queryByText('conversation.workspace.openWith.terminal')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('conversation.workspace.contextMenu.addToChat'));

    expect(props.handleAddToChat).toHaveBeenCalledWith(fileNode);
  });
});
