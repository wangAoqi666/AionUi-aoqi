/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import type { LayoutSection, NonSettingsLayoutSection } from '@renderer/components/layout/layoutSections';

export interface LayoutContextValue {
  isMobile: boolean;
  siderCollapsed: boolean;
  setSiderCollapsed: (value: boolean) => void;
  activeSection: LayoutSection;
  lastNonSettingsSection: NonSettingsLayoutSection;
  getSectionRoute: (section: LayoutSection) => string;
  navigateToSection: (section: LayoutSection) => void;
}

export const LayoutContext = React.createContext<LayoutContextValue | null>(null);

export function useLayoutContext(): LayoutContextValue | null {
  return React.useContext(LayoutContext);
}
