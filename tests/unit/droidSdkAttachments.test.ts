/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tests for the Droid SDK native-attachment resolver (P1-2).
 *
 * Two layers exercised here:
 *   1. `resolveAttachmentsForDroid` — pure helper that classifies a filePath
 *      array into `images` / `files` / `skipped`. Uses real tmp files so the
 *      `fs/promises` code path is fully exercised.
 *   2. `DroidSdkAgent.sendMessageInternal` integration — mocks the SDK session
 *      so we can assert the `MessageOptions` passed to `session.stream()` for
 *      three contract rows:
 *        a. new message + files → options carry images/files
 *        b. legacy content (`@...` prefix) + files → options omit images/files,
 *           legacy `@file` refs prepended to the prompt
 *        c. no files → options omit images/files entirely
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  contentHasLegacyFileReference,
  DEFAULT_MAX_ATTACHMENT_BYTES,
  resolveAttachmentsForDroid,
} from '@/process/agent/droid/runtime/messageAttachments';
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

vi.mock('@process/agent/droid/cliRuntime', () => ({
  resolveWorkingDroidCli: vi.fn((execPath?: string | null) => ({
    execPath: execPath || 'droid',
    cliPath: execPath || 'droid',
    source: 'system',
    version: '1.0.0',
  })),
}));

// 1 pixel PNG (base64) — smallest valid content so resolver produces a proper
// base64 payload that the SDK would accept. We deliberately keep this tiny to
// avoid slowing the test suite.
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAAA1BMVEX///+nxBvIAAAAC0lEQVQIHWMAAQAABQABDQottAAAAABJRU5ErkJggg==';
const TINY_PNG_BUFFER = Buffer.from(TINY_PNG_BASE64, 'base64');

describe('resolveAttachmentsForDroid', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'droid-attach-test-'));
    return async () => {
      await rm(tmp, { recursive: true, force: true });
    };
  });

  it('classifies a PNG file into images[] with SDK-shaped payload', async () => {
    const file = join(tmp, 'hello.png');
    await writeFile(file, TINY_PNG_BUFFER);

    const result = await resolveAttachmentsForDroid([file]);

    expect(result.skipped).toEqual([]);
    expect(result.files).toEqual([]);
    expect(result.images).toHaveLength(1);
    const image = result.images[0];
    expect(image.type).toBe('base64');
    expect(image.mediaType).toBe('image/png');
    expect(image.data).toBe(TINY_PNG_BUFFER.toString('base64'));
  });

  it('classifies a PDF-like file into files[] with DocumentSource shape', async () => {
    const file = join(tmp, 'doc.pdf');
    await writeFile(file, Buffer.from('%PDF-1.4 fake', 'utf-8'));

    const result = await resolveAttachmentsForDroid([file]);

    expect(result.skipped).toEqual([]);
    expect(result.images).toEqual([]);
    expect(result.files).toHaveLength(1);
    const doc = result.files[0];
    expect(doc.type).toBe('base64');
    expect(doc.mediaType).toBe('application/pdf');
    expect(doc.name).toBe('doc.pdf');
    expect(doc.data).toBe(Buffer.from('%PDF-1.4 fake', 'utf-8').toString('base64'));
  });

  it('skips missing paths with reason "not_found"', async () => {
    const result = await resolveAttachmentsForDroid([join(tmp, 'does-not-exist.txt')]);
    expect(result.images).toEqual([]);
    expect(result.files).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toBe('not_found');
    expect(result.skipped[0].path).toContain('does-not-exist.txt');
  });

  it('skips directories with reason "is_directory"', async () => {
    const result = await resolveAttachmentsForDroid([tmp]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toBe('is_directory');
  });

  it('skips oversized files with reason "too_large"', async () => {
    const file = join(tmp, 'big.bin');
    // Write 8 bytes but pass a 4-byte cap so the oversize branch triggers
    // without writing actual 10 MB to disk in test.
    await writeFile(file, Buffer.alloc(8, 0x41));

    const result = await resolveAttachmentsForDroid([file], { maxSizeBytes: 4 });
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toBe('too_large');
    expect(result.skipped[0].detail).toContain('size=8');
    expect(result.images).toEqual([]);
    expect(result.files).toEqual([]);
  });

  it('routes BMP (unsupported image mediaType) into files[] rather than images[]', async () => {
    // `bmp` is in the image extension set but `image/bmp` is NOT one of the
    // four media types supported by SDK's `Base64ImageSourceSchema`. The
    // resolver MUST fall through to `files[]` (DocumentSource has open mediaType).
    const file = join(tmp, 'pic.bmp');
    await writeFile(file, Buffer.from([0x42, 0x4d, 0x01]));

    const result = await resolveAttachmentsForDroid([file]);
    expect(result.images).toEqual([]);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].mediaType).toBe('image/bmp');
    expect(result.skipped).toEqual([]);
  });

  it('handles a mixed input: image + doc + missing + directory + oversize', async () => {
    const img = join(tmp, 'a.png');
    const doc = join(tmp, 'b.pdf');
    const big = join(tmp, 'big.txt');
    const ghost = join(tmp, 'ghost.txt');
    await writeFile(img, TINY_PNG_BUFFER);
    await writeFile(doc, Buffer.from('doc'));
    // Must be strictly larger than the `maxSizeBytes` cap below; the png + pdf
    // both stay under the cap so they flow to images/files respectively.
    await writeFile(big, Buffer.alloc(2048, 0x42));

    const result = await resolveAttachmentsForDroid([img, doc, big, ghost, tmp], { maxSizeBytes: 1024 });

    expect(result.images).toHaveLength(1);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].mediaType).toBe('application/pdf');
    expect(result.skipped).toHaveLength(3);

    const reasons = result.skipped.map((s) => s.reason).toSorted();
    expect(reasons).toEqual(['is_directory', 'not_found', 'too_large']);
  });

  it('returns empty result for empty / undefined / null input', async () => {
    expect(await resolveAttachmentsForDroid([])).toEqual({ images: [], files: [], skipped: [] });
    expect(await resolveAttachmentsForDroid(undefined)).toEqual({ images: [], files: [], skipped: [] });
    expect(await resolveAttachmentsForDroid(null)).toEqual({ images: [], files: [], skipped: [] });
  });

  it('exports a sane default max size (10 MB)', () => {
    expect(DEFAULT_MAX_ATTACHMENT_BYTES).toBe(10 * 1024 * 1024);
  });
});

describe('contentHasLegacyFileReference', () => {
  it('returns true when content starts with @path', () => {
    expect(contentHasLegacyFileReference('@/tmp/a.txt hello')).toBe(true);
    expect(contentHasLegacyFileReference('  @/tmp/b.txt hello')).toBe(true);
    expect(contentHasLegacyFileReference('@"/tmp/with space.txt" hi')).toBe(true);
  });

  it('returns false for plain content', () => {
    expect(contentHasLegacyFileReference('hello')).toBe(false);
    expect(contentHasLegacyFileReference('@ hello')).toBe(false); // stray @ with space
    expect(contentHasLegacyFileReference('')).toBe(false);
    expect(contentHasLegacyFileReference(undefined)).toBe(false);
    expect(contentHasLegacyFileReference(null)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Integration — DroidSdkAgent.sendMessageInternal
// ─────────────────────────────────────────────────────────────────────

type StreamCall = { prompt: string; options: Record<string, unknown> | undefined };

function buildSessionStub(): {
  session: {
    sessionId: string;
    updateSettings: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    interrupt: ReturnType<typeof vi.fn>;
    stream: ReturnType<typeof vi.fn>;
  };
  calls: StreamCall[];
} {
  const calls: StreamCall[] = [];
  const session = {
    sessionId: 'session-attach-int',
    updateSettings: vi.fn(),
    close: vi.fn(),
    interrupt: vi.fn(),
    stream: vi.fn(async function* (prompt: string, options?: Record<string, unknown>) {
      calls.push({ prompt, options });
      yield* [];
    }),
  };
  return { session, calls };
}

describe('DroidSdkAgent.sendMessageInternal native attachment integration', () => {
  let tmp: string;

  beforeEach(async () => {
    createSessionMock.mockReset();
    resumeSessionMock.mockReset();
    mainLogMock.mockReset();
    mainWarnMock.mockReset();
    tmp = await mkdtemp(join(tmpdir(), 'droid-attach-int-'));
    return async () => {
      await rm(tmp, { recursive: true, force: true });
    };
  });

  it('new message + non-empty files + non-@ content → prompt carries @path refs and options stay empty', async () => {
    // Regression guard (CLI-stall fix): the native `MessageOptions.images/files`
    // channel caused `droid.add_user_message` to hang on large base64 blobs.
    // Local attachments are now ALWAYS routed through the legacy `@path`
    // prepend so the Droid CLI can mmap files directly from disk.
    const png = join(tmp, 'pic.png');
    const pdf = join(tmp, 'report.pdf');
    await writeFile(png, TINY_PNG_BUFFER);
    await writeFile(pdf, Buffer.from('%PDF-1.4'));

    const { session, calls } = buildSessionStub();
    createSessionMock.mockResolvedValue(session);

    const agent = new DroidSdkAgent({
      id: 'conv-native-1',
      workingDir: '/tmp',
      onStreamEvent: vi.fn(),
    });

    await agent.start();
    await agent.sendMessage({
      content: '请分析这两份附件',
      files: [png, pdf],
      msg_id: 'msg-native-1',
    });

    expect(calls).toHaveLength(1);
    const call = calls[0];
    // Legacy @path prepend MUST appear so the CLI can mmap the file directly.
    expect(call.prompt).toContain(`@${png}`);
    expect(call.prompt).toContain(`@${pdf}`);
    // Native options MUST stay empty — base64 in-band payloads stall the CLI.
    expect(call.options).toBeUndefined();
  });

  it('legacy content starting with "@" + files → stream options MUST NOT carry images/files', async () => {
    const png = join(tmp, 'legacy.png');
    await writeFile(png, TINY_PNG_BUFFER);

    const { session, calls } = buildSessionStub();
    createSessionMock.mockResolvedValue(session);

    const agent = new DroidSdkAgent({
      id: 'conv-legacy',
      workingDir: '/tmp',
      onStreamEvent: vi.fn(),
    });

    await agent.start();
    await agent.sendMessage({
      content: '@/previously/saved.txt 请继续处理',
      files: [png],
      msg_id: 'msg-legacy',
    });

    expect(calls).toHaveLength(1);
    const call = calls[0];
    // Native options MUST be absent — the @ prefix triggers the legacy branch.
    expect(call.options).toBeUndefined();
    // Legacy path prepends @<path> refs into the prompt.
    expect(call.prompt).toContain(`@${png}`);
    // Historical prefix is preserved verbatim.
    expect(call.prompt).toContain('@/previously/saved.txt');
  });

  it('empty data.files → stream options MUST NOT carry images/files', async () => {
    const { session, calls } = buildSessionStub();
    createSessionMock.mockResolvedValue(session);

    const agent = new DroidSdkAgent({
      id: 'conv-empty',
      workingDir: '/tmp',
      onStreamEvent: vi.fn(),
    });

    await agent.start();
    await agent.sendMessage({
      content: '你好',
      files: [],
      msg_id: 'msg-empty',
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].options).toBeUndefined();
  });

  it('missing files still prepend as @path refs (legacy) so the CLI surfaces the filesystem error', async () => {
    // Legacy routing no longer does a filesystem pre-check. The CLI will
    // report a clear "file not found" itself when it tries to mmap the
    // @path, which matches Droid's existing UX and avoids the overhead of
    // stat()-ing every attachment from the main process.
    const ghost = join(tmp, 'ghost.txt');
    const { session, calls } = buildSessionStub();
    createSessionMock.mockResolvedValue(session);

    const agent = new DroidSdkAgent({
      id: 'conv-ghost',
      workingDir: '/tmp',
      onStreamEvent: vi.fn(),
    });

    await agent.start();
    await agent.sendMessage({
      content: '请确认附件',
      files: [ghost],
      msg_id: 'msg-ghost',
    });

    expect(calls).toHaveLength(1);
    const call = calls[0];
    // Native options stay empty under the legacy-only contract.
    expect(call.options).toBeUndefined();
    // @path prepend must still be present so the CLI can attempt to resolve it.
    expect(call.prompt).toContain(`@${ghost}`);
  });
});
