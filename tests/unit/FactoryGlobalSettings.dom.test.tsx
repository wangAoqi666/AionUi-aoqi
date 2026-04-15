import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockGetFactoryGlobalPaths = vi.fn();
const mockListFactoryRuleFiles = vi.fn();
const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    fs: {
      getFactoryGlobalPaths: { invoke: (...args: unknown[]) => mockGetFactoryGlobalPaths(...args) },
      listFactoryRuleFiles: { invoke: (...args: unknown[]) => mockListFactoryRuleFiles(...args) },
      readFile: { invoke: (...args: unknown[]) => mockReadFile(...args) },
      writeFile: { invoke: (...args: unknown[]) => mockWriteFile(...args) },
    },
  },
}));

vi.mock('@/renderer/pages/settings/components/SettingsPageWrapper', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid='settings-page-wrapper'>{children}</div>,
}));

vi.mock('@icon-park/react', () => ({
  FileText: () => <span data-testid='icon-file-text' />,
  Info: () => <span data-testid='icon-info' />,
  Plus: () => <span data-testid='icon-plus' />,
  Refresh: () => <span data-testid='icon-refresh' />,
  Write: () => <span data-testid='icon-write' />,
}));

vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return {
    ...actual,
    Message: {
      useMessage: () => [
        {
          error: vi.fn(),
          success: vi.fn(),
          warning: vi.fn(),
        },
        <div key='message-context' data-testid='message-context' />,
      ],
    },
  };
});

import FactoryGlobalSettings from '@/renderer/pages/settings/FactoryGlobalSettings';

const defaultPaths = {
  platform: 'darwin',
  factoryRootDir: '/Users/test/.factory',
  skillsDir: '/Users/test/.factory/skills',
  rulesDir: '/Users/test/.factory/rules',
  memoriesFile: '/Users/test/.factory/memories.md',
  agentsFile: '/Users/test/.factory/AGENTS.md',
};

const renderPage = (entry: string) => {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <FactoryGlobalSettings />
    </MemoryRouter>
  );
};

describe('FactoryGlobalSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetFactoryGlobalPaths.mockResolvedValue(defaultPaths);
    mockListFactoryRuleFiles.mockResolvedValue([]);
    mockReadFile.mockResolvedValue('');
    mockWriteFile.mockResolvedValue(undefined);
  });

  it('loads AGENTS.md once even when the translation function identity changes each render', async () => {
    mockReadFile.mockResolvedValue('# global agents');

    renderPage('/settings/agents-md');

    await waitFor(() => {
      expect(mockGetFactoryGlobalPaths).toHaveBeenCalledTimes(1);
      expect(mockReadFile).toHaveBeenCalledTimes(1);
    });

    expect(mockReadFile).toHaveBeenCalledWith({ path: defaultPaths.agentsFile });
    expect(screen.getByTestId('factory-global-info-trigger')).toBeInTheDocument();
    expect(screen.getByDisplayValue('# global agents')).toBeInTheDocument();
  });

  it('loads the first rules file once without getting stuck in a loading loop', async () => {
    mockListFactoryRuleFiles.mockResolvedValue([
      {
        name: 'project.md',
        path: '/Users/test/.factory/rules/project.md',
      },
    ]);
    mockReadFile.mockResolvedValue('# project rules');

    renderPage('/settings/rules');

    await waitFor(() => {
      expect(mockGetFactoryGlobalPaths).toHaveBeenCalledTimes(1);
      expect(mockListFactoryRuleFiles).toHaveBeenCalledTimes(1);
      expect(mockReadFile).toHaveBeenCalledTimes(1);
    });

    expect(mockReadFile).toHaveBeenCalledWith({ path: '/Users/test/.factory/rules/project.md' });
    expect(screen.getByTestId('factory-global-info-trigger')).toBeInTheDocument();
    expect(screen.getByText('project.md')).toBeInTheDocument();
    expect(screen.getByDisplayValue('# project rules')).toBeInTheDocument();
  });
});
