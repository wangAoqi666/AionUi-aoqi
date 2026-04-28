/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import { Badge, Empty, Tag, Typography } from '@arco-design/web-react';
import React, { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { MissionData, MissionState } from './types';

const { Text } = Typography;

/** Maps mission state to a semantic Arco Badge status. */
function stateToStatus(state: MissionState | null): 'default' | 'processing' | 'success' | 'error' | 'warning' {
  switch (state) {
    case 'planning':
      return 'processing';
    case 'running':
      return 'processing';
    case 'completed':
      return 'success';
    case 'failed':
      return 'error';
    case 'cancelled':
      return 'warning';
    default:
      return 'default';
  }
}

/** Maps worker state to a pill color token. */
function workerColor(ws?: string): string {
  if (ws === 'started') return 'processing';
  if (ws === 'completed-success') return 'success';
  if (ws === 'completed-failure') return 'error';
  return 'default';
}

type MissionPanelProps = {
  missionData: MissionData;
};

/**
 * Displays live mission decomposition state: lifecycle badge, feature list,
 * progress log, heartbeat, and per-worker status.
 *
 * Mounts only when `sessionMode === 'mission'`.
 */
const MissionPanel: React.FC<MissionPanelProps> = memo(({ missionData }) => {
  const { t } = useTranslation('agentMode');
  const { state, features, progressLog, heartbeatTimestamp, workerStates } = missionData;

  const stateLabel = useMemo(() => {
    if (!state) return t('missionPanel.idle', 'Idle');
    return t(`missionPanel.state.${state}`, state);
  }, [state, t]);

  const recentLogs = useMemo(() => {
    // Show last 20 entries in reverse chronological order for display
    return progressLog.slice(-20).toReversed();
  }, [progressLog]);

  return (
    <div data-testid='mission-panel' className='p-3'>
      {/* State badge */}
      <div data-testid='mission-panel-state' className='mb-2 flex items-center gap-2'>
        <Badge status={stateToStatus(state)} />
        <Text bold>{stateLabel}</Text>
      </div>

      {/* Features list */}
      <div data-testid='mission-panel-features' className='mb-2'>
        {features.length === 0 ? (
          <Empty description={t('missionPanel.noFeatures', 'No features yet')} />
        ) : (
          features.map((f) => (
            <div key={f.id} data-testid={`mission-panel-worker-${f.id}`} className='flex items-center gap-2 py-1'>
              <Tag color={workerColor(workerStates[f.id])}>{f.id}</Tag>
              {f.description && (
                <Text className='text-sm' ellipsis>
                  {f.description}
                </Text>
              )}
              {workerStates[f.id] === 'completed-success' && (
                <Tag color='green' size='small'>
                  {t('missionPanel.worker.success', 'Success')}
                </Tag>
              )}
              {workerStates[f.id] === 'completed-failure' && (
                <Tag color='red' size='small'>
                  {t('missionPanel.worker.failure', 'Failed')}
                </Tag>
              )}
            </div>
          ))
        )}
      </div>

      {/* Progress log */}
      <div data-testid='mission-panel-progress-log' className='mb-2 max-h-40 overflow-y-auto'>
        {recentLogs.map((entry, i) => (
          <div key={`${entry.timestamp ?? ''}-${i}`} className='text-xs py-px opacity-80'>
            {entry.timestamp && (
              <Text className='mr-1 text-xs opacity-60'>{new Date(entry.timestamp).toLocaleTimeString()}</Text>
            )}
            <Text className='text-xs'>{entry.text ?? entry.type ?? ''}</Text>
          </div>
        ))}
      </div>

      {/* Heartbeat */}
      <div data-testid='mission-panel-heartbeat' className='text-xs opacity-60'>
        {heartbeatTimestamp && (
          <Text>
            {t('missionPanel.heartbeat', 'Last heartbeat')}: {new Date(heartbeatTimestamp).toLocaleTimeString()}
          </Text>
        )}
      </div>
    </div>
  );
});

MissionPanel.displayName = 'MissionPanel';

export default MissionPanel;
