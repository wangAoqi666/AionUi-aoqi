/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IDroidByokModelConfig, IDroidByokModelConfigInput } from '@/common/adapter/ipcBridge';
import { ProcessConfig, getFactoryRootDir } from '@process/utils/initStorage';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const DROID_BYOK_SETTINGS_FILE = 'settings.local.json';
const DROID_BYOK_PROVIDER = 'anthropic' as const;
const DROID_BYOK_MAX_OUTPUT_TOKENS = 8192;

type FactorySettingsJson = Record<string, unknown> & {
  customModels?: unknown[];
};

type FactoryCustomModelEntry = Record<string, unknown> & {
  model?: string;
  displayName?: string;
  baseUrl?: string;
  apiKey?: string;
  provider?: string;
  maxOutputTokens?: number;
};

type DroidByokModelRef = {
  id: string;
  model: string;
  baseUrl: string;
  provider: 'anthropic';
};

const getDroidByokSettingsFilePath = (): string => {
  return path.join(getFactoryRootDir(), DROID_BYOK_SETTINGS_FILE);
};

const normalizeDroidByokBaseUrl = (baseUrl: string): string => {
  return baseUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/v1\/messages$/i, '')
    .replace(/\/messages$/i, '')
    .replace(/\/v1$/i, '');
};

const resolveDisplayName = (model: string, displayName?: string): string => {
  const trimmed = displayName?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : `${model} [BYOK]`;
};

const assertRequiredField = (value: string, fieldName: string): void => {
  if (!value.trim()) {
    throw new Error(`${fieldName} is required`);
  }
};

const isFactoryCustomModelEntry = (value: unknown): value is FactoryCustomModelEntry => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const buildDroidByokModelRefId = (ref: Omit<DroidByokModelRef, 'id'>): string => {
  return createHash('sha1').update(`${ref.provider}\n${ref.model}\n${ref.baseUrl}`).digest('hex').slice(0, 16);
};

const normalizeInputConfig = (input: IDroidByokModelConfigInput): IDroidByokModelConfig => {
  const model = input.model.trim();
  const apiKey = input.apiKey.trim();
  const baseUrl = normalizeDroidByokBaseUrl(input.baseUrl);

  assertRequiredField(baseUrl, 'Base URL');
  assertRequiredField(apiKey, 'API key');
  assertRequiredField(model, 'Model');

  return {
    id: buildDroidByokModelRefId({
      model,
      baseUrl,
      provider: DROID_BYOK_PROVIDER,
    }),
    baseUrl,
    apiKey,
    model,
    displayName: resolveDisplayName(model, input.displayName),
    provider: DROID_BYOK_PROVIDER,
    maxOutputTokens: DROID_BYOK_MAX_OUTPUT_TOKENS,
  };
};

const entryToConfig = (entry: FactoryCustomModelEntry, id?: string): IDroidByokModelConfig | null => {
  if (
    typeof entry.model !== 'string' ||
    typeof entry.baseUrl !== 'string' ||
    typeof entry.apiKey !== 'string' ||
    entry.provider !== DROID_BYOK_PROVIDER
  ) {
    return null;
  }

  const normalizedBaseUrl = normalizeDroidByokBaseUrl(entry.baseUrl);
  if (!normalizedBaseUrl) {
    return null;
  }

  const model = entry.model.trim();
  return {
    id:
      id ||
      buildDroidByokModelRefId({
        model,
        baseUrl: normalizedBaseUrl,
        provider: DROID_BYOK_PROVIDER,
      }),
    model,
    baseUrl: normalizedBaseUrl,
    apiKey: entry.apiKey,
    displayName: resolveDisplayName(model, typeof entry.displayName === 'string' ? entry.displayName : ''),
    provider: DROID_BYOK_PROVIDER,
    maxOutputTokens:
      typeof entry.maxOutputTokens === 'number' && Number.isFinite(entry.maxOutputTokens)
        ? entry.maxOutputTokens
        : DROID_BYOK_MAX_OUTPUT_TOKENS,
  };
};

const configToEntry = (config: IDroidByokModelConfig): FactoryCustomModelEntry => {
  return {
    model: config.model,
    displayName: config.displayName,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    provider: config.provider,
    maxOutputTokens: config.maxOutputTokens,
  };
};

const configToRef = (
  config: Pick<IDroidByokModelConfig, 'id' | 'model' | 'baseUrl' | 'provider'>
): DroidByokModelRef => {
  return {
    id: config.id,
    model: config.model,
    baseUrl: config.baseUrl,
    provider: config.provider,
  };
};

const readFactorySettingsJson = async (): Promise<FactorySettingsJson> => {
  try {
    const raw = await fs.readFile(getDroidByokSettingsFilePath(), 'utf-8');
    const parsed = JSON.parse(raw) as FactorySettingsJson;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    const errno = error as NodeJS.ErrnoException;
    if (errno.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
};

const writeFactorySettingsJson = async (settings: FactorySettingsJson): Promise<void> => {
  await fs.mkdir(getFactoryRootDir(), { recursive: true });
  await fs.writeFile(getDroidByokSettingsFilePath(), `${JSON.stringify(settings, null, 2)}\n`, 'utf-8');
};

const normalizeDroidByokRef = (ref: unknown): DroidByokModelRef | null => {
  if (!ref || typeof ref !== 'object') {
    return null;
  }

  const candidate = ref as {
    id?: unknown;
    model?: unknown;
    baseUrl?: unknown;
    provider?: unknown;
  };

  if (
    typeof candidate.model !== 'string' ||
    typeof candidate.baseUrl !== 'string' ||
    candidate.provider !== DROID_BYOK_PROVIDER
  ) {
    return null;
  }

  const model = candidate.model.trim();
  const baseUrl = normalizeDroidByokBaseUrl(candidate.baseUrl);
  if (!model || !baseUrl) {
    return null;
  }

  return {
    id:
      typeof candidate.id === 'string' && candidate.id.trim()
        ? candidate.id
        : buildDroidByokModelRefId({
            model,
            baseUrl,
            provider: DROID_BYOK_PROVIDER,
          }),
    model,
    baseUrl,
    provider: DROID_BYOK_PROVIDER,
  };
};

const dedupeDroidByokRefs = (refs: DroidByokModelRef[]): DroidByokModelRef[] => {
  return Array.from(new Map(refs.map((ref) => [ref.id, ref])).values());
};

const getDroidByokRefs = async (): Promise<DroidByokModelRef[]> => {
  const acpConfig = await ProcessConfig.get('acp.config').catch((): undefined => undefined);
  const storedRefs = acpConfig?.droid?.byokModelRefs;

  if (Array.isArray(storedRefs)) {
    return dedupeDroidByokRefs(
      storedRefs.map((ref) => normalizeDroidByokRef(ref)).filter((ref): ref is DroidByokModelRef => Boolean(ref))
    );
  }

  const legacyRef = normalizeDroidByokRef(acpConfig?.droid?.byokModelRef);
  return legacyRef ? [legacyRef] : [];
};

const setDroidByokRefs = async (refs: DroidByokModelRef[]): Promise<void> => {
  const acpConfig = (await ProcessConfig.get('acp.config').catch((): undefined => undefined)) || {};
  const nextDroidConfig = { ...acpConfig.droid };

  delete nextDroidConfig.byokModelRef;

  const dedupedRefs = dedupeDroidByokRefs(refs);
  if (dedupedRefs.length > 0) {
    nextDroidConfig.byokModelRefs = dedupedRefs.map((ref) => ({
      id: ref.id,
      model: ref.model,
      baseUrl: ref.baseUrl,
      provider: ref.provider,
    }));
  } else {
    delete nextDroidConfig.byokModelRefs;
  }

  await ProcessConfig.set('acp.config', {
    ...acpConfig,
    droid: nextDroidConfig,
  });
};

const matchesManagedEntry = (entry: FactoryCustomModelEntry, ref: DroidByokModelRef): boolean => {
  return (
    entry.provider === ref.provider &&
    typeof entry.model === 'string' &&
    entry.model.trim() === ref.model &&
    typeof entry.baseUrl === 'string' &&
    normalizeDroidByokBaseUrl(entry.baseUrl) === ref.baseUrl
  );
};

const getCustomModelEntries = (settings: FactorySettingsJson): FactoryCustomModelEntry[] => {
  return Array.isArray(settings.customModels) ? settings.customModels.filter(isFactoryCustomModelEntry) : [];
};

const getAnthropicProbeEndpoints = (baseUrl: string): string[] => {
  return [`${baseUrl}/v1/messages`, `${baseUrl}/messages`];
};

const extractErrorMessage = async (response: Response): Promise<string> => {
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    const data = (await response.json().catch((): null => null)) as {
      error?: { message?: string };
      message?: string;
    } | null;
    return data?.error?.message || data?.message || `HTTP ${response.status}`;
  }

  const text = await response.text().catch(() => '');
  return text.trim().slice(0, 300) || `HTTP ${response.status}`;
};

export async function getDroidByokConfigs(): Promise<IDroidByokModelConfig[]> {
  const refs = await getDroidByokRefs();
  if (refs.length === 0) {
    return [];
  }

  const settings = await readFactorySettingsJson();
  const entries = getCustomModelEntries(settings);
  return refs.flatMap((ref) => {
    const entry = entries.find((candidate) => matchesManagedEntry(candidate, ref));
    const config = entry ? entryToConfig(entry, ref.id) : null;
    return config ? [config] : [];
  });
}

const probeAnthropicEndpoint = async (endpoint: string, config: IDroidByokModelConfig): Promise<string | null> => {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });

    if (!response.ok) {
      return await extractErrorMessage(response);
    }

    const data = (await response.json().catch((): null => null)) as { type?: string } | null;
    return data?.type === 'message' ? null : 'Unexpected Anthropic-compatible response';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

const probeAnthropicEndpoints = async (
  endpoints: string[],
  config: IDroidByokModelConfig,
  lastError = 'Unexpected Anthropic-compatible response'
): Promise<IDroidByokModelConfig> => {
  const [endpoint, ...restEndpoints] = endpoints;
  if (!endpoint) {
    throw new Error(lastError);
  }

  const nextError = await probeAnthropicEndpoint(endpoint, config);
  if (nextError === null) {
    return config;
  }

  return probeAnthropicEndpoints(restEndpoints, config, nextError);
};

export async function testDroidByokConfig(input: IDroidByokModelConfigInput): Promise<IDroidByokModelConfig> {
  const config = normalizeInputConfig(input);
  return probeAnthropicEndpoints(getAnthropicProbeEndpoints(config.baseUrl), config);
}

export async function saveDroidByokConfig(input: IDroidByokModelConfigInput): Promise<IDroidByokModelConfig> {
  const config = normalizeInputConfig(input);
  const settings = await readFactorySettingsJson();
  const existingEntries = getCustomModelEntries(settings);
  const existingRefs = await getDroidByokRefs();
  const replacedRefIds = new Set([config.id]);
  if (typeof input.existingId === 'string' && input.existingId.trim()) {
    replacedRefIds.add(input.existingId);
  }
  const replacedRefs = existingRefs.filter((ref) => replacedRefIds.has(ref.id));
  const nextEntries = existingEntries.filter((entry) => !replacedRefs.some((ref) => matchesManagedEntry(entry, ref)));

  settings.customModels = [...nextEntries, configToEntry(config)];
  await writeFactorySettingsJson(settings);
  await setDroidByokRefs([...existingRefs.filter((ref) => !replacedRefIds.has(ref.id)), configToRef(config)]);

  return config;
}

export async function removeDroidByokConfig(id: string): Promise<void> {
  if (!id.trim()) {
    return;
  }

  const settings = await readFactorySettingsJson();
  const existingEntries = getCustomModelEntries(settings);
  const existingRefs = await getDroidByokRefs();
  const refToRemove = existingRefs.find((ref) => ref.id === id);

  if (refToRemove) {
    const nextEntries = existingEntries.filter((entry) => !matchesManagedEntry(entry, refToRemove));
    if (nextEntries.length > 0) {
      settings.customModels = nextEntries;
    } else {
      delete settings.customModels;
    }
    await writeFactorySettingsJson(settings);
  }

  await setDroidByokRefs(existingRefs.filter((ref) => ref.id !== id));
}
