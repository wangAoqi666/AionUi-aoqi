import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: vi.fn(() => '/tmp') } }));

const refreshFactoryDroidCatalogMock = vi.hoisted(() => vi.fn(async () => []));
const processConfigGetMock = vi.hoisted(() => vi.fn(async () => undefined));
const probeDroidStatusMock = vi.hoisted(() =>
  vi.fn(async () => ({
    available: true,
    loginStatus: 'authenticated',
    cliSource: 'bundled',
    cliPath: '/usr/local/bin/droid',
    cliVersion: 'droid 0.1.4',
    sdkVersion: '0.1.4',
    protocolVersion: '1.2.0',
    modelCount: 21,
  }))
);
const checkDroidCliUpdateMock = vi.hoisted(() =>
  vi.fn(async () => ({
    currentVersion: '0.99.0',
    latestVersion: '0.99.0',
    updateAvailable: false,
    source: 'bundled',
    registry: 'https://registry.npmmirror.com',
  }))
);
const getFactoryModelsMock = vi.hoisted(() => vi.fn(() => []));
const getDroidByokConfigsMock = vi.hoisted(() => vi.fn(async () => []));
const testDroidByokConfigMock = vi.hoisted(() => vi.fn(async () => null));
const saveDroidByokConfigMock = vi.hoisted(() => vi.fn(async () => null));
const removeDroidByokConfigMock = vi.hoisted(() => vi.fn(async () => undefined));

const handlers: Record<string, (...args: any[]) => any> = {};
function makeChannel(name: string) {
  return {
    provider: vi.fn((fn: (...args: any[]) => any) => {
      handlers[name] = fn;
    }),
    emit: vi.fn(),
    invoke: vi.fn(),
  };
}

vi.mock('../../src/common', () => ({
  ipcBridge: {
    acpConversation: {
      checkEnv: makeChannel('checkEnv'),
      detectCliPath: makeChannel('detectCliPath'),
      getAvailableAgents: makeChannel('getAvailableAgents'),
      refreshCustomAgents: makeChannel('refreshCustomAgents'),
      testCustomAgent: makeChannel('testCustomAgent'),
      checkAgentHealth: makeChannel('checkAgentHealth'),
      getMode: makeChannel('getMode'),
      getModelInfo: makeChannel('getModelInfo'),
      getDroidModelCatalog: makeChannel('getDroidModelCatalog'),
      getDroidStatus: makeChannel('getDroidStatus'),
      checkDroidCliUpdate: makeChannel('checkDroidCliUpdate'),
      getDroidByokConfig: makeChannel('getDroidByokConfig'),
      testDroidByokConfig: makeChannel('testDroidByokConfig'),
      saveDroidByokConfig: makeChannel('saveDroidByokConfig'),
      removeDroidByokConfig: makeChannel('removeDroidByokConfig'),
      probeModelInfo: makeChannel('probeModelInfo'),
      setModel: makeChannel('setModel'),
      setMode: makeChannel('setMode'),
      getConfigOptions: makeChannel('getConfigOptions'),
      setConfigOption: makeChannel('setConfigOption'),
    },
  },
}));

vi.mock('../../src/process/agent/acp/AcpDetector', () => ({
  acpDetector: { getDetectedAgents: vi.fn(() => []), refreshCustomAgents: vi.fn(async () => {}) },
}));

vi.mock('../../src/process/agent/acp/AcpConnection', () => ({
  AcpConnection: vi.fn(() => ({
    connect: vi.fn(async () => {}),
    newSession: vi.fn(async () => {}),
    sendPrompt: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    getConfigOptions: vi.fn(() => []),
    getModels: vi.fn(() => []),
    getInitializeResponse: vi.fn(() => null),
  })),
}));

vi.mock('../../src/process/agent/acp/modelInfo', () => ({
  buildAcpModelInfo: vi.fn(() => ({})),
  summarizeAcpModelInfo: vi.fn(() => ({})),
}));

vi.mock('../../src/process/task/AcpAgentManager', () => ({ default: class AcpAgentManager {} }));
vi.mock('../../src/process/task/GeminiAgentManager', () => ({ GeminiAgentManager: class GeminiAgentManager {} }));

vi.mock('../../src/process/services/mcpServices/McpService', () => ({
  mcpService: { getSupportedTransportsForAgent: vi.fn(() => []) },
}));

vi.mock('../../src/process/agent/aionrs/binaryResolver', () => ({
  detectAionrs: vi.fn(() => ({ available: false, path: null })),
}));

vi.mock('../../src/process/utils/mainLogger', () => ({
  mainLog: vi.fn(),
  mainWarn: vi.fn(),
}));

vi.mock('../../src/process/utils/initStorage', () => ({
  refreshFactoryDroidCatalog: refreshFactoryDroidCatalogMock,
  ProcessConfig: {
    get: processConfigGetMock,
  },
}));

vi.mock('../../src/process/agent/droid/modelProbe', () => ({
  checkDroidCliUpdate: checkDroidCliUpdateMock,
  probeDroidStatus: probeDroidStatusMock,
}));

vi.mock('../../src/process/bridge/services/DroidByokService', () => ({
  getDroidByokConfigs: getDroidByokConfigsMock,
  testDroidByokConfig: testDroidByokConfigMock,
  saveDroidByokConfig: saveDroidByokConfigMock,
  removeDroidByokConfig: removeDroidByokConfigMock,
}));

vi.mock('../../src/common/config/factoryModels', () => ({
  getFactoryModels: getFactoryModelsMock,
}));

import { initAcpConversationBridge } from '../../src/process/bridge/acpConversationBridge';
import type { IWorkerTaskManager } from '../../src/process/task/IWorkerTaskManager';

function makeTaskManager(overrides?: Partial<IWorkerTaskManager>): IWorkerTaskManager {
  return {
    getTask: vi.fn(() => undefined),
    getOrBuildTask: vi.fn(async () => {
      throw new Error('not found');
    }),
    addTask: vi.fn(),
    kill: vi.fn(),
    clear: vi.fn(),
    listTasks: vi.fn(() => []),
    ...overrides,
  };
}

describe('acpConversationBridge', () => {
  let taskManager: IWorkerTaskManager;

  beforeEach(() => {
    vi.clearAllMocks();
    refreshFactoryDroidCatalogMock.mockResolvedValue([]);
    processConfigGetMock.mockResolvedValue(undefined);
    probeDroidStatusMock.mockResolvedValue({
      available: true,
      loginStatus: 'authenticated',
      cliSource: 'bundled',
      cliPath: '/usr/local/bin/droid',
      cliVersion: 'droid 0.1.4',
      sdkVersion: '0.1.4',
      protocolVersion: '1.2.0',
      modelCount: 21,
    });
    checkDroidCliUpdateMock.mockResolvedValue({
      currentVersion: '0.99.0',
      latestVersion: '0.99.0',
      updateAvailable: false,
      source: 'bundled',
      registry: 'https://registry.npmmirror.com',
    });
    getFactoryModelsMock.mockReturnValue([]);
    getDroidByokConfigsMock.mockResolvedValue([]);
    testDroidByokConfigMock.mockResolvedValue(null);
    saveDroidByokConfigMock.mockResolvedValue(null);
    removeDroidByokConfigMock.mockResolvedValue(undefined);
    taskManager = makeTaskManager();
    initAcpConversationBridge(taskManager);
  });

  // --- getMode ---

  it('returns { initialized: false } when no task exists for the conversation', async () => {
    vi.mocked(taskManager.getTask).mockReturnValue(undefined);

    const result = await handlers['getMode']({ conversationId: 'missing' });

    expect(result).toEqual({ success: true, data: { mode: 'default', initialized: false } });
  });

  it('uses injected taskManager to look up task by conversation id', async () => {
    vi.mocked(taskManager.getTask).mockReturnValue(undefined);

    await handlers['getMode']({ conversationId: 'c1' });

    expect(taskManager.getTask).toHaveBeenCalledWith('c1');
  });

  it('getDroidModelCatalog returns the refreshed catalog when refresh=true', async () => {
    const refreshedCatalog = [
      {
        id: 'gpt-5.4-fast',
        name: 'GPT-5.4 Fast',
        reasoningLevels: ['low', 'medium', 'high', 'xhigh'],
        defaultReasoning: 'medium',
      },
    ];
    refreshFactoryDroidCatalogMock.mockResolvedValue(refreshedCatalog);

    const result = await handlers['getDroidModelCatalog']({ refresh: true });

    expect(refreshFactoryDroidCatalogMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      success: true,
      data: { catalog: refreshedCatalog },
    });
  });

  it('getDroidModelCatalog falls back to the in-memory catalog when refresh fails', async () => {
    const fallbackCatalog = [
      {
        id: 'glm-5',
        name: 'Droid Core (GLM-5)',
        reasoningLevels: ['none'],
        defaultReasoning: 'none',
      },
    ];
    refreshFactoryDroidCatalogMock.mockRejectedValue(new Error('probe failed'));
    getFactoryModelsMock.mockReturnValue(fallbackCatalog);

    const result = await handlers['getDroidModelCatalog']({ refresh: true });

    expect(result).toEqual({
      success: true,
      data: { catalog: fallbackCatalog },
      msg: 'probe failed',
    });
  });

  it('getDroidStatus returns the probed Droid status', async () => {
    processConfigGetMock.mockResolvedValue({
      droid: {
        cliPath: '/custom/bin/droid',
      },
    });

    const result = await handlers['getDroidStatus']();

    expect(processConfigGetMock).toHaveBeenCalledWith('acp.config');
    expect(probeDroidStatusMock).toHaveBeenCalledWith({
      cwd: expect.any(String),
      execPath: '/custom/bin/droid',
    });
    expect(result).toEqual({
      success: true,
      data: {
        available: true,
        loginStatus: 'authenticated',
        cliSource: 'bundled',
        cliPath: '/usr/local/bin/droid',
        cliVersion: 'droid 0.1.4',
        sdkVersion: '0.1.4',
        protocolVersion: '1.2.0',
        modelCount: 21,
      },
    });
  });

  it('checkDroidCliUpdate returns the probed CLI update info', async () => {
    processConfigGetMock.mockResolvedValue({
      droid: {
        cliPath: '/custom/bin/droid',
      },
    });

    const result = await handlers['checkDroidCliUpdate']();

    expect(checkDroidCliUpdateMock).toHaveBeenCalledWith({
      cwd: expect.any(String),
      execPath: '/custom/bin/droid',
    });
    expect(result).toEqual({
      success: true,
      data: {
        currentVersion: '0.99.0',
        latestVersion: '0.99.0',
        updateAvailable: false,
        source: 'bundled',
        registry: 'https://registry.npmmirror.com',
      },
    });
  });

  it('getDroidByokConfig returns the stored configs', async () => {
    const config = {
      id: 'cfg-1',
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      displayName: 'Claude Sonnet 4.6 [BYOK]',
      provider: 'anthropic' as const,
      maxOutputTokens: 8192,
    };
    getDroidByokConfigsMock.mockResolvedValue([config]);

    const result = await handlers['getDroidByokConfig']();

    expect(result).toEqual({
      success: true,
      data: { configs: [config] },
    });
  });

  it('testDroidByokConfig delegates to the BYOK service', async () => {
    const payload = {
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      displayName: '',
    };
    const config = {
      id: 'cfg-1',
      ...payload,
      displayName: 'Claude Sonnet 4.6 [BYOK]',
      provider: 'anthropic' as const,
      maxOutputTokens: 8192,
    };
    testDroidByokConfigMock.mockResolvedValue(config);

    const result = await handlers['testDroidByokConfig'](payload);

    expect(testDroidByokConfigMock).toHaveBeenCalledWith(payload);
    expect(result).toEqual({
      success: true,
      data: { config },
    });
  });

  it('saveDroidByokConfig refreshes the catalog after persisting', async () => {
    const payload = {
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      displayName: 'Claude Sonnet 4.6 [BYOK]',
    };
    const config = {
      id: 'cfg-1',
      ...payload,
      provider: 'anthropic' as const,
      maxOutputTokens: 8192,
    };
    saveDroidByokConfigMock.mockResolvedValue(config);

    const result = await handlers['saveDroidByokConfig'](payload);

    expect(saveDroidByokConfigMock).toHaveBeenCalledWith(payload);
    expect(refreshFactoryDroidCatalogMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      success: true,
      data: { config },
    });
  });

  it('removeDroidByokConfig refreshes the catalog after deletion', async () => {
    const result = await handlers['removeDroidByokConfig']({ id: 'cfg-1' });

    expect(removeDroidByokConfigMock).toHaveBeenCalledWith('cfg-1');
    expect(refreshFactoryDroidCatalogMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      success: true,
    });
  });

  // --- refreshCustomAgents ---

  it('refreshCustomAgents returns success when detector succeeds', async () => {
    const { acpDetector } = await import('../../src/process/agent/acp/AcpDetector');
    vi.mocked(acpDetector.refreshCustomAgents).mockResolvedValue(undefined as any);

    const result = await handlers['refreshCustomAgents']();
    expect(result).toEqual({ success: true });
  });

  it('refreshCustomAgents returns error when detector throws', async () => {
    const { acpDetector } = await import('../../src/process/agent/acp/AcpDetector');
    vi.mocked(acpDetector.refreshCustomAgents).mockRejectedValue(new Error('refresh failed'));

    const result = await handlers['refreshCustomAgents']();
    expect(result).toEqual({ success: false, msg: 'refresh failed' });
  });

  // --- getAvailableAgents ---

  it('getAvailableAgents returns enriched agent list', async () => {
    const { acpDetector } = await import('../../src/process/agent/acp/AcpDetector');
    vi.mocked(acpDetector.getDetectedAgents).mockReturnValue([
      { backend: 'claude', name: 'Claude', cliPath: '/usr/bin/claude' },
    ] as any);

    const { mcpService } = await import('../../src/process/services/mcpServices/McpService');
    vi.mocked(mcpService.getSupportedTransportsForAgent).mockReturnValue(['stdio'] as any);

    const result = await handlers['getAvailableAgents']();
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].supportedTransports).toEqual(['stdio']);
  });

  it('getAvailableAgents returns error when detector throws', async () => {
    const { acpDetector } = await import('../../src/process/agent/acp/AcpDetector');
    vi.mocked(acpDetector.getDetectedAgents).mockImplementation(() => {
      throw new Error('detection failed');
    });

    const result = await handlers['getAvailableAgents']();
    expect(result).toEqual({ success: false, msg: 'detection failed' });
  });
});
