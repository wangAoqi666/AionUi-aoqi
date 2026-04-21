/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Covers the P1-1 dynamic MCP management surface described in
 * `.factory/skills/droid-sdk-integration/references/gaps-and-guidance.md`.
 *
 * Responsibilities under test:
 *   - Six public wrappers (`addMcpServer` / `removeMcpServer` / `toggleMcpServer`
 *     / `listMcpServers` / `listMcpTools` / `authenticateMcpServer`) return
 *     structured results and degrade gracefully on SDK errors.
 *   - Each wrapper short-circuits with an error when the session isn't live.
 *   - `syncMcpServersOnStartup` diffs desired vs. existing servers and only
 *     calls `addMcpServer` for the missing ones.
 *   - A `listMcpServers()` failure during startup MUST NOT fail `startSession()`.
 *   - Pure `mcpSync` helpers normalise input and diff correctly.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DroidSdkAgent } from '@/process/agent/droid/DroidSdkAgent';
import { AcpSkillManager } from '@/process/task/AcpSkillManager';
import {
  diffMissingMcpServers,
  normalizeDesiredMcpServers,
  toAddMcpServerParams,
  type DesiredMcpServer,
} from '@/process/agent/droid/runtime/mcpSync';

const createSessionMock = vi.hoisted(() => vi.fn());
const resumeSessionMock = vi.hoisted(() => vi.fn());
const mainLogMock = vi.hoisted(() => vi.fn());
const mainWarnMock = vi.hoisted(() => vi.fn());

vi.mock('@factory/droid-sdk', () => ({
  createSession: createSessionMock,
  resumeSession: resumeSessionMock,
  ToolConfirmationOutcome: {
    ProceedOnce: 'proceed_once',
    ProceedAlways: 'proceed_always',
    ProceedAutoRunMedium: 'proceed_auto_run_medium',
    Cancel: 'cancel',
  },
  AutonomyLevel: {
    High: 'high',
    Medium: 'medium',
    Low: 'low',
    Off: 'off',
  },
  DroidInteractionMode: {
    Auto: 'auto',
    Spec: 'spec',
  },
}));

vi.mock('@process/utils/mainLogger', () => ({
  mainLog: mainLogMock,
  mainWarn: mainWarnMock,
}));

vi.mock('@process/utils/shellEnv', () => ({
  getEnhancedEnv: () => ({}),
}));

vi.mock('@process/agent/droid/cliRuntime', () => ({
  resolveWorkingDroidCli: vi.fn((execPath?: string | null) => ({
    execPath: execPath || 'droid',
    cliPath: execPath || 'droid',
    source: 'system',
    version: '1.0.0',
  })),
}));

type McpSessionMocks = {
  addMcpServer: ReturnType<typeof vi.fn>;
  removeMcpServer: ReturnType<typeof vi.fn>;
  toggleMcpServer: ReturnType<typeof vi.fn>;
  listMcpServers: ReturnType<typeof vi.fn>;
  listMcpTools: ReturnType<typeof vi.fn>;
  authenticateMcpServer: ReturnType<typeof vi.fn>;
};

function buildSession(overrides: Partial<McpSessionMocks & Record<string, unknown>> = {}) {
  return {
    sessionId: 'session-mcp',
    updateSettings: vi.fn(),
    close: vi.fn(),
    interrupt: vi.fn(),
    stream: vi.fn(async function* () {}),
    addMcpServer: vi.fn().mockResolvedValue({ success: true }),
    removeMcpServer: vi.fn().mockResolvedValue({ success: true }),
    toggleMcpServer: vi.fn().mockResolvedValue({ success: true }),
    listMcpServers: vi.fn().mockResolvedValue({ servers: [], summary: undefined }),
    listMcpTools: vi.fn().mockResolvedValue({ tools: [] }),
    authenticateMcpServer: vi.fn().mockResolvedValue({ success: true }),
    ...overrides,
  };
}

describe('mcpSync helpers', () => {
  it('normalizeDesiredMcpServers drops invalid entries', () => {
    const result = normalizeDesiredMcpServers([
      null,
      'garbage',
      { type: 'stdio' }, // missing name
      { name: 'good-stdio', type: 'stdio', command: 'node', args: ['a.js'] },
      { name: 'bad-type', type: 'mystery' }, // unknown type
      { name: 'good-http', type: 'http', url: 'https://x' },
    ]);
    expect(result.map((r) => r.name)).toEqual(['good-stdio', 'good-http']);
    expect(result[0]?.args).toEqual(['a.js']);
    expect(result[1]?.url).toBe('https://x');
  });

  it('diffMissingMcpServers returns desired entries not already present', () => {
    const desired: DesiredMcpServer[] = [
      { name: 'a', type: 'stdio', command: 'a-cmd' },
      { name: 'b', type: 'stdio', command: 'b-cmd' },
      { name: 'c', type: 'http', url: 'https://c' },
    ];
    const missing = diffMissingMcpServers(desired, ['b']);
    expect(missing.map((m) => m.name)).toEqual(['a', 'c']);
  });

  it('diffMissingMcpServers dedupes by name (first-wins) before diffing', () => {
    const desired: DesiredMcpServer[] = [
      { name: 'dup', type: 'stdio', command: 'first' },
      { name: 'dup', type: 'stdio', command: 'second' },
      { name: 'uniq', type: 'stdio', command: 'solo' },
    ];
    const missing = diffMissingMcpServers(desired, []);
    expect(missing).toHaveLength(2);
    expect(missing[0]).toMatchObject({ name: 'dup', command: 'first' });
    expect(missing[1]).toMatchObject({ name: 'uniq' });
  });

  it('toAddMcpServerParams requires command for stdio and url for http/sse', () => {
    expect(toAddMcpServerParams({ name: 'no-cmd', type: 'stdio' })).toBeNull();
    expect(toAddMcpServerParams({ name: 'no-url', type: 'http' })).toBeNull();
    expect(toAddMcpServerParams({ name: 'ok-stdio', type: 'stdio', command: 'go' })).toMatchObject({
      name: 'ok-stdio',
      type: 'stdio',
      command: 'go',
    });
    expect(toAddMcpServerParams({ name: 'ok-http', type: 'http', url: 'https://x' })).toMatchObject({
      name: 'ok-http',
      type: 'http',
      url: 'https://x',
    });
  });
});

describe('DroidSdkAgent — MCP management wrappers', () => {
  beforeEach(() => {
    createSessionMock.mockReset();
    resumeSessionMock.mockReset();
    mainLogMock.mockReset();
    mainWarnMock.mockReset();
    AcpSkillManager.resetInstance();
  });

  afterEach(() => {
    AcpSkillManager.resetInstance();
  });

  async function buildStartedAgent(sessionOverrides: Partial<McpSessionMocks & Record<string, unknown>> = {}) {
    const session = buildSession(sessionOverrides);
    createSessionMock.mockResolvedValue(session);
    const agent = new DroidSdkAgent({
      id: `conv-mcp-${Math.random()}`,
      workingDir: '/tmp',
      onStreamEvent: vi.fn(),
    });
    await agent.start();
    return { agent, session };
  }

  it('addMcpServer forwards params to SDK and returns success on happy path', async () => {
    const { agent, session } = await buildStartedAgent();
    const result = await agent.addMcpServer({
      name: 'fs',
      type: 'stdio',
      command: '/bin/fs-mcp',
      args: ['--root', '/'],
      env: { FOO: 'bar' },
    });
    expect(result).toEqual({ success: true });
    expect(session.addMcpServer).toHaveBeenCalledTimes(1);
    expect(session.addMcpServer).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'fs', type: 'stdio', command: '/bin/fs-mcp' })
    );
  });

  it('addMcpServer returns a structured error when SDK rejects', async () => {
    const session = buildSession({ addMcpServer: vi.fn().mockRejectedValue(new Error('duplicate name')) });
    createSessionMock.mockResolvedValue(session);
    const agent = new DroidSdkAgent({ id: 'conv-mcp-add-err', workingDir: '/tmp', onStreamEvent: vi.fn() });
    await agent.start();
    const result = await agent.addMcpServer({ name: 'dup', type: 'stdio', command: 'x' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('duplicate name');
    expect(mainWarnMock).toHaveBeenCalled();
  });

  it('addMcpServer returns error without calling SDK when session is not initialized', async () => {
    const agent = new DroidSdkAgent({ id: 'conv-mcp-no-session', workingDir: '/tmp', onStreamEvent: vi.fn() });
    const result = await agent.addMcpServer({ name: 'x', type: 'stdio', command: 'c' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not initialized');
  });

  it('removeMcpServer passes serverName + settingsLevel=user', async () => {
    const { agent, session } = await buildStartedAgent();
    const result = await agent.removeMcpServer('fs');
    expect(result).toEqual({ success: true });
    expect(session.removeMcpServer).toHaveBeenCalledWith({ serverName: 'fs', settingsLevel: 'user' });
  });

  it('removeMcpServer reports error when SDK rejects', async () => {
    const session = buildSession({ removeMcpServer: vi.fn().mockRejectedValue(new Error('not found')) });
    createSessionMock.mockResolvedValue(session);
    const agent = new DroidSdkAgent({ id: 'conv-mcp-rm-err', workingDir: '/tmp', onStreamEvent: vi.fn() });
    await agent.start();
    const result = await agent.removeMcpServer('ghost');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('toggleMcpServer forwards enabled flag + settingsLevel=user', async () => {
    const { agent, session } = await buildStartedAgent();
    const result = await agent.toggleMcpServer('fs', false);
    expect(result).toEqual({ success: true });
    expect(session.toggleMcpServer).toHaveBeenCalledWith({
      serverName: 'fs',
      enabled: false,
      settingsLevel: 'user',
    });
  });

  it('toggleMcpServer surfaces success=false from SDK result', async () => {
    const session = buildSession({ toggleMcpServer: vi.fn().mockResolvedValue({ success: false }) });
    createSessionMock.mockResolvedValue(session);
    const agent = new DroidSdkAgent({ id: 'conv-mcp-toggle-false', workingDir: '/tmp', onStreamEvent: vi.fn() });
    await agent.start();
    const result = await agent.toggleMcpServer('fs', true);
    expect(result.success).toBe(false);
    expect(result.error).toContain('success=false');
  });

  it('listMcpServers returns an empty array without session', async () => {
    const agent = new DroidSdkAgent({ id: 'conv-mcp-ls-no-session', workingDir: '/tmp', onStreamEvent: vi.fn() });
    const result = await agent.listMcpServers();
    expect(result.servers).toEqual([]);
    expect(result.error).toContain('not initialized');
  });

  it('listMcpServers exposes SDK-reported servers array', async () => {
    const { agent, session } = await buildStartedAgent({
      listMcpServers: vi.fn().mockResolvedValue({
        servers: [
          { name: 'fs', status: 'connected', source: 'user', isManaged: true },
          { name: 'github', status: 'failed', source: 'user', isManaged: true, error: 'auth required' },
        ],
        summary: { total: 2, connected: 1, connecting: 0, failed: 1 },
      }),
    });
    const result = await agent.listMcpServers();
    expect(result.servers).toHaveLength(2);
    expect(result.servers[0]?.name).toBe('fs');
    expect(result.error).toBeUndefined();
    expect(session.listMcpServers).toHaveBeenCalled();
  });

  it('listMcpServers degrades to empty list + error on SDK throw', async () => {
    // No desired MCP servers are configured → syncMcpServersOnStartup skips
    // entirely, so the SDK method is only invoked by the explicit test call.
    const { agent } = await buildStartedAgent({
      listMcpServers: vi.fn().mockRejectedValue(new Error('transport closed')),
    });
    const result = await agent.listMcpServers();
    expect(result.servers).toEqual([]);
    expect(result.error).toContain('transport closed');
  });

  it('listMcpTools returns the SDK tool list', async () => {
    const { agent, session } = await buildStartedAgent({
      listMcpTools: vi.fn().mockResolvedValue({
        tools: [
          { serverName: 'fs', name: 'read_file', isEnabled: true, description: 'read a file' },
          { serverName: 'fs', name: 'write_file', isEnabled: false },
        ],
      }),
    });
    const result = await agent.listMcpTools();
    expect(result.tools).toHaveLength(2);
    expect(result.tools[0]?.name).toBe('read_file');
    expect(session.listMcpTools).toHaveBeenCalled();
  });

  it('listMcpTools returns structured error on SDK throw', async () => {
    const { agent } = await buildStartedAgent({
      listMcpTools: vi.fn().mockRejectedValue(new Error('broken')),
    });
    const result = await agent.listMcpTools();
    expect(result.tools).toEqual([]);
    expect(result.error).toContain('broken');
  });

  it('authenticateMcpServer forwards params, returns authUrl when present', async () => {
    const { agent, session } = await buildStartedAgent({
      authenticateMcpServer: vi.fn().mockResolvedValue({ success: true, authUrl: 'https://x/oauth' }),
    });
    const result = await agent.authenticateMcpServer({ serverName: 'notion' });
    expect(result.success).toBe(true);
    expect(result.authUrl).toBe('https://x/oauth');
    expect(session.authenticateMcpServer).toHaveBeenCalledWith({ serverName: 'notion' });
  });

  it('authenticateMcpServer reports error when SDK throws', async () => {
    const { agent } = await buildStartedAgent({
      authenticateMcpServer: vi.fn().mockRejectedValue(new Error('auth flow busy')),
    });
    const result = await agent.authenticateMcpServer({ serverName: 'github' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('auth flow busy');
  });
});

describe('DroidSdkAgent — syncMcpServersOnStartup', () => {
  beforeEach(() => {
    createSessionMock.mockReset();
    resumeSessionMock.mockReset();
    mainLogMock.mockReset();
    mainWarnMock.mockReset();
    AcpSkillManager.resetInstance();
  });

  afterEach(() => {
    AcpSkillManager.resetInstance();
  });

  it('adds missing MCP servers from teamMcpStdioConfig and skips existing ones', async () => {
    const session = buildSession({
      listMcpServers: vi.fn().mockResolvedValue({
        servers: [{ name: 'existing-shared', status: 'connected', source: 'user', isManaged: true }],
      }),
      addMcpServer: vi.fn().mockResolvedValue({ success: true }),
    });
    createSessionMock.mockResolvedValue(session);
    const agent = new DroidSdkAgent({
      id: 'conv-sync-team',
      workingDir: '/tmp',
      onStreamEvent: vi.fn(),
      teamMcpStdioConfig: {
        name: 'team-mcp',
        command: '/bin/team-mcp',
        args: ['--team', 'aion'],
        env: [{ name: 'AION_TOKEN', value: 'secret' }],
      },
      projectMcpServers: [
        { name: 'existing-shared', type: 'stdio', command: '/bin/dup' }, // already present, should be skipped
        { name: 'proj-http', type: 'http', url: 'https://proj.example' },
      ],
    });
    await agent.start();

    const addCalls = (session.addMcpServer as ReturnType<typeof vi.fn>).mock.calls;
    expect(addCalls).toHaveLength(2);
    const addedNames = addCalls.map((c) => c[0].name);
    expect(addedNames.toSorted()).toEqual(['proj-http', 'team-mcp']);
    const teamCall = addCalls.find((c) => c[0].name === 'team-mcp');
    expect(teamCall?.[0]).toMatchObject({
      name: 'team-mcp',
      type: 'stdio',
      command: '/bin/team-mcp',
      args: ['--team', 'aion'],
      env: { AION_TOKEN: 'secret' },
    });
    const projCall = addCalls.find((c) => c[0].name === 'proj-http');
    expect(projCall?.[0]).toMatchObject({ name: 'proj-http', type: 'http', url: 'https://proj.example' });
  });

  it('does not fail startSession when listMcpServers throws', async () => {
    const session = buildSession({
      listMcpServers: vi.fn().mockRejectedValue(new Error('transport died')),
      addMcpServer: vi.fn().mockResolvedValue({ success: true }),
    });
    createSessionMock.mockResolvedValue(session);
    const agent = new DroidSdkAgent({
      id: 'conv-sync-listerr',
      workingDir: '/tmp',
      onStreamEvent: vi.fn(),
      projectMcpServers: [{ name: 'proj', type: 'stdio', command: '/bin/proj' }],
    });

    await expect(agent.start()).resolves.toBeUndefined();
    expect(agent.isConnected).toBe(true);
    // addMcpServer must not be called when we can't enumerate what's present.
    expect(session.addMcpServer).not.toHaveBeenCalled();
  });

  it('does not fail startSession when an addMcpServer call rejects', async () => {
    const session = buildSession({
      listMcpServers: vi.fn().mockResolvedValue({ servers: [] }),
      addMcpServer: vi
        .fn()
        .mockResolvedValueOnce({ success: true }) // first entry ok
        .mockRejectedValueOnce(new Error('cli busy')), // second entry fails
    });
    createSessionMock.mockResolvedValue(session);
    const agent = new DroidSdkAgent({
      id: 'conv-sync-adderr',
      workingDir: '/tmp',
      onStreamEvent: vi.fn(),
      projectMcpServers: [
        { name: 'ok', type: 'stdio', command: '/bin/ok' },
        { name: 'bad', type: 'stdio', command: '/bin/bad' },
      ],
    });

    await expect(agent.start()).resolves.toBeUndefined();
    expect(agent.isConnected).toBe(true);
    expect(session.addMcpServer).toHaveBeenCalledTimes(2);
    // Second failure must surface as a mainWarn, not an uncaught rejection.
    expect(mainWarnMock).toHaveBeenCalled();
  });

  it('skips sync entirely when no desired MCP servers are configured', async () => {
    const session = buildSession();
    createSessionMock.mockResolvedValue(session);
    const agent = new DroidSdkAgent({
      id: 'conv-sync-empty',
      workingDir: '/tmp',
      onStreamEvent: vi.fn(),
    });
    await agent.start();
    expect(session.listMcpServers).not.toHaveBeenCalled();
    expect(session.addMcpServer).not.toHaveBeenCalled();
  });
});
