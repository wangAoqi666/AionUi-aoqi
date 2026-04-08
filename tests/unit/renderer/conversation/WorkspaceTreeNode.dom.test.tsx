import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';

const iconMocks = vi.hoisted(() => {
  return {
    FileCode: (props: { className?: string }) => <span className={props.className} data-testid='icon-file-code' />,
    FileExcel: (props: { className?: string }) => <span className={props.className} data-testid='icon-file-excel' />,
    FileJpg: (props: { className?: string }) => <span className={props.className} data-testid='icon-file-image' />,
    FilePdf: (props: { className?: string }) => <span className={props.className} data-testid='icon-file-pdf' />,
    FilePpt: (props: { className?: string }) => <span className={props.className} data-testid='icon-file-ppt' />,
    FileText: (props: { className?: string }) => <span className={props.className} data-testid='icon-file-text' />,
    FileWord: (props: { className?: string }) => <span className={props.className} data-testid='icon-file-word' />,
    FileZip: (props: { className?: string }) => <span className={props.className} data-testid='icon-file-archive' />,
    FolderClose: (props: { className?: string }) => (
      <span className={props.className} data-testid='icon-folder-close' />
    ),
    FolderOpen: (props: { className?: string }) => <span className={props.className} data-testid='icon-folder-open' />,
    MoreOne: (props: { className?: string }) => <span className={props.className} data-testid='icon-more' />,
  };
});

vi.mock('@icon-park/react', () => iconMocks);

import type { IDirOrFile } from '@/common/adapter/ipcBridge';
import WorkspaceTreeNode from '@/renderer/pages/conversation/Workspace/components/WorkspaceTreeNode';
import { WORKSPACE_DRAG_MIME } from '@/renderer/utils/file/fileSelection';

const t = ((key: string) => {
  if (key === 'common.more') {
    return 'More';
  }

  return key;
}) as unknown as TFunction;

const folderNode: IDirOrFile = {
  name: 'src',
  fullPath: '/workspace/src',
  relativePath: 'src',
  isDir: true,
  isFile: false,
};

const fileNode: IDirOrFile = {
  name: 'index.tsx',
  fullPath: '/workspace/index.tsx',
  relativePath: 'index.tsx',
  isDir: false,
  isFile: true,
};

describe('WorkspaceTreeNode', () => {
  it('renders folder state with the lighter selected row styling', () => {
    render(
      <WorkspaceTreeNode
        t={t}
        node={folderNode}
        isExpanded={true}
        isSelected={true}
        isMobile={false}
        onOpenContextMenu={vi.fn()}
      />
    );

    expect(screen.getByText('src').closest('.workspace-tree-row')).toHaveClass('workspace-tree-row--selected');
    expect(screen.getByTestId('icon-folder-open')).toBeInTheDocument();
  });

  it('renders code files with the file icon and exposes drag payload as a path item', () => {
    const setData = vi.fn();

    render(
      <WorkspaceTreeNode
        t={t}
        node={fileNode}
        isExpanded={false}
        isSelected={false}
        isMobile={false}
        onOpenContextMenu={vi.fn()}
      />
    );

    fireEvent.dragStart(screen.getByText('index.tsx').closest('.workspace-tree-row')!, {
      dataTransfer: {
        effectAllowed: '',
        setData,
      },
    });

    expect(screen.getByTestId('icon-file-code')).toBeInTheDocument();
    expect(setData).toHaveBeenCalledWith(WORKSPACE_DRAG_MIME, expect.stringContaining('"path":"/workspace/index.tsx"'));
    expect(setData).toHaveBeenCalledWith('text/plain', '/workspace/index.tsx');
  });

  it('shows the mobile quick-action button and opens the context menu from it', () => {
    const onOpenContextMenu = vi.fn();

    render(
      <WorkspaceTreeNode
        t={t}
        node={folderNode}
        isExpanded={false}
        isSelected={false}
        isMobile={true}
        onOpenContextMenu={onOpenContextMenu}
      />
    );

    const moreButton = screen.getByRole('button', { name: 'More' });
    Object.defineProperty(moreButton, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: 120,
        top: 96,
        right: 152,
        bottom: 128,
        width: 32,
        height: 32,
        x: 120,
        y: 96,
        toJSON: () => ({}),
      }),
    });

    fireEvent.click(moreButton);

    expect(screen.getByTestId('icon-more')).toBeInTheDocument();
    expect(onOpenContextMenu).toHaveBeenCalledWith(folderNode, expect.any(Number), expect.any(Number));
  });
});
