/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockTestInvoke = vi.fn();
const mockMessageSuccess = vi.fn();
const mockMessageWarning = vi.fn();
const mockMessageError = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) => {
      if (params?.error) {
        return `${key}:${params.error}`;
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

import FactoryDroidByokModal from '@/renderer/components/settings/FactoryDroidByokModal';

describe('FactoryDroidByokModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requires a successful connection test before saving a new config', async () => {
    const onSubmit = vi.fn();

    render(<FactoryDroidByokModal onSubmit={onSubmit} modalProps={{ visible: true }} modalCtrl={{ close: vi.fn() }} />);

    fireEvent.change(screen.getByPlaceholderText('settings.droidByok.baseUrlPlaceholder'), {
      target: { value: ' https://api.example.com ' },
    });
    fireEvent.change(document.querySelector('input[type="password"]')!, {
      target: { value: ' sk-test ' },
    });
    fireEvent.change(screen.getByPlaceholderText('settings.droidByok.modelIdPlaceholder'), {
      target: { value: ' claude-sonnet-4-6 ' },
    });

    await act(async () => {
      fireEvent.click(screen.getByText('confirm'));
    });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(mockMessageWarning).toHaveBeenCalledWith('settings.droidByok.testBeforeSave');
  });

  it('submits normalized values after a successful test', async () => {
    const onSubmit = vi.fn();
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

    render(<FactoryDroidByokModal onSubmit={onSubmit} modalProps={{ visible: true }} modalCtrl={{ close: vi.fn() }} />);

    fireEvent.change(screen.getByPlaceholderText('settings.droidByok.baseUrlPlaceholder'), {
      target: { value: ' https://api.example.com ' },
    });
    fireEvent.change(document.querySelector('input[type="password"]')!, {
      target: { value: ' sk-test ' },
    });
    fireEvent.change(screen.getByPlaceholderText('settings.droidByok.modelIdPlaceholder'), {
      target: { value: ' claude-sonnet-4-6 ' },
    });

    await act(async () => {
      fireEvent.click(screen.getByText('settings.droidByok.testConnection'));
    });

    expect(mockTestInvoke).toHaveBeenCalledWith({
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      displayName: '',
    });

    await act(async () => {
      fireEvent.click(screen.getByText('confirm'));
    });

    expect(onSubmit).toHaveBeenCalledWith({
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      displayName: 'Claude Sonnet 4.6 [BYOK]',
    });
  });

  it('allows editing only the display name without re-testing an existing config', async () => {
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

    fireEvent.change(screen.getByPlaceholderText('settings.droidByok.displayNamePlaceholder'), {
      target: { value: 'Custom Claude' },
    });

    await act(async () => {
      fireEvent.click(screen.getByText('confirm'));
    });

    expect(mockTestInvoke).not.toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalledWith({
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      displayName: 'Custom Claude',
      existingId: 'cfg-1',
    });
  });
});
