/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// Hoisted mocks — must come before any imports
// ---------------------------------------------------------------------------

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

const mockNavigate = vi.hoisted(() => vi.fn());
const mockGetDroidStatus = vi.hoisted(() => vi.fn());
const mockCheckDroidCliUpdate = vi.hoisted(() => vi.fn());
const mockDetectDroidNodeRuntime = vi.hoisted(() => vi.fn());
const mockInstallDroidCli = vi.hoisted(() => vi.fn());
const mockDroidCliInstallProgressOn = vi.hoisted(() => vi.fn(() => vi.fn()));
const mockMessageSuccess = vi.hoisted(() => vi.fn());
const mockMessageWarning = vi.hoisted(() => vi.fn());
const mockMessageInfo = vi.hoisted(() => vi.fn());
const mockMessageError = vi.hoisted(() => vi.fn());
const mockSwrMutate = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockUseSWR = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-US' } }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('../../src/common', () => ({
  ipcBridge: {
    acpConversation: {
      getDroidStatus: { invoke: mockGetDroidStatus },
      checkDroidCliUpdate: { invoke: mockCheckDroidCliUpdate },
      detectDroidNodeRuntime: { invoke: mockDetectDroidNodeRuntime },
      installDroidCli: { invoke: mockInstallDroidCli },
      droidCliInstallProgress: { on: mockDroidCliInstallProgressOn },
    },
  },
}));

vi.mock('swr', () => ({
  default: (...args: unknown[]) => mockUseSWR(...args),
  mutate: mockSwrMutate,
}));

vi.mock('@arco-design/web-react', () => ({
  Typography: {
    Text: ({ children, ...props }: { children: React.ReactNode; [k: string]: unknown }) => (
      <span {...props}>{children}</span>
    ),
  },
  Alert: ({ content }: { content: React.ReactNode }) => <div>{content}</div>,
  Badge: ({ text }: { text: React.ReactNode }) => <span>{text}</span>,
  Button: ({
    children,
    onClick,
    loading: _loading,
    ...props
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    loading?: boolean;
    [k: string]: unknown;
  }) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
  Message: {
    success: mockMessageSuccess,
    warning: mockMessageWarning,
    info: mockMessageInfo,
    error: mockMessageError,
  },
  Modal: ({ visible, children, footer }: { visible?: boolean; children?: React.ReactNode; footer?: React.ReactNode }) =>
    visible ? (
      <div>
        {children}
        {footer}
      </div>
    ) : null,
  Spin: () => <div data-testid='spin'>loading</div>,
}));

vi.mock('@icon-park/react', () => ({
  Download: () => <span data-testid='icon-download'>DownloadIcon</span>,
  Setting: () => <span data-testid='icon-setting'>SettingIcon</span>,
  Refresh: () => <span data-testid='icon-refresh'>RefreshIcon</span>,
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import LocalAgents, { resetLocalAgentsCache } from '../../src/renderer/pages/settings/AgentSettings/LocalAgents';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LocalAgents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    resetLocalAgentsCache();
    mockGetDroidStatus.mockResolvedValue({ success: true, data: {} });
    mockCheckDroidCliUpdate.mockResolvedValue({
      success: true,
      data: {
        currentVersion: '0.99.0',
        latestVersion: '0.99.0',
        updateAvailable: false,
        source: 'bundled',
        registry: 'https://registry.npmmirror.com',
      },
    });
    mockDetectDroidNodeRuntime.mockResolvedValue({
      success: true,
      data: { available: true, meetsMinimum: true, command: 'node', nodeVersion: process.version },
    });
    mockInstallDroidCli.mockResolvedValue({ success: true, data: { success: true, message: 'installed' } });
    mockDroidCliInstallProgressOn.mockReturnValue(vi.fn());
    mockSwrMutate.mockResolvedValue(undefined);
    mockUseSWR.mockReturnValue({
      data: {
        available: true,
        loginStatus: 'authenticated',
        cliSource: 'bundled',
        cliPath: '/usr/local/bin/droid',
        cliVersion: 'droid 0.1.4',
        sdkVersion: '0.1.4',
        protocolVersion: '1.2.0',
        modelCount: 21,
      },
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: mockSwrMutate,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders Factory Droid summary and status fields', async () => {
    await act(async () => {
      render(<LocalAgents />);
    });

    expect(screen.queryByText('settings.agentManagement.factoryDroidOnlyDescription')).toBeNull();
    expect(screen.getByText('settings.droidByok.factoryDroid')).toBeTruthy();
    expect(screen.getByText('settings.agentManagement.runtimeStatus')).toBeTruthy();
    expect(screen.getByText('settings.agentManagement.loginStatus')).toBeTruthy();
    expect(screen.getByText('droid 0.1.4')).toBeTruthy();
    expect(screen.getAllByText('0.1.4').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1.2.0').length).toBeGreaterThan(0);
    expect(screen.getByText('21')).toBeTruthy();
    expect(screen.getByText('settings.agentManagement.actionCenter')).toBeTruthy();
    expect(screen.getAllByText('settings.agentManagement.cliSourceBundled').length).toBeGreaterThan(0);
    expect(screen.getAllByText('/usr/local/bin/droid').length).toBeGreaterThan(0);
    expect(screen.getAllByText('settings.agentManagement.bundledRuntimeHint').length).toBeGreaterThan(0);
    expect(mockCheckDroidCliUpdate).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('settings.agentManagement.cliUpdateUpToDate')).toBeNull();
  });

  it('refreshes status when refresh button is clicked', async () => {
    await act(async () => {
      render(<LocalAgents />);
    });

    await act(async () => {
      screen.getByText('settings.agentManagement.refreshStatus').click();
    });

    expect(mockSwrMutate).toHaveBeenCalledTimes(1);
  });

  it('opens model settings when the settings button is clicked', async () => {
    await act(async () => {
      render(<LocalAgents />);
    });

    await act(async () => {
      screen.getByText('settings.agentManagement.openModelSettings').click();
    });

    expect(mockNavigate).toHaveBeenCalledWith('/settings/model');
  });

  it('does not auto-check while status is still loading', async () => {
    mockUseSWR.mockReturnValue({
      data: undefined,
      error: undefined,
      isLoading: true,
      isValidating: false,
      mutate: mockSwrMutate,
    });

    await act(async () => {
      render(<LocalAgents />);
    });

    expect(mockCheckDroidCliUpdate).not.toHaveBeenCalled();
  });

  it('shows the status error message when loading fails', async () => {
    mockUseSWR.mockReturnValue({
      data: undefined,
      error: new Error('status failed'),
      isLoading: false,
      isValidating: false,
      mutate: mockSwrMutate,
    });

    await act(async () => {
      render(<LocalAgents />);
    });

    expect(screen.getAllByText('status failed').length).toBeGreaterThan(0);
  });

  it('does not report cli unavailable inside login status when runtime is unavailable', async () => {
    mockUseSWR.mockReturnValue({
      data: {
        available: false,
        loginStatus: 'unavailable',
        cliSource: 'system',
        cliPath: null,
        cliVersion: null,
        sdkVersion: '0.1.4',
        protocolVersion: '1.2.0',
        modelCount: 0,
        error: 'missing cli',
      },
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: mockSwrMutate,
    });

    await act(async () => {
      render(<LocalAgents />);
    });

    expect(screen.getAllByText('settings.agentManagement.loginStatusWaitingRuntime').length).toBeGreaterThan(0);
  });
});
