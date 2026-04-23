/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * m1-f3 — AcpAgentManager.skillsWatcher first-class re-broadcast pipeline.
 *
 * Covers assertions:
 *   - VAL-SKILLS-006: file-change event on a watched skills directory (post
 *     500ms debounce) MUST (1) call `AcpSkillManager.invalidate()`,
 *     (2) call `DroidSdkAgent.syncSdkSkills()` exactly once, and
 *     (3) forward a `slash_commands_updated` event with
 *     `data.source === 'skills-watcher'`.
 *   - VAL-SKILLS-007: `startSkillsWatcher()` MUST register `fs.watch` on
 *     three distinct roots — `getSkillsDir()`, `getBuiltinSkillsCopyDir()`,
 *     and the autoSkills directory — and a file-change on ANY root MUST
 *     trigger the debounced pipeline from VAL-SKILLS-006.
 *
 * The 500ms debounce is preserved from the pre-existing watcher: multiple
 * file events arriving in under 500ms collapse into a single pipeline
 * invocation. Multiple pipelines fire if events straddle the debounce
 * boundary.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- Hoisted test fakes -----------------------------------------------------

const {
  fsWatchMock,
  emitMock,
  invalidateMock,
  syncSdkSkillsMock,
  droidSdkAgentCtor,
  mainLogMock,
  mainWarnMock,
  mainErrorMock,
} = vi.hoisted(() => {
  const fsWatchMock = vi.fn();
  const emitMock = vi.fn();
  const invalidateMock = vi.fn();
  const syncSdkSkillsMock = vi.fn(async () => {});
  // Constructor-style mock so `instanceof` checks still pass.
  const droidSdkAgentCtor = vi.fn(function (this: Record<string, unknown>) {
    this.syncSdkSkills = syncSdkSkillsMock;
    this.sendMessage = vi.fn(async () => ({ success: true }));
    this.getModelInfo = vi.fn(() => null);
    this.getSessionState = vi.fn(() => null);
    this.start = vi.fn(async () => {});
    this.stop = vi.fn();
    this.kill = vi.fn();
    this.on = vi.fn().mockReturnThis();
  }) as unknown as new (...args: unknown[]) => unknown;
  return {
    fsWatchMock,
    emitMock,
    invalidateMock,
    syncSdkSkillsMock,
    droidSdkAgentCtor,
    mainLogMock: vi.fn(),
    mainWarnMock: vi.fn(),
    mainErrorMock: vi.fn(),
  };
});

// --- Module mocks -----------------------------------------------------------

vi.mock('fs', () => ({
  default: { watch: fsWatchMock },
  watch: fsWatchMock,
}));

vi.mock('@process/utils/initStorage', () => ({
  getSkillsDir: () => '/mock/skills/user',
  getBuiltinSkillsCopyDir: () => '/mock/skills/builtin',
  getAutoSkillsDir: () => '/mock/skills/builtin/_builtin',
  ProcessConfig: { get: vi.fn(async () => null), set: vi.fn(async () => {}) },
}));

vi.mock('@/common/platform', () => ({
  getPlatformServices: () => ({
    paths: { isPackaged: () => false, getAppPath: () => null },
    worker: {
      fork: vi.fn(() => ({
        on: vi.fn().mockReturnThis(),
        postMessage: vi.fn(),
        kill: vi.fn(),
      })),
    },
  }),
}));

vi.mock('@process/utils/shellEnv', () => ({
  getEnhancedEnv: vi.fn(() => ({})),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    acpConversation: { responseStream: { emit: emitMock } },
    conversation: {
      confirmation: {
        add: { emit: vi.fn() },
        update: { emit: vi.fn() },
        remove: { emit: vi.fn() },
      },
      responseStream: { emit: vi.fn() },
      listChanged: { emit: vi.fn() },
    },
  },
}));

vi.mock('@process/channels/agent/ChannelEventBus', () => ({
  channelEventBus: { emitAgentMessage: vi.fn() },
}));

vi.mock('@process/team/teamEventBus', () => ({
  teamEventBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
}));

vi.mock('@process/services/database', () => ({
  getDatabase: vi.fn(async () => ({
    updateConversation: vi.fn(),
    getConversation: vi.fn(() => ({ success: false, data: null })),
  })),
}));

vi.mock('@process/utils/message', () => ({
  addMessage: vi.fn(),
  addOrUpdateMessage: vi.fn(),
  flushConversationMessages: vi.fn(),
  nextTickToLocalFinish: vi.fn(),
}));

vi.mock('@process/utils/previewUtils', () => ({
  handlePreviewOpenEvent: vi.fn(),
}));

vi.mock('@process/services/cron/CronBusyGuard', () => ({
  cronBusyGuard: { setProcessing: vi.fn() },
}));

vi.mock('@process/utils/mainLogger', () => ({
  mainLog: mainLogMock,
  mainWarn: mainWarnMock,
  mainError: mainErrorMock,
}));

vi.mock('@process/extensions', () => ({
  ExtensionRegistry: { getInstance: () => ({ getAcpAdapters: () => [], getSkills: () => [] }) },
}));

vi.mock('@/common/utils', () => ({
  parseError: vi.fn((e: unknown) => String(e)),
  uuid: vi.fn(() => 'mock-uuid'),
}));

vi.mock('@process/task/MessageMiddleware', () => ({
  extractTextFromMessage: vi.fn(),
  processCronInMessage: vi.fn(),
}));

vi.mock('@process/task/ThinkTagDetector', () => ({
  extractAndStripThinkTags: vi.fn((s: string) => ({ thinkContent: '', cleanedContent: s })),
  stripThinkTags: vi.fn((s: string) => s),
}));

vi.mock('@process/task/CronCommandDetector', () => ({
  hasCronCommands: vi.fn(() => false),
}));

vi.mock('@process/services/cron/SkillSuggestWatcher', () => ({
  skillSuggestWatcher: { onFinish: vi.fn() },
}));

vi.mock('@process/utils/initAgent', () => ({
  hasNativeSkillSupport: vi.fn(() => true),
  setupAssistantWorkspace: vi.fn(),
}));

vi.mock('@process/task/agentUtils', () => ({
  prepareFirstMessageWithSkillsIndex: vi.fn(async (c: string) => c),
  buildSystemInstructions: vi.fn(async () => undefined),
}));

// AcpSkillManager: keep the real module for buildSkillsIndexText / getInstance,
// but swap in a spy for the static `invalidate` used by the watcher.
vi.mock('@process/task/AcpSkillManager', async () => {
  const actual = (await vi.importActual('@process/task/AcpSkillManager')) as {
    AcpSkillManager: typeof import('@process/task/AcpSkillManager').AcpSkillManager;
    buildSkillsIndexText: (entries: unknown[]) => string;
  };
  return {
    AcpSkillManager: {
      ...actual.AcpSkillManager,
      invalidate: invalidateMock,
      getInstance: actual.AcpSkillManager.getInstance.bind(actual.AcpSkillManager),
      resetInstance: actual.AcpSkillManager.resetInstance.bind(actual.AcpSkillManager),
    },
    buildSkillsIndexText: actual.buildSkillsIndexText,
  };
});

// DroidSdkAgent: constructor-shaped mock so `this.agent instanceof DroidSdkAgent`
// remains truthy when the AcpAgentManager test swaps the agent in directly.
vi.mock('@process/agent/droid', () => ({
  DroidSdkAgent: droidSdkAgentCtor,
}));

vi.mock('@process/agent/droid/runtime/config', () => ({
  isDroidChannelPlatform: () => false,
}));

vi.mock('@process/agent/droid/runtime/DroidTextAskBridge', () => ({
  DroidTextAskBridge: vi.fn().mockImplementation(() => ({ formatPrompt: vi.fn() })),
}));

vi.mock('@process/agent/acp', () => ({
  AcpAgent: vi.fn().mockImplementation(() => ({
    sendMessage: vi.fn(async () => ({ success: true })),
    getModelInfo: vi.fn(() => null),
    getSessionState: vi.fn(() => null),
    start: vi.fn(async () => {}),
    stop: vi.fn(),
    kill: vi.fn(),
    on: vi.fn().mockReturnThis(),
  })),
}));

vi.mock('@process/task/codexConfig', () => ({
  getCodexSandboxModeForSessionMode: vi.fn(() => 'default'),
  writeCodexSandboxMode: vi.fn(async () => {}),
}));

import AcpAgentManager from '@process/task/AcpAgentManager';
import { DroidSdkAgent } from '@process/agent/droid';

// --- Helpers ----------------------------------------------------------------

type FsWatchCall = {
  path: string;
  options: { persistent?: boolean; recursive?: boolean };
  callback: (event: string, filename: string | Buffer) => void;
  watcher: { close: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> };
};

function setupFsWatchMock(): FsWatchCall[] {
  const calls: FsWatchCall[] = [];
  fsWatchMock.mockImplementation(
    (
      targetPath: string,
      options: { persistent?: boolean; recursive?: boolean },
      callback: (event: string, filename: string | Buffer) => void
    ) => {
      const watcher = {
        close: vi.fn(),
        on: vi.fn().mockReturnThis(),
      };
      calls.push({ path: targetPath, options, callback, watcher });
      return watcher;
    }
  );
  return calls;
}

function createDroidManager(): InstanceType<typeof AcpAgentManager> {
  const data = {
    conversation_id: 'conv-skills-watcher',
    backend: 'droid' as const,
    workspace: '/tmp/skills-watcher-test',
  };
  // @ts-expect-error — narrow construction for testing
  const manager = new AcpAgentManager(data);
  // Inject a DroidSdkAgent instance so `instanceof` guards in startSkillsWatcher
  // pick the droid code path without driving a full session bootstrap.
  (manager as unknown as { agent: unknown }).agent = new DroidSdkAgent({
    id: 'conv-skills-watcher',
    workingDir: '/tmp/skills-watcher-test',
  } as never);
  return manager;
}

function invokeStartSkillsWatcher(manager: InstanceType<typeof AcpAgentManager>): void {
  (manager as unknown as { startSkillsWatcher: () => void }).startSkillsWatcher();
}

function invokeStopSkillsWatcher(manager: InstanceType<typeof AcpAgentManager>): void {
  (manager as unknown as { stopSkillsWatcher: () => void }).stopSkillsWatcher();
}

type SlashCommandsUpdatedEvent = {
  type: 'slash_commands_updated';
  conversation_id: string;
  msg_id: string;
  data: { source?: string };
};

function getWatcherSlashEvents(): SlashCommandsUpdatedEvent[] {
  return emitMock.mock.calls
    .map((call) => call[0] as { type?: string; data?: { source?: string } } | undefined)
    .filter(
      (event): event is SlashCommandsUpdatedEvent =>
        event?.type === 'slash_commands_updated' && event?.data?.source === 'skills-watcher'
    );
}

// --- Test suite -------------------------------------------------------------

describe('AcpAgentManager.skillsWatcher — droid SDK re-broadcast pipeline', () => {
  let watchCalls: FsWatchCall[];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    watchCalls = setupFsWatchMock();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('watches user, builtin, and autoSkills directories (VAL-SKILLS-007)', () => {
    const manager = createDroidManager();

    invokeStartSkillsWatcher(manager);

    // All three roots must be registered with fs.watch.
    expect(fsWatchMock).toHaveBeenCalledTimes(3);

    const watchedPaths = new Set(watchCalls.map((call) => call.path));
    expect(watchedPaths.size).toBe(3);
    expect(watchedPaths.has('/mock/skills/user')).toBe(true);
    expect(watchedPaths.has('/mock/skills/builtin')).toBe(true);
    expect(watchedPaths.has('/mock/skills/builtin/_builtin')).toBe(true);

    // Each registration should use persistent=false + recursive=true so file
    // changes inside nested skill directories still fire callbacks.
    for (const call of watchCalls) {
      expect(call.options.persistent).toBe(false);
      expect(call.options.recursive).toBe(true);
      expect(typeof call.callback).toBe('function');
    }

    invokeStopSkillsWatcher(manager);
  });

  it('debounced watcher invalidates cache, re-syncs SDK skills, and broadcasts slash_commands_updated (VAL-SKILLS-006)', async () => {
    const manager = createDroidManager();

    invokeStartSkillsWatcher(manager);
    expect(watchCalls.length).toBe(3);

    // Fire a single filesystem event on the user skills root.
    const userCall = watchCalls.find((call) => call.path === '/mock/skills/user');
    expect(userCall).toBeDefined();
    userCall!.callback('change', 'office-cli/SKILL.md');

    // Before the 500ms debounce elapses the pipeline must NOT run.
    vi.advanceTimersByTime(499);
    expect(invalidateMock).not.toHaveBeenCalled();
    expect(syncSdkSkillsMock).not.toHaveBeenCalled();

    // Once the debounce window expires, the pipeline runs.
    vi.advanceTimersByTime(1);

    // (1) cache invalidation is synchronous inside the debounce flush.
    expect(invalidateMock).toHaveBeenCalledTimes(1);

    // (2) syncSdkSkills is awaited before the slash_commands_updated emit.
    //     Because the pipeline wraps the async path in a microtask chain,
    //     the emit is deferred until the promise resolves.
    await vi.waitFor(() => {
      expect(syncSdkSkillsMock).toHaveBeenCalledTimes(1);
    });

    await vi.waitFor(() => {
      const events = getWatcherSlashEvents();
      expect(events).toHaveLength(1);
    });

    const [event] = getWatcherSlashEvents();
    expect(event.type).toBe('slash_commands_updated');
    expect(event.conversation_id).toBe('conv-skills-watcher');
    expect(event.msg_id).toBe('');
    expect(event.data.source).toBe('skills-watcher');

    invokeStopSkillsWatcher(manager);
  });

  it('coalesces multiple rapid fs events within the debounce window into one pipeline (VAL-SKILLS-006)', async () => {
    const manager = createDroidManager();
    invokeStartSkillsWatcher(manager);

    // Fire three events — one per root — spaced below the debounce window.
    // Each event must reset the timer so the pipeline fires exactly once
    // 500ms after the LAST event, not after the first.
    watchCalls[0].callback('change', 'a/SKILL.md');
    vi.advanceTimersByTime(100);
    watchCalls[1].callback('change', 'b/SKILL.md');
    vi.advanceTimersByTime(200);
    watchCalls[2].callback('change', 'c/SKILL.md');

    // 499ms after the last (third) event — still within the debounce window,
    // so the pipeline must not have run yet.
    vi.advanceTimersByTime(499);
    expect(invalidateMock).not.toHaveBeenCalled();
    expect(syncSdkSkillsMock).not.toHaveBeenCalled();

    // Cross the 500ms threshold from the LAST event — pipeline fires once.
    vi.advanceTimersByTime(1);

    expect(invalidateMock).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(syncSdkSkillsMock).toHaveBeenCalledTimes(1);
    });
    await vi.waitFor(() => {
      expect(getWatcherSlashEvents()).toHaveLength(1);
    });

    invokeStopSkillsWatcher(manager);
  });

  it('file-change on the builtin root triggers the same pipeline (VAL-SKILLS-007)', async () => {
    const manager = createDroidManager();
    invokeStartSkillsWatcher(manager);

    const builtinCall = watchCalls.find((call) => call.path === '/mock/skills/builtin');
    expect(builtinCall).toBeDefined();
    builtinCall!.callback('change', 'pptx-tools/SKILL.md');

    vi.advanceTimersByTime(500);

    expect(invalidateMock).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(syncSdkSkillsMock).toHaveBeenCalledTimes(1);
    });
    await vi.waitFor(() => {
      expect(getWatcherSlashEvents()).toHaveLength(1);
    });

    invokeStopSkillsWatcher(manager);
  });

  it('file-change on the autoSkills root triggers the same pipeline (VAL-SKILLS-007)', async () => {
    const manager = createDroidManager();
    invokeStartSkillsWatcher(manager);

    const autoCall = watchCalls.find((call) => call.path === '/mock/skills/builtin/_builtin');
    expect(autoCall).toBeDefined();
    autoCall!.callback('change', 'aionui-skills/SKILL.md');

    vi.advanceTimersByTime(500);

    expect(invalidateMock).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(syncSdkSkillsMock).toHaveBeenCalledTimes(1);
    });
    await vi.waitFor(() => {
      expect(getWatcherSlashEvents()).toHaveLength(1);
    });

    invokeStopSkillsWatcher(manager);
  });

  it('startSkillsWatcher is idempotent — a second call does NOT create more watchers', () => {
    const manager = createDroidManager();

    invokeStartSkillsWatcher(manager);
    expect(fsWatchMock).toHaveBeenCalledTimes(3);

    invokeStartSkillsWatcher(manager);
    expect(fsWatchMock).toHaveBeenCalledTimes(3);

    invokeStopSkillsWatcher(manager);
  });

  it('mainLog fires exactly once per debounced cluster regardless of N rapid fs.watch events', async () => {
    const manager = createDroidManager();
    invokeStartSkillsWatcher(manager);

    // Simulate macOS-style burst: 5 rapid fs.watch callbacks from different
    // roots within a single debounce window (< 500ms apart).
    const rapidEventCount = 5;
    for (let i = 0; i < rapidEventCount; i++) {
      watchCalls[i % watchCalls.length].callback('change', `skill-${i}/SKILL.md`);
      vi.advanceTimersByTime(50);
    }

    // Before the debounce boundary — no log should have fired yet.
    const logCallsBefore = mainLogMock.mock.calls.filter(
      (args: unknown[]) => typeof args[1] === 'string' && args[1].includes('Skills directory changed')
    );
    expect(logCallsBefore).toHaveLength(0);

    // Cross the debounce boundary (500ms after the LAST event).
    vi.advanceTimersByTime(500);

    // Wait for async pipeline to complete.
    await vi.waitFor(() => {
      expect(syncSdkSkillsMock).toHaveBeenCalledTimes(1);
    });

    // Assert that the mainLog fires exactly once, not once per fs.watch event.
    const logCallsAfter = mainLogMock.mock.calls.filter(
      (args: unknown[]) => typeof args[1] === 'string' && args[1].includes('Skills directory changed')
    );
    expect(logCallsAfter.length).toBeLessThanOrEqual(1);
    expect(logCallsAfter).toHaveLength(1);

    invokeStopSkillsWatcher(manager);
  });

  it('stopSkillsWatcher closes every registered watcher and clears the pending debounce', () => {
    const manager = createDroidManager();
    invokeStartSkillsWatcher(manager);

    // Fire an event but stop before the debounce elapses — the pipeline
    // MUST NOT run.
    watchCalls[0].callback('change', 'x');
    vi.advanceTimersByTime(100);

    invokeStopSkillsWatcher(manager);

    for (const call of watchCalls) {
      expect(call.watcher.close).toHaveBeenCalledTimes(1);
    }

    // Advance past the original debounce window — pipeline must stay silent.
    vi.advanceTimersByTime(500);
    expect(invalidateMock).not.toHaveBeenCalled();
    expect(syncSdkSkillsMock).not.toHaveBeenCalled();
    expect(getWatcherSlashEvents()).toHaveLength(0);
  });

  it('teardown during in-flight refresh does NOT emit slash_commands_updated after stopSkillsWatcher()', async () => {
    // Arrange: make syncSdkSkills hang until we resolve it manually, so we
    // can call stopSkillsWatcher while the async pipeline is mid-flight.
    let resolveSyncSdkSkills!: () => void;
    syncSdkSkillsMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveSyncSdkSkills = resolve;
        })
    );

    const manager = createDroidManager();
    invokeStartSkillsWatcher(manager);

    // Fire a filesystem event and let the debounce expire to start the
    // refresh pipeline.
    watchCalls[0].callback('change', 'office-cli/SKILL.md');
    vi.advanceTimersByTime(500);

    // syncSdkSkills has been called but is now suspended on the pending
    // promise — the pipeline is in-flight.
    expect(syncSdkSkillsMock).toHaveBeenCalledTimes(1);
    expect(getWatcherSlashEvents()).toHaveLength(0);

    // Teardown while the pipeline is still awaiting syncSdkSkills.
    invokeStopSkillsWatcher(manager);

    // Now resolve the in-flight syncSdkSkills — the pipeline resumes, but
    // must NOT emit slash_commands_updated because the watcher is disposed.
    resolveSyncSdkSkills();
    await vi.waitFor(() => {
      // Give microtask queue time to settle after promise resolution.
      expect(syncSdkSkillsMock).toHaveBeenCalledTimes(1);
    });

    // The critical assertion: no slash_commands_updated events after teardown.
    expect(getWatcherSlashEvents()).toHaveLength(0);
  });
});
