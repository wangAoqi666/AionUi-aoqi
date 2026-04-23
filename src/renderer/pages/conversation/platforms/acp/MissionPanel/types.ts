/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

/** Mission lifecycle states emitted by the backend via `mission_state` events. */
export type MissionState = 'planning' | 'running' | 'completed' | 'failed' | 'cancelled';

/** A single feature tracked by the mission. */
export type MissionFeature = {
  id: string;
  description?: string;
  status?: string;
  skillName?: string;
  milestone?: string;
  /** 'started' | 'completed-success' | 'completed-failure' | undefined */
  workerState?: string;
};

/** A single progress log entry (bounded to N=100). */
export type MissionProgressEntry = {
  type?: string;
  timestamp?: string;
  text?: string;
  featureId?: string;
  workerSessionId?: string;
};

/** Full mission state tracked by useMissionState. */
export type MissionData = {
  state: MissionState | null;
  missionId: string | null;
  features: MissionFeature[];
  progressLog: MissionProgressEntry[];
  heartbeatTimestamp: string | null;
  /** Per-feature worker state: featureId → 'started' | 'completed-success' | 'completed-failure' */
  workerStates: Record<string, string>;
};
