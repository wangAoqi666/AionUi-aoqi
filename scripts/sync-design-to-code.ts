/**
 * Design → Code sync script
 *
 * Reads paper-sync-map.json, compares Paper values (from designValue field)
 * against actual code values, and outputs a diff for review.
 *
 * Usage: bun run scripts/sync-design-to-code.ts
 *
 * Workflow:
 * 1. User modifies text/style in Paper prototype
 * 2. User (or Droid) updates "designValue" in paper-sync-map.json
 * 3. Run this script to generate code patches
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const MAP_PATH = resolve(ROOT, 'docs/paper-sync-map.json');

type Mapping = {
  id: string;
  description?: string;
  paper: {
    artboardId: string;
    artboardName?: string;
    nodeId: string;
    property: string;
    layerName: string;
  };
  code: {
    file: string;
    pattern: string;
    captureGroup: number;
  };
  designValue?: string;
};

type SyncMap = {
  version: number;
  mappings: Mapping[];
};

function extractCodeValue(mapping: Mapping): { value: string; line: number; fullLine: string } | null {
  const filePath = resolve(ROOT, mapping.code.file);
  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    console.error(`  [ERROR] File not found: ${mapping.code.file}`);
    return null;
  }

  const lines = content.split('\n');
  const regex = new RegExp(mapping.code.pattern);

  for (let i = 0; i < lines.length; i++) {
    const match = regex.exec(lines[i]);
    if (match && match[mapping.code.captureGroup]) {
      return {
        value: match[mapping.code.captureGroup],
        line: i + 1,
        fullLine: lines[i],
      };
    }
  }

  console.error(`  [ERROR] Pattern not found in ${mapping.code.file}: ${mapping.code.pattern}`);
  return null;
}

function generatePatch(
  mapping: Mapping,
  codeResult: { value: string; line: number; fullLine: string },
  newValue: string
): string {
  const oldLine = codeResult.fullLine;
  const newLine = oldLine.replace(codeResult.value, newValue);

  return [
    `--- a/${mapping.code.file}`,
    `+++ b/${mapping.code.file}`,
    `@@ -${codeResult.line},1 +${codeResult.line},1 @@`,
    `-${oldLine}`,
    `+${newLine}`,
  ].join('\n');
}

function main() {
  console.log('=== Design → Code Sync ===\n');

  const map: SyncMap = JSON.parse(readFileSync(MAP_PATH, 'utf-8'));
  let hasChanges = false;

  for (const mapping of map.mappings) {
    console.log(`[${mapping.id}] ${mapping.description || ''}`);
    console.log(`  Paper: ${mapping.paper.artboardName || mapping.paper.artboardId} → ${mapping.paper.layerName}`);
    console.log(`  Code:  ${mapping.code.file}`);

    if (!mapping.designValue) {
      console.log('  [SKIP] No designValue set. Update paper-sync-map.json with the Paper value first.\n');
      continue;
    }

    const codeResult = extractCodeValue(mapping);
    if (!codeResult) {
      console.log('');
      continue;
    }

    console.log(`  Code value:   "${codeResult.value}" (line ${codeResult.line})`);
    console.log(`  Design value: "${mapping.designValue}"`);

    if (codeResult.value === mapping.designValue) {
      console.log('  [OK] Already in sync.\n');
      continue;
    }

    hasChanges = true;
    console.log('  [DIFF] Values differ!\n');
    console.log(generatePatch(mapping, codeResult, mapping.designValue));
    console.log('');
  }

  if (!hasChanges) {
    console.log('All mappings are in sync. Nothing to do.');
  } else {
    console.log('---\nReview the diffs above. Apply changes manually or use `git apply`.');
  }
}

main();
