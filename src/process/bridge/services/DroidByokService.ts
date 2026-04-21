/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  DroidByokModelProvider,
  IDroidByokImportConfigsInput,
  IDroidByokImportProgress,
  IDroidByokImportResult,
  IDroidByokModelConfig,
  IDroidByokModelConfigInput,
  IDroidByokRemoteCatalog,
  IDroidByokRemoteModel,
} from '@/common/adapter/ipcBridge';
import { ProcessConfig, getFactoryRootDir } from '@process/utils/initStorage';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const DROID_BYOK_SETTINGS_FILE = 'settings.local.json';
const DROID_BYOK_MAX_OUTPUT_TOKENS = 8192;
const DROID_BYOK_REMOTE_FETCH_TIMEOUT_MS = 15000;
const DROID_BYOK_PROBE_TIMEOUT_MS = 8000;
const DROID_BYOK_IMPORT_CONCURRENCY = 6;
const DROID_BYOK_PROVIDER_VALUES = ['anthropic', 'openai', 'generic-chat-completion-api'] as const;
const remoteCatalogCache = new Map<string, IDroidByokRemoteCatalog>();

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
  provider: DroidByokModelProvider;
};

type NormalizedByokInput = Omit<IDroidByokModelConfigInput, 'existingId'> & {
  displayName: string;
};

type SupportedEndpointType = 'anthropic' | 'openai' | 'openai-response' | 'openai-response-compact' | 'gemini';

type ProbeResult = {
  provider: DroidByokModelProvider;
  error: string | null;
};

const getDroidByokSettingsFilePath = (): string => {
  return path.join(getFactoryRootDir(), DROID_BYOK_SETTINGS_FILE);
};

const isDroidByokProvider = (value: unknown): value is DroidByokModelProvider => {
  return typeof value === 'string' && DROID_BYOK_PROVIDER_VALUES.includes(value as DroidByokModelProvider);
};

const normalizeDroidByokBaseUrl = (baseUrl: string): string => {
  return baseUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/v1\/messages$/i, '')
    .replace(/\/messages$/i, '')
    .replace(/\/v1\/chat\/completions$/i, '')
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/v1\/responses$/i, '')
    .replace(/\/responses$/i, '')
    .replace(/\/v1\/models$/i, '')
    .replace(/\/models$/i, '')
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

const buildRemoteCatalogCacheKey = (baseUrl: string, apiKey: string): string => {
  return createHash('sha1').update(`${baseUrl}\n${apiKey}`).digest('hex');
};

const normalizeInputPayload = (input: IDroidByokModelConfigInput): NormalizedByokInput => {
  const model = input.model.trim();
  const apiKey = input.apiKey.trim();
  const baseUrl = normalizeDroidByokBaseUrl(input.baseUrl);

  assertRequiredField(baseUrl, 'Base URL');
  assertRequiredField(apiKey, 'API key');
  assertRequiredField(model, 'Model');

  if (typeof input.provider !== 'undefined' && !isDroidByokProvider(input.provider)) {
    throw new Error('Unsupported provider');
  }

  return {
    baseUrl,
    apiKey,
    model,
    displayName: resolveDisplayName(model, input.displayName),
    ...(input.provider ? { provider: input.provider } : {}),
  };
};

const buildConfig = (input: NormalizedByokInput, provider: DroidByokModelProvider): IDroidByokModelConfig => {
  return {
    id: buildDroidByokModelRefId({
      model: input.model,
      baseUrl: input.baseUrl,
      provider,
    }),
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    model: input.model,
    displayName: input.displayName,
    provider,
    maxOutputTokens: DROID_BYOK_MAX_OUTPUT_TOKENS,
  };
};

const entryToConfig = (entry: FactoryCustomModelEntry, id?: string): IDroidByokModelConfig | null => {
  if (
    typeof entry.model !== 'string' ||
    typeof entry.baseUrl !== 'string' ||
    typeof entry.apiKey !== 'string' ||
    !isDroidByokProvider(entry.provider)
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
        provider: entry.provider,
      }),
    model,
    baseUrl: normalizedBaseUrl,
    apiKey: entry.apiKey.trim(),
    displayName: resolveDisplayName(model, typeof entry.displayName === 'string' ? entry.displayName : ''),
    provider: entry.provider,
    maxOutputTokens:
      typeof entry.maxOutputTokens === 'number' && Number.isFinite(entry.maxOutputTokens)
        ? entry.maxOutputTokens
        : DROID_BYOK_MAX_OUTPUT_TOKENS,
  };
};

/**
 * Build the baseUrl written to settings.local.json / settings.json.
 * Aligns with Factory official BYOK docs:
 *   - anthropic: base URL without /v1 (CLI appends /v1/messages itself)
 *   - openai / generic-chat-completion-api: base URL must include the /v1
 *     version segment so the CLI can append /responses or /chat/completions
 *     on top of it.
 * See https://docs.factory.ai/cli/byok/openai-anthropic.md
 */
const buildPersistedBaseUrl = (canonicalBaseUrl: string, provider: DroidByokModelProvider): string => {
  const trimmed = canonicalBaseUrl.replace(/\/+$/, '');
  if (provider === 'anthropic') {
    return trimmed;
  }
  return /\/v\d+$/i.test(trimmed) ? trimmed : `${trimmed}/v1`;
};

const configToEntry = (config: IDroidByokModelConfig): FactoryCustomModelEntry => {
  return {
    model: config.model,
    displayName: config.displayName,
    baseUrl: buildPersistedBaseUrl(config.baseUrl, config.provider),
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
    !isDroidByokProvider(candidate.provider)
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
            provider: candidate.provider,
          }),
    model,
    baseUrl,
    provider: candidate.provider,
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

const getSupportedEndpointTypes = (value: unknown): SupportedEndpointType[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(
          (item): item is SupportedEndpointType =>
            item === 'anthropic' ||
            item === 'openai' ||
            item === 'openai-response' ||
            item === 'openai-response-compact' ||
            item === 'gemini'
        )
    )
  );
};

const isOpenAiFamilyModel = (model: string): boolean => {
  return /(^|[-_/])(gpt|o[13]|o4|o5|codex)([-_/]|$)/i.test(model);
};

const isClaudeFamilyModel = (model: string): boolean => {
  return /claude/i.test(model);
};

const inferProviderFromModel = (
  model: string,
  supportedEndpointTypes: SupportedEndpointType[]
): DroidByokModelProvider => {
  if (isOpenAiFamilyModel(model)) {
    return 'openai';
  }

  if (isClaudeFamilyModel(model) && supportedEndpointTypes.includes('anthropic')) {
    return 'anthropic';
  }

  if (supportedEndpointTypes.includes('openai') || supportedEndpointTypes.includes('openai-response')) {
    return 'generic-chat-completion-api';
  }

  return supportedEndpointTypes.includes('anthropic') ? 'anthropic' : 'generic-chat-completion-api';
};

const getCandidateProviders = (
  model: string,
  supportedEndpointTypes: SupportedEndpointType[],
  preferredProvider?: DroidByokModelProvider
): DroidByokModelProvider[] => {
  if (preferredProvider) {
    return [preferredProvider];
  }

  const ordered = [
    inferProviderFromModel(model, supportedEndpointTypes),
    ...(isOpenAiFamilyModel(model)
      ? (['openai', 'generic-chat-completion-api', 'anthropic'] as const)
      : isClaudeFamilyModel(model)
        ? (['anthropic', 'openai', 'generic-chat-completion-api'] as const)
        : (['generic-chat-completion-api', 'openai', 'anthropic'] as const)),
  ];

  return Array.from(new Set(ordered));
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

const withFetchTimeout = async (input: RequestInfo | URL, init: RequestInit, timeoutMs: number): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Remote request timed out after ${Math.ceil(timeoutMs / 1000)} seconds`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

const probeAnthropicEndpoint = async (baseUrl: string, input: NormalizedByokInput): Promise<string | null> => {
  const endpoints = [`${baseUrl}/v1/messages`, `${baseUrl}/messages`];
  let lastError = 'Unexpected Anthropic-compatible response';

  for (const endpoint of endpoints) {
    try {
      const response = await withFetchTimeout(
        endpoint,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': input.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: input.model,
            max_tokens: 1,
            messages: [{ role: 'user', content: 'hi' }],
          }),
        },
        DROID_BYOK_PROBE_TIMEOUT_MS
      );

      if (!response.ok) {
        lastError = await extractErrorMessage(response);
        continue;
      }

      const data = (await response.json().catch((): null => null)) as { type?: string; content?: unknown } | null;
      if (data?.type === 'message' || Array.isArray(data?.content)) {
        return null;
      }

      lastError = 'Unexpected Anthropic-compatible response';
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  return lastError;
};

const probeOpenAiResponseEndpoint = async (baseUrl: string, input: NormalizedByokInput): Promise<string | null> => {
  try {
    const response = await withFetchTimeout(
      `${baseUrl}/v1/responses`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${input.apiKey}`,
        },
        body: JSON.stringify({
          model: input.model,
          input: 'hi',
          max_output_tokens: 1,
        }),
      },
      DROID_BYOK_PROBE_TIMEOUT_MS
    );

    if (!response.ok) {
      return await extractErrorMessage(response);
    }

    const data = (await response.json().catch((): null => null)) as { id?: string; output?: unknown } | null;
    return data?.id || Array.isArray(data?.output) ? null : 'Unexpected OpenAI responses response';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

const probeChatCompletionEndpoint = async (baseUrl: string, input: NormalizedByokInput): Promise<string | null> => {
  try {
    const response = await withFetchTimeout(
      `${baseUrl}/v1/chat/completions`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${input.apiKey}`,
        },
        body: JSON.stringify({
          model: input.model,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
      },
      DROID_BYOK_PROBE_TIMEOUT_MS
    );

    if (!response.ok) {
      return await extractErrorMessage(response);
    }

    const data = (await response.json().catch((): null => null)) as { choices?: unknown[] } | null;
    return Array.isArray(data?.choices) ? null : 'Unexpected chat completions response';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

const probeProvider = async (provider: DroidByokModelProvider, input: NormalizedByokInput): Promise<ProbeResult> => {
  if (provider === 'anthropic') {
    return {
      provider,
      error: await probeAnthropicEndpoint(input.baseUrl, input),
    };
  }

  if (provider === 'openai') {
    const responseError = await probeOpenAiResponseEndpoint(input.baseUrl, input);
    if (responseError === null) {
      return { provider, error: null };
    }

    const chatError = await probeChatCompletionEndpoint(input.baseUrl, input);
    return {
      provider,
      error: chatError === null ? null : responseError,
    };
  }

  return {
    provider,
    error: await probeChatCompletionEndpoint(input.baseUrl, input),
  };
};

const probeAndResolveConfig = async (
  input: NormalizedByokInput,
  supportedEndpointTypes: SupportedEndpointType[] = []
): Promise<IDroidByokModelConfig> => {
  const providers = getCandidateProviders(input.model, supportedEndpointTypes, input.provider);
  let lastError = 'No compatible provider found';

  for (const provider of providers) {
    const result = await probeProvider(provider, input);
    if (result.error === null) {
      return buildConfig(input, result.provider);
    }
    lastError = result.error;
  }

  throw new Error(lastError);
};

const parseRemoteModel = (value: unknown): IDroidByokRemoteModel | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as {
    id?: unknown;
    model?: unknown;
    name?: unknown;
    supported_endpoint_types?: unknown;
  };
  const model =
    typeof candidate.id === 'string'
      ? candidate.id.trim()
      : typeof candidate.model === 'string'
        ? candidate.model.trim()
        : typeof candidate.name === 'string'
          ? candidate.name.trim()
          : '';

  if (!model) {
    return null;
  }

  const supportedEndpointTypes = getSupportedEndpointTypes(candidate.supported_endpoint_types);
  return {
    model,
    displayName: resolveDisplayName(model),
    supportedEndpointTypes,
    inferredProvider: inferProviderFromModel(model, supportedEndpointTypes),
  };
};

const loadRemoteCatalogFromEndpoint = async (
  baseUrl: string,
  endpoint: string,
  apiKey: string
): Promise<IDroidByokRemoteCatalog> => {
  const response = await withFetchTimeout(
    endpoint,
    {
      method: 'GET',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'x-api-key': apiKey,
      },
    },
    DROID_BYOK_REMOTE_FETCH_TIMEOUT_MS
  );

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }

  const payload = (await response.json().catch((): null => null)) as
    | { data?: unknown[]; models?: unknown[] }
    | unknown[]
    | null;
  const rawModels = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : payload?.models;
  const models = Array.isArray(rawModels)
    ? rawModels.map((item) => parseRemoteModel(item)).filter((item): item is IDroidByokRemoteModel => Boolean(item))
    : [];

  return {
    baseUrl,
    cachedAt: Date.now(),
    models: models.toSorted((a, b) => a.model.localeCompare(b.model)),
  };
};

const loadRemoteCatalog = async (baseUrl: string, apiKey: string): Promise<IDroidByokRemoteCatalog> => {
  const endpoints = [`${baseUrl}/v1/models`, `${baseUrl}/models`];

  return await new Promise<IDroidByokRemoteCatalog>((resolve, reject) => {
    let rejectedCount = 0;
    let firstError: unknown;

    for (const endpoint of endpoints) {
      void loadRemoteCatalogFromEndpoint(baseUrl, endpoint, apiKey)
        .then((catalog) => {
          resolve(catalog);
        })
        .catch((error) => {
          rejectedCount += 1;
          if (typeof firstError === 'undefined') {
            firstError = error;
          }

          if (rejectedCount === endpoints.length) {
            reject(
              new Error(
                firstError instanceof Error ? firstError.message : String(firstError ?? 'Failed to fetch remote models')
              )
            );
          }
        });
    }
  });
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

export async function fetchDroidByokModels(payload: {
  baseUrl: string;
  apiKey: string;
  refresh?: boolean;
}): Promise<IDroidByokRemoteCatalog> {
  const baseUrl = normalizeDroidByokBaseUrl(payload.baseUrl);
  const apiKey = payload.apiKey.trim();

  assertRequiredField(baseUrl, 'Base URL');
  assertRequiredField(apiKey, 'API key');

  const cacheKey = buildRemoteCatalogCacheKey(baseUrl, apiKey);
  if (!payload.refresh) {
    const cached = remoteCatalogCache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const catalog = await loadRemoteCatalog(baseUrl, apiKey);
  remoteCatalogCache.set(cacheKey, catalog);
  return catalog;
}

export async function testDroidByokConfig(input: IDroidByokModelConfigInput): Promise<IDroidByokModelConfig> {
  const normalizedInput = normalizeInputPayload(input);
  return probeAndResolveConfig(normalizedInput);
}

const persistDroidByokConfig = async (
  config: IDroidByokModelConfig,
  existingId?: string
): Promise<IDroidByokModelConfig> => {
  const settings = await readFactorySettingsJson();
  const existingEntries = getCustomModelEntries(settings);
  const existingRefs = await getDroidByokRefs();
  const replacedRefIds = new Set([config.id]);
  if (typeof existingId === 'string' && existingId.trim()) {
    replacedRefIds.add(existingId);
  }
  const replacedRefs = existingRefs.filter((ref) => replacedRefIds.has(ref.id));
  const nextEntries = existingEntries.filter((entry) => !replacedRefs.some((ref) => matchesManagedEntry(entry, ref)));

  settings.customModels = [...nextEntries, configToEntry(config)];
  await writeFactorySettingsJson(settings);
  await setDroidByokRefs([...existingRefs.filter((ref) => !replacedRefIds.has(ref.id)), configToRef(config)]);

  return config;
};

export async function saveDroidByokConfig(input: IDroidByokModelConfigInput): Promise<IDroidByokModelConfig> {
  const normalizedInput = normalizeInputPayload(input);
  const config = await probeAndResolveConfig(normalizedInput);
  return persistDroidByokConfig(config, input.existingId);
}

const buildCatalogEndpointMap = (catalog: IDroidByokRemoteCatalog | null): Map<string, SupportedEndpointType[]> => {
  return new Map<string, SupportedEndpointType[]>(
    (catalog?.models || []).map((model) => [model.model, getSupportedEndpointTypes(model.supportedEndpointTypes)])
  );
};

const runWithConcurrency = async <T>(tasks: Array<() => Promise<T>>, concurrency: number): Promise<T[]> => {
  const limit = Math.max(1, Math.floor(concurrency));
  const results: T[] = Array.from<T>({ length: tasks.length });
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= tasks.length) {
        return;
      }
      results[index] = await tasks[index]();
    }
  });

  await Promise.all(workers);
  return results;
};

const persistDroidByokConfigsBatch = async (configs: IDroidByokModelConfig[]): Promise<void> => {
  if (configs.length === 0) {
    return;
  }

  const settings = await readFactorySettingsJson();
  const existingEntries = getCustomModelEntries(settings);
  const existingRefs = await getDroidByokRefs();

  const replacedRefIds = new Set<string>();
  for (const config of configs) {
    replacedRefIds.add(config.id);
  }
  const replacedRefs = existingRefs.filter((ref) => replacedRefIds.has(ref.id));

  const keptEntries = existingEntries.filter((entry) => !replacedRefs.some((ref) => matchesManagedEntry(entry, ref)));
  const dedupedConfigs = Array.from(new Map(configs.map((config) => [config.id, config])).values());

  settings.customModels = [...keptEntries, ...dedupedConfigs.map((config) => configToEntry(config))];
  await writeFactorySettingsJson(settings);

  const nextRefs = [
    ...existingRefs.filter((ref) => !replacedRefIds.has(ref.id)),
    ...dedupedConfigs.map((config) => configToRef(config)),
  ];
  await setDroidByokRefs(nextRefs);
};

export async function importDroidByokConfigs(
  input: IDroidByokImportConfigsInput,
  options: { onProgress?: (progress: IDroidByokImportProgress) => void } = {}
): Promise<IDroidByokImportResult> {
  const onProgress = options.onProgress;
  const total = input.models.length;
  const skipProbe = Boolean(input.skipProbe);
  const emit = (progress: IDroidByokImportProgress): void => {
    try {
      onProgress?.(progress);
    } catch {
      // ignore listener errors
    }
  };

  const supportedEndpointMap = new Map<string, SupportedEndpointType[]>();
  for (const item of input.models) {
    if (Array.isArray(item.supportedEndpointTypes) && item.supportedEndpointTypes.length > 0) {
      supportedEndpointMap.set(item.model.trim(), getSupportedEndpointTypes(item.supportedEndpointTypes));
    }
  }

  const hasMissingEndpoints = input.models.some((item) => !supportedEndpointMap.has(item.model.trim()));
  if (!skipProbe && hasMissingEndpoints) {
    const catalog = await fetchDroidByokModels({
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
    }).catch((): IDroidByokRemoteCatalog | null => null);
    const catalogMap = buildCatalogEndpointMap(catalog);
    for (const [model, types] of catalogMap.entries()) {
      if (!supportedEndpointMap.has(model)) {
        supportedEndpointMap.set(model, types);
      }
    }
  }

  let completed = 0;
  const resolvedConfigs: IDroidByokModelConfig[] = [];
  const failed: IDroidByokImportResult['failed'] = [];

  const tasks = input.models.map((item) => async (): Promise<void> => {
    const normalizedModel = item.model.trim();
    emit({ current: completed, total, model: normalizedModel, status: 'probing' });
    try {
      const normalizedInput = normalizeInputPayload({
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
        model: item.model,
        displayName: item.displayName,
        provider: item.provider,
      });

      const inferredProvider = inferProviderFromModel(
        normalizedInput.model,
        supportedEndpointMap.get(normalizedModel) || []
      );
      const resolvedProvider = item.provider || normalizedInput.provider || inferredProvider;

      const config = skipProbe
        ? buildConfig(normalizedInput, resolvedProvider)
        : await probeAndResolveConfig(normalizedInput, supportedEndpointMap.get(normalizedModel) || []);

      resolvedConfigs.push(config);
      completed += 1;
      emit({ current: completed, total, model: normalizedModel, status: 'imported' });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failed.push({ model: normalizedModel, reason });
      completed += 1;
      emit({ current: completed, total, model: normalizedModel, status: 'failed', reason });
    }
  });

  await runWithConcurrency(tasks, DROID_BYOK_IMPORT_CONCURRENCY);

  if (resolvedConfigs.length > 0) {
    emit({ current: completed, total, model: '', status: 'persisting' });
    try {
      await persistDroidByokConfigsBatch(resolvedConfigs);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      for (const config of resolvedConfigs) {
        failed.push({ model: config.model, reason });
      }
      emit({ current: completed, total, model: '', status: 'done', reason });
      return { imported: [], failed };
    }
  }

  emit({ current: completed, total, model: '', status: 'done' });
  return { imported: resolvedConfigs, failed };
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
