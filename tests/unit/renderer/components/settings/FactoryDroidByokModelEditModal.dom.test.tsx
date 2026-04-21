/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSaveInvoke = vi.fn();
const mockMessageSuccess = vi.fn();
const mockMessageError = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    acpConversation: {
      saveDroidByokConfig: {
        invoke: (...args: unknown[]) => mockSaveInvoke(...args),
      },
    },
  },
}));

// Lightweight Arco stubs — DOM-only, no styles.
vi.mock('@arco-design/web-react', () => ({
  Switch: ({ checked, onChange }: { checked?: boolean; onChange?: (value: boolean) => void }) => (
    <input
      type='checkbox'
      role='switch'
      aria-checked={checked}
      checked={Boolean(checked)}
      onChange={(event) => onChange?.(event.target.checked)}
    />
  ),
  Checkbox: Object.assign(
    ({
      children,
      value,
      checked,
      onChange,
    }: {
      children?: React.ReactNode;
      value?: string;
      checked?: boolean;
      onChange?: (value: boolean) => void;
    }) => (
      <label>
        <input
          type='checkbox'
          data-value={value}
          checked={Boolean(checked)}
          onChange={(event) => onChange?.(event.target.checked)}
        />
        {children}
      </label>
    ),
    {
      Group: ({
        value,
        onChange,
        children,
      }: {
        value?: string[];
        onChange?: (value: string[]) => void;
        children?: React.ReactNode;
      }) => {
        // Clone each `Checkbox` child and wire it to the group value.
        const current = Array.isArray(value) ? value : [];
        const augmented = React.Children.map(children, (child) => {
          if (!React.isValidElement(child)) return child;
          const element = child as React.ReactElement<{ value?: string; checked?: boolean }>;
          const groupTree = (tree: React.ReactNode): React.ReactNode =>
            React.Children.map(tree, (node) => {
              if (!React.isValidElement(node)) return node;
              const nodeElement = node as React.ReactElement<{ value?: string; checked?: boolean; children?: React.ReactNode }>;
              const updated: Record<string, unknown> = {};
              if (typeof nodeElement.props.value === 'string') {
                updated.checked = current.includes(nodeElement.props.value);
                updated.onChange = (next: boolean) => {
                  const set = new Set(current);
                  if (next) {
                    set.add(nodeElement.props.value!);
                  } else {
                    set.delete(nodeElement.props.value!);
                  }
                  onChange?.(Array.from(set));
                };
              }
              if (nodeElement.props.children) {
                updated.children = groupTree(nodeElement.props.children);
              }
              return React.cloneElement(nodeElement, updated);
            });
          return groupTree(element);
        });
        return <div role='group'>{augmented}</div>;
      },
    }
  ),
  Radio: Object.assign(
    ({
      children,
      value,
      checked,
      onChange,
    }: {
      children?: React.ReactNode;
      value?: string;
      checked?: boolean;
      onChange?: (value: string) => void;
    }) => (
      <label>
        <input
          type='radio'
          data-value={value}
          checked={Boolean(checked)}
          onChange={() => onChange?.(value || '')}
        />
        {children}
      </label>
    ),
    {
      Group: ({
        value,
        onChange,
        children,
      }: {
        value?: string;
        onChange?: (value: string) => void;
        children?: React.ReactNode;
      }) => {
        const augmented = React.Children.map(children, (child) => {
          if (!React.isValidElement(child)) return child;
          const groupTree = (tree: React.ReactNode): React.ReactNode =>
            React.Children.map(tree, (node) => {
              if (!React.isValidElement(node)) return node;
              const nodeElement = node as React.ReactElement<{ value?: string; checked?: boolean; children?: React.ReactNode }>;
              const updated: Record<string, unknown> = {};
              if (typeof nodeElement.props.value === 'string') {
                updated.checked = nodeElement.props.value === value;
                updated.onChange = () => onChange?.(nodeElement.props.value || '');
              }
              if (nodeElement.props.children) {
                updated.children = groupTree(nodeElement.props.children);
              }
              return React.cloneElement(nodeElement, updated);
            });
          return groupTree(child);
        });
        return <div role='radiogroup'>{augmented}</div>;
      },
    }
  ),
  Message: {
    useMessage: () => [
      {
        success: mockMessageSuccess,
        error: mockMessageError,
      },
      <div key='message-holder' />,
    ],
  },
}));

vi.mock('@/renderer/components/base/AionModal', () => ({
  default: ({
    children,
    onOk,
    onCancel,
  }: {
    children?: React.ReactNode;
    onOk?: () => void;
    onCancel?: () => void;
  }) => (
    <div>
      {children}
      <button type='button' onClick={onOk}>
        confirm
      </button>
      <button type='button' onClick={onCancel}>
        cancel
      </button>
    </div>
  ),
}));

import FactoryDroidByokModelEditModal from '@/renderer/components/settings/SettingsModal/contents/factoryDroidByok/FactoryDroidByokModelEditModal';
import type { IDroidByokModelConfig } from '@/common/adapter/ipcBridge';

const baseConfig: IDroidByokModelConfig = {
  id: 'cfg-1',
  baseUrl: 'https://api.example.com',
  apiKey: 'sk-test',
  model: 'claude-sonnet-4-6',
  displayName: 'Claude Sonnet 4.6 [BYOK]',
  provider: 'anthropic',
  maxOutputTokens: 8192,
  supportsImageInput: true,
  reasoningLevels: ['off', 'low', 'medium', 'high'],
  defaultReasoning: 'off',
};

describe('FactoryDroidByokModelEditModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('seeds the switch/checkboxes/radio from the incoming config', () => {
    render(
      <FactoryDroidByokModelEditModal
        modalProps={{ visible: true }}
        modalCtrl={{ close: vi.fn() }}
        config={baseConfig}
      />
    );

    expect(screen.getByRole('switch')).toBeChecked();
    const offCheckbox = document.querySelector('input[type="checkbox"][data-value="off"]');
    const lowCheckbox = document.querySelector('input[type="checkbox"][data-value="low"]');
    const minimalCheckbox = document.querySelector('input[type="checkbox"][data-value="minimal"]');
    expect(offCheckbox).toBeChecked();
    expect(lowCheckbox).toBeChecked();
    expect(minimalCheckbox).not.toBeChecked();

    const offRadio = document.querySelector('input[type="radio"][data-value="off"]');
    expect(offRadio).toBeChecked();
  });

  it('submits capability overrides through saveDroidByokConfig', async () => {
    const onSuccess = vi.fn();
    mockSaveInvoke.mockResolvedValue({
      success: true,
      data: {
        config: {
          ...baseConfig,
          supportsImageInput: false,
          reasoningLevels: ['off', 'low'],
          defaultReasoning: 'low',
        },
      },
    });

    render(
      <FactoryDroidByokModelEditModal
        modalProps={{ visible: true }}
        modalCtrl={{ close: vi.fn() }}
        config={baseConfig}
        onSuccess={onSuccess}
      />
    );

    // Flip multimodal off.
    fireEvent.click(screen.getByRole('switch'));
    // Uncheck `medium` and `high` to narrow the reasoning set.
    const mediumCheckbox = document.querySelector<HTMLInputElement>('input[type="checkbox"][data-value="medium"]')!;
    const highCheckbox = document.querySelector<HTMLInputElement>('input[type="checkbox"][data-value="high"]')!;
    fireEvent.click(mediumCheckbox);
    fireEvent.click(highCheckbox);

    // Select `low` as the new default.
    const lowRadio = document.querySelector<HTMLInputElement>('input[type="radio"][data-value="low"]')!;
    fireEvent.click(lowRadio);

    await act(async () => {
      fireEvent.click(screen.getByText('confirm'));
    });

    expect(mockSaveInvoke).toHaveBeenCalledWith(
      expect.objectContaining({
        existingId: 'cfg-1',
        baseUrl: 'https://api.example.com',
        apiKey: 'sk-test',
        model: 'claude-sonnet-4-6',
        provider: 'anthropic',
        supportsImageInput: false,
        reasoningLevels: ['off', 'low'],
        defaultReasoning: 'low',
      })
    );
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(mockMessageSuccess).toHaveBeenCalledWith('settings.droidByok.capability.saveSuccess');
  });

  it('clamps default when user unticks the currently-selected level', async () => {
    mockSaveInvoke.mockResolvedValue({
      success: true,
      data: {
        config: {
          ...baseConfig,
          reasoningLevels: ['low', 'medium', 'high'],
          defaultReasoning: 'low',
        },
      },
    });

    render(
      <FactoryDroidByokModelEditModal
        modalProps={{ visible: true }}
        modalCtrl={{ close: vi.fn() }}
        config={baseConfig}
      />
    );

    // Uncheck `off` (was default).
    const offCheckbox = document.querySelector<HTMLInputElement>('input[type="checkbox"][data-value="off"]')!;
    fireEvent.click(offCheckbox);

    await act(async () => {
      fireEvent.click(screen.getByText('confirm'));
    });

    expect(mockSaveInvoke).toHaveBeenCalledWith(
      expect.objectContaining({
        existingId: 'cfg-1',
        // `off` removed → default should clamp to the first remaining level (`low`).
        defaultReasoning: 'low',
        reasoningLevels: ['low', 'medium', 'high'],
      })
    );
  });

  it('surfaces an error when saveDroidByokConfig rejects', async () => {
    mockSaveInvoke.mockResolvedValue({
      success: false,
      msg: 'Backend error',
    });

    render(
      <FactoryDroidByokModelEditModal
        modalProps={{ visible: true }}
        modalCtrl={{ close: vi.fn() }}
        config={baseConfig}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByText('confirm'));
    });

    expect(mockMessageError).toHaveBeenCalledWith('Backend error');
    expect(mockMessageSuccess).not.toHaveBeenCalled();
  });

  it('is a no-op when opened with a null config', async () => {
    const closeSpy = vi.fn();
    render(<FactoryDroidByokModelEditModal modalProps={{ visible: true }} modalCtrl={{ close: closeSpy }} config={null} />);

    await act(async () => {
      fireEvent.click(screen.getByText('confirm'));
    });

    expect(mockSaveInvoke).not.toHaveBeenCalled();
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});
