/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import { getActivityTime } from '@/renderer/utils/chat/timeline';
import { getWorkspaceDisplayName } from '@/renderer/utils/workspace/workspace';
import { getWorkspaceUpdateTime } from '@/renderer/utils/workspace/workspaceHistory';

import type { AgentSpace, GroupedHistoryResult, TimelineItem, TimelineSection } from '../types';
import { getConversationSortOrder } from './sortOrderHelpers';

export const TEMP_AGENT_SPACE_ID = '__agent-space-temp__';

export const createFolderAgentSpaceId = (workspace: string): string => `folder:${workspace}`;

export const getConversationAgentSpaceId = (conversation: TChatConversation): string => {
  const workspace = conversation.extra?.workspace;
  const customWorkspace = conversation.extra?.customWorkspace;

  if (customWorkspace && workspace) {
    return createFolderAgentSpaceId(workspace);
  }

  return TEMP_AGENT_SPACE_ID;
};

export const buildAgentSpaces = (
  conversations: TChatConversation[],
  explicitWorkspacePaths: string[] = [],
  t?: (key: string) => string,
  displayNameOverrides: Record<string, string> = {}
): AgentSpace[] => {
  const explicitOrder = new Map(explicitWorkspacePaths.map((workspace, index) => [workspace, index]));
  const folderSpaces = new Map<string, AgentSpace>();
  const tempConversations: TChatConversation[] = [];

  explicitWorkspacePaths.forEach((workspace) => {
    if (!workspace || folderSpaces.has(workspace)) {
      return;
    }

    folderSpaces.set(workspace, {
      id: createFolderAgentSpaceId(workspace),
      type: 'folder',
      displayName: displayNameOverrides[workspace] || getWorkspaceDisplayName(workspace, t),
      workspacePath: workspace,
      conversations: [],
      lastActiveAt: 0,
    });
  });

  conversations.forEach((conversation) => {
    if (isCronJobConversation(conversation) && !isConversationPinned(conversation)) {
      return;
    }

    const workspace = conversation.extra?.workspace;
    const customWorkspace = conversation.extra?.customWorkspace;

    if (customWorkspace && workspace) {
      const existingSpace =
        folderSpaces.get(workspace) ??
        ({
          id: createFolderAgentSpaceId(workspace),
          type: 'folder',
          displayName: displayNameOverrides[workspace] || getWorkspaceDisplayName(workspace, t),
          workspacePath: workspace,
          conversations: [],
          lastActiveAt: 0,
        } satisfies AgentSpace);

      existingSpace.conversations.push(conversation);
      folderSpaces.set(workspace, existingSpace);
      return;
    }

    tempConversations.push(conversation);
  });

  const orderedFolderSpaces = Array.from(folderSpaces.values())
    .map((space) => {
      const orderedConversations = [...space.conversations].toSorted((a, b) => getActivityTime(b) - getActivityTime(a));

      return {
        ...space,
        conversations: orderedConversations,
        lastActiveAt: orderedConversations.length > 0 ? getActivityTime(orderedConversations[0]) : 0,
      };
    })
    .toSorted((spaceA, spaceB) => {
      const orderA = explicitOrder.get(spaceA.workspacePath ?? '');
      const orderB = explicitOrder.get(spaceB.workspacePath ?? '');

      if (orderA !== undefined && orderB !== undefined && orderA !== orderB) {
        return orderA - orderB;
      }

      if (orderA !== undefined) {
        return -1;
      }

      if (orderB !== undefined) {
        return 1;
      }

      return spaceB.lastActiveAt - spaceA.lastActiveAt;
    });

  const orderedTempConversations = [...tempConversations].toSorted((a, b) => getActivityTime(b) - getActivityTime(a));

  return [
    {
      id: TEMP_AGENT_SPACE_ID,
      type: 'temp',
      displayName: t ? t('conversation.workspace.temporarySpace') : 'Temporary Session',
      workspacePath: null,
      conversations: orderedTempConversations,
      lastActiveAt: orderedTempConversations.length > 0 ? getActivityTime(orderedTempConversations[0]) : 0,
    },
    ...orderedFolderSpaces,
  ];
};

export const isConversationPinned = (conversation: TChatConversation): boolean => {
  const extra = conversation.extra as { pinned?: boolean } | undefined;
  return Boolean(extra?.pinned);
};

export const isCronJobConversation = (conversation: TChatConversation): boolean => {
  const extra = conversation.extra as { cronJobId?: string } | undefined;
  return Boolean(extra?.cronJobId);
};

export const getConversationPinnedAt = (conversation: TChatConversation): number => {
  const extra = conversation.extra as { pinnedAt?: number } | undefined;
  if (typeof extra?.pinnedAt === 'number') {
    return extra.pinnedAt;
  }
  return 0;
};

export const groupConversationsByWorkspace = (
  conversations: TChatConversation[],
  t: (key: string) => string
): TimelineSection[] => {
  const allWorkspaceGroups = new Map<string, TChatConversation[]>();
  const withoutWorkspaceConvs: TChatConversation[] = [];

  conversations.forEach((conv) => {
    const workspace = conv.extra?.workspace;
    const customWorkspace = conv.extra?.customWorkspace;

    if (customWorkspace && workspace) {
      if (!allWorkspaceGroups.has(workspace)) {
        allWorkspaceGroups.set(workspace, []);
      }
      allWorkspaceGroups.get(workspace)!.push(conv);
    } else {
      withoutWorkspaceConvs.push(conv);
    }
  });

  const items: TimelineItem[] = [];

  allWorkspaceGroups.forEach((convList, workspace) => {
    const sortedConvs = [...convList].toSorted((a, b) => getActivityTime(b) - getActivityTime(a));
    const updateTime = getWorkspaceUpdateTime(workspace);
    const time = updateTime > 0 ? updateTime : getActivityTime(sortedConvs[0]);
    items.push({
      type: 'workspace',
      time,
      workspaceGroup: {
        workspace,
        displayName: getWorkspaceDisplayName(workspace),
        conversations: sortedConvs,
      },
    });
  });

  withoutWorkspaceConvs.forEach((conv) => {
    items.push({
      type: 'conversation',
      time: getActivityTime(conv),
      conversation: conv,
    });
  });

  items.sort((a, b) => b.time - a.time);

  if (items.length === 0) return [];

  return [
    {
      timeline: t('conversation.history.recents'),
      items,
    },
  ];
};

/** Check whether a conversation belongs to a team (should be hidden from sidebar). */
const isTeamConversation = (conversation: TChatConversation): boolean => {
  const extra = conversation.extra as { teamId?: string } | undefined;
  return Boolean(extra?.teamId);
};

export const buildGroupedHistory = (
  conversations: TChatConversation[],
  t: (key: string) => string
): GroupedHistoryResult => {
  // Filter out team-owned conversations; they are only visible via the Teams panel
  const visibleConversations = conversations.filter((conv) => !isTeamConversation(conv));

  const pinnedConversations = visibleConversations
    .filter((conversation) => isConversationPinned(conversation))
    .toSorted((a, b) => {
      const orderA = getConversationSortOrder(a);
      const orderB = getConversationSortOrder(b);
      if (orderA !== undefined && orderB !== undefined) return orderA - orderB;
      if (orderA !== undefined) return -1;
      if (orderB !== undefined) return 1;
      return getConversationPinnedAt(b) - getConversationPinnedAt(a);
    });

  const normalConversations = visibleConversations.filter(
    (conversation) => !isConversationPinned(conversation) && !isCronJobConversation(conversation)
  );

  return {
    pinnedConversations,
    timelineSections: groupConversationsByWorkspace(normalConversations, t),
  };
};
