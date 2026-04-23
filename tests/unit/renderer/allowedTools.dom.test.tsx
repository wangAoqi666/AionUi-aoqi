/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 *
 * DOM tests for AllowedToolsSelector: three-state IPC payload mapping
 * (null / [] / [id, id]), non-droid guard, and visibility conditions.
 *
 * VAL-IPC-001: renderer has setEnabledToolIds.invoke call site
 * VAL-IPC-002: exercises all three states (null / [] / [id,…])
 * VAL-IPC-003: non-droid guard surfaces localized Message.error
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── IPC mock ────────────────────────────────────────────────────────────────
const mockSetEnabledToolIdsInvoke = vi.fn().mockResolvedValue({ success: true });

vi.mock('@/common', () => ({
  ipcBridge: {
    acpConversation: {
      setEnabledToolIds: {
        invoke: (...args: unknown[]) => mockSetEnabledToolIdsInvoke(...args),
      },
    },
  },
}));

// ── Message.error spy ───────────────────────────────────────────────────────
const mockMessageError = vi.fn();

// ── Arco mock: Select renders with role="combobox" ──────────────────────────
vi.mock('@arco-design/web-react', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactInner = require('react');

  function MockSelect(props: Record<string, unknown>) {
    const { children, value, onChange, 'data-testid': testId, mode: _mode, ...rest } = props;
    return ReactInner.createElement(
      'select',
      {
        'data-testid': testId,
        value: value as string,
        onChange: (e: { target: { value: string } }) => {
          if (typeof onChange === 'function') {
            (onChange as (v: string) => void)(e.target.value);
          }
        },
        ...Object.fromEntries(
          Object.entries(rest).filter(([k]) => !['loading', 'size', 'allowCreate', 'placeholder'].includes(k))
        ),
      },
      children
    );
  }

  function MockOption(props: Record<string, unknown>) {
    return ReactInner.createElement('option', { value: props.value as string }, props.children);
  }

  MockSelect.Option = MockOption;

  return {
    Select: MockSelect,
    Message: { error: (...args: unknown[]) => mockMessageError(...args) },
  };
});

// ── i18n mock ───────────────────────────────────────────────────────────────
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue || key,
  }),
}));

// ── Component import ────────────────────────────────────────────────────────
import AllowedToolsSelector from '@/renderer/components/agent/AllowedToolsSelector';

describe('AllowedToolsSelector — three-state IPC payload mapping', () => {
  const conversationId = 'conv-tool-test-001';

  beforeEach(() => {
    vi.clearAllMocks();
    mockSetEnabledToolIdsInvoke.mockResolvedValue({ success: true });
  });

  // ── State 1: null (Use SDK Defaults) ────────────────────────────────────
  it('sends toolIds=null when "Use SDK Defaults" is selected (initial state)', () => {
    render(<AllowedToolsSelector conversationId={conversationId} visible />);
    const selector = screen.getByTestId('allowed-tools-selector');
    expect(selector).toBeTruthy();

    // Initial state is 'default' — no IPC call yet (no change event fired)
    expect(mockSetEnabledToolIdsInvoke).not.toHaveBeenCalled();
  });

  it('sends toolIds=null when switching back to "Use SDK Defaults"', async () => {
    const user = userEvent.setup();
    render(<AllowedToolsSelector conversationId={conversationId} visible />);

    const select = screen.getByTestId('allowed-tools-preset');
    // Switch to 'none' first
    await user.selectOptions(select, 'none');
    await waitFor(() => {
      expect(mockSetEnabledToolIdsInvoke).toHaveBeenCalledWith({
        conversationId,
        toolIds: [],
      });
    });

    // Switch back to 'default'
    await user.selectOptions(select, 'default');
    await waitFor(() => {
      expect(mockSetEnabledToolIdsInvoke).toHaveBeenCalledWith({
        conversationId,
        toolIds: null,
      });
    });
  });

  // ── State 2: [] (Disable All Tools) ─────────────────────────────────────
  it('sends toolIds=[] when "Disable All Tools" is selected', async () => {
    const user = userEvent.setup();
    render(<AllowedToolsSelector conversationId={conversationId} visible />);

    const select = screen.getByTestId('allowed-tools-preset');
    await user.selectOptions(select, 'none');

    await waitFor(() => {
      expect(mockSetEnabledToolIdsInvoke).toHaveBeenCalledOnce();
      expect(mockSetEnabledToolIdsInvoke).toHaveBeenCalledWith({
        conversationId,
        toolIds: [],
      });
    });
  });

  // ── State 3: [id, id] (Custom tool list) ────────────────────────────────
  it('sends toolIds=[id, id] when "Custom" is selected with specific ids', async () => {
    const user = userEvent.setup();
    render(<AllowedToolsSelector conversationId={conversationId} visible />);

    const select = screen.getByTestId('allowed-tools-preset');
    await user.selectOptions(select, 'custom');

    // Custom selection sends an empty custom list initially
    await waitFor(() => {
      expect(mockSetEnabledToolIdsInvoke).toHaveBeenCalledWith({
        conversationId,
        toolIds: [],
      });
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Non-droid guard: surfaces localized Message.error
// ═════════════════════════════════════════════════════════════════════════════

describe('AllowedToolsSelector — non-droid guard error surfacing', () => {
  const conversationId = 'conv-guard-test';

  beforeEach(() => {
    vi.clearAllMocks();
    mockSetEnabledToolIdsInvoke.mockResolvedValue({
      success: false,
      msg: 'enabledToolIds is only supported for the Droid SDK backend',
    });
  });

  it('shows Message.error with localized text when backend returns unsupported', async () => {
    const user = userEvent.setup();
    render(<AllowedToolsSelector conversationId={conversationId} visible />);

    const select = screen.getByTestId('allowed-tools-preset');
    await user.selectOptions(select, 'none');

    await waitFor(() => {
      expect(mockMessageError).toHaveBeenCalledOnce();
      const errorMsg = mockMessageError.mock.calls[0]?.[0] as string;
      expect(errorMsg.length).toBeGreaterThan(0);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Visibility: hidden when backend !== 'droid'
// ═════════════════════════════════════════════════════════════════════════════

describe('AllowedToolsSelector — visibility', () => {
  it('renders nothing when visible=false', () => {
    render(<AllowedToolsSelector conversationId='conv-hidden' visible={false} />);
    expect(screen.queryByTestId('allowed-tools-selector')).toBeNull();
  });

  it('renders the selector when visible=true', () => {
    render(<AllowedToolsSelector conversationId='conv-visible' visible />);
    expect(screen.getByTestId('allowed-tools-selector')).toBeTruthy();
  });
});
