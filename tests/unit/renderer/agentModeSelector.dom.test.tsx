/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 *
 * DOM tests for Mission mode visibility and setMode wiring across all three
 * AgentModeSelector surfaces: GuidActionRow (pre-conversation), ChatLayout
 * header pill, and AcpSendBox compact pill.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── IPC mock ────────────────────────────────────────────────────────────────
const mockSetModeInvoke = vi.fn().mockResolvedValue({ success: true, data: { mode: 'mission' } });
const mockGetModeInvoke = vi.fn().mockResolvedValue({
  success: true,
  data: { mode: 'default', initialized: true },
});
const mockSetSkipPermissionsUnsafeInvoke = vi.fn().mockResolvedValue({ success: true });
const mockSetEnabledToolIdsInvoke = vi.fn().mockResolvedValue({ success: true });

vi.mock('@/common', () => ({
  ipcBridge: {
    acpConversation: {
      setMode: { invoke: (...args: unknown[]) => mockSetModeInvoke(...args) },
      getMode: { invoke: (...args: unknown[]) => mockGetModeInvoke(...args) },
      setSkipPermissionsUnsafe: {
        invoke: (...args: unknown[]) => mockSetSkipPermissionsUnsafeInvoke(...args),
      },
      setEnabledToolIds: {
        invoke: (...args: unknown[]) => mockSetEnabledToolIdsInvoke(...args),
      },
    },
  },
}));

// ── i18n mock ───────────────────────────────────────────────────────────────
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

// ── Layout context (no-op) ──────────────────────────────────────────────────
vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => null,
}));

// ── Agent logo (no-op) ─────────────────────────────────────────────────────
vi.mock('@/renderer/utils/model/agentLogo', () => ({
  getAgentLogo: () => null,
}));

// ── Icon mocks ──────────────────────────────────────────────────────────────
vi.mock('@icon-park/react', () => ({
  Down: () => React.createElement('span', { 'data-testid': 'icon-down' }),
  Robot: () => React.createElement('span', { 'data-testid': 'icon-robot' }),
  Shield: () => React.createElement('span', { 'data-testid': 'icon-shield' }),
}));

// ── MarqueePillLabel mock ───────────────────────────────────────────────────
vi.mock('@/renderer/components/agent/MarqueePillLabel', () => ({
  default: ({ text }: { text: string }) => React.createElement('span', null, text),
}));

// ── SkipPermissionsConfirmModal mock: tracks mount ──────────────────────────
const mockSkipPermissionsConfirmModal = vi.fn();
vi.mock('@/renderer/components/agent/SkipPermissionsConfirmModal', () => ({
  default: (props: Record<string, unknown>) => {
    mockSkipPermissionsConfirmModal(props);
    if (props.visible) {
      return React.createElement('div', { 'data-testid': 'yolo-confirm-modal' }, 'YOLO Confirm');
    }
    return null;
  },
}));

// ── Color mocks ─────────────────────────────────────────────────────────────
vi.mock('@/renderer/styles/colors', () => ({
  iconColors: { secondary: '#999' },
}));

// ── Arco mock: Menu.Item renders with role="menuitem" + data-key ───────────
// We must define everything inside the factory since vi.mock is hoisted.
let menuClickHandler: ((key: string) => void) | null = null;

vi.mock('@arco-design/web-react', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactInner = require('react');

  function PMenuItem(props: Record<string, unknown>) {
    const dataKey = props['data-key'] as string | undefined;
    return ReactInner.createElement(
      'div',
      {
        role: 'menuitem',
        'data-key': dataKey,
        'aria-disabled': 'false',
        onClick: () => dataKey && menuClickHandler?.(dataKey),
      },
      props.children
    );
  }

  function PMenuItemGroup(props: { children?: unknown; title?: unknown }) {
    return ReactInner.createElement(
      'div',
      {
        role: 'group',
        'aria-label': typeof props.title === 'string' ? props.title : undefined,
      },
      props.children
    );
  }

  function PMenu(props: { children?: unknown; onClickMenuItem?: (key: string) => void }) {
    menuClickHandler = props.onClickMenuItem ?? null;
    // Clone children to inject data-key from React key
    const patchedChildren = ReactInner.Children.map(props.children as ReactInner.ReactNode, (child: unknown) => {
      if (!ReactInner.isValidElement(child)) return child;
      const childEl = child as ReactInner.ReactElement;
      // ItemGroup: recurse into its children
      if (childEl.type === PMenuItemGroup) {
        const groupProps = childEl.props as { children?: ReactInner.ReactNode; title?: unknown };
        const patchedGroupChildren = ReactInner.Children.map(groupProps.children, (item: unknown) => {
          if (!ReactInner.isValidElement(item)) return item;
          const itemEl = item as ReactInner.ReactElement;
          const itemKey = itemEl.key;
          if (itemKey != null) {
            return ReactInner.cloneElement(itemEl, { 'data-key': String(itemKey) });
          }
          return item;
        });
        return ReactInner.cloneElement(childEl, {}, patchedGroupChildren);
      }
      return child;
    });
    return ReactInner.createElement('div', { role: 'menu' }, patchedChildren);
  }

  PMenu.Item = PMenuItem;
  PMenu.ItemGroup = PMenuItemGroup;

  return {
    Button: (props: Record<string, unknown>) =>
      ReactInner.createElement(
        'button',
        { type: 'button', onClick: props.onClick as (() => void) | undefined, className: props.className },
        props.icon,
        props.children
      ),
    Dropdown: (props: { children?: unknown; droplist?: unknown }) =>
      ReactInner.createElement(ReactInner.Fragment, null, props.children, props.droplist),
    Menu: PMenu,
    Message: { success: vi.fn(), error: vi.fn() },
    // Select is required by AllowedToolsSelector (child of AgentModeSelector).
    Select: Object.assign(
      (props: Record<string, unknown>) =>
        ReactInner.createElement(
          'select',
          {
            'data-testid': props['data-testid'],
            value: props.value as string,
            onChange: (e: { target: { value: string } }) => {
              if (typeof props.onChange === 'function') {
                (props.onChange as (v: string) => void)(e.target.value);
              }
            },
          },
          props.children
        ),
      {
        Option: (props: Record<string, unknown>) =>
          ReactInner.createElement('option', { value: props.value as string }, props.children),
      }
    ),
  };
});

// ── Import SUT ──────────────────────────────────────────────────────────────
import AgentModeSelector from '@/renderer/components/agent/AgentModeSelector';

// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  menuClickHandler = null;
});

// ═════════════════════════════════════════════════════════════════════════════
// Surface 1: GuidActionRow (pre-conversation — no conversationId)
// ═════════════════════════════════════════════════════════════════════════════

describe('AgentModeSelector — GuidActionRow surface (pre-conversation)', () => {
  it('renders Mission menu item when backend is droid', async () => {
    const onModeSelect = vi.fn();
    render(<AgentModeSelector backend='droid' onModeSelect={onModeSelect} />);

    const missionItem = await screen.findByRole('menuitem', { name: /^Mission$/ });
    expect(missionItem).toBeTruthy();
    expect(missionItem.getAttribute('aria-disabled')).toBe('false');
    expect(missionItem.getAttribute('data-key')).toBe('mission');
  });

  it('calls onModeSelect("mission") on click — no setMode IPC', async () => {
    const user = userEvent.setup();
    const onModeSelect = vi.fn();
    const onModeChanged = vi.fn();

    render(<AgentModeSelector backend='droid' onModeSelect={onModeSelect} onModeChanged={onModeChanged} />);

    const missionItem = await screen.findByRole('menuitem', { name: /^Mission$/ });
    await user.click(missionItem);

    expect(onModeSelect).toHaveBeenCalledWith('mission');
    expect(onModeChanged).toHaveBeenCalledWith('mission');
    // No IPC — no conversationId
    expect(mockSetModeInvoke).not.toHaveBeenCalled();
  });

  it('does not show SkipPermissionsConfirmModal for mission mode', async () => {
    const user = userEvent.setup();
    const onModeSelect = vi.fn();

    render(<AgentModeSelector backend='droid' onModeSelect={onModeSelect} />);

    const missionItem = await screen.findByRole('menuitem', { name: /^Mission$/ });
    await user.click(missionItem);

    expect(screen.queryByTestId('yolo-confirm-modal')).toBeNull();
  });

  it('hides Mission for non-droid backend (qwen)', () => {
    const onModeSelect = vi.fn();
    render(<AgentModeSelector backend='qwen' onModeSelect={onModeSelect} />);

    expect(screen.queryByRole('menuitem', { name: /^Mission$/ })).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Surface 2: ChatLayout header pill (in-conversation — has conversationId)
// ═════════════════════════════════════════════════════════════════════════════

describe('AgentModeSelector — ChatLayout header pill surface', () => {
  const conversationId = 'test-conv-header';

  it('renders Mission menu item when backend is droid', async () => {
    render(<AgentModeSelector backend='droid' conversationId={conversationId} agentName='Droid Agent' />);

    const missionItem = await screen.findByRole('menuitem', { name: /^Mission$/ });
    expect(missionItem).toBeTruthy();
    expect(missionItem.getAttribute('aria-disabled')).toBe('false');
    expect(missionItem.getAttribute('data-key')).toBe('mission');
  });

  it('invokes setMode.invoke with {conversationId, mode: "mission"} on click', async () => {
    const user = userEvent.setup();
    const onModeChanged = vi.fn();

    render(
      <AgentModeSelector
        backend='droid'
        conversationId={conversationId}
        agentName='Droid Agent'
        onModeChanged={onModeChanged}
      />
    );

    const missionItem = await screen.findByRole('menuitem', { name: /^Mission$/ });
    await user.click(missionItem);

    await waitFor(() => {
      expect(mockSetModeInvoke).toHaveBeenCalledOnce();
      expect(mockSetModeInvoke).toHaveBeenCalledWith({
        conversationId,
        mode: 'mission',
      });
    });
    await waitFor(() => {
      expect(onModeChanged).toHaveBeenCalledWith('mission');
    });
  });

  it('does not show SkipPermissionsConfirmModal for mission mode', async () => {
    const user = userEvent.setup();

    render(<AgentModeSelector backend='droid' conversationId={conversationId} agentName='Droid Agent' />);

    const missionItem = await screen.findByRole('menuitem', { name: /^Mission$/ });
    await user.click(missionItem);

    expect(screen.queryByTestId('yolo-confirm-modal')).toBeNull();
  });

  it('hides Mission for non-droid backend (qwen)', () => {
    render(<AgentModeSelector backend='qwen' conversationId={conversationId} agentName='Qwen Agent' />);

    expect(screen.queryByRole('menuitem', { name: /^Mission$/ })).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Surface 3: AcpSendBox compact pill (in-conversation — compact mode)
// ═════════════════════════════════════════════════════════════════════════════

describe('AgentModeSelector — AcpSendBox compact pill surface', () => {
  const conversationId = 'test-conv-sendbox';

  it('renders Mission menu item in compact mode when backend is droid', async () => {
    render(
      <AgentModeSelector
        backend='droid'
        conversationId={conversationId}
        compact
        modeLabelFormatter={(mode) => mode.label}
      />
    );

    const missionItem = await screen.findByRole('menuitem', { name: /^Mission$/ });
    expect(missionItem).toBeTruthy();
    expect(missionItem.getAttribute('aria-disabled')).toBe('false');
    expect(missionItem.getAttribute('data-key')).toBe('mission');
  });

  it('invokes setMode.invoke with {conversationId, mode: "mission"} on click', async () => {
    const user = userEvent.setup();
    const onModeChanged = vi.fn();

    render(
      <AgentModeSelector
        backend='droid'
        conversationId={conversationId}
        compact
        modeLabelFormatter={(mode) => mode.label}
        onModeChanged={onModeChanged}
      />
    );

    const missionItem = await screen.findByRole('menuitem', { name: /^Mission$/ });
    await user.click(missionItem);

    await waitFor(() => {
      expect(mockSetModeInvoke).toHaveBeenCalledOnce();
      expect(mockSetModeInvoke).toHaveBeenCalledWith({
        conversationId,
        mode: 'mission',
      });
    });
    await waitFor(() => {
      expect(onModeChanged).toHaveBeenCalledWith('mission');
    });
  });

  it('renders compact pill label as t("agentMode.mission") via modeLabelFormatter', async () => {
    // Use the same modeLabelFormatter as AcpSendBox production code
    render(
      <AgentModeSelector
        backend='droid'
        conversationId={conversationId}
        compact
        initialMode='mission'
        modeLabelFormatter={(mode) => `agentMode.${mode.value}`}
      />
    );

    // Wait for any pending state updates (getMode effect) to settle
    await waitFor(() => {
      // The compact pill should show the translated label
      expect(screen.getByText('agentMode.mission')).toBeTruthy();
    });
  });

  it('does not show SkipPermissionsConfirmModal for mission mode', async () => {
    const user = userEvent.setup();

    render(<AgentModeSelector backend='droid' conversationId={conversationId} compact />);

    const missionItem = await screen.findByRole('menuitem', { name: /^Mission$/ });
    await user.click(missionItem);

    expect(screen.queryByTestId('yolo-confirm-modal')).toBeNull();
  });

  it('hides Mission for non-droid backend (qwen)', () => {
    render(<AgentModeSelector backend='qwen' conversationId={conversationId} compact />);

    expect(screen.queryByRole('menuitem', { name: /^Mission$/ })).toBeNull();
  });
});
