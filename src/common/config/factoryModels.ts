/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AcpModelInfo, AcpSessionConfigOption } from '@/common/types/acpTypes';

export type ReasoningLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'max' | 'xhigh' | 'none';

export type FactoryModel = {
  id: string;
  name: string;
  reasoningLevels: ReasoningLevel[];
  defaultReasoning: ReasoningLevel;
  deprecated?: boolean;
};

export const FACTORY_REASONING_CONFIG_ID = 'reasoning_effort';

const REASONING_LABELS: Record<ReasoningLevel, string> = {
  off: 'Off',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  max: 'Max',
  xhigh: 'Extra High',
  none: '动态',
};

export const FACTORY_MODELS: FactoryModel[] = [
  {
    id: 'claude-opus-4-6',
    name: 'Claude Opus 4.6',
    reasoningLevels: ['off', 'low', 'medium', 'high', 'max'],
    defaultReasoning: 'high',
  },
  {
    id: 'claude-opus-4-6-fast',
    name: 'Claude Opus 4.6 Fast',
    reasoningLevels: ['off', 'low', 'medium', 'high', 'max'],
    defaultReasoning: 'high',
  },
  {
    id: 'claude-opus-4-5-20251101',
    name: 'Claude Opus 4.5',
    reasoningLevels: ['off', 'low', 'medium', 'high'],
    defaultReasoning: 'off',
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    reasoningLevels: ['off', 'low', 'medium', 'high', 'max'],
    defaultReasoning: 'high',
  },
  {
    id: 'claude-sonnet-4-5-20250929',
    name: 'Claude Sonnet 4.5',
    reasoningLevels: ['off', 'low', 'medium', 'high'],
    defaultReasoning: 'off',
  },
  {
    id: 'claude-haiku-4-5-20251001',
    name: 'Claude Haiku 4.5',
    reasoningLevels: ['off', 'low', 'medium', 'high'],
    defaultReasoning: 'off',
  },
  { id: 'gpt-5.4', name: 'GPT-5.4', reasoningLevels: ['low', 'medium', 'high', 'xhigh'], defaultReasoning: 'medium' },
  {
    id: 'gpt-5.4-fast',
    name: 'GPT-5.4 Fast',
    reasoningLevels: ['low', 'medium', 'high', 'xhigh'],
    defaultReasoning: 'medium',
  },
  {
    id: 'gpt-5.4-mini',
    name: 'GPT-5.4 Mini',
    reasoningLevels: ['low', 'medium', 'high', 'xhigh'],
    defaultReasoning: 'high',
  },
  {
    id: 'gpt-5.3-codex',
    name: 'GPT-5.3-Codex',
    reasoningLevels: ['low', 'medium', 'high', 'xhigh'],
    defaultReasoning: 'medium',
  },
  {
    id: 'gpt-5.3-codex-fast',
    name: 'GPT-5.3-Codex Fast',
    reasoningLevels: ['low', 'medium', 'high', 'xhigh'],
    defaultReasoning: 'medium',
  },
  {
    id: 'gpt-5.2',
    name: 'GPT-5.2',
    reasoningLevels: ['off', 'low', 'medium', 'high', 'xhigh'],
    defaultReasoning: 'low',
  },
  {
    id: 'gpt-5.2-codex',
    name: 'GPT-5.2-Codex',
    reasoningLevels: ['low', 'medium', 'high', 'xhigh'],
    defaultReasoning: 'medium',
  },
  {
    id: 'gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro',
    reasoningLevels: ['low', 'medium', 'high'],
    defaultReasoning: 'high',
  },
  {
    id: 'gemini-3-flash-preview',
    name: 'Gemini 3 Flash',
    reasoningLevels: ['minimal', 'low', 'medium', 'high'],
    defaultReasoning: 'high',
  },
  { id: 'glm-5', name: 'Droid Core (GLM-5)', reasoningLevels: ['none'], defaultReasoning: 'none' },
  { id: 'kimi-k2.5', name: 'Droid Core (Kimi K2.5)', reasoningLevels: ['none'], defaultReasoning: 'none' },
  {
    id: 'minimax-m2.5',
    name: 'Droid Core (MiniMax M2.5)',
    reasoningLevels: ['low', 'medium', 'high'],
    defaultReasoning: 'high',
  },
];

export const FACTORY_DEFAULT_MODEL_ID = 'claude-opus-4-6';

function getFactoryModelOrDefault(id?: string | null): FactoryModel {
  return getFactoryModelById(id || '') || FACTORY_MODELS.find((model) => model.id === FACTORY_DEFAULT_MODEL_ID)!;
}

export function getFactoryDroidModelInfo(currentModelId: string = FACTORY_DEFAULT_MODEL_ID): AcpModelInfo {
  const currentModel = getFactoryModelOrDefault(currentModelId);
  return {
    currentModelId: currentModel.id,
    currentModelLabel: currentModel.name,
    availableModels: FACTORY_MODELS.filter((m) => !m.deprecated).map((m) => ({ id: m.id, label: m.name })),
    canSwitch: true,
    source: 'models',
  };
}

export function getFactoryModelById(id: string): FactoryModel | undefined {
  return FACTORY_MODELS.find((m) => m.id === id);
}

export function getFactoryReasoningLabel(level: ReasoningLevel): string {
  return REASONING_LABELS[level];
}

export function resolveFactoryReasoning(modelId?: string | null, requested?: string | null): ReasoningLevel {
  const model = getFactoryModelOrDefault(modelId);
  if (requested && model.reasoningLevels.includes(requested as ReasoningLevel)) {
    return requested as ReasoningLevel;
  }
  return model.defaultReasoning;
}

export function buildFactoryReasoningConfigOption(
  modelId?: string | null,
  currentValue?: string | null
): AcpSessionConfigOption {
  const model = getFactoryModelOrDefault(modelId);
  const resolvedValue = resolveFactoryReasoning(model.id, currentValue);
  return {
    id: FACTORY_REASONING_CONFIG_ID,
    name: 'Reasoning Effort',
    category: 'reasoning',
    type: 'select',
    currentValue: resolvedValue,
    selectedValue: resolvedValue,
    options: model.reasoningLevels.map((level) => ({
      value: level,
      name: getFactoryReasoningLabel(level),
    })),
  };
}
