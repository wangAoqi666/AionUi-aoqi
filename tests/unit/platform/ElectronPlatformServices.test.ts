import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetPath = vi.fn();
const mockGetAppPath = vi.fn().mockReturnValue('/app/path');

vi.mock('electron', () => ({
  app: {
    getPath: (...args: unknown[]) => mockGetPath(...args),
    getAppPath: () => mockGetAppPath(),
    isPackaged: false,
    getName: () => 'AionUi',
    getVersion: () => '1.0.0',
  },
  Notification: vi.fn(),
  powerSaveBlocker: { start: vi.fn(), stop: vi.fn() },
  utilityProcess: { fork: vi.fn() },
}));

describe('ElectronPlatformServices.paths.getLogsDir', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('derives the log directory from the home path in dev mode', async () => {
    mockGetPath.mockImplementation((name: string) => {
      if (name === 'home') return '/Users/test';
      return `/mock/${name}`;
    });

    const { getDefaultLogDir } = await import('../../../src/common/config/appPathConfig');
    const { ElectronPlatformServices } = await import('../../../src/common/platform/ElectronPlatformServices');
    const svc = new ElectronPlatformServices();
    expect(svc.paths.getLogsDir()).toBe(getDefaultLogDir('/Users/test', false));
  });

  it('does not depend on app.getPath("logs") to resolve the directory', async () => {
    mockGetPath.mockImplementation((name: string) => {
      if (name === 'logs') throw new Error("Failed to get 'logs' path");
      if (name === 'home') return '/Users/test';
      return `/mock/${name}`;
    });

    vi.resetModules();
    const { getDefaultLogDir } = await import('../../../src/common/config/appPathConfig');
    const { ElectronPlatformServices } = await import('../../../src/common/platform/ElectronPlatformServices');
    const svc = new ElectronPlatformServices();
    expect(svc.paths.getLogsDir()).toBe(getDefaultLogDir('/Users/test', false));
  });
});
