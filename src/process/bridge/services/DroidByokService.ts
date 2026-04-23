/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  DroidByokModelProvider,
  IDroidByokCapabilityConflict,
  IDroidByokImportConfigsInput,
  IDroidByokImportProgress,
  IDroidByokImportResult,
  IDroidByokModelConfig,
  IDroidByokModelConfigInput,
  IDroidByokRemoteCatalog,
  IDroidByokRemoteModel,
  IDroidByokSite,
  IDroidByokSiteUpsertInput,
  IDroidByokVerificationResult,
} from '@/common/adapter/ipcBridge';
import type { ReasoningLevel } from '@/common/config/factoryModels';
import { ProcessConfig, getFactoryRootDir } from '@process/utils/initStorage';
import { mainLog, mainWarn } from '@process/utils/mainLogger';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const DROID_BYOK_SETTINGS_FILE = 'settings.local.json';
const DROID_BYOK_MAX_OUTPUT_TOKENS = 8192;
const DROID_BYOK_REMOTE_FETCH_TIMEOUT_MS = 15000;
const DROID_BYOK_PROBE_TIMEOUT_MS = 8000;
const DROID_BYOK_IMPORT_CONCURRENCY = 6;
const DROID_BYOK_PROVIDER_VALUES = ['anthropic', 'openai', 'generic-chat-completion-api', 'google'] as const;
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
  /**
   * Whether the BYOK model accepts image inputs. Persisted per entry so a site
   * can expose per-model multimodal state to renderer selectors.
   *
   * 是否支持图片输入；未设置时按启发式推断。
   */
  supportsImageInput?: boolean;
  /**
   * Allowed reasoning levels for this BYOK model. Persisted as an array so the
   * value round-trips through `settings.local.json` unchanged.
   */
  reasoningLevels?: ReasoningLevel[];
  /** Default reasoning level applied when starting a new session. */
  defaultReasoning?: ReasoningLevel;
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

type ByokModelCapabilities = {
  supportsImageInput: boolean;
  reasoningLevels: ReasoningLevel[];
  defaultReasoning: ReasoningLevel;
};

type SupportedEndpointType = 'anthropic' | 'openai' | 'openai-response' | 'openai-response-compact' | 'gemini';

type ProbeResult = {
  provider: DroidByokModelProvider;
  error: string | null;
  baseUrl?: string;
};

const getDroidByokSettingsFilePath = (): string => {
  return path.join(getFactoryRootDir(), DROID_BYOK_SETTINGS_FILE);
};

const isDroidByokProvider = (value: unknown): value is DroidByokModelProvider => {
  return typeof value === 'string' && DROID_BYOK_PROVIDER_VALUES.includes(value as DroidByokModelProvider);
};

const stripDroidByokBaseUrl = (baseUrl: string): string => {
  return baseUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/v1\/messages$/i, '')
    .replace(/\/messages$/i, '')
    .replace(/\/v1\/chat\/completions$/i, '')
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/v1\/responses$/i, '')
    .replace(/\/responses$/i, '')
    .replace(/\/v1beta\/models$/i, '/v1beta')
    .replace(/\/v1\/models$/i, '/v1')
    .replace(/\/models$/i, '');
};

const normalizeDroidByokBaseUrl = (baseUrl: string, provider?: DroidByokModelProvider): string => {
  const stripped = stripDroidByokBaseUrl(baseUrl);

  if (provider === 'google') {
    if (/\/v1beta$/i.test(stripped) || /\/v1$/i.test(stripped)) {
      return stripped;
    }
    return stripped ? `${stripped}/v1beta` : stripped;
  }

  return stripped.replace(/\/v1$/i, '');
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

// =====================================================================
// Capability inference for BYOK models (M3.B)
// =====================================================================
// Heuristics only — users can always override via the model-edit modal. The
// patterns below line up with the public capability matrices of the major
// vendors (Anthropic / OpenAI / Google / Moonshot / Qwen / GLM / DeepSeek).
//
// Why heuristics instead of probing?
//   - Probing `supportsImageInput` would require sending a real image request
//     against a billed endpoint. Users have explicitly asked us not to do that.
//   - Reasoning levels are not exposed through any standard catalog API; the
//     only reliable signal is the model family/name.
//
// User-supplied values ALWAYS win. See `resolveByokModelCapabilities` below
// for the merge rules.

const REASONING_LEVELS_DEFAULT: ReasoningLevel[] = ['none'];
const REASONING_LEVELS_OPENAI_REASONING: ReasoningLevel[] = ['minimal', 'low', 'medium', 'high'];
const REASONING_LEVELS_GPT5: ReasoningLevel[] = ['minimal', 'low', 'medium', 'high', 'xhigh'];
const REASONING_LEVELS_CLAUDE_EXTENDED: ReasoningLevel[] = ['off', 'low', 'medium', 'high'];
const REASONING_LEVELS_GEMINI_2_5: ReasoningLevel[] = ['off', 'low', 'medium', 'high'];
const REASONING_LEVELS_GEMINI_3: ReasoningLevel[] = ['low', 'medium', 'high'];
const REASONING_LEVELS_QWEN3_REASONING: ReasoningLevel[] = ['off', 'low', 'medium', 'high'];
const REASONING_LEVELS_GLM_REASONING: ReasoningLevel[] = ['off', 'low', 'medium', 'high'];

type CapabilityProviderHint = DroidByokModelProvider | undefined;

/**
 * Infer `{supportsImageInput, reasoningLevels, defaultReasoning}` from a model
 * id. `providerHint` and `supportedEndpointTypes` steer the inference when the
 * id alone is ambiguous (e.g., `gpt-4o` over Anthropic shim).
 *
 * 根据模型 id + provider + 远端 supported_endpoint_types 推断能力；
 * 用户显式传入的值始终优先。
 */
export function inferByokModelCapabilities(
  model: string,
  providerHint?: CapabilityProviderHint,
  supportedEndpointTypes?: SupportedEndpointType[]
): ByokModelCapabilities {
  const normalized = model.trim().toLowerCase();

  // --- Anthropic / Claude -------------------------------------------------
  if (isClaudeFamilyModel(normalized) || providerHint === 'anthropic') {
    // Claude 3.5+/3.7/4/4.1/opus-4/sonnet-4: multimodal + extended thinking
    const claude35Plus =
      /claude-(3-5|3\.5|3-7|3\.7|4|4-1|4\.1|opus-4|sonnet-4|haiku-4)/i.test(normalized) ||
      /claude-(sonnet|opus|haiku)-(3-5|3\.5|3-7|3\.7|4|4-1|4\.1|5|6)/i.test(normalized);
    const claude3Base = /claude-3(?!-haiku-200)/i.test(normalized) && !claude35Plus;
    const extendedThinking =
      /claude-(3-7|3\.7|4|4-1|4\.1|opus-4|sonnet-4)/i.test(normalized) ||
      /claude-(sonnet|opus|haiku)-(3-7|3\.7|4|4-1|4\.1|5|6)/i.test(normalized);

    if (claude35Plus || claude3Base) {
      return {
        supportsImageInput: true,
        reasoningLevels: extendedThinking ? REASONING_LEVELS_CLAUDE_EXTENDED : REASONING_LEVELS_DEFAULT,
        defaultReasoning: extendedThinking ? 'off' : 'none',
      };
    }

    // Older / unknown Claude — no vision by default.
    return {
      supportsImageInput: false,
      reasoningLevels: REASONING_LEVELS_DEFAULT,
      defaultReasoning: 'none',
    };
  }

  // --- Google / Gemini ----------------------------------------------------
  if (isGeminiFamilyModel(normalized) || providerHint === 'google' || supportedEndpointTypes?.includes('gemini')) {
    const gemini3 = /gemini-3/i.test(normalized);
    const gemini25 = /gemini-(2-5|2\.5)/i.test(normalized);
    const gemini2 = /gemini-(2-0|2\.0)/i.test(normalized);
    const gemini15Plus = /gemini-(1-5|1\.5|2|3|flash-?latest|pro-?latest)/i.test(normalized);

    if (gemini3) {
      return {
        supportsImageInput: true,
        reasoningLevels: REASONING_LEVELS_GEMINI_3,
        defaultReasoning: 'medium',
      };
    }
    if (gemini25) {
      return {
        supportsImageInput: true,
        reasoningLevels: REASONING_LEVELS_GEMINI_2_5,
        defaultReasoning: 'off',
      };
    }
    if (gemini2 || gemini15Plus) {
      return {
        supportsImageInput: true,
        reasoningLevels: REASONING_LEVELS_DEFAULT,
        defaultReasoning: 'none',
      };
    }

    return {
      supportsImageInput: false,
      reasoningLevels: REASONING_LEVELS_DEFAULT,
      defaultReasoning: 'none',
    };
  }

  // --- OpenAI family ------------------------------------------------------
  if (isOpenAiFamilyModel(normalized) || providerHint === 'openai') {
    // GPT-5 / GPT-5-codex: full reasoning (including xhigh).
    if (/^gpt-5/i.test(normalized) || /gpt-5-(codex|turbo|mini|nano)/i.test(normalized)) {
      return {
        supportsImageInput: true,
        reasoningLevels: REASONING_LEVELS_GPT5,
        defaultReasoning: 'medium',
      };
    }

    // o-series: reasoning-first, o3/o4/o5 support vision, o1 text-only.
    if (/^o[34]/i.test(normalized) || /^o5/i.test(normalized)) {
      return {
        supportsImageInput: true,
        reasoningLevels: REASONING_LEVELS_OPENAI_REASONING,
        defaultReasoning: 'medium',
      };
    }
    if (/^o1/i.test(normalized)) {
      return {
        supportsImageInput: false,
        reasoningLevels: REASONING_LEVELS_OPENAI_REASONING,
        defaultReasoning: 'medium',
      };
    }

    // codex-* / gpt-4.1-codex: reasoning + vision.
    if (/codex/i.test(normalized)) {
      return {
        supportsImageInput: true,
        reasoningLevels: REASONING_LEVELS_OPENAI_REASONING,
        defaultReasoning: 'medium',
      };
    }

    // GPT-4o / GPT-4.1 / GPT-4-vision: multimodal, no reasoning knob.
    if (/gpt-4o|gpt-4-1|gpt-4\.1|gpt-4-vision|gpt-4-turbo/i.test(normalized)) {
      return {
        supportsImageInput: true,
        reasoningLevels: REASONING_LEVELS_DEFAULT,
        defaultReasoning: 'none',
      };
    }

    // Legacy GPT-3.5 / GPT-4 text-only.
    return {
      supportsImageInput: false,
      reasoningLevels: REASONING_LEVELS_DEFAULT,
      defaultReasoning: 'none',
    };
  }

  // --- Moonshot / Kimi ----------------------------------------------------
  if (/^(moonshot|kimi)/i.test(normalized)) {
    const kimiVl = /kimi.*-?vl|moonshot.*-?vision/i.test(normalized);
    const kimiThinking = /kimi-k\d|kimi-thinking|moonshot-v1-.*thinking/i.test(normalized);
    return {
      supportsImageInput: kimiVl,
      reasoningLevels: kimiThinking ? REASONING_LEVELS_QWEN3_REASONING : REASONING_LEVELS_DEFAULT,
      defaultReasoning: kimiThinking ? 'off' : 'none',
    };
  }

  // --- Qwen ---------------------------------------------------------------
  if (/^qwen/i.test(normalized) || /qwen-?\d/i.test(normalized)) {
    const qwenVl = /qwen.*-?vl|qwen.*-?vision|qwen.*omni/i.test(normalized);
    // qwen3 / qwen-plus / qwen-max / qwq carry reasoning.
    const qwen3Thinking = /^(qwen3|qwen-?3)/i.test(normalized) || /qwq/i.test(normalized);
    const qwenMaxPlus = /qwen-(max|plus|turbo)-latest/i.test(normalized);
    return {
      supportsImageInput: qwenVl,
      reasoningLevels: qwen3Thinking || qwenMaxPlus ? REASONING_LEVELS_QWEN3_REASONING : REASONING_LEVELS_DEFAULT,
      defaultReasoning: qwen3Thinking || qwenMaxPlus ? 'off' : 'none',
    };
  }

  // --- GLM / ChatGLM ------------------------------------------------------
  if (/^glm-?\d/i.test(normalized) || /^chatglm/i.test(normalized) || /zhipuai/i.test(normalized)) {
    const glmVision = /glm-?4v|glm-4\.5v|glm-?\d+v/i.test(normalized);
    const glmReasoning = /glm-4\.5|glm-4-plus|glm-zero|glm-z1/i.test(normalized);
    return {
      supportsImageInput: glmVision,
      reasoningLevels: glmReasoning ? REASONING_LEVELS_GLM_REASONING : REASONING_LEVELS_DEFAULT,
      defaultReasoning: glmReasoning ? 'off' : 'none',
    };
  }

  // --- DeepSeek -----------------------------------------------------------
  if (/^deepseek/i.test(normalized)) {
    const deepseekReasoner = /deepseek-?r1|deepseek-reasoner|deepseek-v3\.1.*thinking/i.test(normalized);
    const deepseekVl = /deepseek.*-?vl|deepseek.*vision/i.test(normalized);
    return {
      supportsImageInput: deepseekVl,
      reasoningLevels: deepseekReasoner ? REASONING_LEVELS_QWEN3_REASONING : REASONING_LEVELS_DEFAULT,
      defaultReasoning: deepseekReasoner ? 'off' : 'none',
    };
  }

  // --- Fallback -----------------------------------------------------------
  return {
    supportsImageInput: false,
    reasoningLevels: REASONING_LEVELS_DEFAULT,
    defaultReasoning: 'none',
  };
}

/**
 * Merge user-supplied capability fields with inferred defaults. Explicit
 * user values (from the modal or settings.local.json) always win; missing
 * fields fall back to `inferByokModelCapabilities`. Invalid
 * `defaultReasoning` is clamped to the first valid level.
 */
export function resolveByokModelCapabilities(
  model: string,
  providerHint?: CapabilityProviderHint,
  supportedEndpointTypes?: SupportedEndpointType[],
  overrides?: Partial<ByokModelCapabilities>
): ByokModelCapabilities {
  const inferred = inferByokModelCapabilities(model, providerHint, supportedEndpointTypes);

  const supportsImageInput =
    typeof overrides?.supportsImageInput === 'boolean' ? overrides.supportsImageInput : inferred.supportsImageInput;

  const isValidReasoningLevel = (value: unknown): value is ReasoningLevel =>
    value === 'off' ||
    value === 'minimal' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'max' ||
    value === 'xhigh' ||
    value === 'none';
  const candidateLevels =
    Array.isArray(overrides?.reasoningLevels) && overrides.reasoningLevels.length > 0
      ? overrides.reasoningLevels
      : inferred.reasoningLevels;
  // Filter out unknown/invalid levels — callers may feed us persisted data
  // from older schema versions (or mis-configured modal input), and the
  // resolver is the last chance to sanitize before the value reaches disk.
  const dedupedLevels = Array.from(new Set(candidateLevels.filter(isValidReasoningLevel)));
  const reasoningLevels: ReasoningLevel[] = dedupedLevels.length > 0 ? dedupedLevels : REASONING_LEVELS_DEFAULT;

  const rawDefault = overrides?.defaultReasoning ?? inferred.defaultReasoning;
  const defaultReasoning = reasoningLevels.includes(rawDefault) ? rawDefault : reasoningLevels[0];

  return {
    supportsImageInput,
    reasoningLevels,
    defaultReasoning,
  };
}

const extractCapabilityOverrides = (
  source:
    | {
        supportsImageInput?: unknown;
        reasoningLevels?: unknown;
        defaultReasoning?: unknown;
      }
    | undefined
): Partial<ByokModelCapabilities> | undefined => {
  if (!source) {
    return undefined;
  }

  const overrides: Partial<ByokModelCapabilities> = {};
  if (typeof source.supportsImageInput === 'boolean') {
    overrides.supportsImageInput = source.supportsImageInput;
  }
  if (Array.isArray(source.reasoningLevels)) {
    overrides.reasoningLevels = source.reasoningLevels.filter(
      (value): value is ReasoningLevel =>
        value === 'off' ||
        value === 'minimal' ||
        value === 'low' ||
        value === 'medium' ||
        value === 'high' ||
        value === 'max' ||
        value === 'xhigh' ||
        value === 'none'
    );
  }
  if (
    source.defaultReasoning === 'off' ||
    source.defaultReasoning === 'minimal' ||
    source.defaultReasoning === 'low' ||
    source.defaultReasoning === 'medium' ||
    source.defaultReasoning === 'high' ||
    source.defaultReasoning === 'max' ||
    source.defaultReasoning === 'xhigh' ||
    source.defaultReasoning === 'none'
  ) {
    overrides.defaultReasoning = source.defaultReasoning;
  }
  return Object.keys(overrides).length > 0 ? overrides : undefined;
};

const normalizeInputPayload = (input: IDroidByokModelConfigInput): NormalizedByokInput => {
  const model = input.model.trim();
  const apiKey = input.apiKey.trim();
  const baseUrl = normalizeDroidByokBaseUrl(input.baseUrl, input.provider === 'google' ? undefined : input.provider);

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
    ...(typeof input.supportsImageInput === 'boolean' ? { supportsImageInput: input.supportsImageInput } : {}),
    ...(Array.isArray(input.reasoningLevels) ? { reasoningLevels: input.reasoningLevels } : {}),
    ...(input.defaultReasoning ? { defaultReasoning: input.defaultReasoning } : {}),
  };
};

const buildConfig = (
  input: NormalizedByokInput,
  provider: DroidByokModelProvider,
  supportedEndpointTypes?: SupportedEndpointType[]
): IDroidByokModelConfig => {
  const baseUrl = normalizeDroidByokBaseUrl(input.baseUrl, provider);
  const capabilities = resolveByokModelCapabilities(input.model, provider, supportedEndpointTypes, {
    ...(typeof input.supportsImageInput === 'boolean' ? { supportsImageInput: input.supportsImageInput } : {}),
    ...(Array.isArray(input.reasoningLevels) ? { reasoningLevels: input.reasoningLevels } : {}),
    ...(input.defaultReasoning ? { defaultReasoning: input.defaultReasoning } : {}),
  });
  return {
    id: buildDroidByokModelRefId({
      model: input.model,
      baseUrl,
      provider,
    }),
    baseUrl,
    apiKey: input.apiKey,
    model: input.model,
    displayName: input.displayName,
    provider,
    maxOutputTokens: DROID_BYOK_MAX_OUTPUT_TOKENS,
    supportsImageInput: capabilities.supportsImageInput,
    reasoningLevels: capabilities.reasoningLevels,
    defaultReasoning: capabilities.defaultReasoning,
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

  const normalizedBaseUrl = normalizeDroidByokBaseUrl(entry.baseUrl, entry.provider);
  if (!normalizedBaseUrl) {
    return null;
  }

  const model = entry.model.trim();
  const capabilities = resolveByokModelCapabilities(
    model,
    entry.provider,
    undefined,
    extractCapabilityOverrides({
      supportsImageInput: entry.supportsImageInput,
      reasoningLevels: entry.reasoningLevels,
      defaultReasoning: entry.defaultReasoning,
    })
  );
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
    supportsImageInput: capabilities.supportsImageInput,
    reasoningLevels: capabilities.reasoningLevels,
    defaultReasoning: capabilities.defaultReasoning,
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
  if (provider === 'google') {
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
    supportsImageInput: config.supportsImageInput,
    reasoningLevels: config.reasoningLevels,
    defaultReasoning: config.defaultReasoning,
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

const getEntryProvider = (entry: FactoryCustomModelEntry): DroidByokModelProvider | undefined => {
  return isDroidByokProvider(entry.provider) ? entry.provider : undefined;
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
  const baseUrl = normalizeDroidByokBaseUrl(candidate.baseUrl, candidate.provider);
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
  const legacyRef = normalizeDroidByokRef(acpConfig?.droid?.byokModelRef);

  const refs = Array.isArray(storedRefs)
    ? storedRefs.map((ref) => normalizeDroidByokRef(ref)).filter((ref): ref is DroidByokModelRef => Boolean(ref))
    : [];
  const deduped = dedupeDroidByokRefs([...refs, ...(legacyRef ? [legacyRef] : [])]);

  if (legacyRef) {
    await setDroidByokRefs(deduped);
  }

  return deduped;
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
  const model = typeof entry.model === 'string' ? entry.model.trim() : '';
  const entryProvider = getEntryProvider(entry);
  const baseUrlWithRefProvider =
    typeof entry.baseUrl === 'string' ? normalizeDroidByokBaseUrl(entry.baseUrl, ref.provider) : '';
  const baseUrlWithEntryProvider =
    typeof entry.baseUrl === 'string' && entryProvider ? normalizeDroidByokBaseUrl(entry.baseUrl, entryProvider) : '';

  return (
    model === ref.model &&
    (baseUrlWithRefProvider === ref.baseUrl ||
      (entryProvider === ref.provider && baseUrlWithEntryProvider === ref.baseUrl))
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

const normalizeRemoteModelId = (model: string): string => model.replace(/^models\//i, '').trim();

const isOpenAiFamilyModel = (model: string): boolean => {
  return /(^|[-_/])(gpt|o[13]|o4|o5|codex)([-_/]|$)/i.test(model);
};

const isClaudeFamilyModel = (model: string): boolean => {
  return /claude/i.test(model);
};

const isGeminiFamilyModel = (model: string): boolean => {
  return /gemini/i.test(model);
};

const inferProviderFromModel = (
  model: string,
  supportedEndpointTypes: SupportedEndpointType[]
): DroidByokModelProvider => {
  if (supportedEndpointTypes.includes('gemini')) {
    return 'google';
  }

  if (supportedEndpointTypes.includes('anthropic')) {
    return 'anthropic';
  }

  if (supportedEndpointTypes.includes('openai') || supportedEndpointTypes.includes('openai-response')) {
    return isOpenAiFamilyModel(model) ? 'openai' : 'generic-chat-completion-api';
  }

  if (isGeminiFamilyModel(model)) {
    return 'google';
  }

  if (isOpenAiFamilyModel(model)) {
    return 'openai';
  }

  return isClaudeFamilyModel(model) ? 'anthropic' : 'generic-chat-completion-api';
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
    ...(isGeminiFamilyModel(model) ? (['google', 'openai', 'generic-chat-completion-api', 'anthropic'] as const) : []),
    ...(isOpenAiFamilyModel(model)
      ? (['openai', 'generic-chat-completion-api', 'google', 'anthropic'] as const)
      : isClaudeFamilyModel(model)
        ? (['anthropic', 'google', 'openai', 'generic-chat-completion-api'] as const)
        : (['generic-chat-completion-api', 'openai', 'google', 'anthropic'] as const)),
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

const probeGoogleEndpoint = async (
  baseUrl: string,
  input: NormalizedByokInput
): Promise<{ error: string | null; baseUrl?: string }> => {
  const apiBases =
    /\/v1beta$/i.test(baseUrl) || /\/v1$/i.test(baseUrl) ? [baseUrl] : [`${baseUrl}/v1beta`, `${baseUrl}/v1`];
  let lastError = 'Unexpected Gemini-compatible response';

  for (const apiBase of apiBases) {
    try {
      const response = await withFetchTimeout(
        `${apiBase}/models/${encodeURIComponent(input.model)}:generateContent`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${input.apiKey}`,
            'x-goog-api-key': input.apiKey,
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [{ text: 'hi' }],
              },
            ],
            generationConfig: {
              maxOutputTokens: 1,
            },
          }),
        },
        DROID_BYOK_PROBE_TIMEOUT_MS
      );

      if (!response.ok) {
        lastError = await extractErrorMessage(response);
        continue;
      }

      const data = (await response.json().catch((): null => null)) as {
        candidates?: unknown[];
        promptFeedback?: unknown;
      } | null;
      if (Array.isArray(data?.candidates) || data?.promptFeedback) {
        return { error: null, baseUrl: apiBase };
      }

      lastError = 'Unexpected Gemini-compatible response';
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  return { error: lastError };
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

  if (provider === 'google') {
    const result = await probeGoogleEndpoint(input.baseUrl, input);
    return {
      provider,
      error: result.error,
      ...(result.baseUrl ? { baseUrl: result.baseUrl } : {}),
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
      return buildConfig(
        result.baseUrl
          ? {
              ...input,
              baseUrl: result.baseUrl,
            }
          : input,
        result.provider,
        supportedEndpointTypes
      );
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
  const rawModel =
    typeof candidate.id === 'string'
      ? candidate.id.trim()
      : typeof candidate.model === 'string'
        ? candidate.model.trim()
        : typeof candidate.name === 'string'
          ? candidate.name.trim()
          : '';
  const model = normalizeRemoteModelId(rawModel);

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
        'x-goog-api-key': apiKey,
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
  const endpoints = [`${baseUrl}/v1/models`, `${baseUrl}/v1beta/models`, `${baseUrl}/models`];

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
    const supportedTypesForItem = supportedEndpointMap.get(normalizedModel) || [];
    emit({ current: completed, total, model: normalizedModel, status: 'probing' });
    try {
      const normalizedInput = normalizeInputPayload({
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
        model: item.model,
        displayName: item.displayName,
        provider: item.provider,
        ...(typeof item.supportsImageInput === 'boolean' ? { supportsImageInput: item.supportsImageInput } : {}),
        ...(Array.isArray(item.reasoningLevels) ? { reasoningLevels: item.reasoningLevels } : {}),
        ...(item.defaultReasoning ? { defaultReasoning: item.defaultReasoning } : {}),
      });

      const inferredProvider = inferProviderFromModel(normalizedInput.model, supportedTypesForItem);
      const resolvedProvider = item.provider || normalizedInput.provider || inferredProvider;

      const config = skipProbe
        ? buildConfig(normalizedInput, resolvedProvider, supportedTypesForItem)
        : await probeAndResolveConfig(normalizedInput, supportedTypesForItem);

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

// =====================================================================
// BYOK site aggregation (M3.A, B1 in spec 2026-04-21-v0-1-5)
// =====================================================================
//
// A "site" is the logical group of BYOK model entries that share the same
// normalized `(provider, baseUrl)` tuple. The underlying persistence model
// does not change — sites are derived from the existing `byokModelRefs` list
// plus an opt-in `byokSiteLabels` dictionary that stores purely cosmetic
// display names. API keys continue to live in `settings.local.json`'s
// `customModels[].apiKey`, never exposed through the site view.
//
// Stable ids:
//   id = sha1(provider + '|' + normalizedBaseUrl).slice(0, 16)
// Calling this from outside the service MUST use `buildDroidByokSiteId` so a
// given (provider, baseUrl) pair always maps to the same id across restarts.

/**
 * Environment flag. When set to `'1'`, server-side site helpers are still
 * reachable but:
 *   - `migrateLegacyModelsIntoSites` is a no-op (legacy data is not touched)
 *   - the renderer can fall back to the old flat list via its own localStorage
 *     feature flag (`aionui.byok.legacyUi`) and keep the site APIs untouched
 *
 * AIONUI_BYOK_LEGACY=1 时，迁移函数直接跳过，不会改写老数据；UI 通过前端 localStorage
 * 自行决定走扁平列表还是站点视图。
 */
const isByokLegacyMode = (): boolean => process.env.AIONUI_BYOK_LEGACY === '1';

/** Current migration schema version; bump when the on-disk shape changes. */
const BYOK_MIGRATION_VERSION = 1;

/**
 * Build the stable `sha1(provider|normalizedBaseUrl)` id used to identify a
 * BYOK site across process restarts. Exported for tests + callers that need
 * to build an id without loading the full site list.
 */
export function buildDroidByokSiteId(provider: DroidByokModelProvider, baseUrl: string): string {
  const normalized = normalizeDroidByokBaseUrl(baseUrl, provider);
  return createHash('sha1').update(`${provider}|${normalized}`).digest('hex').slice(0, 16);
}

type DroidByokSiteLabel = { id: string; label: string };

const normalizeSiteLabel = (value: unknown): DroidByokSiteLabel | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as { id?: unknown; label?: unknown };
  if (typeof candidate.id !== 'string' || !candidate.id.trim()) {
    return null;
  }
  if (typeof candidate.label !== 'string') {
    return null;
  }
  const label = candidate.label.trim();
  return label ? { id: candidate.id, label } : null;
};

const getSiteLabelsMap = async (): Promise<Map<string, string>> => {
  const acpConfig = await ProcessConfig.get('acp.config').catch((): undefined => undefined);
  const stored = acpConfig?.droid?.byokSiteLabels;
  if (!Array.isArray(stored)) {
    return new Map();
  }
  const entries: Array<[string, string]> = [];
  for (const raw of stored) {
    const normalized = normalizeSiteLabel(raw);
    if (normalized) {
      entries.push([normalized.id, normalized.label]);
    }
  }
  return new Map(entries);
};

const setSiteLabel = async (id: string, label: string | undefined): Promise<void> => {
  const acpConfig = (await ProcessConfig.get('acp.config').catch((): undefined => undefined)) || {};
  const nextDroidConfig = { ...acpConfig.droid };
  const existing = Array.isArray(nextDroidConfig.byokSiteLabels)
    ? nextDroidConfig.byokSiteLabels
        .map((value) => normalizeSiteLabel(value))
        .filter((value): value is DroidByokSiteLabel => Boolean(value))
    : [];

  const filtered = existing.filter((entry) => entry.id !== id);
  const trimmed = label?.trim();
  const next = trimmed ? [...filtered, { id, label: trimmed }] : filtered;

  if (next.length > 0) {
    nextDroidConfig.byokSiteLabels = next;
  } else {
    delete nextDroidConfig.byokSiteLabels;
  }

  await ProcessConfig.set('acp.config', {
    ...acpConfig,
    droid: nextDroidConfig,
  });
};

const pruneSiteLabels = async (validIds: Set<string>): Promise<void> => {
  const acpConfig = (await ProcessConfig.get('acp.config').catch((): undefined => undefined)) || {};
  const existing = Array.isArray(acpConfig.droid?.byokSiteLabels)
    ? acpConfig
        .droid!.byokSiteLabels.map((value) => normalizeSiteLabel(value))
        .filter((value): value is DroidByokSiteLabel => Boolean(value))
    : [];
  const filtered = existing.filter((entry) => validIds.has(entry.id));
  if (filtered.length === existing.length) {
    return;
  }

  const nextDroidConfig = { ...acpConfig.droid };
  if (filtered.length > 0) {
    nextDroidConfig.byokSiteLabels = filtered;
  } else {
    delete nextDroidConfig.byokSiteLabels;
  }

  await ProcessConfig.set('acp.config', {
    ...acpConfig,
    droid: nextDroidConfig,
  });
};

type SiteAggregate = {
  id: string;
  baseUrl: string;
  provider: DroidByokModelProvider;
  modelIds: string[];
  hasApiKey: boolean;
  supportsImageInput: boolean;
};

/**
 * Group refs + entries into site aggregates. Only entries that have a non-empty
 * `apiKey` contribute to `hasApiKey=true`; refs that lack backing entries (a
 * rare corrupted state) still appear but with `hasApiKey=false`.
 *
 * `supportsImageInput` is the logical OR across all members: a site exposes
 * multimodal capability if at least one of its models supports images.
 */
const aggregateSites = (refs: DroidByokModelRef[], entries: FactoryCustomModelEntry[]): SiteAggregate[] => {
  const byId = new Map<string, SiteAggregate>();

  for (const ref of refs) {
    const siteId = buildDroidByokSiteId(ref.provider, ref.baseUrl);
    const existing = byId.get(siteId);
    const matchingEntry = entries.find((entry) => matchesManagedEntry(entry, ref));
    const hasApiKeyForRef = Boolean(typeof matchingEntry?.apiKey === 'string' && matchingEntry.apiKey.trim());
    const capabilitiesForRef = resolveByokModelCapabilities(
      ref.model,
      ref.provider,
      undefined,
      extractCapabilityOverrides({
        supportsImageInput: matchingEntry?.supportsImageInput,
        reasoningLevels: matchingEntry?.reasoningLevels,
        defaultReasoning: matchingEntry?.defaultReasoning,
      })
    );

    if (existing) {
      existing.modelIds.push(ref.id);
      existing.hasApiKey = existing.hasApiKey || hasApiKeyForRef;
      existing.supportsImageInput = existing.supportsImageInput || capabilitiesForRef.supportsImageInput;
    } else {
      byId.set(siteId, {
        id: siteId,
        baseUrl: ref.baseUrl,
        provider: ref.provider,
        modelIds: [ref.id],
        hasApiKey: hasApiKeyForRef,
        supportsImageInput: capabilitiesForRef.supportsImageInput,
      });
    }
  }

  return Array.from(byId.values());
};

/**
 * List all BYOK sites aggregated from the current `customModels` + ref list.
 * Empty groups are NOT surfaced; a site only exists when at least one model
 * references it. The `label` field is opt-in and stored separately.
 *
 * 列出所有 BYOK 站点（按 provider+归一化 baseUrl 聚合）；不包含明文 apiKey。
 */
export async function listDroidByokSites(): Promise<IDroidByokSite[]> {
  const refs = await getDroidByokRefs();
  if (refs.length === 0) {
    return [];
  }

  const settings = await readFactorySettingsJson();
  const entries = getCustomModelEntries(settings);
  const aggregates = aggregateSites(refs, entries);

  const labels = await getSiteLabelsMap();
  return aggregates
    .map((aggregate) =>
      Object.assign(
        {
          id: aggregate.id,
          baseUrl: aggregate.baseUrl,
          provider: aggregate.provider,
          hasApiKey: aggregate.hasApiKey,
          modelIds: aggregate.modelIds,
          modelCount: aggregate.modelIds.length,
          supportsImageInput: aggregate.supportsImageInput,
        },
        labels.has(aggregate.id) ? { label: labels.get(aggregate.id) } : {}
      )
    )
    .toSorted((a, b) => a.baseUrl.localeCompare(b.baseUrl));
}

/**
 * Upsert a BYOK site.
 *
 * - **Create path** (no `id`): rejected with "`site must have at least one
 *   model`". Callers should seed the first model through
 *   `importDroidByokConfigs` / `saveDroidByokConfig`, then call this helper
 *   to attach a label if desired.
 * - **Update path** (`id` present): updates `baseUrl`, `provider`, and — if
 *   `apiKey` is supplied — rotates the API key on every underlying model
 *   entry. Setting `label` to an empty string clears the stored label.
 */
export async function upsertDroidByokSite(input: IDroidByokSiteUpsertInput): Promise<IDroidByokSite> {
  const trimmedBaseUrl = input.baseUrl.trim();
  assertRequiredField(trimmedBaseUrl, 'Base URL');
  if (!isDroidByokProvider(input.provider)) {
    throw new Error('Unsupported provider');
  }

  const nextBaseUrl = normalizeDroidByokBaseUrl(trimmedBaseUrl, input.provider);
  assertRequiredField(nextBaseUrl, 'Base URL');

  const settings = await readFactorySettingsJson();
  const existingEntries = getCustomModelEntries(settings);
  const existingRefs = await getDroidByokRefs();

  if (!input.id || !input.id.trim()) {
    throw new Error(
      'Cannot create an empty BYOK site. Add at least one model via import/save first, then attach a label.'
    );
  }

  const targetId = input.id.trim();
  const refsBelongingToSite = existingRefs.filter(
    (ref) => buildDroidByokSiteId(ref.provider, ref.baseUrl) === targetId
  );
  if (refsBelongingToSite.length === 0) {
    throw new Error('BYOK site not found');
  }

  const apiKey = input.apiKey?.trim();
  const capabilityOverrides = extractCapabilityOverrides({
    supportsImageInput: input.capabilities?.supportsImageInput,
    reasoningLevels: input.capabilities?.reasoningLevels,
    defaultReasoning: input.capabilities?.defaultReasoning,
  });

  const entryRefMap = new Map<FactoryCustomModelEntry, DroidByokModelRef>();
  const keptEntries: FactoryCustomModelEntry[] = [];
  for (const entry of existingEntries) {
    const matchingRef = refsBelongingToSite.find((ref) => matchesManagedEntry(entry, ref));
    if (matchingRef) {
      entryRefMap.set(entry, matchingRef);
    } else {
      keptEntries.push(entry);
    }
  }

  const updatedEntries: FactoryCustomModelEntry[] = [];
  const nextRefs: DroidByokModelRef[] = [];

  for (const [entry, ref] of entryRefMap.entries()) {
    const persistedBaseUrl = buildPersistedBaseUrl(nextBaseUrl, input.provider);
    const modelName = typeof entry.model === 'string' ? entry.model.trim() : ref.model;
    // Re-resolve capabilities per entry so an explicit site-level override
    // wins, otherwise fall back to the stored/inferred per-model value.
    const resolvedCaps = resolveByokModelCapabilities(modelName, input.provider, undefined, {
      ...extractCapabilityOverrides({
        supportsImageInput: entry.supportsImageInput,
        reasoningLevels: entry.reasoningLevels,
        defaultReasoning: entry.defaultReasoning,
      }),
      ...capabilityOverrides,
    });
    const nextEntry: FactoryCustomModelEntry = {
      ...entry,
      baseUrl: persistedBaseUrl,
      provider: input.provider,
      ...(typeof apiKey === 'string' && apiKey.length > 0 ? { apiKey } : {}),
      supportsImageInput: resolvedCaps.supportsImageInput,
      reasoningLevels: resolvedCaps.reasoningLevels,
      defaultReasoning: resolvedCaps.defaultReasoning,
    };
    updatedEntries.push(nextEntry);

    nextRefs.push({
      id: buildDroidByokModelRefId({
        model: modelName,
        baseUrl: nextBaseUrl,
        provider: input.provider,
      }),
      model: modelName,
      baseUrl: nextBaseUrl,
      provider: input.provider,
    });
  }

  settings.customModels = [...keptEntries, ...updatedEntries];
  await writeFactorySettingsJson(settings);

  const refIdsToRemove = new Set(refsBelongingToSite.map((ref) => ref.id));
  await setDroidByokRefs([...existingRefs.filter((ref) => !refIdsToRemove.has(ref.id)), ...nextRefs]);

  if (typeof input.label === 'string') {
    await setSiteLabel(buildDroidByokSiteId(input.provider, nextBaseUrl), input.label.trim() || undefined);
  }

  const nextSiteId = buildDroidByokSiteId(input.provider, nextBaseUrl);
  const sites = await listDroidByokSites();
  const persisted = sites.find((site) => site.id === nextSiteId);
  if (!persisted) {
    throw new Error('BYOK site not found after upsert');
  }
  return persisted;
}

/**
 * Remove all model entries that belong to the specified site. Site labels are
 * also pruned to keep config storage tidy.
 *
 * 级联删除站点下所有模型条目，同时清理对应的 site label。
 */
export async function removeDroidByokSite(id: string): Promise<void> {
  const siteId = id.trim();
  if (!siteId) {
    return;
  }

  const existingRefs = await getDroidByokRefs();
  const refsToRemove = existingRefs.filter((ref) => buildDroidByokSiteId(ref.provider, ref.baseUrl) === siteId);
  if (refsToRemove.length === 0) {
    return;
  }

  const settings = await readFactorySettingsJson();
  const existingEntries = getCustomModelEntries(settings);
  const nextEntries = existingEntries.filter((entry) => !refsToRemove.some((ref) => matchesManagedEntry(entry, ref)));

  if (nextEntries.length > 0) {
    settings.customModels = nextEntries;
  } else {
    delete settings.customModels;
  }
  await writeFactorySettingsJson(settings);

  const refIdsToRemove = new Set(refsToRemove.map((ref) => ref.id));
  await setDroidByokRefs(existingRefs.filter((ref) => !refIdsToRemove.has(ref.id)));

  const remainingRefs = existingRefs.filter((ref) => !refIdsToRemove.has(ref.id));
  const remainingSiteIds = new Set(remainingRefs.map((ref) => buildDroidByokSiteId(ref.provider, ref.baseUrl)));
  await pruneSiteLabels(remainingSiteIds);
}

/**
 * Rotate the API key on every model entry that belongs to the specified site.
 * Other fields (model id / baseUrl / provider / maxOutputTokens) are preserved.
 *
 * 仅改写站点下每条 model entry 的 apiKey；其他字段保持不变。
 */
export async function rotateDroidByokSiteApiKey(id: string, newApiKey: string): Promise<IDroidByokSite> {
  const siteId = id.trim();
  assertRequiredField(siteId, 'Site id');
  const trimmedKey = newApiKey.trim();
  assertRequiredField(trimmedKey, 'API key');

  const existingRefs = await getDroidByokRefs();
  const refsInSite = existingRefs.filter((ref) => buildDroidByokSiteId(ref.provider, ref.baseUrl) === siteId);
  if (refsInSite.length === 0) {
    throw new Error('BYOK site not found');
  }

  const settings = await readFactorySettingsJson();
  const existingEntries = getCustomModelEntries(settings);
  const nextEntries = existingEntries.map((entry) => {
    const isManagedBySite = refsInSite.some((ref) => matchesManagedEntry(entry, ref));
    return isManagedBySite ? { ...entry, apiKey: trimmedKey } : entry;
  });

  settings.customModels = nextEntries;
  await writeFactorySettingsJson(settings);

  const sites = await listDroidByokSites();
  const persisted = sites.find((site) => site.id === siteId);
  if (!persisted) {
    throw new Error('BYOK site not found after rotate');
  }
  return persisted;
}

/**
 * Verify BYOK model capabilities against the CLI's `availableModels` catalog.
 *
 * This function is called after each BYOK CRUD operation (save / import / remove / site-crud)
 * via the `catalogRefresher`. It compares local BYOK model capabilities against the
 * CLI-probed catalog that was just refreshed.
 *
 * Returns a structured result — never throws. Callers should emit non-blocking
 * IPC events and/or UI toasts based on the result.
 *
 * @param localConfigs - The BYOK model configs with local capability inference.
 * @param cliModels - The CLI's available models (from refreshed catalog).
 *                    Pass `null` when CLI is unreachable.
 */
export function verifyByokCapabilitiesAgainstCli(
  localConfigs: ReadonlyArray<{
    id: string;
    model: string;
    supportsImageInput?: boolean;
  }>,
  cliModels: ReadonlyArray<{
    id: string;
    noImageSupport?: boolean;
  }> | null
): IDroidByokVerificationResult {
  if (cliModels === null) {
    mainLog('[DroidByokService]', 'droid.byok.verifier.cli_unreachable');
    return { ok: [], missing: [], conflict: [], unreachable: true };
  }

  const cliModelMap = new Map(cliModels.map((m) => [m.id, m]));

  const ok: string[] = [];
  const missing: string[] = [];
  const conflict: IDroidByokCapabilityConflict[] = [];

  for (const local of localConfigs) {
    const cliModel = cliModelMap.get(local.id);

    if (!cliModel) {
      missing.push(local.id);
      mainWarn('[DroidByokService]', 'capabilities_unverified', {
        modelId: local.id,
        reason: 'cli-missing',
      });
      continue;
    }

    // Compare image support: CLI noImageSupport=true means no image support
    // Local supportsImageInput=true means image support
    const cliSupportsImage = cliModel.noImageSupport !== true;
    const localSupportsImage = local.supportsImageInput === true;

    if (localSupportsImage && !cliSupportsImage) {
      conflict.push({
        modelId: local.id,
        field: 'supportsImageInput',
        local: localSupportsImage,
        cli: cliSupportsImage,
      });
    } else {
      ok.push(local.id);
    }
  }

  return { ok, missing, conflict, unreachable: false };
}

/**
 * One-time migration from legacy flat BYOK data into the site-aware shape.
 *
 * - When `AIONUI_BYOK_LEGACY=1` is set, the migration is an explicit no-op so
 *   users can roll back without mutating their data.
 * - Normally this:
 *     1. Promotes the deprecated singular `byokModelRef` into the plural
 *        `byokModelRefs` array (via `getDroidByokRefs`).
 *     2. Dedupes duplicate `customModels` entries that share the same
 *        `(provider, model, normalizedBaseUrl)` tuple — keeping the last copy
 *        so the most recent `apiKey` / label survives.
 *     3. Prunes site labels whose sites no longer exist.
 *     4. Writes `droidByokMigrationVersion: 1` so subsequent calls fast-path.
 *
 * 幂等：一旦写入 version 标记就不再跑。
 */
export async function migrateLegacyModelsIntoSites(): Promise<void> {
  if (isByokLegacyMode()) {
    return;
  }

  const acpConfig = (await ProcessConfig.get('acp.config').catch((): undefined => undefined)) || {};
  if (acpConfig.droid?.byokMigrationVersion === BYOK_MIGRATION_VERSION) {
    return;
  }

  try {
    const refs = await getDroidByokRefs();
    const settings = await readFactorySettingsJson();
    const entries = getCustomModelEntries(settings);

    // Dedupe customModels by (provider, model, normalizedBaseUrl). Preserve
    // the LAST occurrence so the most recent apiKey/displayName survives.
    const seen = new Map<string, FactoryCustomModelEntry>();
    for (const entry of entries) {
      const provider = getEntryProvider(entry);
      if (!provider || typeof entry.model !== 'string' || typeof entry.baseUrl !== 'string') {
        // Non-BYOK-managed custom entry; keep as-is without dedupe grouping.
        seen.set(`__passthrough__:${seen.size}`, entry);
        continue;
      }
      const normalizedBaseUrl = normalizeDroidByokBaseUrl(entry.baseUrl, provider);
      const key = `${provider}|${entry.model.trim()}|${normalizedBaseUrl}`;
      seen.set(key, entry);
    }

    const deduped = Array.from(seen.values());
    if (deduped.length !== entries.length) {
      settings.customModels = deduped;
      await writeFactorySettingsJson(settings);
    }

    const remainingSiteIds = new Set(refs.map((ref) => buildDroidByokSiteId(ref.provider, ref.baseUrl)));
    await pruneSiteLabels(remainingSiteIds);
  } catch (error) {
    mainWarn('[DroidByokService]', 'migrateLegacyModelsIntoSites failed', {
      err: error instanceof Error ? error.message : String(error),
    });
  } finally {
    const latestAcpConfig = (await ProcessConfig.get('acp.config').catch((): undefined => undefined)) || {};
    const nextDroidConfig = { ...latestAcpConfig.droid, byokMigrationVersion: BYOK_MIGRATION_VERSION };
    await ProcessConfig.set('acp.config', {
      ...latestAcpConfig,
      droid: nextDroidConfig,
    });
  }
}
