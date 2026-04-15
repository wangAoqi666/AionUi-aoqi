import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const tMock = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: tMock,
  }),
}));

vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return {
    ...actual,
    Message: {
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
      loading: vi.fn(() => vi.fn()),
    },
    Modal: {
      confirm: vi.fn(),
    },
  };
});

vi.mock('@icon-park/react', () => ({
  Delete: () => <span data-testid='icon-delete' />,
  FolderOpen: () => <span data-testid='icon-folder' />,
  Info: () => <span data-testid='icon-info' />,
  Refresh: () => <span data-testid='icon-refresh' />,
  Search: () => <span data-testid='icon-search' />,
}));

const mockListAvailableSkills = vi.fn();
const mockGetSkillPaths = vi.fn();
const mockImportSkillWithSymlink = vi.fn();
const mockDeleteSkill = vi.fn();
const mockScanForSkills = vi.fn();
const mockShowOpen = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: {
    fs: {
      listAvailableSkills: { invoke: (...args: unknown[]) => mockListAvailableSkills(...args) },
      getSkillPaths: { invoke: (...args: unknown[]) => mockGetSkillPaths(...args) },
      importSkillWithSymlink: { invoke: (...args: unknown[]) => mockImportSkillWithSymlink(...args) },
      deleteSkill: { invoke: (...args: unknown[]) => mockDeleteSkill(...args) },
      scanForSkills: { invoke: (...args: unknown[]) => mockScanForSkills(...args) },
    },
    dialog: {
      showOpen: { invoke: (...args: unknown[]) => mockShowOpen(...args) },
    },
  },
}));

vi.mock('@/renderer/pages/settings/components/SettingsPageWrapper', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid='settings-page-wrapper'>{children}</div>,
}));

import SkillsHubSettings from '@/renderer/pages/settings/SkillsHubSettings';

describe('SkillsHubSettings Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockListAvailableSkills.mockResolvedValue([
      { name: 'MySkill1', description: 'desc1', location: '/path1', isCustom: true },
      { name: 'Builtin1', description: 'desc2', location: '/path2', isCustom: false },
    ]);
    mockGetSkillPaths.mockResolvedValue({
      userSkillsDir: '/user/.factory/skills',
      builtinSkillsDir: '/builtin/skills',
    });
    mockShowOpen.mockResolvedValue([]);
    mockScanForSkills.mockResolvedValue({
      success: true,
      data: [],
    });
  });

  it('renders the global skills sections and filters out builtin skills', async () => {
    render(<SkillsHubSettings />);

    await waitFor(() => {
      expect(mockListAvailableSkills).toHaveBeenCalled();
      expect(mockGetSkillPaths).toHaveBeenCalled();
    });

    expect(screen.getByText('Skills Hub')).toBeInTheDocument();
    expect(screen.getByText('My Skills')).toBeInTheDocument();
    expect(screen.getByTestId('skills-hub-info-trigger')).toBeInTheDocument();
    expect(screen.getByText('MySkill1')).toBeInTheDocument();
    expect(screen.queryByText('Builtin1')).not.toBeInTheDocument();
  });

  it('filters custom skills by search query', async () => {
    mockListAvailableSkills.mockResolvedValue([
      { name: 'MySkill1', description: 'desc1', location: '/path1', isCustom: true },
      { name: 'OtherSkill', description: 'desc2', location: '/path2', isCustom: true },
    ]);

    render(<SkillsHubSettings />);

    await waitFor(() => {
      expect(screen.getByText('MySkill1')).toBeInTheDocument();
      expect(screen.getByText('OtherSkill')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText('Search skills...'), {
      target: { value: 'other' },
    });

    await waitFor(() => {
      expect(screen.queryByText('MySkill1')).not.toBeInTheDocument();
      expect(screen.getByText('OtherSkill')).toBeInTheDocument();
    });
  });

  it('imports a single discovered skill from the selected folder', async () => {
    mockShowOpen.mockResolvedValue(['/tmp/skills']);
    mockScanForSkills.mockResolvedValue({
      success: true,
      data: [{ name: 'ImportedSkill', path: '/tmp/skills/ImportedSkill' }],
    });
    mockImportSkillWithSymlink.mockResolvedValue({ success: true });

    render(<SkillsHubSettings />);

    fireEvent.click(screen.getByText('Import from Folder'));

    await waitFor(() => {
      expect(mockShowOpen).toHaveBeenCalled();
      expect(mockScanForSkills).toHaveBeenCalledWith({ folderPath: '/tmp/skills' });
      expect(mockImportSkillWithSymlink).toHaveBeenCalledWith({ skillPath: '/tmp/skills/ImportedSkill' });
    });
  });

  it('calls deleteSkill when confirming deletion of a custom skill', async () => {
    mockListAvailableSkills.mockResolvedValueOnce([
      { name: 'MySkill1', description: 'desc1', location: '/path1', isCustom: true },
    ]);
    mockListAvailableSkills.mockResolvedValueOnce([]);
    mockDeleteSkill.mockResolvedValue({ success: true });

    const { Modal } = await import('@arco-design/web-react');

    render(<SkillsHubSettings />);

    await waitFor(() => {
      expect(screen.getByText('MySkill1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Delete'));

    await waitFor(() => {
      expect(Modal.confirm).toHaveBeenCalled();
    });

    const [options] = vi.mocked(Modal.confirm).mock.calls[0] as Array<
      [{ onOk?: () => Promise<void> | void; title?: string; content?: string }]
    >;
    await act(async () => {
      await options.onOk?.();
    });

    await waitFor(() => {
      expect(mockDeleteSkill).toHaveBeenCalledWith({ skillName: 'MySkill1' });
    });
  });

  it('renders the empty state when no custom skills exist', async () => {
    mockListAvailableSkills.mockResolvedValue([]);

    render(<SkillsHubSettings />);

    await waitFor(() => {
      expect(
        screen.getByText('No global skills found. Import a folder to create your first official ~/.factory skill.')
      ).toBeInTheDocument();
    });
  });

  it('renders the compact path guidance trigger', async () => {
    render(<SkillsHubSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('skills-hub-info-trigger')).toBeInTheDocument();
    });
  });
});
