import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetConfigOptionsInvoke = vi.fn();
const mockConfigStorageGet = vi.fn();
const mockConfigStorageSet = vi.fn();
let responseStreamHandler: ((message: { type: string; conversation_id: string }) => void) | null = null;

function MockButton({
  children,
  onClick,
  className,
}: {
  children?: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button type='button' onClick={onClick} className={className}>
      {children}
    </button>
  );
}

function MockDropdown({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}

function MockMenuRoot({ children }: { children?: React.ReactNode }) {
  return <div>{children}</div>;
}

function MockMenuItem({ children }: { children?: React.ReactNode }) {
  return <div>{children}</div>;
}

function MockMenuItemGroup({ children, title }: { children?: React.ReactNode; title?: React.ReactNode }) {
  return (
    <div>
      <div>{title}</div>
      {children}
    </div>
  );
}

vi.mock('@/common', () => ({
  ipcBridge: {
    acpConversation: {
      getConfigOptions: {
        invoke: (...args: unknown[]) => mockGetConfigOptionsInvoke(...args),
      },
      responseStream: {
        on: (handler: (message: { type: string; conversation_id: string }) => void) => {
          responseStreamHandler = handler;
          return vi.fn();
        },
      },
    },
  },
}));

vi.mock('@/common/config/storage', () => ({
  ConfigStorage: {
    get: (...args: unknown[]) => mockConfigStorageGet(...args),
    set: (...args: unknown[]) => mockConfigStorageSet(...args),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

vi.mock('@arco-design/web-react', () => {
  return {
    Button: MockButton,
    Dropdown: MockDropdown,
    Menu: Object.assign(MockMenuRoot, {
      Item: MockMenuItem,
      ItemGroup: MockMenuItemGroup,
    }),
  };
});

vi.mock('@icon-park/react', () => ({
  Down: () => <span data-testid='icon-down'>v</span>,
}));

import AcpConfigSelector from '@/renderer/components/agent/AcpConfigSelector';

const droidConfigOptions = [
  {
    id: 'spec_mode_model',
    name: 'Spec Model',
    category: 'spec-model',
    type: 'select',
    currentValue: 'claude-sonnet-4-6',
    selectedValue: 'claude-sonnet-4-6',
    options: [{ value: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' }],
  },
  {
    id: 'spec_mode_reasoning_effort',
    name: 'Spec Reasoning',
    category: 'spec-reasoning',
    type: 'select',
    currentValue: 'high',
    selectedValue: 'high',
    options: [{ value: 'high', name: 'High' }],
  },
  {
    id: 'reasoning_effort',
    name: 'Reasoning Effort',
    category: 'reasoning',
    type: 'select',
    currentValue: 'high',
    selectedValue: 'high',
    options: [{ value: 'high', name: 'High' }],
  },
] as const;

describe('AcpConfigSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    responseStreamHandler = null;
    mockConfigStorageGet.mockResolvedValue({});
    mockConfigStorageSet.mockResolvedValue(undefined);
  });

  it('refreshes droid config options when a turn starts after the session is initialized', async () => {
    mockGetConfigOptionsInvoke
      .mockResolvedValueOnce({
        success: true,
        data: { configOptions: [] },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          configOptions: [
            {
              id: 'spec_mode_model',
              name: 'Spec Model',
              category: 'spec-model',
              type: 'select',
              currentValue: 'claude-sonnet-4-6',
              selectedValue: 'claude-sonnet-4-6',
              options: [{ value: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' }],
            },
            {
              id: 'reasoning_effort',
              name: 'Reasoning Effort',
              category: 'reasoning',
              type: 'select',
              currentValue: 'high',
              selectedValue: 'high',
              options: [{ value: 'high', name: 'High' }],
            },
          ],
        },
      });

    render(
      <AcpConfigSelector conversationId='conv-droid' backend='droid' initialConfigOptions={[]} selectedMode='spec' />
    );

    await waitFor(() => {
      expect(mockGetConfigOptionsInvoke).toHaveBeenCalledWith({ conversationId: 'conv-droid' });
    });

    responseStreamHandler?.({
      type: 'start',
      conversation_id: 'conv-droid',
    });

    await waitFor(() => {
      expect(mockGetConfigOptionsInvoke).toHaveBeenCalledTimes(2);
      expect(screen.getAllByText('Spec Model · Claude Sonnet 4.6').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Reasoning Effort · High').length).toBeGreaterThan(0);
    });
  });

  it('hides droid spec-only config pills outside spec mode', () => {
    render(<AcpConfigSelector backend='droid' initialConfigOptions={droidConfigOptions} selectedMode='default' />);

    expect(screen.queryByText('Spec Model · Claude Sonnet 4.6')).not.toBeInTheDocument();
    expect(screen.queryByText('Spec Reasoning · High')).not.toBeInTheDocument();
    expect(screen.getAllByText('Reasoning Effort · High').length).toBeGreaterThan(0);
  });

  it('shows droid spec-only config pills in spec mode', () => {
    render(<AcpConfigSelector backend='droid' initialConfigOptions={droidConfigOptions} selectedMode='spec' />);

    expect(screen.getAllByText('Spec Model · Claude Sonnet 4.6').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Spec Reasoning · High').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Reasoning Effort · High').length).toBeGreaterThan(0);
  });
});
