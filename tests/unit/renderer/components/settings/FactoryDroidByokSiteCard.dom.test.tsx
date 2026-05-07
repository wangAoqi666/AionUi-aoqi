/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * DOM-level coverage for the BYOK site card. We keep the test harness fully
 * offline: the heavy Arco/IconPark components are replaced with minimal
 * stand-ins so we can assert on the card's behaviour instead of chrome.
 *
 * 站点卡片最小 DOM 测试：Arco/IconPark 组件被替换为轻量 mock，
 * 以便聚焦卡片自身的交互逻辑（标签编辑 / 删除确认 / 轮换 / 新增）。
 */

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      if (params && 'count' in params) {
        return `${key}:${params.count}`;
      }
      return key;
    },
  }),
}));

vi.mock('@/common/config/factoryModels', () => {
  // Return the same empty array reference so useSyncExternalStore doesn't
  // detect a new snapshot on every render (otherwise React bails out with
  // "Maximum update depth exceeded").
  const EMPTY_MODELS: Array<unknown> = [];
  return {
    subscribeFactoryModelCatalog: (_listener: () => void) => () => {},
    getFactoryModels: () => EMPTY_MODELS,
    getFactoryReasoningLabel: (level: string) => `reason:${level}`,
    isFactoryCustomModel: () => false,
  };
});

vi.mock('@arco-design/web-react', () => {
  const Button = ({
    children,
    icon,
    onClick,
    disabled,
    loading,
    ...rest
  }: {
    children?: React.ReactNode;
    icon?: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    loading?: boolean;
  } & Record<string, unknown>) => (
    <button
      type='button'
      onClick={onClick}
      disabled={disabled}
      data-loading={loading ? '1' : undefined}
      data-testid={(rest as { 'data-testid'?: string })['data-testid']}
    >
      {icon}
      {children}
    </button>
  );
  const Collapse: React.FC<{ children?: React.ReactNode }> & {
    Item: React.FC<{
      children?: React.ReactNode;
      header?: React.ReactNode;
      name?: string;
    }>;
  } = ({ children }) => <div>{children}</div>;
  Collapse.Item = ({ children, header }) => (
    <div>
      <div>{header}</div>
      <div>{children}</div>
    </div>
  );
  const Divider = () => <hr />;
  const Input = Object.assign(
    ({
      value,
      onChange,
      placeholder,
      onPressEnter,
      onBlur,
    }: {
      value?: string;
      onChange?: (value: string) => void;
      placeholder?: string;
      onPressEnter?: () => void;
      onBlur?: () => void;
    }) => (
      <input
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange?.(event.target.value)}
        onBlur={onBlur}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            onPressEnter?.();
          }
        }}
      />
    ),
    {
      Password: ({ value, onChange }: { value?: string; onChange?: (value: string) => void }) => (
        <input type='password' value={value} onChange={(event) => onChange?.(event.target.value)} />
      ),
    }
  );
  const Popconfirm = ({
    title,
    onOk,
    children,
  }: {
    title?: React.ReactNode;
    onOk?: () => void;
    children?: React.ReactNode;
  }) => (
    <div>
      {children}
      <button type='button' onClick={onOk}>
        confirm:{title}
      </button>
    </div>
  );
  const Tag = ({ children }: { children?: React.ReactNode }) => <span>{children}</span>;
  const Tooltip = ({ children }: { children?: React.ReactNode }) => <span>{children}</span>;
  return { Button, Collapse, Divider, Input, Popconfirm, Tag, Tooltip };
});

// Provide default exports for the IconPark components we touch so the card
// renders without pulling in real SVG assets. Each entry is inline because
// `vi.mock` factories are hoisted above module-level bindings.
vi.mock('@icon-park/react', () => ({
  Check: () => null,
  Close: () => null,
  Delete: () => null,
  Edit: () => null,
  Key: () => null,
  LinkCloud: () => null,
  Plus: () => null,
  Refresh: () => null,
  Write: () => null,
}));

import FactoryDroidByokSiteCard from '@/renderer/components/settings/SettingsModal/contents/factoryDroidByok/FactoryDroidByokSiteCard';
import type { IDroidByokSite } from '@/common/adapter/ipcBridge';

const baseSite: IDroidByokSite = {
  id: 'site-1',
  baseUrl: 'https://api.example.com',
  providers: ['anthropic'],
  label: 'OpenRouter prod',
  hasApiKey: true,
  modelIds: ['cfg-1', 'cfg-2'],
  modelCount: 2,
};

describe('FactoryDroidByokSiteCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the label when present and falls back to hostname when empty', () => {
    const { rerender } = render(
      <FactoryDroidByokSiteCard
        site={baseSite}
        byokConfigs={[]}
        onAddModel={vi.fn()}
        onRotateKey={vi.fn()}
        onRemoveSite={vi.fn()}
        onSaveLabel={vi.fn()}
        onRemoveModel={vi.fn()}
        onEditModel={vi.fn()}
      />
    );
    expect(screen.getByText('OpenRouter prod')).toBeInTheDocument();

    rerender(
      <FactoryDroidByokSiteCard
        site={{ ...baseSite, label: undefined }}
        byokConfigs={[]}
        onAddModel={vi.fn()}
        onRotateKey={vi.fn()}
        onRemoveSite={vi.fn()}
        onSaveLabel={vi.fn()}
        onRemoveModel={vi.fn()}
        onEditModel={vi.fn()}
      />
    );
    expect(screen.getByText('api.example.com')).toBeInTheDocument();
  });

  it('invokes callbacks for add model / rotate key / remove site', () => {
    const onAddModel = vi.fn();
    const onRotateKey = vi.fn();
    const onRemoveSite = vi.fn();
    render(
      <FactoryDroidByokSiteCard
        site={baseSite}
        byokConfigs={[]}
        onAddModel={onAddModel}
        onRotateKey={onRotateKey}
        onRemoveSite={onRemoveSite}
        onSaveLabel={vi.fn()}
        onRemoveModel={vi.fn()}
        onEditModel={vi.fn()}
      />
    );

    // Button order in card header:
    //   edit-label, add-model, rotate-key, remove-site (inside Popconfirm).
    const buttons = screen.getAllByRole('button');
    // Find the buttons by the tooltip wrapper text (icons are stubbed).
    const addBtn = buttons[1];
    const rotateBtn = buttons[2];
    const removeBtn = buttons[3];

    fireEvent.click(addBtn);
    fireEvent.click(rotateBtn);
    // Popconfirm renders a dedicated confirm button whose text contains the
    // prompt — click that to simulate a confirmed removal.
    fireEvent.click(screen.getByText(/^confirm:settings.droidByok.site.removeConfirm$/));

    expect(onAddModel).toHaveBeenCalledWith(baseSite);
    expect(onRotateKey).toHaveBeenCalledWith(baseSite);
    expect(onRemoveSite).toHaveBeenCalledWith(baseSite);
    void removeBtn;
  });

  it('submits the new label when the user confirms the inline editor', async () => {
    const onSaveLabel = vi.fn().mockResolvedValue(undefined);
    render(
      <FactoryDroidByokSiteCard
        site={baseSite}
        byokConfigs={[]}
        onAddModel={vi.fn()}
        onRotateKey={vi.fn()}
        onRemoveSite={vi.fn()}
        onSaveLabel={onSaveLabel}
        onRemoveModel={vi.fn()}
        onEditModel={vi.fn()}
      />
    );

    // First button is the "edit label" pencil.
    fireEvent.click(screen.getAllByRole('button')[0]);

    const input = screen.getByPlaceholderText('settings.droidByok.site.labelPlaceholder') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Renamed site' } });

    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    expect(onSaveLabel).toHaveBeenCalledWith(baseSite, 'Renamed site');
  });
});
