/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure helpers for resolving user-provided file paths into the SDK-native
 * `MessageOptions.images` / `MessageOptions.files` payload shape.
 *
 * Responsibility: given a list of absolute file paths coming from the UI
 * (`data.files`), produce three parallel arrays:
 *   1. `images`  — entries compatible with `Base64ImageSource`
 *                  (`{ type: 'base64', data, mediaType }`). Only the four
 *                  mediaTypes enumerated by SDK 0.1.4 (`image/jpeg`,
 *                  `image/png`, `image/gif`, `image/webp`) are accepted;
 *                  anything else falls through to `files`.
 *   2. `files`   — entries compatible with `DocumentSource`
 *                  (`{ type, mediaType, data, name? }`). Type defaults to
 *                  `'base64'` because the SDK's strict schema does not support
 *                  path-based sources in 0.1.4 (see index.d.ts line ~1665).
 *   3. `skipped` — files that could not be resolved (not found, a directory,
 *                  too large, or an I/O error). Each entry carries a machine
 *                  readable `reason` so the caller can:
 *                    - emit a human-readable `<system-reminder>` to Droid;
 *                    - fall back to the legacy `@file` text for oversized
 *                      entries (preserves backward compatibility with the
 *                      cron / plugin code paths that still encode attachments
 *                      as `@path` in the prompt body).
 *
 * Hard constraints (see `.factory/skills/droid-sdk-integration/SKILL.md` and
 * `references/gaps-and-guidance.md` P1-2):
 * - **Pure, async functions only**. No IPC, no storage, no SDK runtime imports.
 *   The only runtime dependency is `node:fs/promises`.
 * - **Never throw on bad input**. Every failure path returns a `skipped` entry;
 *   callers (Droid `sendMessageInternal`) rely on graceful degradation.
 * - **No sync I/O**. Always `await fs.stat` / `fs.readFile`; respecting the
 *   renderer-agnostic process split (`src/process/` has no UI thread so blocking
 *   I/O stalls every conversation on the same worker).
 * - **Bounded memory**. A single file larger than `maxSizeBytes` (default 10 MB)
 *   is NOT read into memory; it is reported as `skipped` with reason
 *   `'too_large'` so the caller can fall back to the legacy `@file` reference.
 *
 * 为什么要这个模块：
 * - SDK 原生支持 `MessageOptions.images` / `files`，比拼 `@file` 文本更稳（
 *   路径中含空格 / 非 ASCII 时 CLI 解析可能出问题），也是与终端 Droid 对齐的
 *   行为。
 * - 纯函数 / pure helper 让 `DroidSdkAgent.sendMessageInternal` 保持干净，也
 *   便于独立单测，不需要 spin 真实 session。
 */

import { readFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';

/**
 * Default upper bound for a single file when expanding attachments into the
 * native `MessageOptions.{images,files}` payload. Files larger than this are
 * marked `skipped` with reason `'too_large'`; callers MUST fall back to the
 * legacy `@file` reference text so the Droid CLI can mmap them off disk rather
 * than holding the full byte array in RAM.
 *
 * 10 MB 是单个附件走原生路径（读完整 bytes → base64）的上限，超过就回退。
 */
export const DEFAULT_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/**
 * File extensions that SHOULD be interpreted as images first. An extension in
 * this set only ends up in `images` when the inferred `mediaType` is one of the
 * four enumerated by SDK 0.1.4's `Base64ImageSourceSchema`; otherwise it falls
 * through to `files` (DocumentSource has an open `mediaType: z.ZodString`).
 */
const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']);

/**
 * MediaTypes accepted by SDK 0.1.4 `Base64ImageSourceSchema`:
 *   `z.ZodEnum<["image/jpeg", "image/png", "image/gif", "image/webp"]>`.
 * Anything outside this set MUST NOT be pushed to `images` or the SDK's zod
 * validator will reject the whole message.
 */
const SDK_SUPPORTED_IMAGE_MEDIA_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

/** Lightweight ext → MIME map — deliberately avoids pulling in `mime-types`. */
const EXTENSION_MEDIA_TYPES: Readonly<Record<string, string>> = {
  // Images
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  // Documents / text
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
  htm: 'text/html',
  // Office-ish (kept minimal; anything unknown gets `application/octet-stream`)
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/**
 * Structured payload reported for each file that could not be added to the
 * native attachment arrays. The `reason` is intentionally a finite string
 * union so downstream callers can switch on it (e.g. to decide whether to
 * fall back to `@file` text for `'too_large'`).
 */
export interface SkippedAttachment {
  /** Absolute path the caller supplied. */
  path: string;
  /** Machine-readable cause so callers can react deterministically. */
  reason: 'not_found' | 'is_directory' | 'too_large' | 'read_failed';
  /** Extra context for logs / user-facing reminders. */
  detail?: string;
}

/**
 * `Base64ImageSource` — structurally matches `@factory/droid-sdk`
 * `Base64ImageSourceSchema`. Inline here so this module stays free of SDK
 * runtime imports (hard constraint #1 of the task spec).
 */
export interface ResolvedImageAttachment {
  type: 'base64';
  data: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
}

/**
 * `DocumentSource` — structurally matches `@factory/droid-sdk`
 * `DocumentSourceSchema`. `type` is kept open (the SDK uses `z.ZodString`)
 * but we populate `'base64'` so `data` is unambiguous.
 */
export interface ResolvedFileAttachment {
  type: string;
  mediaType: string;
  data: string;
  name?: string;
  mime?: string;
}

/**
 * Result of {@link resolveAttachmentsForDroid}. All three arrays are always
 * present; `skipped` MUST be inspected by callers that want to surface reasons
 * to the model (e.g. via a `<system-reminder>`).
 */
export interface ResolvedAttachments {
  images: ResolvedImageAttachment[];
  files: ResolvedFileAttachment[];
  skipped: SkippedAttachment[];
}

/** Options accepted by {@link resolveAttachmentsForDroid}. */
export interface ResolveAttachmentsOptions {
  /**
   * Maximum bytes per single file before we skip the native path. Defaults to
   * {@link DEFAULT_MAX_ATTACHMENT_BYTES} (10 MB). Callers can tighten this for
   * stricter transports.
   */
  maxSizeBytes?: number;
}

/**
 * Normalise a single file path into either an `images` / `files` entry or a
 * `skipped` entry. Never throws — every failure is classified.
 */
async function resolveOne(
  filePath: string,
  maxSizeBytes: number
): Promise<
  | { kind: 'image'; payload: ResolvedImageAttachment }
  | { kind: 'file'; payload: ResolvedFileAttachment }
  | { kind: 'skipped'; payload: SkippedAttachment }
> {
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    return {
      kind: 'skipped',
      payload: { path: String(filePath), reason: 'not_found', detail: 'empty path' },
    };
  }
  let stats;
  try {
    stats = await stat(filePath);
  } catch (error) {
    return {
      kind: 'skipped',
      payload: {
        path: filePath,
        reason: 'not_found',
        detail: error instanceof Error ? error.message : String(error),
      },
    };
  }
  if (stats.isDirectory()) {
    return {
      kind: 'skipped',
      payload: { path: filePath, reason: 'is_directory', detail: 'path is a directory' },
    };
  }
  if (stats.size > maxSizeBytes) {
    return {
      kind: 'skipped',
      payload: {
        path: filePath,
        reason: 'too_large',
        detail: `size=${stats.size} bytes exceeds maxSizeBytes=${maxSizeBytes}`,
      },
    };
  }

  // Read bytes. `readFile` without encoding yields a Buffer; toString('base64')
  // is the cheapest path to produce the SDK-accepted payload.
  let buffer: Buffer;
  try {
    buffer = await readFile(filePath);
  } catch (error) {
    return {
      kind: 'skipped',
      payload: {
        path: filePath,
        reason: 'read_failed',
        detail: error instanceof Error ? error.message : String(error),
      },
    };
  }

  const ext = extname(filePath).replace(/^\./, '').toLowerCase();
  const inferredMediaType = EXTENSION_MEDIA_TYPES[ext] ?? 'application/octet-stream';
  const base64 = buffer.toString('base64');

  if (IMAGE_EXTENSIONS.has(ext) && SDK_SUPPORTED_IMAGE_MEDIA_TYPES.has(inferredMediaType)) {
    return {
      kind: 'image',
      payload: {
        type: 'base64',
        data: base64,
        // Narrow to the SDK enum after the Set check above.
        mediaType: inferredMediaType as ResolvedImageAttachment['mediaType'],
      },
    };
  }

  return {
    kind: 'file',
    payload: {
      type: 'base64',
      mediaType: inferredMediaType,
      data: base64,
      name: basename(filePath),
    },
  };
}

/**
 * Resolve the caller's file-path list into SDK-native attachment payloads.
 *
 * Contract:
 * - Returns a `ResolvedAttachments` with three parallel arrays; never throws.
 * - Order of resolution is deterministic (follows input order), but results
 *   are grouped by kind (`images[]`, `files[]`, `skipped[]`).
 * - `stat` + `readFile` run concurrently via `Promise.all` for latency; the
 *   grouping happens synchronously afterwards.
 *
 * 使用：
 *   const { images, files, skipped } = await resolveAttachmentsForDroid(data.files);
 *   session.stream(text, { images, files });
 */
export async function resolveAttachmentsForDroid(
  filePaths: readonly string[] | undefined | null,
  options?: ResolveAttachmentsOptions
): Promise<ResolvedAttachments> {
  const images: ResolvedImageAttachment[] = [];
  const files: ResolvedFileAttachment[] = [];
  const skipped: SkippedAttachment[] = [];

  if (!Array.isArray(filePaths) || filePaths.length === 0) {
    return { images, files, skipped };
  }

  const maxSizeBytes = options?.maxSizeBytes ?? DEFAULT_MAX_ATTACHMENT_BYTES;

  const resolved = await Promise.all(filePaths.map((p) => resolveOne(p, maxSizeBytes)));

  for (const entry of resolved) {
    if (entry.kind === 'image') {
      images.push(entry.payload);
    } else if (entry.kind === 'file') {
      files.push(entry.payload);
    } else {
      skipped.push(entry.payload);
    }
  }

  return { images, files, skipped };
}

/**
 * Heuristic: does the user-supplied prompt text already contain a legacy
 * `@file` reference at the start? If so, we MUST keep the legacy text-prepend
 * path in `DroidSdkAgent.sendMessageInternal` to avoid:
 *   1. re-uploading the same file via the native images/files arrays;
 *   2. confusing Droid with two competing attachment representations.
 *
 * Historical messages (cron jobs, plugin saves, channel replays) may persist
 * prompts that already begin with `@path` tokens. Those must be passed through
 * unmodified.
 *
 * 启发式：content 是否以 "@..." 开头，用来识别旧消息体。
 * 见 SKILL references/gaps-and-guidance.md P1-2 "老消息体兼容"。
 */
export function contentHasLegacyFileReference(content: string | undefined | null): boolean {
  if (typeof content !== 'string') return false;
  const trimmed = content.trimStart();
  if (trimmed.length === 0) return false;
  // Match `@` followed by either a non-space character or a quoted path.
  // The legacy prepend pattern is `@<path>` or `@"<path with spaces>"`.
  return /^@(?:"[^"]+"|\S)/.test(trimmed);
}
