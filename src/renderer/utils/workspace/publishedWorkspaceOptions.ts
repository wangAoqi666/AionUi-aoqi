/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import { buildAgentSpaces } from '@/renderer/pages/conversation/GroupedHistory/utils/groupingHelpers';
import { getSelectedSpaceWorkspace } from './selectedSpace';

const OPENED_FOLDER_SPACES_KEY = 'conversation-opened-folder-spaces';
const AGENT_SPACE_DISPLAY_NAMES_KEY = 'conversation-agent-space-display-names';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export type PublishedWorkspaceOption = {
  path: string;
  displayName: string;
  lastActiveAt: number;
};

const getStorage = (storage?: StorageLike): StorageLike | undefined => {
  if (storage) {
    return storage;
  }

  if (typeof window === 'undefined') {
    return undefined;
  }

  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
};

const normalizeWorkspacePaths = (paths: string[]): string[] => {
  const seen = new Set<string>();

  return paths.flatMap((workspace) => {
    const normalized = workspace.trim();
    if (!normalized || seen.has(normalized)) {
      return [];
    }

    seen.add(normalized);
    return [normalized];
  });
};

const parseJson = <T>(raw: string | null, fallback: T): T => {
  if (!raw) {
    return fallback;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const loadOpenedFolderSpaces = (storage?: StorageLike): string[] => {
  const nextStorage = getStorage(storage);
  if (!nextStorage) {
    return [];
  }

  const parsed = parseJson<unknown[]>(nextStorage.getItem(OPENED_FOLDER_SPACES_KEY), []);
  return normalizeWorkspacePaths(parsed.filter((workspace): workspace is string => typeof workspace === 'string'));
};

const loadAgentSpaceDisplayNames = (storage?: StorageLike): Record<string, string> => {
  const nextStorage = getStorage(storage);
  if (!nextStorage) {
    return {};
  }

  const parsed = parseJson<Record<string, unknown>>(nextStorage.getItem(AGENT_SPACE_DISPLAY_NAMES_KEY), {});
  return Object.fromEntries(
    Object.entries(parsed).flatMap(([workspace, displayName]) => {
      if (typeof displayName !== 'string' || !displayName.trim()) {
        return [];
      }

      return [[workspace, displayName] as const];
    })
  );
};

export const rememberPublishedWorkspace = (workspace: string, storage?: StorageLike): void => {
  const nextStorage = getStorage(storage);
  const normalized = workspace.trim();

  if (!nextStorage || !normalized) {
    return;
  }

  const nextPaths = normalizeWorkspacePaths([normalized, ...loadOpenedFolderSpaces(nextStorage)]);
  nextStorage.setItem(OPENED_FOLDER_SPACES_KEY, JSON.stringify(nextPaths));
};

export const buildPublishedWorkspaceOptions = (
  conversations: TChatConversation[] = [],
  t?: (key: string) => string,
  options: {
    storage?: StorageLike;
    includePaths?: string[];
  } = {}
): PublishedWorkspaceOption[] => {
  const openedFolderSpaces = loadOpenedFolderSpaces(options.storage);
  const selectedWorkspace = getSelectedSpaceWorkspace(options.storage);
  const explicitWorkspacePaths = normalizeWorkspacePaths([
    ...openedFolderSpaces,
    ...(selectedWorkspace ? [selectedWorkspace] : []),
    ...(options.includePaths ?? []),
  ]);
  const displayNameOverrides = loadAgentSpaceDisplayNames(options.storage);

  return buildAgentSpaces(conversations, explicitWorkspacePaths, t, displayNameOverrides)
    .filter((space): space is typeof space & { workspacePath: string } => {
      return space.type === 'folder' && typeof space.workspacePath === 'string';
    })
    .map((space) => ({
      path: space.workspacePath,
      displayName: space.displayName,
      lastActiveAt: space.lastActiveAt,
    }));
};
