import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      (
        ({
          'common.conversation': 'Conversation',
          'common.tasks': 'Tasks',
          'common.settings': 'Settings',
        }) as Record<string, string>
      )[key] ?? key,
  }),
}));

vi.mock('@arco-design/web-react', () => ({
  Button: ({
    children,
    icon,
    onClick,
    'aria-label': ariaLabel,
    'aria-pressed': ariaPressed,
  }: {
    children?: React.ReactNode;
    icon?: React.ReactNode;
    onClick?: () => void;
    'aria-label'?: string;
    'aria-pressed'?: boolean;
  }) => (
    <button type='button' aria-label={ariaLabel} aria-pressed={ariaPressed} onClick={onClick}>
      {icon}
      {children}
    </button>
  ),
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@icon-park/react', () => ({
  AlarmClock: () => <span data-testid='tasks-icon' />,
  MessageOne: () => <span data-testid='conversation-icon' />,
  SettingTwo: () => <span data-testid='settings-icon' />,
}));

vi.mock('@renderer/utils/ui/siderTooltip', () => ({
  getSiderTooltipProps: () => ({}),
}));

import PrimaryRail from '@/renderer/components/layout/PrimaryRail';

describe('PrimaryRail', () => {
  it('marks the active section and emits section changes', () => {
    const onSelectSection = vi.fn();

    render(<PrimaryRail activeSection='tasks' isMobile={false} onSelectSection={onSelectSection} />);

    expect(screen.getByLabelText('Conversation')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByLabelText('Tasks')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Settings')).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByLabelText('Conversation'));
    fireEvent.click(screen.getByLabelText('Settings'));

    expect(onSelectSection).toHaveBeenNthCalledWith(1, 'conversation');
    expect(onSelectSection).toHaveBeenNthCalledWith(2, 'settings');
  });
});
