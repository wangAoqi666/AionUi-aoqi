import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

vi.mock('@arco-design/web-react', () => ({
  Message: {
    error: vi.fn(),
  },
}));

import { useDragUpload } from '@/renderer/hooks/file/useDragUpload';
import { serializeWorkspaceDragItem, WORKSPACE_DRAG_MIME } from '@/renderer/utils/file/fileSelection';

const workspaceItem = {
  path: '/workspace/index.tsx',
  name: 'index.tsx',
  isFile: true,
  relativePath: 'index.tsx',
} as const;

const DragUploadHarness: React.FC<{
  onWorkspaceItemsDropped?: (items: (typeof workspaceItem)[]) => void;
}> = ({ onWorkspaceItemsDropped }) => {
  const { isFileDragging, dragHandlers } = useDragUpload({
    onWorkspaceItemsDropped,
  });

  return (
    <div data-testid='drop-zone' data-dragging={isFileDragging ? 'yes' : 'no'} {...dragHandlers}>
      drop zone
    </div>
  );
};

describe('useDragUpload', () => {
  it('ignores plain text drags so the sendbox keeps normal text-drop behavior', () => {
    render(<DragUploadHarness />);

    fireEvent.dragEnter(screen.getByTestId('drop-zone'), {
      dataTransfer: {
        types: ['text/plain'],
      },
    });

    expect(screen.getByTestId('drop-zone')).toHaveAttribute('data-dragging', 'no');
  });

  it('accepts workspace item drags and forwards them as path-based context items', () => {
    const onWorkspaceItemsDropped = vi.fn();

    render(<DragUploadHarness onWorkspaceItemsDropped={onWorkspaceItemsDropped} />);

    const transfer = {
      types: [WORKSPACE_DRAG_MIME],
      files: [],
      getData: (type: string) => (type === WORKSPACE_DRAG_MIME ? serializeWorkspaceDragItem(workspaceItem) : ''),
    };

    fireEvent.dragEnter(screen.getByTestId('drop-zone'), {
      dataTransfer: transfer,
    });
    expect(screen.getByTestId('drop-zone')).toHaveAttribute('data-dragging', 'yes');

    fireEvent.drop(screen.getByTestId('drop-zone'), {
      dataTransfer: transfer,
    });

    expect(onWorkspaceItemsDropped).toHaveBeenCalledWith([workspaceItem]);
    expect(screen.getByTestId('drop-zone')).toHaveAttribute('data-dragging', 'no');
  });
});
