import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolConfirmationOutcome } from '@factory/droid-sdk';
import { resolveDroidChannelRuntimeConfig } from '@/common/config/storage';
import { DroidSdkAgent } from '@process/agent/droid';
import { DroidPermissionPolicy } from '@process/agent/droid/runtime/DroidPermissionPolicy';
import { DroidRuntimeScheduler, resetDroidRuntimeSchedulers } from '@process/agent/droid/runtime/DroidRuntimeScheduler';
import { DroidTextAskBridge } from '@process/agent/droid/runtime/DroidTextAskBridge';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn(() => '/tmp'),
  },
}));

describe('DroidPermissionPolicy', () => {
  it('allows configured Execute command prefixes and denies others', () => {
    const policy = new DroidPermissionPolicy(
      resolveDroidChannelRuntimeConfig({}, { permissionMode: 'custom', allowExecCommands: ['git status'] })
    );

    expect(
      policy.evaluate({
        confirmationType: 'tool',
        toolName: 'Execute',
        toolInput: { command: 'git status --short' },
        workspace: '/tmp/workspace',
      })
    ).toMatchObject({ outcome: ToolConfirmationOutcome.ProceedOnce });

    expect(
      policy.evaluate({
        confirmationType: 'tool',
        toolName: 'Execute',
        toolInput: { command: 'npm test' },
        workspace: '/tmp/workspace',
      })
    ).toMatchObject({
      outcome: ToolConfirmationOutcome.Cancel,
      notice: expect.stringContaining('not allowlisted'),
    });
  });
});

describe('DroidTextAskBridge', () => {
  it('parses single-question numeric answers', () => {
    expect(
      DroidTextAskBridge.parseReply([{ index: 0, topic: 'Mode', question: 'Pick one', options: ['Fast', 'Safe'] }], '2')
    ).toEqual({
      ok: true,
      payload: {
        answers: [{ index: 0, question: 'Pick one', answer: 'Safe' }],
      },
    });
  });

  it('parses multi-question numbered replies', () => {
    expect(
      DroidTextAskBridge.parseReply(
        [
          { index: 0, topic: 'Mode', question: 'Pick mode', options: ['Fast', 'Safe'] },
          { index: 1, topic: 'Reason', question: 'Why?', options: [] },
        ],
        '1. 1\n2. Because it is safer'
      )
    ).toEqual({
      ok: true,
      payload: {
        answers: [
          { index: 0, question: 'Pick mode', answer: 'Fast' },
          { index: 1, question: 'Why?', answer: 'Because it is safer' },
        ],
      },
    });
  });
});

describe('DroidRuntimeScheduler', () => {
  afterEach(() => {
    resetDroidRuntimeSchedulers();
  });

  it('runs each conversation queue in FIFO order', async () => {
    const scheduler = new DroidRuntimeScheduler(
      'telegram',
      resolveDroidChannelRuntimeConfig({}, { maxConcurrentRuns: 1, maxQueuePerConversation: 4 })
    );
    const events: string[] = [];
    let releaseFirst: (() => void) | null = null;

    const first = scheduler.enqueueTurn('conv-1', async () => {
      events.push('first-start');
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      events.push('first-end');
      return 'first';
    });

    const second = scheduler.enqueueTurn('conv-1', async () => {
      events.push('second-start');
      return 'second';
    });

    await vi.waitFor(() => {
      expect(events).toEqual(['first-start']);
    });

    releaseFirst?.();
    await expect(first).resolves.toBe('first');
    await expect(second).resolves.toBe('second');
    expect(events).toEqual(['first-start', 'first-end', 'second-start']);
  });

  it('rejects new turns when reject mode is enabled and the conversation is busy', async () => {
    const scheduler = new DroidRuntimeScheduler(
      'telegram',
      resolveDroidChannelRuntimeConfig({}, { overloadStrategy: 'reject', maxConcurrentRuns: 1 })
    );
    let releaseFirst: (() => void) | null = null;

    const first = scheduler.enqueueTurn('conv-2', async () => {
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      return 'done';
    });

    await Promise.resolve();
    await expect(scheduler.enqueueTurn('conv-2', async () => 'blocked')).rejects.toThrow(
      'Droid runtime is busy for this conversation'
    );

    releaseFirst?.();
    await expect(first).resolves.toBe('done');
  });
});

describe('DroidSdkAgent published runtime', () => {
  beforeEach(() => {
    resetDroidRuntimeSchedulers();
  });

  afterEach(() => {
    resetDroidRuntimeSchedulers();
    vi.useRealTimers();
  });

  it('auto-denies non-allowlisted Execute requests without waiting for UI confirmation', () => {
    const streamEvents: Array<{ type: string; data: unknown }> = [];
    const agent = new DroidSdkAgent({
      id: 'conv-policy',
      workingDir: '/tmp/workspace',
      source: 'telegram',
      runtimeSettings: resolveDroidChannelRuntimeConfig(
        {},
        { permissionMode: 'custom', allowExecCommands: ['git status'] }
      ),
      onStreamEvent: (event) => streamEvents.push({ type: event.type, data: event.data }),
    });

    const handlePermission = (
      Reflect.get(agent, 'handlePermission') as (params: Record<string, unknown>) => string
    ).bind(agent);
    const outcome = handlePermission({
      toolUses: [
        {
          confirmationType: 'tool',
          toolUse: {
            id: 'call-1',
            name: 'Execute',
            input: { command: 'npm test' },
          },
        },
      ],
    });

    expect(outcome).toBe(ToolConfirmationOutcome.Cancel);
    expect(streamEvents.at(-1)).toMatchObject({
      type: 'content',
      data: expect.stringContaining('blocked Execute'),
    });
  });

  it('turns AskUser into a text prompt and resolves it from a later answer', async () => {
    vi.useFakeTimers();
    const streamEvents: Array<{ type: string; data: unknown }> = [];
    const askRequests: Array<{ callId: string; questions: Array<{ question: string }> }> = [];
    const agent = new DroidSdkAgent({
      id: 'conv-ask',
      workingDir: '/tmp/workspace',
      source: 'telegram',
      runtimeSettings: resolveDroidChannelRuntimeConfig({}, { askReplyTtlMs: 5_000 }),
      onStreamEvent: (event) => streamEvents.push({ type: event.type, data: event.data }),
      onAskUserRequest: (request) => askRequests.push(request),
    });

    const controller = {
      pauseForInteractive: vi.fn(),
      resumeAfterInteractive: vi.fn(async () => {}),
    };
    Reflect.set(agent, 'currentTurnController', controller);

    const handleAskUser = (
      Reflect.get(agent, 'handleAskUser') as (params: Record<string, unknown>) => Promise<Record<string, unknown>>
    ).bind(agent);

    const askPromise = handleAskUser({
      toolCallId: 'ask-1',
      questions: [{ index: 0, topic: 'Mode', question: 'Pick one', options: ['Fast', 'Safe'] }],
    });

    expect(controller.pauseForInteractive).toHaveBeenCalled();
    expect(askRequests).toHaveLength(1);
    expect(streamEvents.at(-1)).toMatchObject({
      type: 'content',
      data: expect.stringContaining('Pick one'),
    });

    await expect(
      agent.answerAskUser({
        callId: 'ask-1',
        result: {
          answers: [{ index: 0, question: 'Pick one', answer: 'Safe' }],
        },
      })
    ).resolves.toEqual({ success: true, data: null });

    await expect(askPromise).resolves.toEqual({
      answers: [{ index: 0, question: 'Pick one', answer: 'Safe' }],
    });
    expect(controller.resumeAfterInteractive).toHaveBeenCalled();
  });
});
