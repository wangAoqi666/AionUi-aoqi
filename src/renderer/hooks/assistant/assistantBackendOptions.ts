/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import { ACP_BACKENDS_ALL } from '@/common/types/acpTypes';

type AssistantBackendTarget = {
  isBuiltin?: boolean;
  presetAgentType?: string;
};

type ExtensionAcpAdapter = Record<string, unknown>;

export type AssistantBackendOption = {
  value: string;
  label: string;
  isExtension?: boolean;
};

export const LOCKED_BUILTIN_ASSISTANT_BACKEND = 'droid' as const;

const buildBackendOption = (backendId: string): AssistantBackendOption => {
  const config = ACP_BACKENDS_ALL[backendId as keyof typeof ACP_BACKENDS_ALL];
  return {
    value: backendId,
    label: config?.name ?? backendId,
  };
};

export const isBuiltinAssistantBackendLocked = (assistant: AssistantBackendTarget | null | undefined): boolean =>
  assistant?.isBuiltin === true;

export const resolveAssistantPresetAgentType = (
  assistant: AssistantBackendTarget | null | undefined,
  fallback = 'gemini'
): string => {
  if (isBuiltinAssistantBackendLocked(assistant)) {
    return LOCKED_BUILTIN_ASSISTANT_BACKEND;
  }

  return assistant?.presetAgentType || fallback;
};

export const getAssistantBackendOptions = ({
  assistant,
  availableBackends,
  extensionAcpAdapters,
}: {
  assistant: AssistantBackendTarget | null | undefined;
  availableBackends: Set<string>;
  extensionAcpAdapters?: ExtensionAcpAdapter[];
}): AssistantBackendOption[] => {
  if (isBuiltinAssistantBackendLocked(assistant)) {
    return [buildBackendOption(LOCKED_BUILTIN_ASSISTANT_BACKEND)];
  }

  const builtinOptions = Array.from(availableBackends).map((backendId) => buildBackendOption(backendId));
  const extensionOptions = (extensionAcpAdapters || []).flatMap((adapter) => {
    const id = typeof adapter.id === 'string' ? adapter.id : '';
    if (!id) return [];

    return [
      {
        value: id,
        label: typeof adapter.name === 'string' && adapter.name ? adapter.name : id,
        isExtension: true,
      },
    ];
  });

  return [...builtinOptions, ...extensionOptions];
};
