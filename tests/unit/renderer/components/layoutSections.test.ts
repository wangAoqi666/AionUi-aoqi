import { describe, expect, it } from 'vitest';
import {
  getDefaultLayoutSectionRoute,
  matchLayoutSectionByPath,
  resolveLayoutSectionByPath,
} from '@/renderer/components/layout/layoutSections';

describe('layout section routing', () => {
  it('matches the expected section for known routes', () => {
    expect(matchLayoutSectionByPath('/guid')).toBe('conversation');
    expect(matchLayoutSectionByPath('/conversation/conv-1')).toBe('conversation');
    expect(matchLayoutSectionByPath('/team/team-1')).toBe('conversation');
    expect(matchLayoutSectionByPath('/scheduled/job-1')).toBe('tasks');
    expect(matchLayoutSectionByPath('/settings/about')).toBe('settings');
  });

  it('falls back to the conversation section for unknown routes', () => {
    expect(matchLayoutSectionByPath('/test/components')).toBeNull();
    expect(resolveLayoutSectionByPath('/test/components')).toBe('conversation');
  });

  it('exposes stable default routes for each section', () => {
    expect(getDefaultLayoutSectionRoute('conversation')).toBe('/guid');
    expect(getDefaultLayoutSectionRoute('tasks')).toBe('/scheduled');
    expect(getDefaultLayoutSectionRoute('settings')).toBe('/settings/model');
  });
});
