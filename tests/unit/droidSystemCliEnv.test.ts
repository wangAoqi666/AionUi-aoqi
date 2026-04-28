import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DroidSdkAgent } from '@/process/agent/droid/DroidSdkAgent';

const createSessionMock = vi.hoisted(() => vi.fn());
const resumeSessionMock = vi.hoisted(() => vi.fn());
const getEnhancedEnvMock = vi.hoisted(() => vi.fn(() => ({ PATH: '/system/bin' })));
const resolveWorkingDroidCliMock = vi.hoisted(() =>
  vi.fn(() => ({
    execPath: 'node',
    execArgs: ['/Users/test/AppData/Roaming/npm/node_modules/@factory/cli/bin/droid'],
    cliPath: null,
    source: 'system',
    version: '1.0.0',
  }))
);
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
  getEnhancedEnv: getEnhancedEnvMock,
}));

vi.mock('@process/agent/droid/cliRuntime', () => ({
  resolveWorkingDroidCli: resolveWorkingDroidCliMock,
}));

function buildSessionStub(sessionId = 'session-env-test') {
  return {
    sessionId,
    updateSettings: vi.fn(),
    close: vi.fn(),
    interrupt: vi.fn(),
    onNotification: vi.fn(() => vi.fn()),
    listMcpServers: vi
      .fn()
      .mockResolvedValue({ servers: [], summary: { total: 0, connected: 0, connecting: 0, failed: 0 } }),
    listSkills: vi.fn().mockResolvedValue({ skills: [] }),
    stream: vi.fn(async function* () {}),
  };
}

describe('DroidSdkAgent system CLI env handling', () => {
  beforeEach(() => {
    createSessionMock.mockReset();
    resumeSessionMock.mockReset();
    getEnhancedEnvMock.mockReset();
    getEnhancedEnvMock.mockReturnValue({ PATH: '/system/bin' });
    resolveWorkingDroidCliMock.mockReset();
    resolveWorkingDroidCliMock.mockReturnValue({
      execPath: 'node',
      execArgs: ['/Users/test/AppData/Roaming/npm/node_modules/@factory/cli/bin/droid'],
      cliPath: null,
      source: 'system',
      version: '1.0.0',
    });
    mainLogMock.mockReset();
    mainWarnMock.mockReset();
  });

  it('starts fresh sessions with bundled droid removed from PATH when using the system CLI', async () => {
    const env = { PATH: '/system/bin' };
    createSessionMock.mockResolvedValue(buildSessionStub('session-create-env'));

    const agent = new DroidSdkAgent({
      id: 'conv-create-env',
      workingDir: '/tmp',
      onStreamEvent: vi.fn(),
    });

    await agent.start();

    expect(getEnhancedEnvMock).toHaveBeenCalledWith(undefined, {
      includeBundledDroidInPath: false,
    });
    expect(createSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        execPath: 'node',
        // Tail-merged by `composeSdkExecArgs`: the resolver-supplied launch
        // prefix must be followed by the SDK's stream-jsonrpc args, otherwise
        // droid spawns in interactive TUI mode and initialize_session hangs.
        execArgs: [
          '/Users/test/AppData/Roaming/npm/node_modules/@factory/cli/bin/droid',
          'exec',
          '--input-format',
          'stream-jsonrpc',
          '--output-format',
          'stream-jsonrpc',
        ],
        env,
      })
    );
  });

  it('resumes sessions with the same system-only PATH rule', async () => {
    const env = { PATH: '/system/bin' };
    resumeSessionMock.mockResolvedValue(buildSessionStub('session-resume-env'));

    const agent = new DroidSdkAgent({
      id: 'conv-resume-env',
      workingDir: '/tmp',
      acpSessionId: 'session-existing',
      onStreamEvent: vi.fn(),
    });

    await agent.start();

    expect(getEnhancedEnvMock).toHaveBeenCalledWith(undefined, {
      includeBundledDroidInPath: false,
    });
    expect(resumeSessionMock).toHaveBeenCalledWith(
      'session-existing',
      expect.objectContaining({
        execPath: 'node',
        // Same tail-merge rationale as createSession: the resume path feeds
        // the resolver prefix + SDK stream-jsonrpc args so the reconnected
        // droid process still speaks JSON-RPC rather than starting a TUI.
        execArgs: [
          '/Users/test/AppData/Roaming/npm/node_modules/@factory/cli/bin/droid',
          'exec',
          '--input-format',
          'stream-jsonrpc',
          '--output-format',
          'stream-jsonrpc',
        ],
        env,
      })
    );
  });
});
