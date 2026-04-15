/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

export const SELECTED_AGENT_SPACE_KEY = 'conversation-selected-agent-space';
const FOLDER_AGENT_SPACE_PREFIX = 'folder:';

type StorageLike = Pick<Storage, 'getItem'>;

export function extractSelectedSpaceWorkspace(selectedSpaceId?: string | null): string | null {
  if (!selectedSpaceId?.startsWith(FOLDER_AGENT_SPACE_PREFIX)) {
    return null;
  }

  const workspace = selectedSpaceId.slice(FOLDER_AGENT_SPACE_PREFIX.length).trim();
  return workspace || null;
}

export function getSelectedSpaceWorkspace(storage?: StorageLike): string | null {
  if (typeof window === 'undefined' && !storage) {
    return null;
  }

  try {
    const nextStorage = storage || globalThis.localStorage;
    return extractSelectedSpaceWorkspace(nextStorage?.getItem(SELECTED_AGENT_SPACE_KEY));
  } catch {
    return null;
  }
}

export function getSelectedSpaceGuidState(storage?: StorageLike): { workspace: string } | undefined {
  const workspace = getSelectedSpaceWorkspace(storage);
  return workspace ? { workspace } : undefined;
}
