/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Auto-wrap ASCII / Unicode directory trees emitted by agents in fenced code
 * blocks so that MarkdownView renders them with a monospace font and preserves
 * the whitespace needed for branches to align.
 *
 * Assistants frequently reply with a plain-text tree that was never wrapped in
 * a ```` ```text ``` ```` block. Rendered as a normal paragraph, `remark-breaks`
 * keeps the newlines but the proportional font and collapsed whitespace make
 * the branches look mangled (see the "目录树" regression the user reported).
 *
 * The heuristic is intentionally narrow to avoid wrapping regular prose:
 * - Detect a run of 2+ consecutive lines that start with a "tree prefix"
 *   (Unicode box-drawing chars or the common ASCII fallbacks such as `|--`).
 * - Optionally absorb the preceding line when it looks like the tree root
 *   (ends with `/`, e.g. `my-project/`).
 * - Skip anything that is already inside a fenced or tilde code block / inline
 *   code span so we never re-wrap content that was already formatted.
 */

// Unicode box-drawing glyphs we treat as "definitely a tree line".
const BOX_DRAWING_CHARS_RE = /[│├└┃┏┓┗┛┣┫┳┻┼╂╋─━]/;

// ASCII branch indicator anywhere on the line (e.g. `|--`, `|__`, `---`).
const ASCII_BRANCH_RE = /\|[-─━_]{2,}|[-─━_]{2,}|\|[ \t]+[│|├└─]/;

// Fenced code blocks / tilde blocks / inline code — used to carve out
// protected segments that should pass through unchanged.
const CODE_SEGMENT_RE = /```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`/g;

const ROOT_LINE_RE = /^[ \t]*[^\s][^\n]*\/\s*$/;

const isTreeLine = (line: string): boolean => {
  if (!line) {
    return false;
  }
  const trimmed = line.replace(/^[ \t]+/, '');
  if (!trimmed) {
    return false;
  }
  const first = trimmed[0];

  // Unicode box-drawing at the leading non-space character: always a tree line.
  if (BOX_DRAWING_CHARS_RE.test(first)) {
    return true;
  }

  // ASCII fallback: the line starts with `|` AND has a branch indicator
  // somewhere on the same line. This keeps plain sentences containing a single
  // pipe from being misclassified while still catching continuation lines
  // such as `|   |-- one.txt`.
  if (first === '|') {
    return ASCII_BRANCH_RE.test(trimmed);
  }

  return false;
};

const isRootLine = (line: string): boolean => ROOT_LINE_RE.test(line);

const wrapSegment = (segment: string): string => {
  if (!segment.includes('\n')) {
    return segment;
  }

  const lines = segment.split('\n');
  const output: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const current = lines[index];
    const isCurrentTree = isTreeLine(current);

    if (!isCurrentTree) {
      output.push(current);
      index += 1;
      continue;
    }

    // Found the first tree line. Look ahead: we need at least one more
    // consecutive tree line to treat this as a block.
    let end = index + 1;
    while (end < lines.length && isTreeLine(lines[end])) {
      end += 1;
    }

    if (end - index < 2) {
      output.push(current);
      index += 1;
      continue;
    }

    // Optionally absorb the preceding "root" line (e.g. `my-project/`).
    let startIncludingRoot = index;
    const previous = output.length > 0 ? output[output.length - 1] : undefined;
    if (previous !== undefined && isRootLine(previous)) {
      output.pop();
      startIncludingRoot = index - 1;
    }

    const blockLines =
      startIncludingRoot === index ? lines.slice(index, end) : [lines[startIncludingRoot], ...lines.slice(index, end)];

    // Preserve the block as a fenced code block so CodeBlock renders it in
    // a monospace font with whitespace preserved.
    output.push('```text');
    output.push(...blockLines);
    output.push('```');

    index = end;
  }

  return output.join('\n');
};

/**
 * Transform directory-tree-like text blocks into fenced `text` code blocks.
 * Safe to call on every render: if nothing matches, the input is returned
 * unchanged (same reference when possible).
 */
export const autoWrapTreeBlocks = (content: string): string => {
  if (!content || typeof content !== 'string') {
    return content;
  }

  // Fast path: no likely tree glyphs at all.
  if (!/[│├└┃┏┓┗┛┣┫┳┻┼╂╋]|\|[-─━_]{2,}|\|[ \t]+[├└─]/.test(content)) {
    return content;
  }

  const pieces: string[] = [];
  let cursor = 0;
  CODE_SEGMENT_RE.lastIndex = 0;

  for (const match of content.matchAll(CODE_SEGMENT_RE)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      pieces.push(wrapSegment(content.slice(cursor, start)));
    }
    pieces.push(match[0]);
    cursor = start + match[0].length;
  }

  if (cursor < content.length) {
    pieces.push(wrapSegment(content.slice(cursor)));
  }

  return pieces.join('');
};

export const hasTreeBlocks = (content: string): boolean => {
  if (!content || typeof content !== 'string') {
    return false;
  }
  return content.split('\n').some((line) => isTreeLine(line));
};
