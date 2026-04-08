/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

export type LayoutSection = 'conversation' | 'tasks' | 'settings';

export type NonSettingsLayoutSection = Exclude<LayoutSection, 'settings'>;

export const PRIMARY_RAIL_WIDTH = 64;
export const DESKTOP_SECTION_PANEL_WIDTH = 272;
export const DESKTOP_NAVIGATION_WIDTH = PRIMARY_RAIL_WIDTH + DESKTOP_SECTION_PANEL_WIDTH;

const SECTION_DEFAULT_ROUTES: Record<LayoutSection, string> = {
  conversation: '/guid',
  tasks: '/scheduled',
  settings: '/settings/model',
};

export const matchLayoutSectionByPath = (pathname: string): LayoutSection | null => {
  if (pathname === '/guid' || pathname.startsWith('/conversation/') || pathname.startsWith('/team/')) {
    return 'conversation';
  }
  if (pathname === '/scheduled' || pathname.startsWith('/scheduled/')) {
    return 'tasks';
  }
  if (pathname.startsWith('/settings')) {
    return 'settings';
  }
  return null;
};

export const resolveLayoutSectionByPath = (pathname: string): LayoutSection =>
  matchLayoutSectionByPath(pathname) ?? 'conversation';

export const getDefaultLayoutSectionRoute = (section: LayoutSection): string => SECTION_DEFAULT_ROUTES[section];

export const isNonSettingsSection = (section: LayoutSection): section is NonSettingsLayoutSection =>
  section !== 'settings';
