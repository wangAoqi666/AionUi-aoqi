/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ICronJob } from '@/common/adapter/ipcBridge';
import type { TChatConversation } from '@/common/config/storage';
import {
  TEMP_AGENT_SPACE_ID,
  createFolderAgentSpaceId,
} from '@renderer/pages/conversation/GroupedHistory/utils/groupingHelpers';
import { getActivityTime } from '@renderer/utils/chat/timeline';
import { getSelectedSpaceWorkspace } from '@renderer/utils/workspace/selectedSpace';
import { getWorkspaceDisplayName } from '@renderer/utils/workspace/workspace';

export const CRON_AGENT_SPACE_DISPLAY_NAMES_KEY = 'conversation-agent-space-display-names';
export const CRON_TEMP_SPACE_FILTER = 'temp';

export type CronScheduledFilterPathParams = {
  workspacePath?: string | null;
  conversationId?: string | null;
  scope?: typeof CRON_TEMP_SPACE_FILTER | null;
};

export function isTempCronSpaceFilter(value: string | null | undefined): value is typeof CRON_TEMP_SPACE_FILTER {
  return value === CRON_TEMP_SPACE_FILTER;
}

export function buildScheduledFilterPath({
  workspacePath,
  conversationId,
  scope,
}: CronScheduledFilterPathParams = {}): string {
  const params = new URLSearchParams();
  if (workspacePath) {
    params.set('workspace', workspacePath);
  }
  if (conversationId) {
    params.set('conversationId', conversationId);
  }
  if (!workspacePath && isTempCronSpaceFilter(scope)) {
    params.set('space', scope);
  }

  const query = params.toString();
  return query ? `/scheduled?${query}` : '/scheduled';
}

export type CronOwnershipConversation = {
  id: string;
  conversation: TChatConversation | null;
  displayName: string;
  workspacePath: string | null;
  jobs: ICronJob[];
  lastActiveAt: number;
};

export type CronOwnershipSpace = {
  id: string;
  type: 'folder' | 'temp';
  displayName: string;
  workspacePath: string | null;
  conversations: CronOwnershipConversation[];
  totalJobs: number;
  lastActiveAt: number;
};

export function loadCronWorkspaceDisplayNames(): Record<string, string> {
  try {
    const saved = localStorage.getItem(CRON_AGENT_SPACE_DISPLAY_NAMES_KEY);
    const parsed = saved ? JSON.parse(saved) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[0] === 'string' && typeof entry[1] === 'string'
      )
    );
  } catch {
    return {};
  }
}

export function getCronMarkerCleanupConversations(
  conversations: TChatConversation[],
  jobs: ICronJob[]
): TChatConversation[] {
  const jobsById = new Map(jobs.map((job) => [job.id, job] as const));

  return conversations.filter((conversation) => {
    const cronJobId = (conversation.extra as { cronJobId?: string } | undefined)?.cronJobId;
    if (!cronJobId) {
      return false;
    }

    const matchedJob = jobsById.get(cronJobId);
    return !matchedJob;
  });
}

export function getCronWorkspacePath(conversation?: TChatConversation | null): string | null {
  const workspace = conversation?.extra?.workspace;
  const customWorkspace = conversation?.extra?.customWorkspace;

  if (!workspace || !customWorkspace) {
    return null;
  }

  return workspace;
}

export function getConversationBackend(conversation?: TChatConversation | null): string | undefined {
  if (!conversation) {
    return undefined;
  }

  switch (conversation.type) {
    case 'gemini':
      return 'gemini';
    case 'acp':
      return conversation.extra?.backend || 'claude';
    case 'codex':
      return 'codex';
    case 'openclaw-gateway':
      return 'openclaw-gateway';
    case 'nanobot':
      return 'nanobot';
    case 'remote':
      return 'remote';
    case 'aionrs':
      return 'aionrs';
    default:
      return undefined;
  }
}

export function getSelectableCronConversations(
  conversations: TChatConversation[],
  workspacePath: string | null,
  backend?: string
): TChatConversation[] {
  if (!workspacePath) {
    return [];
  }

  return conversations
    .filter((conversation) => {
      if (getCronWorkspacePath(conversation) !== workspacePath) {
        return false;
      }

      if (!backend) {
        return true;
      }

      return getConversationBackend(conversation) === backend;
    })
    .toSorted((conversationA, conversationB) => getActivityTime(conversationB) - getActivityTime(conversationA));
}

export function resolveDefaultCronWorkspacePath(
  conversations: TChatConversation[],
  options: {
    preferredConversationId?: string;
    preferredWorkspacePath?: string;
  } = {}
): string | null {
  if (options.preferredWorkspacePath) {
    return options.preferredWorkspacePath;
  }

  if (options.preferredConversationId) {
    const matchedConversation = conversations.find(
      (conversation) => conversation.id === options.preferredConversationId
    );
    const conversationWorkspace = getCronWorkspacePath(matchedConversation);
    if (conversationWorkspace) {
      return conversationWorkspace;
    }
  }

  const selectedSpaceWorkspace = getSelectedSpaceWorkspace();
  if (selectedSpaceWorkspace) {
    return selectedSpaceWorkspace;
  }

  const latestWorkspaceConversation = conversations
    .filter((conversation) => Boolean(getCronWorkspacePath(conversation)))
    .toSorted((conversationA, conversationB) => getActivityTime(conversationB) - getActivityTime(conversationA))[0];

  return getCronWorkspacePath(latestWorkspaceConversation);
}

export function buildCronOwnershipSpaces(
  jobs: ICronJob[],
  conversations: TChatConversation[],
  t: (key: string, options?: Record<string, unknown>) => string,
  displayNameOverrides: Record<string, string> = {}
): CronOwnershipSpace[] {
  const conversationMap = new Map(conversations.map((conversation) => [conversation.id, conversation] as const));
  const spaceMap = new Map<string, CronOwnershipSpace>();

  jobs.forEach((job) => {
    const conversation = conversationMap.get(job.metadata.conversationId) ?? null;
    const workspacePath = getCronWorkspacePath(conversation);
    const spaceId = workspacePath ? createFolderAgentSpaceId(workspacePath) : TEMP_AGENT_SPACE_ID;
    const existingSpace = spaceMap.get(spaceId);
    const nextSpace =
      existingSpace ??
      ({
        id: spaceId,
        type: workspacePath ? 'folder' : 'temp',
        displayName: workspacePath
          ? displayNameOverrides[workspacePath] || getWorkspaceDisplayName(workspacePath, t)
          : t('conversation.workspace.temporarySpace'),
        workspacePath,
        conversations: [],
        totalJobs: 0,
        lastActiveAt: 0,
      } satisfies CronOwnershipSpace);

    const conversationId = job.metadata.conversationId || `missing:${job.id}`;
    let ownerConversation = nextSpace.conversations.find((entry) => entry.id === conversationId);

    if (!ownerConversation) {
      ownerConversation = {
        id: conversationId,
        conversation,
        displayName: conversation?.name || job.metadata.conversationTitle || job.name,
        workspacePath,
        jobs: [],
        lastActiveAt: conversation ? getActivityTime(conversation) : job.metadata.updatedAt,
      };
      nextSpace.conversations.push(ownerConversation);
    }

    ownerConversation.jobs.push(job);
    ownerConversation.lastActiveAt = Math.max(ownerConversation.lastActiveAt, job.metadata.updatedAt);
    nextSpace.totalJobs += 1;
    nextSpace.lastActiveAt = Math.max(nextSpace.lastActiveAt, ownerConversation.lastActiveAt);

    spaceMap.set(spaceId, nextSpace);
  });

  return Array.from(spaceMap.values())
    .map((space) => {
      const orderedConversations = [...space.conversations]
        .map((conversation) => {
          return {
            id: conversation.id,
            conversation: conversation.conversation,
            displayName: conversation.displayName,
            workspacePath: conversation.workspacePath,
            lastActiveAt: conversation.lastActiveAt,
            jobs: [...conversation.jobs].toSorted((jobA, jobB) => jobB.metadata.updatedAt - jobA.metadata.updatedAt),
          };
        })
        .toSorted((conversationA, conversationB) => conversationB.lastActiveAt - conversationA.lastActiveAt);

      return {
        id: space.id,
        type: space.type,
        displayName: space.displayName,
        workspacePath: space.workspacePath,
        totalJobs: space.totalJobs,
        lastActiveAt: space.lastActiveAt,
        conversations: orderedConversations,
      };
    })
    .toSorted((spaceA, spaceB) => {
      if (spaceA.type !== spaceB.type) {
        return spaceA.type === 'folder' ? -1 : 1;
      }

      return spaceB.lastActiveAt - spaceA.lastActiveAt;
    });
}
