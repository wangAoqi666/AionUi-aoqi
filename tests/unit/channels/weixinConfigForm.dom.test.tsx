/**
 * DOM tests for WeixinConfigForm login state machine.
 */
import type { IChannelPluginStatus } from '@process/channels/types';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import React from 'react';

const { mockEnablePlugin, mockDisablePlugin, mockGetPluginStatus, noopModelSelection } = vi.hoisted(() => ({
  mockEnablePlugin: vi.fn(async () => ({ success: true })),
  mockDisablePlugin: vi.fn(async () => ({ success: true })),
  mockGetPluginStatus: vi.fn(async () => ({ success: true, data: [] })),
  noopModelSelection: {
    currentModel: undefined,
    isLoading: false,
    onSelectModel: vi.fn(),
  },
}));

vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return {
    ...actual,
    Message: {
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
    },
  };
});

// Mock i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | { defaultValue?: string }) =>
      typeof fallback === 'string' ? fallback : (fallback?.defaultValue ?? key),
  }),
}));

// Mock electronAPI
const mockWeixinLoginStart = vi.fn();
const mockWeixinLoginOnQR = vi.fn(() => vi.fn());
const mockWeixinLoginOnScanned = vi.fn(() => vi.fn());
const mockWeixinLoginOnDone = vi.fn(() => vi.fn());

Object.defineProperty(window, 'electronAPI', {
  value: {
    weixinLoginStart: mockWeixinLoginStart,
    weixinLoginOnQR: mockWeixinLoginOnQR,
    weixinLoginOnScanned: mockWeixinLoginOnScanned,
    weixinLoginOnDone: mockWeixinLoginOnDone,
  },
  writable: true,
});

// Mock channel IPC bridge
vi.mock('@/common/adapter/ipcBridge', () => ({
  channel: {
    enablePlugin: { invoke: mockEnablePlugin },
    disablePlugin: { invoke: mockDisablePlugin },
    getPluginStatus: { invoke: mockGetPluginStatus },
    syncChannelSettings: { invoke: vi.fn(async () => ({ success: true })) },
    getPendingPairings: { invoke: vi.fn(async () => ({ success: true, data: [] })) },
    getAuthorizedUsers: { invoke: vi.fn(async () => ({ success: true, data: [] })) },
    pairingRequested: { on: vi.fn(() => vi.fn()) },
    userAuthorized: { on: vi.fn(() => vi.fn()) },
  },
  acpConversation: {
    getAvailableAgents: { invoke: vi.fn(async () => ({ success: true, data: [] })) },
  },
}));

vi.mock('@/common/config/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/common/config/storage')>();
  return {
    ...actual,
    ConfigStorage: { get: vi.fn(async () => undefined), set: vi.fn(async () => {}) },
  };
});

vi.mock('@/renderer/pages/conversation/platforms/gemini/GeminiModelSelector', () => ({
  default: ({ label }: { label?: string }) => <div data-testid='model-selector'>{label}</div>,
}));

vi.mock('@/renderer/components/settings/SettingsModal/contents/channels/useChannelInstanceModelSelection', () => ({
  useChannelInstanceModelSelection: () => noopModelSelection,
}));

vi.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }: { value: string }) => <div data-testid='webui-qr'>{value}</div>,
}));

import WeixinConfigForm from '@/renderer/components/settings/SettingsModal/contents/channels/WeixinConfigForm';
import { ConfigStorage } from '@/common/config/storage';

class MockEventSource {
  static instances: MockEventSource[] = [];
  listeners = new Map<string, Array<(event: MessageEvent) => void>>();
  onerror: null | (() => void) = null;
  close = vi.fn();

  constructor(
    public readonly url: string,
    public readonly options?: EventSourceInit
  ) {
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const handlers = this.listeners.get(type) ?? [];
    handlers.push(listener);
    this.listeners.set(type, handlers);
  }

  emit(type: string, data: unknown = {}) {
    const event = { data: JSON.stringify(data) } as MessageEvent;
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

const createPluginStatus = (overrides: Partial<IChannelPluginStatus> = {}): IChannelPluginStatus => ({
  id: 'weixin_default',
  type: 'weixin',
  name: 'WeChat',
  enabled: true,
  connected: true,
  status: 'running',
  activeUsers: 0,
  hasToken: true,
  ...overrides,
});

describe('WeixinConfigForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockEventSource.instances.length = 0;
    localStorage.clear();
    Object.defineProperty(window, 'EventSource', {
      value: MockEventSource,
      writable: true,
    });
    window.electronAPI = {
      weixinLoginStart: mockWeixinLoginStart,
      weixinLoginOnQR: mockWeixinLoginOnQR,
      weixinLoginOnScanned: mockWeixinLoginOnScanned,
      weixinLoginOnDone: mockWeixinLoginOnDone,
    } as typeof window.electronAPI;
    mockWeixinLoginOnQR.mockReturnValue(vi.fn());
    mockWeixinLoginOnScanned.mockReturnValue(vi.fn());
    mockWeixinLoginOnDone.mockReturnValue(vi.fn());
  });

  it('renders login button in idle state', () => {
    render(<WeixinConfigForm pluginStatus={null} modelSelection={noopModelSelection} onStatusChange={vi.fn()} />);
    expect(screen.getByText('Scan to Login')).toBeTruthy();
  });

  it('shows an empty-state hint when no sidebar workspace is available', () => {
    render(<WeixinConfigForm pluginStatus={null} modelSelection={noopModelSelection} onStatusChange={vi.fn()} />);

    expect(screen.getByText('Open or create a workspace in the sidebar first.')).toBeTruthy();
  });

  it('lists sidebar workspaces and persists the selected published workspace', async () => {
    localStorage.setItem('conversation-opened-folder-spaces', JSON.stringify(['/tmp/workspace-a', '/tmp/workspace-b']));
    localStorage.setItem(
      'conversation-agent-space-display-names',
      JSON.stringify({ '/tmp/workspace-b': '绘画里的工作空间' })
    );

    render(<WeixinConfigForm pluginStatus={null} modelSelection={noopModelSelection} onStatusChange={vi.fn()} />);

    await act(async () => {
      fireEvent.click(screen.getByPlaceholderText('Select a workspace'));
    });

    const namedWorkspaceOption = await screen.findByRole('option', { name: '绘画里的工作空间' });
    expect(screen.getByRole('option', { name: 'workspace-a' })).toBeTruthy();

    await act(async () => {
      fireEvent.click(namedWorkspaceOption);
    });

    await waitFor(() => {
      expect(ConfigStorage.set).toHaveBeenCalledWith('assistant.channel.publishInstances', {
        weixin_default: { workspace: '/tmp/workspace-b' },
      });
    });
    expect(localStorage.getItem('conversation-opened-folder-spaces')).toContain('/tmp/workspace-b');
    expect(screen.getByText('/tmp/workspace-b')).toBeTruthy();
  });

  it('keeps Factory Droid selected by default for WeChat conversations', async () => {
    render(<WeixinConfigForm pluginStatus={null} modelSelection={noopModelSelection} onStatusChange={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Factory Droid')).toBeTruthy();
    });
    expect(screen.queryByText('Automatically follow the model when CLI is running')).toBeNull();
  });

  it('shows loading state when login starts', async () => {
    // weixinLoginStart never resolves in this test — stays in loading
    mockWeixinLoginStart.mockReturnValue(new Promise(() => {}));

    render(<WeixinConfigForm pluginStatus={null} modelSelection={noopModelSelection} onStatusChange={vi.fn()} />);

    await act(async () => {
      fireEvent.click(screen.getByText('Scan to Login'));
    });

    // Button should be loading/disabled
    const btn = screen.getByRole('button', { name: /Scan to Login/i });
    expect(btn).toBeTruthy();
  });

  it('displays QR image when qrcodeUrl is set', async () => {
    let qrCallback: ((data: { qrcodeUrl: string }) => void) | null = null;
    mockWeixinLoginOnQR.mockImplementation((cb: unknown) => {
      qrCallback = cb as (data: { qrcodeUrl: string }) => void;
      return vi.fn();
    });
    mockWeixinLoginStart.mockReturnValue(new Promise(() => {}));

    render(<WeixinConfigForm pluginStatus={null} modelSelection={noopModelSelection} onStatusChange={vi.fn()} />);

    await act(async () => {
      fireEvent.click(screen.getByText('Scan to Login'));
    });

    await act(async () => {
      qrCallback?.({ qrcodeUrl: 'https://example.com/qr.png' });
    });

    const img = screen.getByRole('img');
    expect((img as HTMLImageElement).src).toContain('qr.png');
    expect(screen.getByText('Please scan the QR code with WeChat')).toBeTruthy();
  });

  it('shows scanned text when onScanned fires', async () => {
    let qrCallback: ((data: { qrcodeUrl: string }) => void) | null = null;
    let scannedCallback: (() => void) | null = null;

    mockWeixinLoginOnQR.mockImplementation((cb: unknown) => {
      qrCallback = cb as (data: { qrcodeUrl: string }) => void;
      return vi.fn();
    });
    mockWeixinLoginOnScanned.mockImplementation((cb: unknown) => {
      scannedCallback = cb as () => void;
      return vi.fn();
    });
    mockWeixinLoginStart.mockReturnValue(new Promise(() => {}));

    render(<WeixinConfigForm pluginStatus={null} modelSelection={noopModelSelection} onStatusChange={vi.fn()} />);

    await act(async () => {
      fireEvent.click(screen.getByText('Scan to Login'));
    });
    await act(async () => {
      qrCallback?.({ qrcodeUrl: 'https://example.com/qr.png' });
    });
    await act(async () => {
      scannedCallback?.();
    });

    expect(screen.getByText('Scanned, waiting for confirmation...')).toBeTruthy();
  });

  it('shows already-connected state when pluginStatus.hasToken is true', () => {
    const pluginStatus = createPluginStatus();

    render(
      <WeixinConfigForm pluginStatus={pluginStatus} modelSelection={noopModelSelection} onStatusChange={vi.fn()} />
    );

    expect(screen.getByText('Connected')).toBeTruthy();
    // Login button should not be shown
    expect(screen.queryByText('Scan to Login')).toBeNull();
  });

  it('does not show connected state when plugin has token but is disabled', () => {
    const pluginStatus = createPluginStatus({
      enabled: false,
      connected: false,
      status: 'stopped',
    });

    render(
      <WeixinConfigForm pluginStatus={pluginStatus} modelSelection={noopModelSelection} onStatusChange={vi.fn()} />
    );

    expect(screen.queryByText('Connected')).toBeNull();
    expect(screen.getByText('Scan to Login')).toBeTruthy();
  });

  it('uses the WebUI EventSource login flow when electron login bridge is unavailable', async () => {
    const onStatusChange = vi.fn();
    window.electronAPI = {} as typeof window.electronAPI;
    mockGetPluginStatus.mockResolvedValueOnce({
      success: true,
      data: [{ id: 'weixin_default', type: 'weixin', enabled: true, hasToken: true, status: 'running' }],
    });

    render(
      <WeixinConfigForm pluginStatus={null} modelSelection={noopModelSelection} onStatusChange={onStatusChange} />
    );

    await act(async () => {
      fireEvent.click(screen.getByText('Scan to Login'));
    });

    const es = MockEventSource.instances[0];
    expect(es?.url).toBe('/api/channel/weixin/login');
    expect(es?.options).toEqual({ withCredentials: true });

    await act(async () => {
      es?.emit('qr', { qrcodeData: 'ticket_webui_1' });
    });
    expect(screen.getByTestId('webui-qr').textContent).toContain('ticket_webui_1');

    await act(async () => {
      es?.emit('scanned');
    });
    expect(screen.getByText('Scanned, waiting for confirmation...')).toBeTruthy();

    await act(async () => {
      es?.emit('done', { accountId: 'acc-1', botToken: 'bot-1' });
    });

    await waitFor(() => {
      expect(mockEnablePlugin).toHaveBeenCalledWith({
        pluginId: 'weixin_default',
        config: { accountId: 'acc-1', botToken: 'bot-1' },
      });
    });
    expect(es?.close).toHaveBeenCalled();
    expect(onStatusChange).toHaveBeenCalledWith(expect.objectContaining({ type: 'weixin', enabled: true }));
  });

  it('resets to idle when enableWeixinPlugin fails in WebUI mode', async () => {
    window.electronAPI = {} as typeof window.electronAPI;
    mockEnablePlugin.mockResolvedValueOnce({ success: false, msg: 'Enable failed' });

    render(<WeixinConfigForm pluginStatus={null} modelSelection={noopModelSelection} onStatusChange={vi.fn()} />);

    await act(async () => {
      fireEvent.click(screen.getByText('Scan to Login'));
    });

    const es = MockEventSource.instances[0];

    await act(async () => {
      es?.emit('done', { accountId: 'acc-1', botToken: 'bot-1' });
    });

    await waitFor(() => {
      expect(screen.getByText('Scan to Login')).toBeTruthy();
    });
  });

  it('resets to idle when SSE error event contains expired message', async () => {
    window.electronAPI = {} as typeof window.electronAPI;

    render(<WeixinConfigForm pluginStatus={null} modelSelection={noopModelSelection} onStatusChange={vi.fn()} />);

    await act(async () => {
      fireEvent.click(screen.getByText('Scan to Login'));
    });

    const es = MockEventSource.instances[0];

    await act(async () => {
      es?.emit('qr', { qrcodeData: 'ticket_1' });
    });

    await act(async () => {
      es?.emit('error', { message: 'QR code expired' });
    });

    await waitFor(() => {
      expect(screen.getByText('Scan to Login')).toBeTruthy();
    });
    expect(es?.close).toHaveBeenCalled();
  });

  it('resets to idle when SSE error event contains non-expired message', async () => {
    window.electronAPI = {} as typeof window.electronAPI;

    render(<WeixinConfigForm pluginStatus={null} modelSelection={noopModelSelection} onStatusChange={vi.fn()} />);

    await act(async () => {
      fireEvent.click(screen.getByText('Scan to Login'));
    });

    const es = MockEventSource.instances[0];

    await act(async () => {
      es?.emit('qr', { qrcodeData: 'ticket_2' });
    });

    await act(async () => {
      es?.emit('error', { message: 'server internal error' });
    });

    await waitFor(() => {
      expect(screen.getByText('Scan to Login')).toBeTruthy();
    });
    expect(es?.close).toHaveBeenCalled();
  });

  it('stays connected when handleDisconnect fails', async () => {
    mockDisablePlugin.mockResolvedValueOnce({ success: false, msg: 'Disable failed' });

    const pluginStatus = createPluginStatus();

    render(
      <WeixinConfigForm pluginStatus={pluginStatus} modelSelection={noopModelSelection} onStatusChange={vi.fn()} />
    );

    await act(async () => {
      fireEvent.click(screen.getByText('Disconnect'));
    });

    expect(mockDisablePlugin).toHaveBeenCalledWith({ pluginId: 'weixin_default' });
    expect(screen.getByText('Connected')).toBeTruthy();
  });

  it('closes EventSource on component unmount', async () => {
    window.electronAPI = {} as typeof window.electronAPI;

    const { unmount } = render(
      <WeixinConfigForm pluginStatus={null} modelSelection={noopModelSelection} onStatusChange={vi.fn()} />
    );

    await act(async () => {
      fireEvent.click(screen.getByText('Scan to Login'));
    });

    const es = MockEventSource.instances[0];
    expect(es).toBeTruthy();

    unmount();

    expect(es?.close).toHaveBeenCalled();
  });

  it('allows disconnecting from the connected state', async () => {
    const initialPluginStatus = createPluginStatus();

    const onStatusChange = vi.fn();

    const TestHarness = () => {
      const [status, setStatus] = React.useState<IChannelPluginStatus | null>(initialPluginStatus);

      return (
        <WeixinConfigForm
          pluginStatus={status}
          modelSelection={noopModelSelection}
          onStatusChange={(nextStatus) => {
            onStatusChange(nextStatus);
            setStatus(nextStatus);
          }}
        />
      );
    };

    render(<TestHarness />);

    await act(async () => {
      fireEvent.click(screen.getByText('Disconnect'));
    });

    expect(mockDisablePlugin).toHaveBeenCalledWith({ pluginId: 'weixin_default' });
    expect(onStatusChange).toHaveBeenCalledWith(null);
    await waitFor(() => {
      expect(screen.getByText('Scan to Login')).toBeTruthy();
    });
  });
});
