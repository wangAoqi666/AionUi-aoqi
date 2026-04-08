/**
 * Code → Design sync script
 *
 * Reads paper-sync-map.json, extracts current code values,
 * and outputs instructions for updating Paper prototype.
 *
 * Usage: bun run scripts/sync-code-to-design.ts
 *
 * Workflow:
 * 1. Developer modifies code (e.g., changes app title)
 * 2. Run this script to detect what needs to update in Paper
 * 3. Droid (or user) applies the changes to Paper prototype
 *
 * Note: This script cannot directly call Paper MCP. It outputs
 * the required changes, which can be applied by Droid in a
 * conversation or via future Paper API integration.
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

function extractCodeValue(mapping: Mapping): string | null {
  const filePath = resolve(ROOT, mapping.code.file);
  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    console.error(`  [ERROR] File not found: ${mapping.code.file}`);
    return null;
  }

  const regex = new RegExp(mapping.code.pattern);
  for (const line of content.split('\n')) {
    const match = regex.exec(line);
    if (match && match[mapping.code.captureGroup]) {
      return match[mapping.code.captureGroup];
    }
  }

  console.error(`  [ERROR] Pattern not found in ${mapping.code.file}`);
  return null;
}

function main() {
  console.log('=== Code → Design Sync ===\n');

  const map: SyncMap = JSON.parse(readFileSync(MAP_PATH, 'utf-8'));
  const updates: Array<{ id: string; nodeId: string; property: string; newValue: string; artboard: string }> = [];

  for (const mapping of map.mappings) {
    console.log(`[${mapping.id}] ${mapping.description || ''}`);

    const codeValue = extractCodeValue(mapping);
    if (!codeValue) {
      console.log('');
      continue;
    }

    console.log(`  Code value:   "${codeValue}"`);
    console.log(`  Design value: "${mapping.designValue || '(not set)'}"`);

    if (mapping.designValue === codeValue) {
      console.log('  [OK] Already in sync.\n');
      continue;
    }

    console.log(`  [DIFF] Paper needs update: "${mapping.designValue || '?'}" → "${codeValue}"`);
    updates.push({
      id: mapping.id,
      nodeId: mapping.paper.nodeId,
      property: mapping.paper.property,
      newValue: codeValue,
      artboard: mapping.paper.artboardName || mapping.paper.artboardId,
    });

    // Auto-update designValue in the map to keep it in sync
    mapping.designValue = codeValue;
    console.log('');
  }

  if (updates.length === 0) {
    console.log('All mappings are in sync. Nothing to do.');
    return;
  }

  // Save updated designValues back to map
  writeFileSync(MAP_PATH, JSON.stringify(map, null, 2) + '\n', 'utf-8');
  console.log(`Updated designValue in ${MAP_PATH}\n`);

  // Output Paper MCP commands for Droid
  console.log('=== Paper Update Instructions ===');
  console.log('Copy the following to Droid to apply changes:\n');

  for (const update of updates) {
    if (update.property === 'textContent') {
      console.log(`- Set text of node "${update.nodeId}" (${update.artboard}) to: "${update.newValue}"`);
    } else {
      console.log(
        `- Update ${update.property} of node "${update.nodeId}" (${update.artboard}) to: "${update.newValue}"`
      );
    }
  }
}

main();
