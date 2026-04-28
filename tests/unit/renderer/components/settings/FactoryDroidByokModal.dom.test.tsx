/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockTestInvoke = vi.fn();
const mockSaveInvoke = vi.fn();
const mockFetchInvoke = vi.fn();
const mockImportInvoke = vi.fn();
const mockMessageSuccess = vi.fn();
const mockMessageWarning = vi.fn();
const mockMessageError = vi.fn();
const capabilityDriftHandlerRef = vi.hoisted(() => ({
  current: null as ((payload: any) => void) | null,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) => {
      if (params?.error) {
        return `${key}:${params.error}`;
      }
      if (params?.count) {
        return `${key}:${params.count}`;
      }
      return key;
    },
  }),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    acpConversation: {
      testDroidByokConfig: {
        invoke: (...args: unknown[]) => mockTestInvoke(...args),
      },
      saveDroidByokConfig: {
        invoke: (...args: unknown[]) => mockSaveInvoke(...args),
      },
      fetchDroidByokModels: {
        invoke: (...args: unknown[]) => mockFetchInvoke(...args),
      },
      importDroidByokConfigs: {
        invoke: (...args: unknown[]) => mockImportInvoke(...args),
      },
      droidByokImportProgress: {
        on: vi.fn(() => vi.fn()),
      },
      droidByokCapabilityDrift: {
        on: vi.fn((handler: (payload: any) => void) => {
          capabilityDriftHandlerRef.current = handler;
          return vi.fn();
        }),
      },
    },
  },
}));

vi.mock('@arco-design/web-react', () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type='button' onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  Checkbox: ({
    children,
    checked,
    onChange,
  }: {
    children?: React.ReactNode;
    checked?: boolean;
    onChange?: (value: boolean) => void;
  }) => (
    <label>
      <input type='checkbox' checked={checked} onChange={(event) => onChange?.(event.target.checked)} />
      {children}
    </label>
  ),
  Input: Object.assign(
    ({
      value,
      onChange,
      placeholder,
    }: {
      value?: string;
      onChange?: (value: string) => void;
      placeholder?: string;
    }) => <input value={value} placeholder={placeholder} onChange={(event) => onChange?.(event.target.value)} />,
    {
      Password: ({ value, onChange }: { value?: string; onChange?: (value: string) => void }) => (
        <input type='password' value={value} onChange={(event) => onChange?.(event.target.value)} />
      ),
    }
  ),
  Message: {
    useMessage: () => [
      {
        success: mockMessageSuccess,
        warning: mockMessageWarning,
        error: mockMessageError,
      },
      <div key='message-holder' />,
    ],
  },
  Progress: ({ percent }: { percent?: number }) => <div>{percent}</div>,
  Spin: () => <div>loading</div>,
  Tag: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('@/renderer/components/base/AionModal', () => ({
  default: ({ children, onOk }: { children?: React.ReactNode; onOk?: () => void }) => (
    <div>
      {children}
      <button type='button' onClick={onOk}>
        confirm
      </button>
    </div>
  ),
}));

vi.mock('@/renderer/components/base/AionSelect', () => {
  const Option = ({ children, value }: { children?: React.ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  );
  const Select = ({
    children,
    value,
    onChange,
    disabled,
  }: {
    children?: React.ReactNode;
    value?: string;
    onChange?: (value: string) => void;
    disabled?: boolean;
  }) => (
    <select value={value} disabled={disabled} onChange={(event) => onChange?.(event.target.value)}>
      {children}
    </select>
  );

  return {
    __esModule: true,
    default: Object.assign(Select, { Option }),
  };
});

import FactoryDroidByokModal from '@/renderer/components/settings/FactoryDroidByokModal';

describe('FactoryDroidByokModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capabilityDriftHandlerRef.current = null;
  });

  it('renders the generic provider option for Gemini endpoints in edit mode', () => {
    render(
      <FactoryDroidByokModal
        data={{
          id: 'cfg-gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
          apiKey: 'gem-key',
          model: 'gemini-2.5-pro',
          displayName: 'Gemini 2.5 Pro [BYOK]',
          provider: 'generic-chat-completion-api',
          maxOutputTokens: 8192,
        }}
        modalProps={{ visible: true }}
        modalCtrl={{ close: vi.fn() }}
      />
    );

    expect(screen.getByText('settings.droidByok.providerGeneric')).toBeInTheDocument();
  });

  it('fetches remote models and imports selected models in add mode', async () => {
    const onSubmit = vi.fn();
    const onClose = vi.fn();
    mockFetchInvoke.mockResolvedValue({
      success: true,
      data: {
        catalog: {
          baseUrl: 'https://gateway.example.com',
          cachedAt: 1,
          models: [
            {
              model: 'gpt-5.4',
              displayName: 'GPT-5.4 [BYOK]',
              supportedEndpointTypes: ['openai', 'openai-response'],
              inferredProvider: 'openai',
            },
            {
              model: 'claude-sonnet-4-6',
              displayName: 'Claude Sonnet 4.6 [BYOK]',
              supportedEndpointTypes: ['anthropic'],
              inferredProvider: 'anthropic',
            },
          ],
        },
      },
    });
    mockImportInvoke.mockResolvedValue({
      success: true,
      data: {
        imported: [
          {
            id: 'cfg-1',
            baseUrl: 'https://gateway.example.com',
            apiKey: 'sk-test',
            model: 'gpt-5.4',
            displayName: 'GPT Custom',
            provider: 'generic-chat-completion-api',
            maxOutputTokens: 8192,
          },
        ],
        failed: [],
      },
    });

    const { container } = render(
      <FactoryDroidByokModal onSubmit={onSubmit} modalProps={{ visible: true }} modalCtrl={{ close: onClose }} />
    );

    fireEvent.change(screen.getByPlaceholderText('settings.droidByok.baseUrlPlaceholder'), {
      target: { value: ' https://gateway.example.com/v1/models ' },
    });
    fireEvent.change(container.querySelector('input[type="password"]')!, {
      target: { value: ' sk-test ' },
    });

    await act(async () => {
      fireEvent.click(screen.getByText('settings.droidByok.fetchModels'));
    });

    expect(mockFetchInvoke).toHaveBeenCalledWith({
      baseUrl: 'https://gateway.example.com/v1/models',
      apiKey: 'sk-test',
      refresh: false,
    });

    fireEvent.click(screen.getAllByRole('checkbox')[0]);

    fireEvent.change(screen.getByDisplayValue('GPT-5.4 [BYOK]'), {
      target: { value: 'GPT Custom' },
    });

    fireEvent.change(screen.getAllByRole('combobox')[0], {
      target: { value: 'generic-chat-completion-api' },
    });

    await act(async () => {
      fireEvent.click(screen.getByText('confirm'));
    });

    expect(mockImportInvoke).toHaveBeenCalledWith({
      baseUrl: 'https://gateway.example.com/v1/models',
      apiKey: 'sk-test',
      skipProbe: true,
      models: [
        {
          model: 'gpt-5.4',
          displayName: 'GPT Custom',
          provider: 'generic-chat-completion-api',
          supportedEndpointTypes: ['openai', 'openai-response'],
        },
      ],
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockMessageSuccess).toHaveBeenCalledWith('settings.droidByok.importSuccess:1');
  });

  it('requires a successful connection test before saving in edit mode', async () => {
    const onSubmit = vi.fn();

    render(
      <FactoryDroidByokModal
        data={{
          id: 'cfg-1',
          baseUrl: 'https://api.example.com',
          apiKey: 'sk-test',
          model: 'claude-sonnet-4-6',
          displayName: 'Claude Sonnet 4.6 [BYOK]',
          provider: 'anthropic',
          maxOutputTokens: 8192,
        }}
        onSubmit={onSubmit}
        modalProps={{ visible: true }}
        modalCtrl={{ close: vi.fn() }}
      />
    );

    fireEvent.change(screen.getByPlaceholderText('settings.droidByok.modelIdPlaceholder'), {
      target: { value: ' claude-3-7-sonnet ' },
    });

    await act(async () => {
      fireEvent.click(screen.getByText('confirm'));
    });

    expect(mockSaveInvoke).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(mockMessageWarning).toHaveBeenCalledWith('settings.droidByok.testBeforeSave');
  });

  it('saves normalized values after a successful test in edit mode', async () => {
    const onSubmit = vi.fn();
    const onClose = vi.fn();
    mockTestInvoke.mockResolvedValue({
      success: true,
      data: {
        config: {
          id: 'cfg-1',
          baseUrl: 'https://api.example.com',
          apiKey: 'sk-test',
          model: 'claude-sonnet-4-6',
          displayName: 'Claude Sonnet 4.6 [BYOK]',
          provider: 'anthropic',
          maxOutputTokens: 8192,
        },
      },
    });
    mockSaveInvoke.mockResolvedValue({
      success: true,
      data: {
        config: {
          id: 'cfg-1',
          baseUrl: 'https://api.example.com',
          apiKey: 'sk-test',
          model: 'claude-sonnet-4-6',
          displayName: 'Custom Claude',
          provider: 'anthropic',
          maxOutputTokens: 8192,
        },
      },
    });

    render(
      <FactoryDroidByokModal
        data={{
          id: 'cfg-1',
          baseUrl: 'https://api.example.com',
          apiKey: 'sk-test',
          model: 'claude-sonnet-4-6',
          displayName: 'Claude Sonnet 4.6 [BYOK]',
          provider: 'anthropic',
          maxOutputTokens: 8192,
        }}
        onSubmit={onSubmit}
        modalProps={{ visible: true }}
        modalCtrl={{ close: onClose }}
      />
    );

    fireEvent.change(screen.getByPlaceholderText('settings.droidByok.displayNamePlaceholder'), {
      target: { value: 'Custom Claude' },
    });

    await act(async () => {
      fireEvent.click(screen.getByText('settings.droidByok.testConnection'));
    });

    expect(mockTestInvoke).toHaveBeenCalledWith({
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      displayName: 'Custom Claude',
      provider: 'anthropic',
      existingId: 'cfg-1',
    });

    await act(async () => {
      fireEvent.click(screen.getByText('confirm'));
    });

    expect(mockSaveInvoke).toHaveBeenCalledWith({
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      displayName: 'Custom Claude',
      provider: 'anthropic',
      existingId: 'cfg-1',
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockMessageSuccess).toHaveBeenCalledWith('settings.droidByok.saveSuccess');
  });

  it('shows a targeted Windows CLI repair warning after save when verifier reports missing-platform-binary', async () => {
    const onSubmit = vi.fn();
    const onClose = vi.fn();
    mockTestInvoke.mockResolvedValue({
      success: true,
      data: {
        config: {
          id: 'cfg-1',
          baseUrl: 'https://api.example.com',
          apiKey: 'sk-test',
          model: 'claude-sonnet-4-6',
          displayName: 'Claude Sonnet 4.6 [BYOK]',
          provider: 'anthropic',
          maxOutputTokens: 8192,
        },
      },
    });
    mockSaveInvoke.mockImplementation(async () => {
      capabilityDriftHandlerRef.current?.({
        ok: [],
        missing: [],
        conflict: [],
        unreachable: true,
        cliDiagnosticCode: 'missing-platform-binary',
      });
      return {
        success: true,
        data: {
          config: {
            id: 'cfg-1',
            baseUrl: 'https://api.example.com',
            apiKey: 'sk-test',
            model: 'claude-sonnet-4-6',
            displayName: 'Claude Sonnet 4.6 [BYOK]',
            provider: 'anthropic',
            maxOutputTokens: 8192,
          },
        },
      };
    });

    render(
      <FactoryDroidByokModal
        data={{
          id: 'cfg-1',
          baseUrl: 'https://api.example.com',
          apiKey: 'sk-test',
          model: 'claude-sonnet-4-6',
          displayName: 'Claude Sonnet 4.6 [BYOK]',
          provider: 'anthropic',
          maxOutputTokens: 8192,
        }}
        onSubmit={onSubmit}
        modalProps={{ visible: true }}
        modalCtrl={{ close: onClose }}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByText('settings.droidByok.testConnection'));
    });

    await act(async () => {
      fireEvent.click(screen.getByText('confirm'));
    });

    expect(mockMessageWarning).toHaveBeenCalledWith('settings.droidByok.warning.missingPlatformBinary');
    expect(mockMessageSuccess).toHaveBeenCalledWith('settings.droidByok.saveSuccess');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows a post-import warning when saved models are not exposed yet', async () => {
    const onSubmit = vi.fn();
    const onClose = vi.fn();
    mockFetchInvoke.mockResolvedValue({
      success: true,
      data: {
        catalog: {
          baseUrl: 'https://gateway.example.com',
          cachedAt: 1,
          models: [
            {
              model: 'gpt-5.4',
              displayName: 'GPT-5.4 [BYOK]',
              supportedEndpointTypes: ['openai', 'openai-response'],
              inferredProvider: 'openai',
            },
          ],
        },
      },
    });
    mockImportInvoke.mockImplementation(async () => {
      capabilityDriftHandlerRef.current?.({
        ok: [],
        missing: ['custom:GPT-5.4 [BYOK]'],
        conflict: [],
        unreachable: false,
      });
      return {
        success: true,
        data: {
          imported: [
            {
              id: 'cfg-1',
              baseUrl: 'https://gateway.example.com',
              apiKey: 'sk-test',
              model: 'gpt-5.4',
              displayName: 'GPT-5.4 [BYOK]',
              provider: 'openai',
              maxOutputTokens: 8192,
            },
          ],
          failed: [],
        },
      };
    });

    const { container } = render(
      <FactoryDroidByokModal onSubmit={onSubmit} modalProps={{ visible: true }} modalCtrl={{ close: onClose }} />
    );

    fireEvent.change(screen.getByPlaceholderText('settings.droidByok.baseUrlPlaceholder'), {
      target: { value: 'https://gateway.example.com' },
    });
    fireEvent.change(container.querySelector('input[type="password"]')!, {
      target: { value: 'sk-test' },
    });

    await act(async () => {
      fireEvent.click(screen.getByText('settings.droidByok.fetchModels'));
    });

    fireEvent.click(screen.getAllByRole('checkbox')[0]);

    await act(async () => {
      fireEvent.click(screen.getByText('confirm'));
    });

    expect(mockMessageWarning).toHaveBeenCalledWith('settings.droidByok.warning.missingModels:1');
    expect(mockMessageSuccess).toHaveBeenCalledWith('settings.droidByok.importSuccess:1');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
