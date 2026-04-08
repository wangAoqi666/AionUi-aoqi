/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import {
  getDefaultLayoutSectionRoute,
  isNonSettingsSection,
  matchLayoutSectionByPath,
  type LayoutSection,
  type NonSettingsLayoutSection,
} from '@renderer/components/layout/layoutSections';

const SECTION_ROUTE_MEMORY_STORAGE_KEY = 'aion:layout-section-routes';
const LAST_NON_SETTINGS_SECTION_STORAGE_KEY = 'aion:layout-last-non-settings-section';

type SectionRouteMemory = Record<LayoutSection, string>;

const buildDefaultRouteMemory = (): SectionRouteMemory => ({
  conversation: getDefaultLayoutSectionRoute('conversation'),
  tasks: getDefaultLayoutSectionRoute('tasks'),
  settings: getDefaultLayoutSectionRoute('settings'),
});

export const readSectionRouteMemory = (): SectionRouteMemory => {
  if (typeof window === 'undefined') {
    return buildDefaultRouteMemory();
  }

  try {
    const raw = window.sessionStorage.getItem(SECTION_ROUTE_MEMORY_STORAGE_KEY);
    if (!raw) {
      return buildDefaultRouteMemory();
    }

    const parsed = JSON.parse(raw) as Partial<SectionRouteMemory>;
    const nextSettingsRoute =
      parsed.settings === '/settings/agent' ? getDefaultLayoutSectionRoute('settings') : parsed.settings;
    return {
      ...buildDefaultRouteMemory(),
      ...parsed,
      ...(nextSettingsRoute ? { settings: nextSettingsRoute } : {}),
    };
  } catch {
    return buildDefaultRouteMemory();
  }
};

const writeSectionRouteMemory = (memory: SectionRouteMemory): void => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.sessionStorage.setItem(SECTION_ROUTE_MEMORY_STORAGE_KEY, JSON.stringify(memory));
  } catch {
    // ignore storage write failures
  }
};

const readLastNonSettingsSection = (): NonSettingsLayoutSection => {
  if (typeof window === 'undefined') {
    return 'conversation';
  }

  try {
    const raw = window.sessionStorage.getItem(LAST_NON_SETTINGS_SECTION_STORAGE_KEY);
    return raw === 'tasks' ? 'tasks' : 'conversation';
  } catch {
    return 'conversation';
  }
};

const writeLastNonSettingsSection = (section: NonSettingsLayoutSection): void => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.sessionStorage.setItem(LAST_NON_SETTINGS_SECTION_STORAGE_KEY, section);
  } catch {
    // ignore storage write failures
  }
};

type UseSectionRouteMemoryParams = {
  pathname: string;
  search: string;
  hash: string;
};

type UseSectionRouteMemoryResult = {
  routeMemory: SectionRouteMemory;
  lastNonSettingsSection: NonSettingsLayoutSection;
  getRouteForSection: (section: LayoutSection) => string;
};

export const useSectionRouteMemory = ({
  pathname,
  search,
  hash,
}: UseSectionRouteMemoryParams): UseSectionRouteMemoryResult => {
  const [routeMemory, setRouteMemory] = useState<SectionRouteMemory>(readSectionRouteMemory);
  const [lastNonSettingsSection, setLastNonSettingsSection] =
    useState<NonSettingsLayoutSection>(readLastNonSettingsSection);

  useEffect(() => {
    const matchedSection = matchLayoutSectionByPath(pathname);
    if (!matchedSection) {
      return;
    }

    const nextRoute = `${pathname}${search}${hash}`;

    setRouteMemory((previous) => {
      if (previous[matchedSection] === nextRoute) {
        return previous;
      }

      const nextMemory = {
        ...previous,
        [matchedSection]: nextRoute,
      };

      writeSectionRouteMemory(nextMemory);
      return nextMemory;
    });

    if (isNonSettingsSection(matchedSection) && matchedSection !== lastNonSettingsSection) {
      setLastNonSettingsSection(matchedSection);
      writeLastNonSettingsSection(matchedSection);
    }
  }, [hash, lastNonSettingsSection, pathname, search]);

  const getRouteForSection = useCallback(
    (section: LayoutSection): string => routeMemory[section] || getDefaultLayoutSectionRoute(section),
    [routeMemory]
  );

  return {
    routeMemory,
    lastNonSettingsSection,
    getRouteForSection,
  };
};
