import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const factoryModelsSnapshot: never[] = [];

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      if (key === 'common.defaultModel') return '默认模型';
      if (key === 'conversation.welcome.useCliModel') return '选择模型';
      if (key === 'conversation.welcome.modelSwitchNotSupported') return '当前不支持切换模型';
      return key;
    },
  }),
}));

vi.mock('@arco-design/web-react', () => ({
  Button: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  Dropdown: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Menu: Object.assign(({ children }: { children: React.ReactNode }) => <div>{children}</div>, {
    Item: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  }),
  Tooltip: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    acpConversation: {
      getModelInfo: {
        invoke: vi.fn(() => new Promise(() => undefined)),
      },
      responseStream: {
        on: vi.fn(() => () => undefined),
      },
      setModel: {
        invoke: vi.fn(),
      },
    },
    mode: {
      getModelConfig: {
        invoke: vi.fn(async () => []),
      },
    },
  },
}));

vi.mock('@/common/config/storage', () => ({
  ConfigStorage: {
    get: vi.fn(async () => ({})),
  },
}));

vi.mock('@/common/config/factoryModels', () => ({
  getFactoryDroidModelInfo: vi.fn((currentModelId?: string) => ({
    source: 'models',
    currentModelId: currentModelId || 'claude-sonnet-4-6',
    currentModelLabel: currentModelId === 'claude-opus-4-6' ? 'Claude Opus 4.6' : 'Claude Sonnet 4.6',
    canSwitch: true,
    availableModels: [
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
      { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
    ],
  })),
  getFactoryModels: vi.fn(() => factoryModelsSnapshot),
  subscribeFactoryModelCatalog: vi.fn(() => () => undefined),
}));

vi.mock('@/renderer/components/agent/MarqueePillLabel', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

import AcpModelSelector from '@/renderer/components/agent/AcpModelSelector';

describe('AcpModelSelector', () => {
  it('shows the droid model label immediately for a fresh conversation tab', () => {
    render(<AcpModelSelector conversationId='conv-1' backend='droid' initialModelId='claude-opus-4-6' />);

    expect(screen.getByText('Claude Opus 4.6')).toBeInTheDocument();
    expect(screen.queryByText('选择模型')).not.toBeInTheDocument();
  });
});
