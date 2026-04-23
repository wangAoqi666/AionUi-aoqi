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
const detectNodeRuntimeMock = vi.hoisted(() =>
  vi.fn(async () => ({
    command: 'node',
    version: process.version,
  }))
);
const installOrUpdateDroidCliMock = vi.hoisted(() =>
  vi.fn(async () => ({
    success: true,
    mode: 'install' as const,
    message: 'installed',
  }))
);
const getFactoryModelsMock = vi.hoisted(() => vi.fn(() => []));
const getDroidByokConfigsMock = vi.hoisted(() => vi.fn(async () => []));
const fetchDroidByokModelsMock = vi.hoisted(() => vi.fn(async () => []));
const testDroidByokConfigMock = vi.hoisted(() => vi.fn(async () => null));
const saveDroidByokConfigMock = vi.hoisted(() => vi.fn(async () => null));
const importDroidByokConfigsMock = vi.hoisted(() =>
  vi.fn(async () => ({
    imported: [],
    failed: [],
    summary: { total: 0, imported: 0, failed: 0 },
  }))
);
const removeDroidByokConfigMock = vi.hoisted(() => vi.fn(async () => undefined));
const listDroidByokSitesMock = vi.hoisted(() => vi.fn(async () => []));
const upsertDroidByokSiteMock = vi.hoisted(() =>
  vi.fn(async () => ({
    id: 'site-1',
    provider: 'anthropic' as const,
    baseUrl: 'https://api.example.com',
    models: [],
    hasApiKey: false,
  }))
);
const removeDroidByokSiteMock = vi.hoisted(() => vi.fn(async () => undefined));
const rotateDroidByokSiteApiKeyMock = vi.hoisted(() =>
  vi.fn(async () => ({
    id: 'site-1',
    provider: 'anthropic' as const,
    baseUrl: 'https://api.example.com',
    models: [],
    hasApiKey: true,
  }))
);
const migrateLegacyModelsIntoSitesMock = vi.hoisted(() => vi.fn(async () => undefined));

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
      detectDroidNodeRuntime: makeChannel('detectDroidNodeRuntime'),
      installDroidCli: makeChannel('installDroidCli'),
      droidCliInstallProgress: { emit: vi.fn() },
      getDroidByokConfig: makeChannel('getDroidByokConfig'),
      fetchDroidByokModels: makeChannel('fetchDroidByokModels'),
      testDroidByokConfig: makeChannel('testDroidByokConfig'),
      saveDroidByokConfig: makeChannel('saveDroidByokConfig'),
      importDroidByokConfigs: makeChannel('importDroidByokConfigs'),
      droidByokImportProgress: { emit: vi.fn() },
      removeDroidByokConfig: makeChannel('removeDroidByokConfig'),
      listDroidByokSites: makeChannel('listDroidByokSites'),
      upsertDroidByokSite: makeChannel('upsertDroidByokSite'),
      removeDroidByokSite: makeChannel('removeDroidByokSite'),
      rotateDroidByokSiteApiKey: makeChannel('rotateDroidByokSiteApiKey'),
      probeModelInfo: makeChannel('probeModelInfo'),
      setModel: makeChannel('setModel'),
      setMode: makeChannel('setMode'),
      setSkipPermissionsUnsafe: makeChannel('setSkipPermissionsUnsafe'),
      setEnabledToolIds: makeChannel('setEnabledToolIds'),
      submitBugReport: makeChannel('submitBugReport'),
      addMcpServer: makeChannel('addMcpServer'),
      removeMcpServer: makeChannel('removeMcpServer'),
      toggleMcpServer: makeChannel('toggleMcpServer'),
      listMcpServers: makeChannel('listMcpServers'),
      listMcpTools: makeChannel('listMcpTools'),
      authenticateMcpServer: makeChannel('authenticateMcpServer'),
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

vi.mock('../../src/process/agent/droid/cliInstaller', () => ({
  detectNodeRuntime: detectNodeRuntimeMock,
  installOrUpdateDroidCli: installOrUpdateDroidCliMock,
}));

vi.mock('../../src/process/bridge/services/DroidByokService', () => ({
  getDroidByokConfigs: getDroidByokConfigsMock,
  fetchDroidByokModels: fetchDroidByokModelsMock,
  testDroidByokConfig: testDroidByokConfigMock,
  saveDroidByokConfig: saveDroidByokConfigMock,
  importDroidByokConfigs: importDroidByokConfigsMock,
  removeDroidByokConfig: removeDroidByokConfigMock,
  listDroidByokSites: listDroidByokSitesMock,
  upsertDroidByokSite: upsertDroidByokSiteMock,
  removeDroidByokSite: removeDroidByokSiteMock,
  rotateDroidByokSiteApiKey: rotateDroidByokSiteApiKeyMock,
  migrateLegacyModelsIntoSites: migrateLegacyModelsIntoSitesMock,
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
    fetchDroidByokModelsMock.mockResolvedValue([]);
    testDroidByokConfigMock.mockResolvedValue(null);
    saveDroidByokConfigMock.mockResolvedValue(null);
    importDroidByokConfigsMock.mockResolvedValue({
      imported: [],
      failed: [],
      summary: { total: 0, imported: 0, failed: 0 },
    });
    removeDroidByokConfigMock.mockResolvedValue(undefined);
    listDroidByokSitesMock.mockResolvedValue([]);
    upsertDroidByokSiteMock.mockResolvedValue({
      id: 'site-1',
      provider: 'anthropic',
      baseUrl: 'https://api.example.com',
      models: [],
      hasApiKey: false,
    } as any);
    removeDroidByokSiteMock.mockResolvedValue(undefined);
    rotateDroidByokSiteApiKeyMock.mockResolvedValue({
      id: 'site-1',
      provider: 'anthropic',
      baseUrl: 'https://api.example.com',
      models: [],
      hasApiKey: true,
    } as any);
    migrateLegacyModelsIntoSitesMock.mockResolvedValue(undefined);
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

  // --- setEnabledToolIds (SKILL P2-2 tool whitelist) ---
  //
  // IPC surface contract:
  //   - Task not found / not an AcpAgentManager → { success: false, msg: 'Conversation not found' }
  //   - Inner `task.setEnabledToolIds` returns { success: false, msg } → bridge forwards msg
  //   - Happy path → { success: true, data: { toolIds } } (echoes the input for UI reconciliation)
  //   - Thrown error → { success: false, msg: error.message }
  //
  // IPC 层只做"代理 → 转发"，Droid/非 Droid 的三态语义由 AcpAgentManager/DroidSdkAgent 负责。
  describe('setEnabledToolIds', () => {
    it('returns "Conversation not found" when getOrBuildTask yields no task', async () => {
      vi.mocked(taskManager.getOrBuildTask).mockResolvedValue(undefined as any);

      const result = await handlers['setEnabledToolIds']({
        conversationId: 'missing',
        toolIds: ['read_file'],
      });

      expect(result).toEqual({ success: false, msg: 'Conversation not found' });
    });

    it('returns "Conversation not found" when the task is not an AcpAgentManager', async () => {
      // Non-AcpAgentManager task (e.g. Gemini-only manager). The `instanceof`
      // guard in the bridge MUST reject it regardless of whether the object
      // happens to have a `setEnabledToolIds` method (fail-closed).
      const foreignTask = { setEnabledToolIds: vi.fn() } as unknown;
      vi.mocked(taskManager.getOrBuildTask).mockResolvedValue(foreignTask as any);

      const result = await handlers['setEnabledToolIds']({
        conversationId: 'conv-1',
        toolIds: [],
      });

      expect(result).toEqual({ success: false, msg: 'Conversation not found' });
    });

    it('forwards to task.setEnabledToolIds and echoes toolIds on success', async () => {
      const { default: AcpAgentManager } = await import('../../src/process/task/AcpAgentManager');
      const task = new AcpAgentManager();
      (task as any).setEnabledToolIds = vi.fn(async () => ({ success: true }));
      vi.mocked(taskManager.getOrBuildTask).mockResolvedValue(task as any);

      const result = await handlers['setEnabledToolIds']({
        conversationId: 'conv-whitelist',
        toolIds: ['read_file', 'grep'],
      });

      expect((task as any).setEnabledToolIds).toHaveBeenCalledWith(['read_file', 'grep']);
      expect(result).toEqual({
        success: true,
        data: { toolIds: ['read_file', 'grep'] },
      });
    });

    it('forwards null (clear-whitelist) through to the manager and echoes it back', async () => {
      const { default: AcpAgentManager } = await import('../../src/process/task/AcpAgentManager');
      const task = new AcpAgentManager();
      (task as any).setEnabledToolIds = vi.fn(async () => ({ success: true }));
      vi.mocked(taskManager.getOrBuildTask).mockResolvedValue(task as any);

      const result = await handlers['setEnabledToolIds']({
        conversationId: 'conv-clear',
        toolIds: null,
      });

      expect((task as any).setEnabledToolIds).toHaveBeenCalledWith(null);
      expect(result).toEqual({ success: true, data: { toolIds: null } });
    });

    it('forwards the inner failure message when the manager reports unsupported backend', async () => {
      const { default: AcpAgentManager } = await import('../../src/process/task/AcpAgentManager');
      const task = new AcpAgentManager();
      (task as any).setEnabledToolIds = vi.fn(async () => ({
        success: false,
        msg: 'enabledToolIds is only supported for the Droid SDK backend',
      }));
      vi.mocked(taskManager.getOrBuildTask).mockResolvedValue(task as any);

      const result = await handlers['setEnabledToolIds']({
        conversationId: 'conv-claude',
        toolIds: ['read_file'],
      });

      expect(result).toEqual({
        success: false,
        msg: 'enabledToolIds is only supported for the Droid SDK backend',
      });
    });

    it('returns a structured failure when getOrBuildTask throws', async () => {
      vi.mocked(taskManager.getOrBuildTask).mockRejectedValue(new Error('task build failed'));

      const result = await handlers['setEnabledToolIds']({
        conversationId: 'conv-boom',
        toolIds: [],
      });

      expect(result).toEqual({ success: false, msg: 'task build failed' });
    });
  });

  // --- submitBugReport (SKILL P2-4 bug report submission) ---
  //
  // IPC surface contract:
  //   - Task not found / not an AcpAgentManager → { success: false, msg: 'Conversation not found' }
  //   - Inner `task.submitBugReport` returns { success: false, msg } → bridge forwards msg
  //   - Happy path with reportId → { success: true, data: { reportId } }
  //   - Happy path without reportId → { success: true, data: {} }
  //   - Thrown error → { success: false, msg: error.message }
  //
  // IPC 层只做"代理 → 转发"，Droid/非 Droid、clientLogs 隐私语义由下游管理器与
  // DroidSdkAgent 负责。
  describe('submitBugReport', () => {
    it('returns "Conversation not found" when getOrBuildTask yields no task', async () => {
      vi.mocked(taskManager.getOrBuildTask).mockResolvedValue(undefined as any);

      const result = await handlers['submitBugReport']({
        conversationId: 'missing',
        title: 'x',
        description: 'y'.repeat(20),
      });

      expect(result).toEqual({ success: false, msg: 'Conversation not found' });
    });

    it('returns "Conversation not found" when the task is not an AcpAgentManager', async () => {
      // Non-AcpAgentManager task (e.g. Gemini-only manager). The `instanceof`
      // guard in the bridge MUST reject it regardless of whether the object
      // happens to have a `submitBugReport` method (fail-closed).
      const foreignTask = { submitBugReport: vi.fn() } as unknown;
      vi.mocked(taskManager.getOrBuildTask).mockResolvedValue(foreignTask as any);

      const result = await handlers['submitBugReport']({
        conversationId: 'conv-foreign',
        title: 'x',
        description: 'y'.repeat(20),
      });

      expect(result).toEqual({ success: false, msg: 'Conversation not found' });
    });

    it('forwards to task.submitBugReport and echoes reportId on success', async () => {
      const { default: AcpAgentManager } = await import('../../src/process/task/AcpAgentManager');
      const task = new AcpAgentManager();
      (task as any).submitBugReport = vi.fn(async () => ({
        success: true,
        reportId: 'bug-abc-123',
      }));
      vi.mocked(taskManager.getOrBuildTask).mockResolvedValue(task as any);

      const result = await handlers['submitBugReport']({
        conversationId: 'conv-happy',
        title: 'An issue',
        description: 'Details that are long enough to pass renderer min-length.',
        includeSessionId: true,
      });

      expect((task as any).submitBugReport).toHaveBeenCalledWith({
        title: 'An issue',
        description: 'Details that are long enough to pass renderer min-length.',
        includeSessionId: true,
      });
      expect(result).toEqual({
        success: true,
        data: { reportId: 'bug-abc-123' },
      });
    });

    it('returns `data: {}` on success when the inner call did not produce a reportId', async () => {
      // Contract: a successful submit is still a success even if the SDK
      // didn't echo back a bug id (unlikely in practice but the IPC surface
      // must be robust to partial responses). UI uses the plain success
      // variant of the toast in that case.
      const { default: AcpAgentManager } = await import('../../src/process/task/AcpAgentManager');
      const task = new AcpAgentManager();
      (task as any).submitBugReport = vi.fn(async () => ({ success: true }));
      vi.mocked(taskManager.getOrBuildTask).mockResolvedValue(task as any);

      const result = await handlers['submitBugReport']({
        conversationId: 'conv-no-id',
        title: 'Short title',
        description: 'Description long enough.',
      });

      expect(result).toEqual({ success: true, data: {} });
    });

    it('forwards the inner failure message when the manager reports unsupported backend', async () => {
      const { default: AcpAgentManager } = await import('../../src/process/task/AcpAgentManager');
      const task = new AcpAgentManager();
      (task as any).submitBugReport = vi.fn(async () => ({
        success: false,
        msg: 'submitBugReport is only supported for the Droid SDK backend',
      }));
      vi.mocked(taskManager.getOrBuildTask).mockResolvedValue(task as any);

      const result = await handlers['submitBugReport']({
        conversationId: 'conv-claude',
        title: 'Any',
        description: 'Description long enough to pass.',
      });

      expect(result).toEqual({
        success: false,
        msg: 'submitBugReport is only supported for the Droid SDK backend',
      });
    });

    it('returns a structured failure when getOrBuildTask throws', async () => {
      vi.mocked(taskManager.getOrBuildTask).mockRejectedValue(new Error('task build failed'));

      const result = await handlers['submitBugReport']({
        conversationId: 'conv-boom',
        title: 'Will not submit',
        description: 'Whatever description.',
      });

      expect(result).toEqual({ success: false, msg: 'task build failed' });
    });
  });
});
