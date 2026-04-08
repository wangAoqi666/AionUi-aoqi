// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import { readSectionRouteMemory } from '@/renderer/hooks/ui/useSectionRouteMemory';

describe('readSectionRouteMemory', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('upgrades the legacy settings default route to the model page', () => {
    window.sessionStorage.setItem(
      'aion:layout-section-routes',
      JSON.stringify({
        conversation: '/guid',
        tasks: '/scheduled',
        settings: '/settings/agent',
      })
    );

    expect(readSectionRouteMemory()).toEqual({
      conversation: '/guid',
      tasks: '/scheduled',
      settings: '/settings/model',
    });
  });
});
