/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * DOM tests for `OfficeWatchViewer` — covers the failure card's Retry,
 * Manual Install, and Copy Command actions plus Windows ExecutionPolicy
 * hint routing. The happy-path / status-emitter coverage lives in the
 * sibling PptViewer / OfficeDocViewer tests.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- Hoisted mocks ---

const {
  startInvokeMock,
  stopInvokeMock,
  statusOnMock,
  statusUnsubMock,
  installOfficecliMock,
  openExternalUrlMock,
  clipboardWriteTextMock,
  messageSuccessMock,
  messageErrorMock,
  isElectronDesktopMock,
} = vi.hoisted(() => ({
  startInvokeMock: vi.fn(),
  stopInvokeMock: vi.fn(),
  statusOnMock: vi.fn(),
  statusUnsubMock: vi.fn(),
  installOfficecliMock: vi.fn(),
  openExternalUrlMock: vi.fn(),
  clipboardWriteTextMock: vi.fn(),
  messageSuccessMock: vi.fn(),
  messageErrorMock: vi.fn(),
  isElectronDesktopMock: vi.fn(() => true),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    pptPreview: {
      start: { invoke: (...args: unknown[]) => startInvokeMock(...args) },
      stop: { invoke: (...args: unknown[]) => stopInvokeMock(...args) },
      status: { on: (...args: unknown[]) => statusOnMock(...args) },
    },
    wordPreview: {
      start: { invoke: (...args: unknown[]) => startInvokeMock(...args) },
      stop: { invoke: (...args: unknown[]) => stopInvokeMock(...args) },
      status: { on: (...args: unknown[]) => statusOnMock(...args) },
    },
    excelPreview: {
      start: { invoke: (...args: unknown[]) => startInvokeMock(...args) },
      stop: { invoke: (...args: unknown[]) => stopInvokeMock(...args) },
      status: { on: (...args: unknown[]) => statusOnMock(...args) },
    },
    officeCli: {
      installOfficecli: { invoke: (...args: unknown[]) => installOfficecliMock(...args) },
      getOfficecliStatus: { invoke: vi.fn() },
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@arco-design/web-react', () => {
  const Message = {
    success: (...args: unknown[]) => messageSuccessMock(...args),
    error: (...args: unknown[]) => messageErrorMock(...args),
  };
  return {
    Button: ({
      children,
      onClick,
      loading,
      icon,
    }: {
      children?: React.ReactNode;
      onClick?: (e: React.MouseEvent) => void;
      loading?: boolean;
      icon?: React.ReactNode;
    }) => (
      <button type='button' onClick={onClick} disabled={loading} data-loading={loading ? 'true' : 'false'}>
        {icon}
        {children}
      </button>
    ),
    Message,
    Spin: ({ size }: { size?: number }) => (
      <div data-testid='spin' data-size={size}>
        loading...
      </div>
    ),
  };
});

vi.mock('@icon-park/react', () => ({
  Copy: ({ size }: { size?: string }) => <span data-testid='copy-icon' data-size={size} />,
}));

vi.mock('@/renderer/components/media/WebviewHost', () => ({
  default: ({ url, className }: { url: string; className?: string }) => (
    <div data-testid='webview-host' data-url={url} className={className} />
  ),
}));

vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: (...args: unknown[]) => isElectronDesktopMock(...args),
  openExternalUrl: (...args: unknown[]) => openExternalUrlMock(...args),
}));

// --- Helpers ---

let originalNavigator: PropertyDescriptor | undefined;
let originalClipboardDescriptor: PropertyDescriptor | undefined;

function setPlatform(platform: string): void {
  originalNavigator = Object.getOwnPropertyDescriptor(navigator, 'platform');
  Object.defineProperty(navigator, 'platform', {
    configurable: true,
    get: () => platform,
  });
}

function restorePlatform(): void {
  if (originalNavigator) {
    Object.defineProperty(navigator, 'platform', originalNavigator);
    originalNavigator = undefined;
  }
}

function installClipboardMock(): void {
  originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: clipboardWriteTextMock,
    },
  });
}

function restoreClipboard(): void {
  if (originalClipboardDescriptor) {
    Object.defineProperty(navigator, 'clipboard', originalClipboardDescriptor);
    originalClipboardDescriptor = undefined;
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (navigator as any).clipboard;
  }
}

import OfficeWatchViewer from '@/renderer/pages/conversation/Preview/components/viewers/OfficeWatchViewer';

beforeEach(() => {
  vi.clearAllMocks();
  statusOnMock.mockReturnValue(statusUnsubMock);
  stopInvokeMock.mockResolvedValue(undefined);
  isElectronDesktopMock.mockReturnValue(true);
  installClipboardMock();
  clipboardWriteTextMock.mockResolvedValue(undefined);
});

afterEach(() => {
  restoreClipboard();
  restorePlatform();
  vi.restoreAllMocks();
});

describe('OfficeWatchViewer — failure card', () => {
  it('renders the structured failure card with title, error, and action buttons', async () => {
    setPlatform('MacIntel');
    startInvokeMock.mockRejectedValue(new Error('spawn failed'));

    await act(async () => {
      render(<OfficeWatchViewer docType='word' filePath='/test/file.docx' />);
    });

    expect(screen.getByTestId('officecli-failure-card')).toBeInTheDocument();
    expect(screen.getByText('preview.officecli.failed.title')).toBeInTheDocument();
    expect(screen.getByText('spawn failed')).toBeInTheDocument();
    // darwin platform → darwin hint key chosen by default
    expect(screen.getByText('preview.officecli.hints.darwin')).toBeInTheDocument();
    expect(screen.getByText('preview.officecli.actions.retry')).toBeInTheDocument();
    expect(screen.getByText('preview.officecli.actions.manualInstall')).toBeInTheDocument();
    expect(screen.getByText('preview.officecli.actions.copyCommand')).toBeInTheDocument();
  });

  it('shows the Windows ExecutionPolicy hint when the bridge emits it', async () => {
    setPlatform('Win32');
    startInvokeMock.mockRejectedValue(new Error('PowerShell blocked'));

    await act(async () => {
      render(<OfficeWatchViewer docType='ppt' filePath='/test/file.pptx' />);
    });

    // Capture the status handler registered by the viewer and drive an error
    // event from the bridge side.
    const statusHandler = statusOnMock.mock.calls[0][0] as (evt: {
      state: 'starting' | 'installing' | 'ready' | 'error';
      hintKey?: string;
      manualCommand?: string;
    }) => void;

    act(() => {
      statusHandler({
        state: 'error',
        hintKey: 'preview.officecli.hints.windowsExecutionPolicy',
        manualCommand: 'powershell -NoProfile -Command "irm ..."',
      });
    });

    expect(screen.getByText('preview.officecli.hints.windowsExecutionPolicy')).toBeInTheDocument();
    // Manual command from the bridge payload takes priority over the default.
    expect(screen.getByText('powershell -NoProfile -Command "irm ..."')).toBeInTheDocument();
  });

  it('re-invokes start when retry button is clicked and surfaces installing state', async () => {
    setPlatform('Linux x86_64');
    startInvokeMock.mockRejectedValueOnce(new Error('first failure'));
    installOfficecliMock.mockResolvedValue({
      success: true,
      data: { ok: true, status: { state: 'installed' } },
    });
    startInvokeMock.mockResolvedValueOnce({ url: 'http://localhost:55555' });

    await act(async () => {
      render(<OfficeWatchViewer docType='excel' filePath='/test/file.xlsx' />);
    });

    expect(screen.getByTestId('officecli-failure-card')).toBeInTheDocument();
    expect(startInvokeMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(screen.getByText('preview.officecli.actions.retry'));
    });

    expect(installOfficecliMock).toHaveBeenCalledTimes(1);
    // `start.invoke` re-runs after retry since the effect re-mounts via startKey bump.
    await waitFor(() => expect(startInvokeMock).toHaveBeenCalledTimes(2));
  });

  it('copies the install command to clipboard and shows success message', async () => {
    setPlatform('MacIntel');
    startInvokeMock.mockRejectedValue(new Error('failed'));

    await act(async () => {
      render(<OfficeWatchViewer docType='word' filePath='/test/file.docx' />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('preview.officecli.actions.copyCommand'));
    });

    expect(clipboardWriteTextMock).toHaveBeenCalledWith(expect.stringContaining('install.sh | bash'));
    expect(messageSuccessMock).toHaveBeenCalledWith('preview.officecli.actions.copySuccess');
  });

  it('opens the manual install URL via openExternalUrl', async () => {
    setPlatform('MacIntel');
    startInvokeMock.mockRejectedValue(new Error('failed'));

    await act(async () => {
      render(<OfficeWatchViewer docType='ppt' filePath='/test/file.pptx' />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('preview.officecli.actions.manualInstall'));
    });

    expect(openExternalUrlMock).toHaveBeenCalledWith(expect.stringContaining('iOfficeAI/OfficeCli'));
  });

  it('limits the failure card to at most six interactive buttons', async () => {
    setPlatform('Win32');
    startInvokeMock.mockRejectedValue(new Error('failed'));

    await act(async () => {
      render(<OfficeWatchViewer docType='word' filePath='/test/file.docx' />);
    });

    const card = screen.getByTestId('officecli-failure-card');
    const buttons = card.querySelectorAll('button');
    expect(buttons.length).toBeLessThanOrEqual(6);
    // Retry + ManualInstall + CopyCommand = exactly 3 action buttons for M3.C.
    expect(buttons.length).toBe(3);
  });
});
