import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DroidSdkAgent } from '@/process/agent/droid/DroidSdkAgent';

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

vi.mock('@process/agent/droid/cliRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@process/agent/droid/cliRuntime')>();
  return {
    ...actual,
    resolveWorkingDroidCli: vi.fn((execPath?: string | null) => ({
      execPath: execPath || 'droid',
      cliPath: execPath || 'droid',
      source: 'system',
      version: '1.0.0',
    })),
  };
});

describe('DroidSdkAgent', () => {
  beforeEach(() => {
    createSessionMock.mockReset();
    resumeSessionMock.mockReset();
    mainLogMock.mockReset();
    mainWarnMock.mockReset();
  });

  it('injects the AskUser format reminder ahead of legacy @file references', async () => {
    // Legacy / historical content (cron / plugin-saved messages) may arrive with
    // a `@path` prefix already embedded in the text body. The new native-attachment
    // path in `DroidSdkAgent.sendMessageInternal` MUST preserve those verbatim and
    // still inject the AskUser reminder in front of them. This test asserts the
    // ordering invariant on the legacy branch.
    let streamedPrompt = '';
    const session = {
      sessionId: 'session-1',
      updateSettings: vi.fn(),
      close: vi.fn(),
      interrupt: vi.fn(),
      stream: vi.fn(async function* (prompt: string) {
        streamedPrompt = prompt;
        yield* [];
      }),
    };
    createSessionMock.mockResolvedValue(session);

    const agent = new DroidSdkAgent({
      id: 'conv-1',
      workingDir: '/tmp',
      onStreamEvent: vi.fn(),
    });

    await agent.start();
    await agent.sendMessage({
      content: '@/tmp/example.txt 请先问我一个问题',
      msg_id: 'msg-1',
    });

    expect(streamedPrompt).toContain('When using the AskUser tool');
    expect(streamedPrompt).toContain('@/tmp/example.txt');
    expect(streamedPrompt.indexOf('<system-reminder>')).toBeLessThan(streamedPrompt.indexOf('@/tmp/example.txt'));
  });

  it('prepends @path refs (legacy) for local file attachments to avoid CLI-side base64 stall', async () => {
    // Regression guard: the native `MessageOptions.images/files` channel
    // caused `droid.add_user_message` to stall for minutes on large base64
    // payloads because the JSON-RPC handler blocks while parsing the blob.
    // Since the Droid CLI runs locally and can mmap files directly from
    // disk, we now ALWAYS route local attachments via the legacy `@path`
    // text prepend and keep `MessageOptions` free of `images/files`.
    const tmp = await mkdtemp(join(tmpdir(), 'droid-agent-attach-'));
    try {
      const file = join(tmp, 'note.txt');
      await writeFile(file, 'hello', 'utf-8');

      let streamedPrompt = '';
      let streamOptions: Record<string, unknown> | undefined;
      const session = {
        sessionId: 'session-attach-native',
        updateSettings: vi.fn(),
        close: vi.fn(),
        interrupt: vi.fn(),
        stream: vi.fn(async function* (prompt: string, options?: Record<string, unknown>) {
          streamedPrompt = prompt;
          streamOptions = options;
          yield* [];
        }),
      };
      createSessionMock.mockResolvedValue(session);

      const agent = new DroidSdkAgent({
        id: 'conv-native',
        workingDir: '/tmp',
        onStreamEvent: vi.fn(),
      });

      await agent.start();
      await agent.sendMessage({
        content: '请分析附件',
        files: [file],
        msg_id: 'msg-native',
      });

      expect(streamedPrompt).toContain('When using the AskUser tool');
      // Legacy `@path` prepend MUST appear so Droid CLI can mmap the file.
      expect(streamedPrompt).toContain(`@${file}`);
      // Native options MUST NOT be set — base64 payloads cause CLI stalls.
      expect(streamOptions).toBeUndefined();
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('injects a spec-mode planning reminder instead of the generic AskUser reminder', async () => {
    let streamedPrompt = '';
    const session = {
      sessionId: 'session-spec-1',
      updateSettings: vi.fn(),
      close: vi.fn(),
      interrupt: vi.fn(),
      stream: vi.fn(async function* (prompt: string) {
        streamedPrompt = prompt;
        yield* [];
      }),
    };
    createSessionMock.mockResolvedValue(session);

    const agent = new DroidSdkAgent({
      id: 'conv-spec-1',
      workingDir: '/tmp',
      sessionMode: 'spec',
      onStreamEvent: vi.fn(),
    });

    await agent.start();
    await agent.sendMessage({
      content: '帮我创建一个飞机大战小游戏。',
      msg_id: 'msg-spec-1',
    });

    expect(streamedPrompt).toContain('Specification Mode is active');
    expect(streamedPrompt).toContain('ExitSpecMode tool');
    expect(streamedPrompt).not.toContain('When using the AskUser tool');
  });

  it('bridges ask-user requests back through answerAskUser', async () => {
    const session = {
      sessionId: 'session-2',
      updateSettings: vi.fn(),
      close: vi.fn(),
      interrupt: vi.fn(),
      stream: vi.fn(async function* () {}),
    };
    createSessionMock.mockResolvedValue(session);
    const onAskUserRequest = vi.fn();

    const agent = new DroidSdkAgent({
      id: 'conv-2',
      workingDir: '/tmp',
      onStreamEvent: vi.fn(),
      onAskUserRequest,
    });

    await agent.start();
    const options = createSessionMock.mock.calls[0]?.[0];
    expect(options?.askUserHandler).toBeTypeOf('function');

    const askUserPromise = options.askUserHandler({
      toolCallId: 'ask-user-1',
      questions: [
        {
          index: 1,
          topic: 'Task',
          question: '需要我做什么？',
          options: ['写代码', '修 bug'],
        },
      ],
    });

    expect(onAskUserRequest).toHaveBeenCalledWith({
      callId: 'ask-user-1',
      questions: [
        {
          index: 1,
          topic: 'Task',
          question: '需要我做什么？',
          options: ['写代码', '修 bug'],
        },
      ],
    });

    await agent.answerAskUser({
      callId: 'ask-user-1',
      result: {
        cancelled: false,
        answers: [{ index: 1, question: '需要我做什么？', answer: '写代码' }],
      },
    });

    await expect(askUserPromise).resolves.toEqual({
      cancelled: false,
      answers: [{ index: 1, question: '需要我做什么？', answer: '写代码' }],
    });
  });

  it('maps spec mode to SDK interaction settings', async () => {
    const session = {
      sessionId: 'session-3',
      updateSettings: vi.fn(),
      close: vi.fn(),
      interrupt: vi.fn(),
      stream: vi.fn(async function* () {}),
    };
    createSessionMock.mockResolvedValue(session);

    const agent = new DroidSdkAgent({
      id: 'conv-3',
      workingDir: '/tmp',
      sessionMode: 'spec',
      onStreamEvent: vi.fn(),
    });

    await agent.start();

    expect(createSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        interactionMode: 'spec',
        autonomyLevel: 'off',
      })
    );

    await agent.setMode('auto');

    expect(session.updateSettings).toHaveBeenLastCalledWith({
      interactionMode: 'auto',
      autonomyLevel: 'medium',
    });
  });

  it('applies configured spec-mode model settings immediately after session creation', async () => {
    const session = {
      sessionId: 'session-spec-config',
      updateSettings: vi.fn(),
      close: vi.fn(),
      interrupt: vi.fn(),
      stream: vi.fn(async function* () {}),
    };
    createSessionMock.mockResolvedValue(session);

    const agent = new DroidSdkAgent({
      id: 'conv-spec-config',
      workingDir: '/tmp',
      modelId: 'claude-opus-4-6',
      pendingConfigOptions: {
        spec_mode_model: 'claude-sonnet-4-6',
        spec_mode_reasoning_effort: 'low',
      },
      onStreamEvent: vi.fn(),
    });

    await agent.start();

    expect(createSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: 'claude-opus-4-6',
      })
    );
    expect(session.updateSettings).toHaveBeenCalledWith({
      specModeModelId: 'claude-sonnet-4-6',
      specModeReasoningEffort: 'low',
    });
  });

  it('updates the prompt preamble after switching into spec mode', async () => {
    let streamedPrompt = '';
    const session = {
      sessionId: 'session-spec-2',
      updateSettings: vi.fn(),
      close: vi.fn(),
      interrupt: vi.fn(),
      stream: vi.fn(async function* (prompt: string) {
        streamedPrompt = prompt;
        yield* [];
      }),
    };
    createSessionMock.mockResolvedValue(session);

    const agent = new DroidSdkAgent({
      id: 'conv-spec-2',
      workingDir: '/tmp',
      onStreamEvent: vi.fn(),
    });

    await agent.start();
    await agent.setMode('spec');
    await agent.sendMessage({
      content: '实现一个新功能',
      msg_id: 'msg-spec-2',
    });

    expect(streamedPrompt).toContain('Specification Mode is active');
    expect(streamedPrompt).not.toContain('When using the AskUser tool');
  });

  it('preserves SDK permission options for spec approval requests', async () => {
    const session = {
      sessionId: 'session-4',
      updateSettings: vi.fn(),
      close: vi.fn(),
      interrupt: vi.fn(),
      stream: vi.fn(async function* () {}),
    };
    createSessionMock.mockResolvedValue(session);
    const onStreamEvent = vi.fn();

    const agent = new DroidSdkAgent({
      id: 'conv-4',
      workingDir: '/tmp',
      onStreamEvent,
    });

    await agent.start();
    const options = createSessionMock.mock.calls[0]?.[0];
    expect(options?.permissionHandler).toBeTypeOf('function');

    const permissionPromise = options.permissionHandler({
      toolUses: [
        {
          toolUse: {
            id: 'spec-review-1',
            name: 'ExitSpecMode',
            input: {},
          },
          confirmationType: 'exit_spec_mode',
          details: {
            type: 'exit_spec_mode',
            plan: '# 计划\n\n- 添加 SPEC 按钮',
            title: 'SPEC Review',
            optionNames: ['继续', '保留'],
          },
        },
      ],
      options: [
        { label: 'Proceed with implementation', value: 'proceed_once' },
        { label: 'Proceed, and allow reversible commands (Medium)', value: 'proceed_auto_run_medium' },
        { label: 'No, keep iterating on spec', value: 'cancel' },
      ],
    });

    expect(onStreamEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'acp_permission',
        data: expect.objectContaining({
          options: [
            {
              optionId: 'proceed_once',
              name: 'Proceed with implementation',
              kind: 'allow_once',
            },
            {
              optionId: 'proceed_auto_run_medium',
              name: 'Proceed, and allow reversible commands (Medium)',
              kind: 'allow_once',
            },
            {
              optionId: 'cancel',
              name: 'No, keep iterating on spec',
              kind: 'reject_once',
            },
          ],
          toolCall: expect.objectContaining({
            title: 'SPEC Review',
            kind: 'exit_spec_mode',
            rawInput: expect.objectContaining({
              plan: '# 计划\n\n- 添加 SPEC 按钮',
              description: '# 计划\n\n- 添加 SPEC 按钮',
              title: 'SPEC Review',
              optionNames: ['继续', '保留'],
            }),
          }),
        }),
      })
    );

    await agent.confirmMessage({
      confirmKey: 'cancel',
      callId: 'spec-review-1',
    });

    await expect(permissionPromise).resolves.toBe('cancel');
  });

  it('subscribes to session.onNotification on start and unsubscribes on kill', async () => {
    const unsubscribeMock = vi.fn();
    const onNotificationMock = vi.fn(() => unsubscribeMock);
    const session = {
      sessionId: 'session-notifications',
      updateSettings: vi.fn(),
      close: vi.fn(),
      interrupt: vi.fn(),
      stream: vi.fn(async function* () {}),
      onNotification: onNotificationMock,
    };
    createSessionMock.mockResolvedValue(session);

    const agent = new DroidSdkAgent({
      id: 'conv-notifications',
      workingDir: '/tmp',
      onStreamEvent: vi.fn(),
    });

    await agent.start();
    expect(onNotificationMock).toHaveBeenCalledTimes(1);
    expect(typeof onNotificationMock.mock.calls[0][0]).toBe('function');

    await agent.kill();
    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
  });

  it('dispatches session_title_updated notifications to onStreamEvent', async () => {
    let capturedCallback: ((notification: Record<string, unknown>) => void) | null = null;
    const session = {
      sessionId: 'session-title-push',
      updateSettings: vi.fn(),
      close: vi.fn(),
      interrupt: vi.fn(),
      stream: vi.fn(async function* () {}),
      onNotification: vi.fn((cb: (notification: Record<string, unknown>) => void) => {
        capturedCallback = cb;
        return vi.fn();
      }),
    };
    createSessionMock.mockResolvedValue(session);

    const onStreamEvent = vi.fn();
    const agent = new DroidSdkAgent({
      id: 'conv-title-push',
      workingDir: '/tmp',
      onStreamEvent,
    });

    await agent.start();
    expect(capturedCallback).toBeTypeOf('function');

    capturedCallback!({
      type: 'session_title_updated',
      title: 'New Title From SDK',
    });

    expect(onStreamEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'session_title',
        conversation_id: 'conv-title-push',
        data: expect.objectContaining({
          sessionId: 'session-title-push',
          title: 'New Title From SDK',
        }),
      })
    );
  });

  // ── "真 YOLO" (skipPermissionsUnsafe) 二次确认流 ────────────────────
  // SKILL P0-3 硬约束：
  // - YOLO 模式默认 MUST NOT 携带 skipPermissionsUnsafe: true
  // - 必须 UI 弹窗显式确认后调用 setSkipPermissionsUnsafe(true) 才能启用
  // - 离开 YOLO / 传入 false 必须清除状态
  describe('skipPermissionsUnsafe ("真 YOLO" second-confirm gate)', () => {
    it('does NOT set skipPermissionsUnsafe by default when starting in yolo mode', async () => {
      const session = {
        sessionId: 'session-yolo-default',
        updateSettings: vi.fn(),
        close: vi.fn(),
        interrupt: vi.fn(),
        stream: vi.fn(async function* () {}),
      };
      createSessionMock.mockResolvedValue(session);

      const agent = new DroidSdkAgent({
        id: 'conv-yolo-default',
        workingDir: '/tmp',
        sessionMode: 'yolo',
        onStreamEvent: vi.fn(),
      });

      await agent.start();

      // YOLO autonomy + interactionMode must be pushed, but
      // skipPermissionsUnsafe MUST be absent (default false).
      const options = createSessionMock.mock.calls[0]?.[0];
      expect(options).toEqual(
        expect.objectContaining({
          interactionMode: 'auto',
          autonomyLevel: 'high',
        })
      );
      expect(options).not.toHaveProperty('skipPermissionsUnsafe');

      // Post-init updateSettings MUST NOT have pushed the unsafe flag either.
      const unsafePushes = session.updateSettings.mock.calls.filter(
        (call) => (call[0] as Record<string, unknown>)?.skipPermissionsUnsafe !== undefined
      );
      expect(unsafePushes).toHaveLength(0);
      expect(agent.isSkipPermissionsUnsafeConfirmed).toBe(false);
    });

    it('setSkipPermissionsUnsafe(true) pushes the flag via updateSettings for an active yolo session', async () => {
      const session = {
        sessionId: 'session-yolo-confirm',
        updateSettings: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        interrupt: vi.fn(),
        stream: vi.fn(async function* () {}),
      };
      createSessionMock.mockResolvedValue(session);

      const agent = new DroidSdkAgent({
        id: 'conv-yolo-confirm',
        workingDir: '/tmp',
        sessionMode: 'yolo',
        onStreamEvent: vi.fn(),
      });

      await agent.start();
      session.updateSettings.mockClear();

      const result = await agent.setSkipPermissionsUnsafe(true);
      expect(result.success).toBe(true);
      expect(agent.isSkipPermissionsUnsafeConfirmed).toBe(true);
      expect(session.updateSettings).toHaveBeenCalledWith({ skipPermissionsUnsafe: true });
    });

    it('setSkipPermissionsUnsafe(true) followed by setMode("yolo") creates a YOLO session carrying the flag', async () => {
      const session = {
        sessionId: 'session-yolo-switch',
        updateSettings: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        interrupt: vi.fn(),
        stream: vi.fn(async function* () {}),
      };
      createSessionMock.mockResolvedValue(session);

      // Start in default mode
      const agent = new DroidSdkAgent({
        id: 'conv-yolo-switch',
        workingDir: '/tmp',
        onStreamEvent: vi.fn(),
      });
      await agent.start();

      // User confirms real YOLO while NOT in YOLO mode yet — flag is cached,
      // no JSON-RPC update is sent (no-op).
      session.updateSettings.mockClear();
      await agent.setSkipPermissionsUnsafe(true);
      expect(session.updateSettings).not.toHaveBeenCalled();
      expect(agent.isSkipPermissionsUnsafeConfirmed).toBe(true);

      // Switch to yolo — getSessionSettingsForMode('yolo') must now include
      // skipPermissionsUnsafe:true alongside autonomy/interactionMode.
      const result = await agent.setMode('yolo');
      expect(result.success).toBe(true);
      expect(session.updateSettings).toHaveBeenCalledWith({
        interactionMode: 'auto',
        autonomyLevel: 'high',
        skipPermissionsUnsafe: true,
      });
    });

    it('leaving yolo mode after setSkipPermissionsUnsafe(false) clears the flag for subsequent mode switches', async () => {
      const session = {
        sessionId: 'session-yolo-leave',
        updateSettings: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        interrupt: vi.fn(),
        stream: vi.fn(async function* () {}),
      };
      createSessionMock.mockResolvedValue(session);

      const agent = new DroidSdkAgent({
        id: 'conv-yolo-leave',
        workingDir: '/tmp',
        sessionMode: 'yolo',
        onStreamEvent: vi.fn(),
      });

      await agent.start();
      await agent.setSkipPermissionsUnsafe(true);
      expect(agent.isSkipPermissionsUnsafeConfirmed).toBe(true);

      // Leave YOLO by clearing the flag first, then switching to auto.
      // Once the flag is off and we re-enter YOLO later, the unsafe field
      // MUST NOT be re-pushed until the user confirms again.
      session.updateSettings.mockClear();
      await agent.setSkipPermissionsUnsafe(false);
      expect(agent.isSkipPermissionsUnsafeConfirmed).toBe(false);
      // Live YOLO session + turn-off → server must receive false.
      expect(session.updateSettings).toHaveBeenCalledWith({ skipPermissionsUnsafe: false });

      session.updateSettings.mockClear();
      await agent.setMode('auto');
      // Switching to auto must NOT leak skipPermissionsUnsafe into the payload.
      expect(session.updateSettings).toHaveBeenCalledWith({
        interactionMode: 'auto',
        autonomyLevel: 'medium',
      });
      const mergedCall = session.updateSettings.mock.calls.find(
        (call) => (call[0] as Record<string, unknown>)?.skipPermissionsUnsafe !== undefined
      );
      expect(mergedCall).toBeUndefined();

      // Re-entering YOLO must also NOT re-push the flag without a new confirmation.
      session.updateSettings.mockClear();
      await agent.setMode('yolo');
      const yoloCall = session.updateSettings.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(yoloCall).toEqual({
        interactionMode: 'auto',
        autonomyLevel: 'high',
      });
    });

    it('rolls back confirmed state when updateSettings rejects', async () => {
      const session = {
        sessionId: 'session-yolo-fail',
        updateSettings: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        interrupt: vi.fn(),
        stream: vi.fn(async function* () {}),
      };
      createSessionMock.mockResolvedValue(session);

      const agent = new DroidSdkAgent({
        id: 'conv-yolo-fail',
        workingDir: '/tmp',
        sessionMode: 'yolo',
        onStreamEvent: vi.fn(),
      });
      await agent.start();
      expect(agent.isSkipPermissionsUnsafeConfirmed).toBe(false);

      // Arm the next updateSettings call to reject so the setter path exercises
      // its rollback branch. Any earlier bootstrap calls (none are expected in
      // this setup without spec-mode config) already resolved via mockResolvedValue.
      session.updateSettings.mockRejectedValueOnce(new Error('CLI rejected skipPermissionsUnsafe'));

      const result = await agent.setSkipPermissionsUnsafe(true);
      expect(result.success).toBe(false);
      expect(result.error).toContain('CLI rejected skipPermissionsUnsafe');
      // Rollback: state must return to the previous false.
      expect(agent.isSkipPermissionsUnsafeConfirmed).toBe(false);
    });

    it('bypassPermissions mode id is also gated by the same confirmed flag', async () => {
      const session = {
        sessionId: 'session-bypass',
        updateSettings: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        interrupt: vi.fn(),
        stream: vi.fn(async function* () {}),
      };
      createSessionMock.mockResolvedValue(session);

      const agent = new DroidSdkAgent({
        id: 'conv-bypass',
        workingDir: '/tmp',
        sessionMode: 'bypassPermissions',
        onStreamEvent: vi.fn(),
      });
      await agent.start();

      // Default (not confirmed): createSession MUST NOT carry skipPermissionsUnsafe.
      const options = createSessionMock.mock.calls[0]?.[0];
      expect(options).toEqual(
        expect.objectContaining({
          interactionMode: 'auto',
          autonomyLevel: 'high',
        })
      );
      expect(options).not.toHaveProperty('skipPermissionsUnsafe');
    });
  });

  describe('pipe-compatibility gate (Windows cmd.exe shell wrapper regression)', () => {
    it('refuses to create a session when the resolver returns a non-pipe-compatible cmd.exe wrapper', async () => {
      // Tester's v0.108.0 log: cmd.exe /c droid.cmd answers --version but the
      // SDK's `droid.initialize_session` hangs 60s through cmd.exe's stdio
      // layer (CRLF translation, stdin EOF, ConPTY). The agent must fail fast
      // with an actionable error message rather than silently time out.
      const { resolveWorkingDroidCli } = await import('@process/agent/droid/cliRuntime');
      (resolveWorkingDroidCli as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        execPath: 'cmd.exe',
        execArgs: ['/d', '/s', '/c', 'C:/Users/qwq/AppData/Roaming/npm/droid.cmd'],
        cliPath: null,
        source: 'system',
        version: '0.108.0',
        pipeCompatible: false,
      });

      const streamEvents: unknown[] = [];
      const agent = new DroidSdkAgent({
        id: 'conv-cmd-exe',
        workingDir: '/tmp',
        onStreamEvent: (msg: unknown) => streamEvents.push(msg),
      });

      await expect(agent.start()).rejects.toThrow(/cmd\.exe|JSON-RPC|@factory\/cli/);
      expect(createSessionMock).not.toHaveBeenCalled();
    });

    it('tail-merges SDK stream-jsonrpc args onto the node + JS launch prefix when starting a session', async () => {
      // Root cause of the v0.108.0 Windows timeout regression: the resolver
      // returns `{ execPath: 'node', execArgs: ['<path to droid.js>'] }` so
      // the SDK can spawn the CLI without going through cmd.exe. But the
      // SDK's ProcessTransport fully OVERRIDES its internal DEFAULT_EXEC_ARGS
      // (`['exec', '--input-format', 'stream-jsonrpc', '--output-format',
      // 'stream-jsonrpc']`) whenever the caller passes any truthy execArgs.
      // If we only hand over the `['<path>']` prefix, droid spawns in
      // interactive TUI mode and the SDK hangs 60 s waiting for
      // `droid.initialize_session` to respond.
      //
      // The fix tail-merges the 5 SDK args via `composeSdkExecArgs` so the
      // spawned process actually speaks the JSON-RPC stream protocol.
      const { resolveWorkingDroidCli } = await import('@process/agent/droid/cliRuntime');
      (resolveWorkingDroidCli as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        execPath: 'node',
        execArgs: ['C:/Users/qwq/AppData/Roaming/npm/node_modules/droid/bin/droid'],
        cliPath: null,
        source: 'system',
        version: '0.108.0',
        pipeCompatible: true,
      });

      const session = {
        sessionId: 'session-node-shim',
        updateSettings: vi.fn(),
        close: vi.fn(),
        interrupt: vi.fn(),
        stream: vi.fn(async function* () {
          yield* [];
        }),
      };
      createSessionMock.mockResolvedValue(session);

      const agent = new DroidSdkAgent({
        id: 'conv-node-shim',
        workingDir: '/tmp',
        onStreamEvent: vi.fn(),
      });

      await agent.start();

      expect(createSessionMock).toHaveBeenCalledTimes(1);
      const options = createSessionMock.mock.calls[0]?.[0];
      expect(options).toMatchObject({
        execPath: 'node',
        execArgs: [
          'C:/Users/qwq/AppData/Roaming/npm/node_modules/droid/bin/droid',
          'exec',
          '--input-format',
          'stream-jsonrpc',
          '--output-format',
          'stream-jsonrpc',
        ],
      });
    });

    it('emits an actionable conversation error when the Windows CLI is missing from PATH', async () => {
      const { resolveWorkingDroidCli } = await import('@process/agent/droid/cliRuntime');
      (resolveWorkingDroidCli as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        execPath: 'droid',
        cliPath: null,
        source: 'system',
        version: null,
        error: 'spawnSync droid ENOENT',
        diagnostic: {
          code: 'cli-not-found',
          stage: 'preflight',
          detail: 'spawnSync droid ENOENT',
        },
      });
      createSessionMock.mockRejectedValue(new Error('spawnSync droid ENOENT'));

      const streamEvents: Array<Record<string, unknown>> = [];
      const agent = new DroidSdkAgent({
        id: 'conv-missing-cli',
        workingDir: '/tmp',
        onStreamEvent: (message) => streamEvents.push(message as Record<string, unknown>),
      });

      await expect(agent.start()).rejects.toThrow('spawnSync droid ENOENT');

      expect(streamEvents).toContainEqual(
        expect.objectContaining({
          type: 'error',
          data: expect.stringContaining('Droid CLI is not installed or is not available on PATH'),
        })
      );
    });
  });
});
