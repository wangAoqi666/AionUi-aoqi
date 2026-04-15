import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/common/platform', () => ({
  getPlatformServices: () => ({ paths: { isPackaged: () => false } }),
}));

describe('common/appEnv', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('appends -dev suffix in dev builds', async () => {
    const { getEnvAwareName } = await import('../../../src/common/config/appEnv');
    expect(getEnvAwareName('.agent-factory')).toBe('.agent-factory-dev');
    expect(getEnvAwareName('.agent-factory-config')).toBe('.agent-factory-config-dev');
  });

  it('returns baseName unchanged in release builds', async () => {
    vi.doMock('@/common/platform', () => ({
      getPlatformServices: () => ({ paths: { isPackaged: () => true } }),
    }));
    const { getEnvAwareName } = await import('../../../src/common/config/appEnv');
    expect(getEnvAwareName('.agent-factory')).toBe('.agent-factory');
    expect(getEnvAwareName('.agent-factory-config')).toBe('.agent-factory-config');
  });

  it('normalizes legacy system paths to agent-factory names', async () => {
    const { normalizeLegacySystemPath } = await import('../../../src/common/config/appPathConfig');

    expect(normalizeLegacySystemPath('/Users/test/.aionui-config-dev')).toBe('/Users/test/.agent-factory-config-dev');
    expect(normalizeLegacySystemPath('/Users/test/.aionui-dev')).toBe('/Users/test/.agent-factory-dev');
    expect(normalizeLegacySystemPath('/Users/test/Library/Logs/AionUi')).toBe('/Users/test/Library/Logs/agent-factory');
  });
});
