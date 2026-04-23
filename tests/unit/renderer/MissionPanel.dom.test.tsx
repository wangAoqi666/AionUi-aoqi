/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 *
 * DOM tests for MissionPanel mount/unmount, state transitions, feature list,
 * progress log bounding, heartbeat display, and worker badges.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── i18n mock ───────────────────────────────────────────────────────────────
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

// ── Arco design mocks ──────────────────────────────────────────────────────
vi.mock('@arco-design/web-react', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactInner = require('react');
  return {
    Badge: (props: Record<string, unknown>) =>
      ReactInner.createElement('span', { 'data-status': props.status }, props.children ?? props.text),
    Empty: (props: { description?: string }) =>
      ReactInner.createElement('div', { 'data-testid': 'arco-empty' }, props.description ?? 'No data'),
    Tag: (props: Record<string, unknown>) =>
      ReactInner.createElement('span', { 'data-color': props.color, 'data-size': props.size }, props.children),
    Typography: {
      Text: (props: Record<string, unknown>) =>
        ReactInner.createElement('span', { className: props.className }, props.children),
    },
  };
});

// ── Import SUT ──────────────────────────────────────────────────────────────
import { MissionPanel } from '@/renderer/pages/conversation/platforms/acp/MissionPanel';
import type { MissionData } from '@/renderer/pages/conversation/platforms/acp/MissionPanel';

// ─────────────────────────────────────────────────────────────────────────────

const INITIAL_DATA: MissionData = {
  state: null,
  missionId: null,
  features: [],
  progressLog: [],
  heartbeatTimestamp: null,
  workerStates: {},
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ═════════════════════════════════════════════════════════════════════════════
// 1. Conditional mount / unmount (VAL-MISSION-007)
// ═════════════════════════════════════════════════════════════════════════════

describe('MissionPanel — conditional mount', () => {
  it('renders mission-panel with data-testid when mounted', () => {
    render(<MissionPanel missionData={INITIAL_DATA} />);
    expect(screen.getByTestId('mission-panel')).toBeTruthy();
  });

  it('contains all required child data-testids', () => {
    render(<MissionPanel missionData={INITIAL_DATA} />);
    expect(screen.getByTestId('mission-panel-state')).toBeTruthy();
    expect(screen.getByTestId('mission-panel-features')).toBeTruthy();
    expect(screen.getByTestId('mission-panel-progress-log')).toBeTruthy();
    expect(screen.getByTestId('mission-panel-heartbeat')).toBeTruthy();
  });

  it('shows empty state placeholder when no features', () => {
    render(<MissionPanel missionData={INITIAL_DATA} />);
    expect(screen.getByTestId('arco-empty')).toBeTruthy();
    expect(screen.getByText('No features yet')).toBeTruthy();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. State transitions (VAL-MISSION-008)
// ═════════════════════════════════════════════════════════════════════════════

describe('MissionPanel — state transitions', () => {
  it.each([
    ['planning', 'planning'],
    ['running', 'running'],
    ['completed', 'completed'],
    ['failed', 'failed'],
    ['cancelled', 'cancelled'],
  ] as const)('displays localized label for state=%s', (state, expectedLabel) => {
    const data: MissionData = { ...INITIAL_DATA, state };
    render(<MissionPanel missionData={data} />);
    expect(screen.getByText(expectedLabel)).toBeTruthy();
  });

  it('shows "Idle" when state is null', () => {
    render(<MissionPanel missionData={INITIAL_DATA} />);
    expect(screen.getByText('Idle')).toBeTruthy();
  });

  it('uses semantic Badge status for each state', () => {
    const { rerender } = render(<MissionPanel missionData={{ ...INITIAL_DATA, state: 'planning' }} />);
    const badge = screen.getByTestId('mission-panel-state').querySelector('[data-status]');
    expect(badge?.getAttribute('data-status')).toBe('processing');

    rerender(<MissionPanel missionData={{ ...INITIAL_DATA, state: 'completed' }} />);
    const badge2 = screen.getByTestId('mission-panel-state').querySelector('[data-status]');
    expect(badge2?.getAttribute('data-status')).toBe('success');

    rerender(<MissionPanel missionData={{ ...INITIAL_DATA, state: 'failed' }} />);
    const badge3 = screen.getByTestId('mission-panel-state').querySelector('[data-status]');
    expect(badge3?.getAttribute('data-status')).toBe('error');

    rerender(<MissionPanel missionData={{ ...INITIAL_DATA, state: 'cancelled' }} />);
    const badge4 = screen.getByTestId('mission-panel-state').querySelector('[data-status]');
    expect(badge4?.getAttribute('data-status')).toBe('warning');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. Features list — REPLACE behavior (VAL-MISSION-009)
// ═════════════════════════════════════════════════════════════════════════════

describe('MissionPanel — features list', () => {
  it('renders features with per-feature worker data-testid', () => {
    const data: MissionData = {
      ...INITIAL_DATA,
      features: [
        { id: 'feat-1', description: 'Create API endpoint' },
        { id: 'feat-2', description: 'Add database model' },
        { id: 'feat-3', description: 'Write tests' },
      ],
      workerStates: {},
    };
    render(<MissionPanel missionData={data} />);
    expect(screen.getByTestId('mission-panel-worker-feat-1')).toBeTruthy();
    expect(screen.getByTestId('mission-panel-worker-feat-2')).toBeTruthy();
    expect(screen.getByTestId('mission-panel-worker-feat-3')).toBeTruthy();
  });

  it('replaces features on re-render (3→1→0 with empty state)', () => {
    const data3: MissionData = {
      ...INITIAL_DATA,
      features: [
        { id: 'f1', description: 'a' },
        { id: 'f2', description: 'b' },
        { id: 'f3', description: 'c' },
      ],
    };
    const { rerender } = render(<MissionPanel missionData={data3} />);
    expect(screen.getByTestId('mission-panel-worker-f1')).toBeTruthy();
    expect(screen.getByTestId('mission-panel-worker-f2')).toBeTruthy();
    expect(screen.getByTestId('mission-panel-worker-f3')).toBeTruthy();

    // Replace with 1
    rerender(<MissionPanel missionData={{ ...INITIAL_DATA, features: [{ id: 'f1', description: 'a' }] }} />);
    expect(screen.getByTestId('mission-panel-worker-f1')).toBeTruthy();
    expect(screen.queryByTestId('mission-panel-worker-f2')).toBeNull();
    expect(screen.queryByTestId('mission-panel-worker-f3')).toBeNull();

    // Replace with 0
    rerender(<MissionPanel missionData={INITIAL_DATA} />);
    expect(screen.queryByTestId('mission-panel-worker-f1')).toBeNull();
    expect(screen.getByTestId('arco-empty')).toBeTruthy();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. Worker badges (VAL-MISSION-012)
// ═════════════════════════════════════════════════════════════════════════════

describe('MissionPanel — worker badges', () => {
  it('shows success pill for completed-success worker', () => {
    const data: MissionData = {
      ...INITIAL_DATA,
      features: [{ id: 'feat-a', description: 'Build backend' }],
      workerStates: { 'feat-a': 'completed-success' },
    };
    render(<MissionPanel missionData={data} />);
    expect(screen.getByText('Success')).toBeTruthy();
  });

  it('shows failure pill for completed-failure worker', () => {
    const data: MissionData = {
      ...INITIAL_DATA,
      features: [{ id: 'feat-b', description: 'Build frontend' }],
      workerStates: { 'feat-b': 'completed-failure' },
    };
    render(<MissionPanel missionData={data} />);
    expect(screen.getByText('Failed')).toBeTruthy();
  });

  it('shows processing tag for started worker', () => {
    const data: MissionData = {
      ...INITIAL_DATA,
      features: [{ id: 'feat-c', description: 'Running task' }],
      workerStates: { 'feat-c': 'started' },
    };
    render(<MissionPanel missionData={data} />);
    const tag = screen.getByTestId('mission-panel-worker-feat-c').querySelector('[data-color]');
    expect(tag?.getAttribute('data-color')).toBe('processing');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. Progress log display (VAL-MISSION-010)
// ═════════════════════════════════════════════════════════════════════════════

describe('MissionPanel — progress log', () => {
  it('renders progress entries', () => {
    const data: MissionData = {
      ...INITIAL_DATA,
      progressLog: [
        { type: 'mission_run_started', text: 'Mission started', timestamp: '2025-01-01T10:00:00Z' },
        { type: 'worker_started', text: 'Worker 1 started', timestamp: '2025-01-01T10:01:00Z' },
      ],
    };
    render(<MissionPanel missionData={data} />);
    expect(screen.getByText('Mission started')).toBeTruthy();
    expect(screen.getByText('Worker 1 started')).toBeTruthy();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. Heartbeat (VAL-MISSION-011)
// ═════════════════════════════════════════════════════════════════════════════

describe('MissionPanel — heartbeat', () => {
  it('renders heartbeat timestamp when present', () => {
    const data: MissionData = {
      ...INITIAL_DATA,
      heartbeatTimestamp: '2025-01-01T10:05:00Z',
    };
    render(<MissionPanel missionData={data} />);
    const heartbeat = screen.getByTestId('mission-panel-heartbeat');
    expect(heartbeat.textContent).toContain('Last heartbeat');
  });

  it('renders empty heartbeat section when no timestamp', () => {
    render(<MissionPanel missionData={INITIAL_DATA} />);
    const heartbeat = screen.getByTestId('mission-panel-heartbeat');
    expect(heartbeat.textContent).toBe('');
  });
});
