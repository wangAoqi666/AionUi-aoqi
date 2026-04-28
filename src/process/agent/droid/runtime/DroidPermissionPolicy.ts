/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'path';
import { ToolConfirmationOutcome } from '@factory/droid-sdk';
import type { ResolvedDroidChannelRuntimeConfig } from '@/common/config/storage';

export type DroidPermissionEvaluationInput = {
  confirmationType?: string;
  toolName?: string;
  toolInput: Record<string, unknown>;
  workspace: string;
};

export type DroidPermissionEvaluationResult = {
  outcome: string;
  notice?: string;
};

const SAFE_READ_COMMAND_PREFIXES = ['pwd', 'ls', 'rg', 'git status', 'git diff', 'bun run test', 'bunx tsc --noEmit'];
const SAFE_TOOL_NAMES = new Set([
  'askuser',
  'exitspecmode',
  'todowrite',
  'read',
  'ls',
  'grep',
  'glob',
  'fetchurl',
  'websearch',
  'context7___resolve-library-id',
  'context7___query-docs',
]);
const EDIT_TOOL_NAMES = new Set(['create', 'edit', 'multiedit', 'applypatch']);

const getNormalizedName = (toolName?: string, confirmationType?: string): string =>
  (toolName || confirmationType || '').trim().toLowerCase();

const matchesAllowedValue = (value: string, allowList: string[]): boolean => {
  const normalizedValue = value.trim().toLowerCase();
  return allowList.some((entry) => {
    const normalizedEntry = entry.trim().toLowerCase();
    if (!normalizedEntry) {
      return false;
    }

    if (normalizedEntry.endsWith('*')) {
      return normalizedValue.startsWith(normalizedEntry.slice(0, -1));
    }

    return normalizedValue === normalizedEntry || normalizedValue.startsWith(`${normalizedEntry} `);
  });
};

const getEditPaths = (toolName: string, toolInput: Record<string, unknown>): string[] => {
  const filePath = typeof toolInput.file_path === 'string' ? toolInput.file_path : undefined;
  if (filePath) {
    return [filePath];
  }

  if (toolName !== 'applypatch') {
    return [];
  }

  const patch = typeof toolInput.patch === 'string' ? toolInput.patch : undefined;
  if (!patch) {
    return [];
  }

  const matches = Array.from(patch.matchAll(/^\*\*\* (?:Add|Update) File: (.+)$/gm));
  return matches.map((match) => match[1]?.trim()).filter((value): value is string => Boolean(value));
};

const isPathAllowed = (targetPath: string, allowRoots: string[], workspace: string): boolean => {
  if (allowRoots.length === 0) {
    return false;
  }

  const absoluteTarget = path.resolve(workspace, targetPath);
  return allowRoots.some((root) => {
    const absoluteRoot = path.resolve(workspace, root);
    return absoluteTarget === absoluteRoot || absoluteTarget.startsWith(`${absoluteRoot}${path.sep}`);
  });
};

const buildNotice = (toolName: string, reason: string): string =>
  `Droid blocked ${toolName || 'this request'}: ${reason}. Update the channel Droid runtime allowlists if this should be permitted.`;

export class DroidPermissionPolicy {
  constructor(private settings: ResolvedDroidChannelRuntimeConfig) {}

  updateSettings(settings: ResolvedDroidChannelRuntimeConfig): void {
    this.settings = settings;
  }

  evaluate(input: DroidPermissionEvaluationInput): DroidPermissionEvaluationResult {
    const normalizedName = getNormalizedName(input.toolName, input.confirmationType);

    if (this.settings.permissionMode === 'allow-all') {
      return { outcome: ToolConfirmationOutcome.ProceedOnce };
    }

    if (SAFE_TOOL_NAMES.has(normalizedName) || input.confirmationType === 'ask_user') {
      return { outcome: ToolConfirmationOutcome.ProceedOnce };
    }

    if (this.settings.permissionMode === 'deny-all') {
      return {
        outcome: ToolConfirmationOutcome.Cancel,
        notice: buildNotice(input.toolName || input.confirmationType || 'request', 'permission mode is deny-all'),
      };
    }

    if (normalizedName === 'execute') {
      const command = typeof input.toolInput.command === 'string' ? input.toolInput.command.trim() : '';
      if (!command) {
        return {
          outcome: ToolConfirmationOutcome.Cancel,
          notice: buildNotice('Execute', 'missing command payload'),
        };
      }

      if (matchesAllowedValue(command, this.settings.allowExecCommands)) {
        return { outcome: ToolConfirmationOutcome.ProceedOnce };
      }

      if (this.settings.permissionMode === 'safe-auto' && matchesAllowedValue(command, SAFE_READ_COMMAND_PREFIXES)) {
        return { outcome: ToolConfirmationOutcome.ProceedOnce };
      }

      return {
        outcome: ToolConfirmationOutcome.Cancel,
        notice: buildNotice('Execute', `command "${command}" is not allowlisted`),
      };
    }

    if (EDIT_TOOL_NAMES.has(normalizedName)) {
      const paths = getEditPaths(normalizedName, input.toolInput);
      const allAllowed =
        paths.length > 0 &&
        paths.every((filePath) => isPathAllowed(filePath, this.settings.allowEditRoots, input.workspace));
      if (allAllowed) {
        return { outcome: ToolConfirmationOutcome.ProceedOnce };
      }

      return {
        outcome: ToolConfirmationOutcome.Cancel,
        notice: buildNotice(
          input.toolName || input.confirmationType || 'file edit',
          'target path is not within allowEditRoots'
        ),
      };
    }

    if (normalizedName.includes('___')) {
      if (matchesAllowedValue(normalizedName, this.settings.allowMcpTools)) {
        return { outcome: ToolConfirmationOutcome.ProceedOnce };
      }

      return {
        outcome: ToolConfirmationOutcome.Cancel,
        notice: buildNotice(input.toolName || 'MCP tool', 'tool is not allowlisted'),
      };
    }

    return {
      outcome: ToolConfirmationOutcome.Cancel,
      notice: buildNotice(
        input.toolName || input.confirmationType || 'request',
        'request type is not allowed in published mode'
      ),
    };
  }
}
