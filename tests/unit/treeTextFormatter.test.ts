/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { autoWrapTreeBlocks, hasTreeBlocks } from '../../src/renderer/utils/chat/treeTextFormatter';

describe('autoWrapTreeBlocks', () => {
  it('returns input unchanged when no tree glyphs are present', () => {
    const content = 'Just a sentence with no tree chars at all.';
    expect(autoWrapTreeBlocks(content)).toBe(content);
  });

  it('wraps a unicode box-drawing tree in a fenced text block', () => {
    const input = ['my-project/', '├── src/', '│   ├── index.ts', '│   └── utils.ts', '└── package.json'].join('\n');

    const output = autoWrapTreeBlocks(input);

    expect(output.startsWith('```text')).toBe(true);
    expect(output.endsWith('```')).toBe(true);
    expect(output).toContain('my-project/');
    expect(output).toContain('│   ├── index.ts');
  });

  it('wraps ASCII fallback trees that use |-- / |__', () => {
    const input = ['root/', '|-- alpha/', '|   |-- one.txt', '|   |__ two.txt', '|__ beta.txt'].join('\n');

    const output = autoWrapTreeBlocks(input);

    expect(output).toContain('```text');
    expect(output).toContain('|-- alpha/');
    expect(output).toContain('|__ beta.txt');
    const firstFenceIndex = output.indexOf('```text');
    const lastFenceIndex = output.lastIndexOf('```');
    expect(firstFenceIndex).toBeGreaterThanOrEqual(0);
    expect(lastFenceIndex).toBeGreaterThan(firstFenceIndex);
  });

  it('absorbs a preceding root line that ends with /', () => {
    const input = ['前言', '', 'demo/', '├── a.txt', '└── b.txt', '', '后面正文'].join('\n');

    const output = autoWrapTreeBlocks(input);
    const lines = output.split('\n');

    const fenceStart = lines.findIndex((line) => line === '```text');
    expect(fenceStart).toBeGreaterThan(-1);
    expect(lines[fenceStart + 1]).toBe('demo/');
    expect(lines[fenceStart + 2]).toBe('├── a.txt');
    expect(lines[fenceStart + 3]).toBe('└── b.txt');
    expect(lines[fenceStart + 4]).toBe('```');
  });

  it('does not rewrap content that is already inside a fenced block', () => {
    const input = ['```text', 'root/', '├── a', '└── b', '```'].join('\n');
    const output = autoWrapTreeBlocks(input);
    expect(output).toBe(input);

    const fenceCount = (output.match(/```/g) ?? []).length;
    expect(fenceCount).toBe(2);
  });

  it('leaves a single isolated tree line alone (no false positives)', () => {
    const input = 'This sentence has one | pipe character, nothing to wrap.';
    expect(autoWrapTreeBlocks(input)).toBe(input);
  });

  it('ignores inline code spans containing pipes', () => {
    const input = 'Use `a | b` to combine; plain text continues.';
    expect(autoWrapTreeBlocks(input)).toBe(input);
  });

  it('handles empty / nullish input safely', () => {
    expect(autoWrapTreeBlocks('')).toBe('');
    // @ts-expect-error runtime safety check
    expect(autoWrapTreeBlocks(undefined)).toBeUndefined();
  });
});

describe('hasTreeBlocks', () => {
  it('detects unicode tree lines', () => {
    expect(hasTreeBlocks('root/\n├── a')).toBe(true);
  });

  it('detects ASCII fallback tree lines', () => {
    expect(hasTreeBlocks('root/\n|-- a')).toBe(true);
  });

  it('returns false for regular prose', () => {
    expect(hasTreeBlocks('Hello world. No tree here.')).toBe(false);
  });
});
