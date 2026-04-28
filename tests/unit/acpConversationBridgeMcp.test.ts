/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 *
 * Bridge-level unit tests for the 6 MCP IPC providers registered in
 * `acpConversationBridge.ts`.
 *
 * Each provider wraps try/catch around AcpAgentManager.<method> and converts
 * errors to `{success:false, msg}` (mutating methods) or
 * `{servers/tools:[], error}` (list methods).
 *
 * VAL-IPC-017: verifies the provider layer handles thrown errors gracefully.
 * VAL-IPC-018: contract-style parity with the setSkipPermissionsUnsafe template.
 */

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
const migrateLegacyGoogleProviderMock = vi.hoisted(() => vi.fn(async () => undefined));
const migrateSiteLabelsToBaseUrlOnlyIdsMock = vi.hoisted(() => vi.fn(async () => undefined));
const fetchDroidByokModelsForSiteMock = vi.hoisted(() => vi.fn(async () => ({ models: [], providerHint: null })));
const importDroidByokConfigsIntoSiteMock = vi.hoisted(() => vi.fn(async () => ({ imported: [], failed: [] })));
const rebuildDroidCatalogFromRefsMock = vi.hoisted(() => vi.fn(async () => undefined));

const handlers: Record<string, (...args: unknown[]) => unknown> = {};
function makeChannel(name: string) {
  return {
    provider: vi.fn((fn: (...args: unknown[]) => unknown) => {
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
      fetchDroidByokModelsForSite: makeChannel('fetchDroidByokModelsForSite'),
      importDroidByokConfigsIntoSite: makeChannel('importDroidByokConfigsIntoSite'),
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

const mockMcpManager = {
  addMcpServer: vi.fn(async () => ({ success: true })),
  removeMcpServer: vi.fn(async () => ({ success: true })),
  toggleMcpServer: vi.fn(async () => ({ success: true })),
  listMcpServers: vi.fn(async () => ({ servers: [{ name: 'srv-1' }] })),
  listMcpTools: vi.fn(async () => ({ tools: [{ name: 'tool-1' }] })),
  authenticateMcpServer: vi.fn(async () => ({ success: true })),
};

const getOrBuildTaskMock = vi.fn(async () => mockMcpManager);

vi.mock('../../src/process/task/AcpAgentManager', () => ({
  default: class AcpAgentManager {},
}));
vi.mock('../../src/process/task/GeminiAgentManager', () => ({
  GeminiAgentManager: class GeminiAgentManager {},
}));

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
  migrateLegacyGoogleProvider: migrateLegacyGoogleProviderMock,
  migrateSiteLabelsToBaseUrlOnlyIds: migrateSiteLabelsToBaseUrlOnlyIdsMock,
  fetchDroidByokModelsForSite: fetchDroidByokModelsForSiteMock,
  importDroidByokConfigsIntoSite: importDroidByokConfigsIntoSiteMock,
  rebuildDroidCatalogFromRefs: rebuildDroidCatalogFromRefsMock,
}));

vi.mock('../../src/common/config/factoryModels', () => ({
  getFactoryModels: getFactoryModelsMock,
}));

import { initAcpConversationBridge } from '../../src/process/bridge/acpConversationBridge';
import type { IWorkerTaskManager } from '../../src/process/task/IWorkerTaskManager';
import AcpAgentManager from '../../src/process/task/AcpAgentManager';

// ── Setup ─────────────────────────────────────────────────────────────

const workerTaskManager: IWorkerTaskManager = {
  getOrBuildTask: getOrBuildTaskMock,
  getManagerAgentTaskType: vi.fn(),
  getManagerConversationType: vi.fn(),
} as unknown as IWorkerTaskManager;

beforeEach(() => {
  vi.clearAllMocks();
  // Make instanceof check pass for the mock manager.
  Object.setPrototypeOf(mockMcpManager, AcpAgentManager.prototype);
  initAcpConversationBridge(workerTaskManager);
});

// ── Tests ─────────────────────────────────────────────────────────────

describe('acpConversationBridge MCP providers', () => {
  // ── addMcpServer ──────────────────────────────────────────────────

  describe('addMcpServer provider', () => {
    it('forwards to AcpAgentManager and returns success', async () => {
      const result = await handlers.addMcpServer({
        conversationId: 'conv-1',
        params: { name: 'test', type: 'stdio', command: 'echo' },
      });
      expect(result).toEqual({ success: true, data: { success: true } });
      expect(mockMcpManager.addMcpServer).toHaveBeenCalledOnce();
    });

    it('returns structured failure when task returns failure', async () => {
      mockMcpManager.addMcpServer.mockResolvedValueOnce({ success: false, msg: 'guard error' });
      const result = await handlers.addMcpServer({
        conversationId: 'conv-1',
        params: { name: 'test' },
      });
      expect(result).toEqual({ success: false, msg: 'guard error' });
    });

    it('catches thrown errors and returns structured failure', async () => {
      mockMcpManager.addMcpServer.mockRejectedValueOnce(new Error('boom'));
      const result = await handlers.addMcpServer({
        conversationId: 'conv-1',
        params: { name: 'test' },
      });
      expect(result).toEqual({ success: false, msg: 'boom' });
    });
  });

  // ── removeMcpServer ───────────────────────────────────────────────

  describe('removeMcpServer provider', () => {
    it('forwards to AcpAgentManager and returns success', async () => {
      const result = await handlers.removeMcpServer({
        conversationId: 'conv-1',
        name: 'my-server',
      });
      expect(result).toEqual({ success: true, data: { success: true } });
      expect(mockMcpManager.removeMcpServer).toHaveBeenCalledWith('my-server');
    });

    it('returns structured failure when task returns failure', async () => {
      mockMcpManager.removeMcpServer.mockResolvedValueOnce({
        success: false,
        msg: 'not found',
      });
      const result = await handlers.removeMcpServer({
        conversationId: 'conv-1',
        name: 'my-server',
      });
      expect(result).toEqual({ success: false, msg: 'not found' });
    });

    it('catches thrown errors', async () => {
      mockMcpManager.removeMcpServer.mockRejectedValueOnce(new Error('crash'));
      const result = await handlers.removeMcpServer({
        conversationId: 'conv-1',
        name: 'my-server',
      });
      expect(result).toEqual({ success: false, msg: 'crash' });
    });
  });

  // ── toggleMcpServer ───────────────────────────────────────────────

  describe('toggleMcpServer provider', () => {
    it('forwards to AcpAgentManager and returns success', async () => {
      const result = await handlers.toggleMcpServer({
        conversationId: 'conv-1',
        name: 'srv',
        enabled: true,
      });
      expect(result).toEqual({ success: true, data: { success: true } });
      expect(mockMcpManager.toggleMcpServer).toHaveBeenCalledWith('srv', true);
    });

    it('returns structured failure on task failure', async () => {
      mockMcpManager.toggleMcpServer.mockResolvedValueOnce({
        success: false,
        msg: 'disabled',
      });
      const result = await handlers.toggleMcpServer({
        conversationId: 'conv-1',
        name: 'srv',
        enabled: false,
      });
      expect(result).toEqual({ success: false, msg: 'disabled' });
    });

    it('catches thrown errors', async () => {
      mockMcpManager.toggleMcpServer.mockRejectedValueOnce(new Error('toggle-err'));
      const result = await handlers.toggleMcpServer({
        conversationId: 'conv-1',
        name: 'srv',
        enabled: true,
      });
      expect(result).toEqual({ success: false, msg: 'toggle-err' });
    });
  });

  // ── listMcpServers ────────────────────────────────────────────────

  describe('listMcpServers provider', () => {
    it('forwards to AcpAgentManager and returns servers', async () => {
      const result = await handlers.listMcpServers({ conversationId: 'conv-1' });
      expect(result).toEqual({
        success: true,
        data: { servers: [{ name: 'srv-1' }] },
      });
    });

    it('returns empty servers + error on task error', async () => {
      mockMcpManager.listMcpServers.mockResolvedValueOnce({
        servers: [],
        error: 'backend guard',
      });
      const result = await handlers.listMcpServers({ conversationId: 'conv-1' });
      expect(result).toEqual({
        success: true,
        data: { servers: [], error: 'backend guard' },
      });
    });

    it('catches thrown errors and returns empty servers', async () => {
      mockMcpManager.listMcpServers.mockRejectedValueOnce(new Error('nope'));
      const result = await handlers.listMcpServers({ conversationId: 'conv-1' });
      expect(result).toEqual({
        success: true,
        data: { servers: [], error: 'nope' },
      });
    });
  });

  // ── listMcpTools ──────────────────────────────────────────────────

  describe('listMcpTools provider', () => {
    it('forwards to AcpAgentManager and returns tools', async () => {
      const result = await handlers.listMcpTools({ conversationId: 'conv-1' });
      expect(result).toEqual({
        success: true,
        data: { tools: [{ name: 'tool-1' }] },
      });
    });

    it('returns empty tools + error on task error', async () => {
      mockMcpManager.listMcpTools.mockResolvedValueOnce({ tools: [], error: 'not ready' });
      const result = await handlers.listMcpTools({ conversationId: 'conv-1' });
      expect(result).toEqual({
        success: true,
        data: { tools: [], error: 'not ready' },
      });
    });

    it('catches thrown errors and returns empty tools', async () => {
      mockMcpManager.listMcpTools.mockRejectedValueOnce(new Error('timeout'));
      const result = await handlers.listMcpTools({ conversationId: 'conv-1' });
      expect(result).toEqual({
        success: true,
        data: { tools: [], error: 'timeout' },
      });
    });
  });

  // ── authenticateMcpServer ─────────────────────────────────────────

  describe('authenticateMcpServer provider', () => {
    it('forwards to AcpAgentManager and returns success', async () => {
      const result = await handlers.authenticateMcpServer({
        conversationId: 'conv-1',
        params: { serverName: 'oauth-srv' },
      });
      expect(result).toEqual({ success: true, data: { success: true } });
      expect(mockMcpManager.authenticateMcpServer).toHaveBeenCalledOnce();
    });

    it('returns structured failure on task failure', async () => {
      mockMcpManager.authenticateMcpServer.mockResolvedValueOnce({
        success: false,
        msg: 'oauth denied',
      });
      const result = await handlers.authenticateMcpServer({
        conversationId: 'conv-1',
        params: { serverName: 'oauth-srv' },
      });
      expect(result).toEqual({ success: false, msg: 'oauth denied' });
    });

    it('catches thrown errors', async () => {
      mockMcpManager.authenticateMcpServer.mockRejectedValueOnce(new Error('auth-fail'));
      const result = await handlers.authenticateMcpServer({
        conversationId: 'conv-1',
        params: { serverName: 'oauth-srv' },
      });
      expect(result).toEqual({ success: false, msg: 'auth-fail' });
    });
  });

  // ── Conversation not found ────────────────────────────────────────

  describe('conversation not found', () => {
    it('addMcpServer returns failure when conversation not found', async () => {
      getOrBuildTaskMock.mockResolvedValueOnce(null);
      const result = await handlers.addMcpServer({
        conversationId: 'missing',
        params: { name: 'test' },
      });
      expect(result).toEqual({ success: false, msg: 'Conversation not found' });
    });

    it('listMcpServers returns empty servers when conversation not found', async () => {
      getOrBuildTaskMock.mockResolvedValueOnce(null);
      const result = await handlers.listMcpServers({ conversationId: 'missing' });
      expect(result).toEqual({
        success: true,
        data: { servers: [], error: 'Conversation not found' },
      });
    });

    it('listMcpTools returns empty tools when conversation not found', async () => {
      getOrBuildTaskMock.mockResolvedValueOnce(null);
      const result = await handlers.listMcpTools({ conversationId: 'missing' });
      expect(result).toEqual({
        success: true,
        data: { tools: [], error: 'Conversation not found' },
      });
    });
  });
});
