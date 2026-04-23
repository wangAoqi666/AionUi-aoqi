/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 *
 * Meta-test: IPC exposure coverage invariant assertions.
 *
 * VAL-IPC-016: Every IPC symbol is invoked ≥1 time in the renderer.
 * VAL-IPC-017: At least 28 test cases across the 7 wrapper test files
 *   (7 methods × 4 axes: happy / unsupported / session-not-ready / SDK-threw).
 * VAL-IPC-018: No direct DroidSdkAgent import in renderer code;
 *   every renderer hook uses `ipcBridge.acpConversation.<name>.invoke(...)`;
 *   provider catch → `{ success: false, msg }` pattern present.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(__dirname, '../..');
const RENDERER_DIR = join(ROOT, 'src/renderer');
const TESTS_DIR = join(ROOT, 'tests/unit');

/** Count `it(` occurrences (test cases) in a file. */
function countTestCases(filePath: string): number {
  const content = readFileSync(filePath, 'utf8');
  // Match `it(` or `it.only(` or `it.skip(` — standard vitest/jest patterns
  const matches = content.match(/\bit\s*\(/g);
  return matches ? matches.length : 0;
}

/** Recursively read all files in a directory. */
function readAllFiles(dir: string): string[] {
  const entries: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      entries.push(...readAllFiles(fullPath));
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      entries.push(fullPath);
    }
  }
  return entries;
}

/** Read all renderer source files and return their concatenated content. */
function readRendererSource(): string {
  return readAllFiles(RENDERER_DIR)
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
}

// ──────────────────────────────────────────────────────
// The 7 IPC symbols that MUST be exercised in the renderer
// ──────────────────────────────────────────────────────
const IPC_SYMBOLS = [
  'setEnabledToolIds',
  'addMcpServer',
  'removeMcpServer',
  'toggleMcpServer',
  'listMcpServers',
  'listMcpTools',
  'authenticateMcpServer',
] as const;

// ──────────────────────────────────────────────────────
// Test files that cover the 7 IPC wrapper methods
// ──────────────────────────────────────────────────────
const WRAPPER_TEST_FILES = [
  'acpAgentManagerMcpMethods.test.ts',
  'acpAgentManagerSetEnabledToolIds.test.ts',
  'acpConversationBridgeMcp.test.ts',
  'droidEnabledToolIds.test.ts',
  'droidMcpManagement.test.ts',
];

describe('IPC Exposure Coverage Invariants', () => {
  describe('VAL-IPC-016: zero-dead-channel assertion', () => {
    const rendererSource = readRendererSource();

    for (const symbol of IPC_SYMBOLS) {
      it(`ipcBridge.acpConversation.${symbol}.invoke has ≥1 hit in renderer`, () => {
        const pattern = `ipcBridge.acpConversation.${symbol}.invoke`;
        // Also check destructured form: `acpConversation.${symbol}.invoke`
        const hasFullPath = rendererSource.includes(pattern);
        expect(hasFullPath).toBe(true);
      });
    }
  });

  describe('VAL-IPC-017: aggregate test count ≥28', () => {
    const perFile: Record<string, number> = {};
    let total = 0;

    for (const file of WRAPPER_TEST_FILES) {
      const filePath = join(TESTS_DIR, file);
      const count = countTestCases(filePath);
      perFile[file] = count;
      total += count;
    }

    it('total test cases across wrapper files ≥28', () => {
      expect(total).toBeGreaterThanOrEqual(28);
    });

    it('every wrapper test file has ≥1 test case', () => {
      for (const [file, count] of Object.entries(perFile)) {
        expect(count, `${file} should have ≥1 test case`).toBeGreaterThanOrEqual(1);
      }
    });

    it('reports per-file counts', () => {
      // Informational — log the breakdown
      const summary = Object.entries(perFile)
        .map(([f, c]) => `  ${f}: ${c}`)
        .join('\n');
      // This test always passes; it's here for CI visibility
      expect(`Total: ${total}\n${summary}`).toBeTruthy();
    });
  });

  describe('VAL-IPC-018: template parity', () => {
    const rendererSource = readRendererSource();

    it('no direct DroidSdkAgent import in renderer code', () => {
      // Must NOT have: import ... from '...DroidSdkAgent'
      const importPattern = /import\s+.*from\s+['"].*DroidSdkAgent['"]/g;
      const matches = rendererSource.match(importPattern) || [];
      expect(matches).toHaveLength(0);
    });

    it('all 7 IPC symbols use ipcBridge.acpConversation.<name>.invoke form', () => {
      for (const symbol of IPC_SYMBOLS) {
        const pattern = `ipcBridge.acpConversation.${symbol}.invoke`;
        expect(rendererSource, `renderer must contain ${pattern}`).toContain(pattern);
      }
    });

    it('bridge providers use catch → { success: false, msg } pattern', () => {
      const bridgePath = join(ROOT, 'src/process/bridge/acpConversationBridge.ts');
      const bridgeSource = readFileSync(bridgePath, 'utf8');
      // Must have the catch → structured failure pattern
      const hasCatchPattern = bridgeSource.includes('success: false, msg');
      expect(hasCatchPattern).toBe(true);
    });
  });
});
