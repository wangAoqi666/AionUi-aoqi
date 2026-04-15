import path from 'path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const platformServicesMock = vi.fn(() => ({
  paths: {
    getVersion: () => '0.1.0',
    isPackaged: () => false,
  },
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    application: {
      getVersion: { provider: vi.fn() },
      systemInfo: { provider: vi.fn() },
      updateSystemInfo: { provider: vi.fn() },
      getPath: { provider: vi.fn() },
      restart: { provider: vi.fn() },
      openDevTools: { provider: vi.fn() },
      isDevToolsOpened: { provider: vi.fn() },
      getZoomFactor: { provider: vi.fn() },
      setZoomFactor: { provider: vi.fn() },
      getCdpStatus: { provider: vi.fn() },
      updateCdpConfig: { provider: vi.fn() },
      logStream: { emit: vi.fn() },
      devToolsStateChanged: { emit: vi.fn() },
    },
  },
}));

vi.mock('@/common/platform', () => ({
  getPlatformServices: platformServicesMock,
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock('@process/utils/initStorage', () => ({
  getSystemDir: () => ({
    cacheDir: '/mock/cache',
    workDir: '/mock/work',
    logDir: '/mock/logs',
    platform: 'linux',
    arch: 'x64',
  }),
  ProcessEnv: { set: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('@process/utils', () => ({
  copyDirectoryRecursively: vi.fn().mockResolvedValue(undefined),
}));

describe('initApplicationBridgeCore', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    platformServicesMock.mockReturnValue({
      paths: {
        getVersion: () => '0.1.0',
        isPackaged: () => false,
      },
    });
  });

  it('imports without requiring electron', async () => {
    const mod = await import('@process/bridge/applicationBridgeCore');
    expect(mod.initApplicationBridgeCore).toBeTypeOf('function');
  });

  it('registers app version and system providers', async () => {
    const { ipcBridge } = await import('@/common');
    const { initApplicationBridgeCore } = await import('@process/bridge/applicationBridgeCore');
    initApplicationBridgeCore();
    expect(ipcBridge.application.getVersion.provider).toHaveBeenCalledOnce();
    expect(ipcBridge.application.systemInfo.provider).toHaveBeenCalledOnce();
    expect(ipcBridge.application.updateSystemInfo.provider).toHaveBeenCalledOnce();
  });

  it('prefers the bundled host app version in dev mode when available on PATH', async () => {
    const { existsSync, readFileSync } = await import('fs');
    const { getBundledHostAppVersion, getApplicationDisplayVersion } =
      await import('@process/bridge/applicationBridgeCore');

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      `<?xml version="1.0" encoding="UTF-8"?><plist><dict><key>CFBundleShortVersionString</key><string>0.1.0</string></dict></plist>`
    );

    const pathEnv = `/Applications/智能体工厂.app/Contents/Resources/bundled-bun/darwin-arm64${path.delimiter}/usr/bin`;

    expect(getBundledHostAppVersion(pathEnv, 'darwin')).toBe('0.1.0');

    const originalPath = process.env.PATH;
    process.env.PATH = pathEnv;
    try {
      expect(getApplicationDisplayVersion()).toBe('0.1.0');
    } finally {
      process.env.PATH = originalPath;
    }
  });
});
