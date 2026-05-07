import { describe, it, expect } from 'vitest';
import { getBuiltinSettingsNavItems } from '@/renderer/pages/settings/components/SettingsPageWrapper';

const t = (key: string, options?: { defaultValue?: string }) => {
  const labels: Record<string, string> = {
    'settings.gemini': 'Gemini',
    'settings.model': 'Models',
    'settings.assistants': 'Assistants',
    'settings.agents': 'Agents',
    'settings.skillsHub.title': 'Skills Hub',
    'settings.mcp': 'MCP',
    'settings.rules': 'Rules',
    'settings.memory': 'Memory',
    'settings.agentsMd': 'AGENTS.md',
    'settings.tools': 'Tools',
    'settings.display': 'Display',
    'settings.webui': 'WebUI',
    'settings.system': 'System',
    'settings.about': 'About',
  };

  return labels[key] ?? options?.defaultValue ?? key;
};

describe('getBuiltinSettingsNavItems', () => {
  it('returns mobile settings tabs in the same order as desktop sider (tools hidden)', () => {
    const items = getBuiltinSettingsNavItems(false, t);

    expect(items.map((item) => item.id)).toEqual([
      'agent',
      'model',
      'assistants',
      'skills-hub',
      'mcp',
      'rules',
      'memory',
      'agents-md',
      'display',
      'webui',
      'system',
      'about',
    ]);

    expect(items.map((item) => item.label)).toEqual([
      'Agents',
      'Models',
      'Assistants',
      'Skills Hub',
      'MCP',
      'Rules',
      'Memory',
      'AGENTS.md',
      'Display',
      'WebUI',
      'System',
      'About',
    ]);
  });

  it('keeps the webui route stable for mobile and desktop nav variants', () => {
    expect(getBuiltinSettingsNavItems(false, t).find((item) => item.id === 'webui')?.path).toBe('webui');
    expect(getBuiltinSettingsNavItems(true, t).find((item) => item.id === 'webui')?.path).toBe('webui');
  });
});
