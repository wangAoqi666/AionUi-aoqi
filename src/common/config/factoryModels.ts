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
  modelProvider?: string;
  sourceModelId?: string;
  isCustom?: boolean;
  deprecated?: boolean;
};

export const FACTORY_REASONING_CONFIG_ID = 'reasoning_effort';
export const FACTORY_SPEC_MODEL_CONFIG_ID = 'spec_mode_model';
export const FACTORY_SPEC_REASONING_CONFIG_ID = 'spec_mode_reasoning_effort';
export const FACTORY_SPEC_MODEL_USE_MAIN_VALUE = '__use_main_model__';

type FactoryModelProvider = 'anthropic' | 'openai' | 'google' | 'factory' | 'other';

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
let droidModelCatalog: FactoryModel[] = FACTORY_MODELS;
const droidModelCatalogListeners = new Set<() => void>();

function areFactoryCatalogsEqual(left: FactoryModel[], right: FactoryModel[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function emitDroidModelCatalogChange(): void {
  droidModelCatalogListeners.forEach((listener) => listener());
}

function isReasoningLevel(value: string): value is ReasoningLevel {
  return Object.prototype.hasOwnProperty.call(REASONING_LABELS, value);
}

function normalizeFactoryModel(model: FactoryModel | null | undefined): FactoryModel | null {
  if (!model?.id || !model.name) {
    return null;
  }

  const reasoningLevels: ReasoningLevel[] = Array.from(new Set(model.reasoningLevels.filter(isReasoningLevel)));
  const normalizedReasoningLevels: ReasoningLevel[] = reasoningLevels.length > 0 ? reasoningLevels : ['none'];
  const defaultReasoning = normalizedReasoningLevels.includes(model.defaultReasoning)
    ? model.defaultReasoning
    : normalizedReasoningLevels[0];

  return {
    ...model,
    modelProvider: typeof model.modelProvider === 'string' ? model.modelProvider : undefined,
    sourceModelId: typeof model.sourceModelId === 'string' ? model.sourceModelId : undefined,
    isCustom: model.isCustom === true,
    reasoningLevels: normalizedReasoningLevels,
    defaultReasoning,
  };
}

function getActiveFactoryCatalog(): FactoryModel[] {
  return droidModelCatalog.length > 0 ? droidModelCatalog : FACTORY_MODELS;
}

export function getFactoryModels(): FactoryModel[] {
  return getActiveFactoryCatalog();
}

export function subscribeFactoryModelCatalog(listener: () => void): () => void {
  droidModelCatalogListeners.add(listener);
  return () => {
    droidModelCatalogListeners.delete(listener);
  };
}

export function setDroidModelCatalog(models?: FactoryModel[] | null): FactoryModel[] {
  const previousCatalog = getActiveFactoryCatalog();
  const nextCatalog = (models || [])
    .map((model) => normalizeFactoryModel(model))
    .filter((model): model is FactoryModel => Boolean(model));

  droidModelCatalog = nextCatalog.length > 0 ? nextCatalog : FACTORY_MODELS;
  const activeCatalog = getActiveFactoryCatalog();

  if (!areFactoryCatalogsEqual(previousCatalog, activeCatalog)) {
    emitDroidModelCatalogChange();
  }

  return activeCatalog;
}

export function resetDroidModelCatalog(): void {
  const previousCatalog = getActiveFactoryCatalog();
  droidModelCatalog = FACTORY_MODELS;
  if (!areFactoryCatalogsEqual(previousCatalog, FACTORY_MODELS)) {
    emitDroidModelCatalogChange();
  }
}

export function getFactoryDefaultModelId(): string {
  const models = getActiveFactoryCatalog();
  return (
    models.find((model) => !model.deprecated && model.id === FACTORY_DEFAULT_MODEL_ID)?.id ||
    models.find((model) => !model.deprecated)?.id ||
    FACTORY_DEFAULT_MODEL_ID
  );
}

function getFactoryModelOrDefault(id?: string | null): FactoryModel {
  const models = getActiveFactoryCatalog();
  return getFactoryModelById(id || '') || models.find((model) => model.id === getFactoryDefaultModelId()) || models[0]!;
}

function getFactoryModelProvider(modelId?: string | null): FactoryModelProvider {
  if (!modelId) return 'other';

  const catalogModel = getFactoryModelById(modelId);
  const explicitProvider = catalogModel?.modelProvider;
  if (explicitProvider === 'anthropic' || explicitProvider === 'openai' || explicitProvider === 'google') {
    return explicitProvider;
  }
  if (explicitProvider === 'factory') {
    return 'factory';
  }

  const candidateId = catalogModel?.sourceModelId || modelId;
  if (candidateId.startsWith('claude-')) return 'anthropic';
  if (candidateId.startsWith('gpt-')) return 'openai';
  if (candidateId.startsWith('gemini-')) return 'google';
  if (candidateId.startsWith('glm-') || candidateId.startsWith('kimi-') || candidateId.startsWith('minimax-')) {
    return 'factory';
  }
  return 'other';
}

export function isFactoryCustomModel(modelId?: string | null): boolean {
  if (!modelId) return false;
  return getFactoryModelById(modelId)?.isCustom === true;
}

export function getFactoryDroidModelInfo(currentModelId: string = getFactoryDefaultModelId()): AcpModelInfo {
  const currentModel = getFactoryModelOrDefault(currentModelId);
  return {
    currentModelId: currentModel.id,
    currentModelLabel: currentModel.name,
    availableModels: getActiveFactoryCatalog()
      .filter((m) => !m.deprecated)
      .map((m) => ({ id: m.id, label: m.name })),
    canSwitch: true,
    source: 'models',
  };
}

export function getFactoryModelById(id: string): FactoryModel | undefined {
  return getActiveFactoryCatalog().find((m) => m.id === id);
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

export function isFactorySpecModelCompatible(
  mainModelId?: string | null,
  mainReasoning?: string | null,
  specModelId?: string | null
): boolean {
  if (!specModelId) return false;

  const mainProvider = getFactoryModelProvider(mainModelId);
  const specProvider = getFactoryModelProvider(specModelId);
  const resolvedMainReasoning = resolveFactoryReasoning(mainModelId, mainReasoning);

  if (mainProvider === 'openai') {
    return specProvider === 'openai';
  }

  if (mainProvider === 'anthropic' && resolvedMainReasoning !== 'off') {
    return specProvider === 'anthropic';
  }

  return specProvider !== 'openai';
}

export function resolveFactorySpecModel(
  mainModelId?: string | null,
  mainReasoning?: string | null,
  requestedSpecModelId?: string | null
): string | null {
  if (!requestedSpecModelId) return null;
  return isFactorySpecModelCompatible(mainModelId, mainReasoning, requestedSpecModelId) ? requestedSpecModelId : null;
}

export function getCompatibleFactorySpecModels(
  mainModelId?: string | null,
  mainReasoning?: string | null
): FactoryModel[] {
  return getActiveFactoryCatalog().filter(
    (model) => !model.deprecated && isFactorySpecModelCompatible(mainModelId, mainReasoning, model.id)
  );
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

export function buildFactorySpecModelConfigOption(
  mainModelId?: string | null,
  mainReasoning?: string | null,
  currentValue?: string | null
): AcpSessionConfigOption {
  const model = getFactoryModelOrDefault(mainModelId);
  const compatibleModels = getCompatibleFactorySpecModels(model.id, mainReasoning);
  const resolvedSpecModelId = resolveFactorySpecModel(model.id, mainReasoning, currentValue);

  return {
    id: FACTORY_SPEC_MODEL_CONFIG_ID,
    name: 'Spec Model',
    category: 'spec-model',
    type: 'select',
    currentValue: resolvedSpecModelId || FACTORY_SPEC_MODEL_USE_MAIN_VALUE,
    selectedValue: resolvedSpecModelId || FACTORY_SPEC_MODEL_USE_MAIN_VALUE,
    options: [
      {
        value: FACTORY_SPEC_MODEL_USE_MAIN_VALUE,
        name: `Use main model (${model.name})`,
      },
      ...compatibleModels.map((item) => ({
        value: item.id,
        name: item.name,
      })),
    ],
  };
}

export function buildFactorySpecReasoningConfigOption(
  specModelId?: string | null,
  currentValue?: string | null
): AcpSessionConfigOption | null {
  if (!specModelId) return null;

  const model = getFactoryModelOrDefault(specModelId);
  const resolvedValue = resolveFactoryReasoning(model.id, currentValue);

  return {
    id: FACTORY_SPEC_REASONING_CONFIG_ID,
    name: 'Spec Reasoning',
    category: 'spec-reasoning',
    type: 'select',
    currentValue: resolvedValue,
    selectedValue: resolvedValue,
    options: model.reasoningLevels.map((level) => ({
      value: level,
      name: getFactoryReasoningLabel(level),
    })),
  };
}

export function buildFactoryDroidConfigOptions(params: {
  mainModelId?: string | null;
  mainReasoning?: string | null;
  specModelId?: string | null;
  specReasoning?: string | null;
}): AcpSessionConfigOption[] {
  const mainModelId = params.mainModelId || getFactoryDefaultModelId();
  const resolvedMainReasoning = resolveFactoryReasoning(mainModelId, params.mainReasoning);
  const resolvedSpecModelId = resolveFactorySpecModel(mainModelId, resolvedMainReasoning, params.specModelId);
  const specReasoningOption = buildFactorySpecReasoningConfigOption(resolvedSpecModelId, params.specReasoning);

  return [
    buildFactorySpecModelConfigOption(mainModelId, resolvedMainReasoning, resolvedSpecModelId),
    ...(specReasoningOption ? [specReasoningOption] : []),
    buildFactoryReasoningConfigOption(mainModelId, resolvedMainReasoning),
  ];
}
