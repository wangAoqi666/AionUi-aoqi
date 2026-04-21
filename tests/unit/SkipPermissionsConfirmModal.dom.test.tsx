import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

// Mock window.matchMedia for Arco Design responsive observer, even though
// we mock AionModal below — some transitive imports still touch matchMedia.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// i18n stub so we can assert on the i18n keys requested from t().
// Default value branches MUST still appear in output so real locales always
// render something meaningful even before the i18n bundle lands.
const requestedKeys: string[] = [];
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => {
      requestedKeys.push(key);
      return options?.defaultValue ?? key;
    },
    i18n: { language: 'zh-CN' },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

vi.mock('@icon-park/react', () => ({
  Caution: () => <span data-testid='icon-caution' />,
}));

// Simplified AionModal surface: render nothing when hidden, else render the
// header/footer/children verbatim so we can make meaningful DOM assertions.
vi.mock('@/renderer/components/base', async () => {
  return {
    AionModal: ({
      visible,
      onCancel,
      header,
      footer,
      children,
    }: {
      visible: boolean;
      onCancel: () => void;
      header?: { title: React.ReactNode; showClose?: boolean } | React.ReactNode;
      footer?: React.ReactNode;
      children?: React.ReactNode;
    }) => {
      if (!visible) {
        return <div data-testid='aion-modal-hidden' />;
      }
      const renderedHeader =
        header && typeof header === 'object' && 'title' in (header as { title: React.ReactNode })
          ? (header as { title: React.ReactNode }).title
          : (header as React.ReactNode);
      return (
        <div data-testid='aion-modal' role='dialog'>
          <div data-testid='aion-modal-header'>
            {renderedHeader}
            <button type='button' data-testid='aion-modal-close' onClick={onCancel}>
              ×
            </button>
          </div>
          <div data-testid='aion-modal-body'>{children}</div>
          <div data-testid='aion-modal-footer'>{footer}</div>
        </div>
      );
    },
  };
});

// Import AFTER mocks are set up.
const { default: SkipPermissionsConfirmModal } =
  await import('@/renderer/components/agent/SkipPermissionsConfirmModal');

describe('SkipPermissionsConfirmModal', () => {
  beforeEach(() => {
    requestedKeys.length = 0;
    vi.clearAllMocks();
  });

  it('renders nothing visible when visible=false', () => {
    render(<SkipPermissionsConfirmModal visible={false} onConfirm={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByTestId('aion-modal-hidden')).toBeTruthy();
    expect(screen.queryByTestId('aion-modal')).toBeNull();
  });

  it('renders title, warning icon, body, warning and both buttons when visible', () => {
    render(<SkipPermissionsConfirmModal visible onConfirm={vi.fn()} onCancel={vi.fn()} />);

    // Warning icon should be present in the header.
    expect(screen.getByTestId('icon-caution')).toBeTruthy();

    // All 5 i18n keys must have been requested (title/body/warning/both buttons).
    expect(requestedKeys).toEqual(
      expect.arrayContaining([
        'agentMode.yoloConfirmTitle',
        'agentMode.yoloConfirmBody',
        'agentMode.yoloConfirmWarning',
        'agentMode.yoloConfirmConfirmButton',
        'agentMode.yoloConfirmCancelButton',
      ])
    );

    // Title text (Chinese default value) should render in the header.
    expect(screen.getByText(/启用 真 YOLO/)).toBeTruthy();

    // Body + warning text should both be visible.
    expect(screen.getByText(/skipPermissionsUnsafe/)).toBeTruthy();
    expect(screen.getByText(/切换到其他模式时会自动关闭/)).toBeTruthy();

    // Both buttons should render with their default labels.
    expect(screen.getByText('取消')).toBeTruthy();
    expect(screen.getByText('我确认风险，启用真 YOLO')).toBeTruthy();
  });

  it('invokes onConfirm when the warning-styled confirm button is clicked', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<SkipPermissionsConfirmModal visible onConfirm={onConfirm} onCancel={onCancel} />);

    fireEvent.click(screen.getByText('我确认风险，启用真 YOLO'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('invokes onCancel when the cancel button is clicked', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<SkipPermissionsConfirmModal visible onConfirm={onConfirm} onCancel={onCancel} />);

    fireEvent.click(screen.getByText('取消'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('invokes onCancel when the AionModal close button is clicked', () => {
    const onCancel = vi.fn();
    render(<SkipPermissionsConfirmModal visible onConfirm={vi.fn()} onCancel={onCancel} />);

    fireEvent.click(screen.getByTestId('aion-modal-close'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables the cancel button and sets loading state on confirm while loading=true', () => {
    render(<SkipPermissionsConfirmModal visible loading onConfirm={vi.fn()} onCancel={vi.fn()} />);

    const cancelButton = screen.getByText('取消').closest('button');
    expect(cancelButton).toBeTruthy();
    expect(cancelButton?.getAttribute('disabled')).not.toBeNull();
  });
});
