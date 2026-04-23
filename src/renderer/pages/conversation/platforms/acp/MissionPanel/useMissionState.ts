/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useRef, useState } from 'react';
import type { IResponseMessage } from '@/common/adapter/ipcBridge';
import type { MissionData, MissionFeature, MissionProgressEntry, MissionState } from './types';

const PROGRESS_LOG_LIMIT = 100;

const INITIAL_MISSION_DATA: MissionData = {
  state: null,
  missionId: null,
  features: [],
  progressLog: [],
  heartbeatTimestamp: null,
  workerStates: {},
};

/**
 * Manages mission-level state from the 6 mission_* IPC events.
 *
 * Returns a stable `dispatch` callback that `useAcpMessage` can invoke for each
 * mission event, plus the current `missionData` snapshot and a `reset` to clear
 * all state on mode switch or session change.
 */
export function useMissionState(conversationId: string) {
  const [missionData, setMissionData] = useState<MissionData>(INITIAL_MISSION_DATA);
  const missionDataRef = useRef(missionData);

  const updateData = useCallback((updater: (prev: MissionData) => MissionData) => {
    setMissionData((prev) => {
      const next = updater(prev);
      missionDataRef.current = next;
      return next;
    });
  }, []);

  const dispatch = useCallback(
    (message: IResponseMessage) => {
      if (message.conversation_id !== conversationId) return;

      const data = message.data as Record<string, unknown>;
      switch (message.type) {
        case 'mission_state': {
          const state = (data.state as MissionState) ?? null;
          const missionId = (data.missionId as string) ?? null;
          updateData((prev) => ({ ...prev, state, missionId }));
          break;
        }
        case 'mission_features': {
          const rawFeatures = (data.features ?? []) as Array<Record<string, unknown>>;
          const features: MissionFeature[] = rawFeatures.map((f) => ({
            id: String(f.id ?? ''),
            description: f.description as string | undefined,
            status: f.status as string | undefined,
            skillName: f.skillName as string | undefined,
            milestone: f.milestone as string | undefined,
            workerState: missionDataRef.current.workerStates[String(f.id ?? '')] ?? undefined,
          }));
          updateData((prev) => ({ ...prev, features }));
          break;
        }
        case 'mission_progress': {
          const entries = (data.entries ?? (data.entry ? [data.entry] : [])) as Array<Record<string, unknown>>;
          const mapped: MissionProgressEntry[] = entries.map((e) => ({
            type: e.type as string | undefined,
            timestamp: e.timestamp as string | undefined,
            text: e.text as string | undefined,
            featureId: e.featureId as string | undefined,
            workerSessionId: e.workerSessionId as string | undefined,
          }));
          updateData((prev) => {
            const combined = [...prev.progressLog, ...mapped];
            return {
              ...prev,
              progressLog:
                combined.length > PROGRESS_LOG_LIMIT ? combined.slice(combined.length - PROGRESS_LOG_LIMIT) : combined,
            };
          });
          break;
        }
        case 'mission_heartbeat': {
          const ts = (data.timestamp as string) ?? new Date().toISOString();
          updateData((prev) => ({ ...prev, heartbeatTimestamp: ts }));
          break;
        }
        case 'mission_worker_started': {
          const featureId = data.featureId as string;
          if (!featureId) break;
          updateData((prev) => ({
            ...prev,
            workerStates: { ...prev.workerStates, [featureId]: 'started' },
            features: prev.features.map((f) => (f.id === featureId ? { ...f, workerState: 'started' } : f)),
          }));
          break;
        }
        case 'mission_worker_completed': {
          const featureId = data.featureId as string;
          if (!featureId) break;
          const success = data.success !== false;
          const workerState = success ? 'completed-success' : 'completed-failure';
          updateData((prev) => ({
            ...prev,
            workerStates: { ...prev.workerStates, [featureId]: workerState },
            features: prev.features.map((f) => (f.id === featureId ? { ...f, workerState } : f)),
          }));
          break;
        }
        default:
          break;
      }
    },
    [conversationId, updateData]
  );

  const reset = useCallback(() => {
    setMissionData(INITIAL_MISSION_DATA);
    missionDataRef.current = INITIAL_MISSION_DATA;
  }, []);

  return { missionData, dispatch, reset } as const;
}
