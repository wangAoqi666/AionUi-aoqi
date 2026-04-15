/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import { FACTORY_PROTOCOL_VERSION, createSession, type AvailableModelConfig } from '@factory/droid-sdk';
import type { FactoryModel, ReasoningLevel } from '@/common/config/factoryModels';
import type { DroidCliUpdateInfo, DroidLoginStatus, DroidStatusInfo } from '@/common/types/acpTypes';
import { getEnhancedEnv } from '@process/utils/shellEnv';
import { mainLog, mainWarn } from '@process/utils/mainLogger';
import packageJson from '../../../../package.json';
import { resolveWorkingDroidCli } from './cliRuntime';
import semver from 'semver';

const appPackageJson = packageJson as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

type ProbeDroidModelCatalogOptions = {
  cwd: string;
  execPath?: string;
};

const REASONING_LEVEL_MAP: Record<string, ReasoningLevel> = {
  none: 'none',
  dynamic: 'none',
  off: 'off',
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  max: 'max',
};

const AUTH_ERROR_PATTERN = /(auth|login|unauthori[sz]ed|forbidden|credential|api key|factory_api_key)/i;
const PRIMARY_REGISTRY_BASE_URL = process.env.AIONUI_NPM_REGISTRY_URL || 'https://registry.npmmirror.com';
const FALLBACK_REGISTRY_BASE_URL = 'https://registry.npmjs.org';
const REGISTRY_FETCH_TIMEOUT_MS = 1800;
const PRIMARY_REGISTRY_VERSION_PATHS = ['/-/package/%40factory%2Fcli/dist-tags', '/%40factory%2Fcli/latest'];
const FALLBACK_REGISTRY_VERSION_PATHS = ['/%40factory%2Fcli/latest', '/%40factory%2Fcli'];
const LATEST_CLI_VERSION_CACHE_TTL_MS = 10 * 60 * 1000;
const FACTORY_DROID_SDK_VERSION =
  normalizeDependencyVersion(
    appPackageJson.dependencies?.['@factory/droid-sdk'] || appPackageJson.devDependencies?.['@factory/droid-sdk']
  ) || 'unknown';

let latestCliVersionCache: { version: string; registry: string; expiresAt: number } | null = null;
let latestCliVersionInFlight: Promise<{ version: string | null; registry: string | null }> | null = null;

function normalizeDependencyVersion(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const match = value.match(/\d+\.\d+\.\d+(?:[-+][\w.-]+)?/u);
  return match ? match[0] : value.trim();
}

function toLoginStatus(error: unknown): DroidLoginStatus {
  const message = error instanceof Error ? error.message : String(error);
  return AUTH_ERROR_PATTERN.test(message) ? 'unauthenticated' : 'error';
}

function toReasoningLevel(value: string | null | undefined): ReasoningLevel | null {
  if (!value) {
    return null;
  }
  return REASONING_LEVEL_MAP[value] || null;
}

async function fetchCliVersionFromEndpoint(
  registry: string,
  versionPath: string
): Promise<{ version: string; registry: string }> {
  const abortController = new AbortController();
  const timeoutId = globalThis.setTimeout(() => abortController.abort(), REGISTRY_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(`${registry}${versionPath}`, {
      signal: abortController.signal,
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = (await response.json()) as {
      latest?: string;
      version?: string;
      'dist-tags'?: { latest?: string };
    };
    const latest = normalizeDependencyVersion(payload.latest || payload.version || payload['dist-tags']?.latest);
    if (!latest) {
      throw new Error('Missing latest version');
    }

    return {
      version: latest,
      registry,
    };
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

async function fetchCliVersionFromRegistry(
  registry: string,
  versionPaths: string[]
): Promise<{ version: string | null; registry: string | null }> {
  try {
    return await Promise.any(versionPaths.map((versionPath) => fetchCliVersionFromEndpoint(registry, versionPath)));
  } catch {
    return {
      version: null,
      registry: null,
    };
  }
}

async function fetchLatestFactoryCliVersion(): Promise<{ version: string | null; registry: string | null }> {
  if (latestCliVersionCache && latestCliVersionCache.expiresAt > Date.now()) {
    return {
      version: latestCliVersionCache.version,
      registry: latestCliVersionCache.registry,
    };
  }

  if (latestCliVersionInFlight) {
    return latestCliVersionInFlight;
  }

  latestCliVersionInFlight = (async () => {
    const primaryResult = await fetchCliVersionFromRegistry(PRIMARY_REGISTRY_BASE_URL, PRIMARY_REGISTRY_VERSION_PATHS);
    if (primaryResult.version && primaryResult.registry) {
      latestCliVersionCache = {
        version: primaryResult.version,
        registry: primaryResult.registry,
        expiresAt: Date.now() + LATEST_CLI_VERSION_CACHE_TTL_MS,
      };
      return primaryResult;
    }

    const fallbackResult = await fetchCliVersionFromRegistry(
      FALLBACK_REGISTRY_BASE_URL,
      FALLBACK_REGISTRY_VERSION_PATHS
    );
    if (fallbackResult.version && fallbackResult.registry) {
      latestCliVersionCache = {
        version: fallbackResult.version,
        registry: fallbackResult.registry,
        expiresAt: Date.now() + LATEST_CLI_VERSION_CACHE_TTL_MS,
      };
    }

    return fallbackResult;
  })().finally(() => {
    latestCliVersionInFlight = null;
  });

  return latestCliVersionInFlight;
}

export async function probeDroidStatus(options: ProbeDroidModelCatalogOptions): Promise<DroidStatusInfo> {
  const resolvedCli = resolveWorkingDroidCli(options.execPath);
  const execPath = resolvedCli.execPath;
  const baseStatus: Omit<DroidStatusInfo, 'loginStatus' | 'available' | 'modelCount'> = {
    cliSource: resolvedCli.source,
    cliPath: resolvedCli.cliPath,
    cliVersion: resolvedCli.version,
    sdkVersion: FACTORY_DROID_SDK_VERSION,
    protocolVersion: FACTORY_PROTOCOL_VERSION,
  };

  if (!resolvedCli.version) {
    return {
      ...baseStatus,
      available: false,
      loginStatus: 'unavailable',
      modelCount: 0,
      ...(resolvedCli.error ? { error: resolvedCli.error } : {}),
    };
  }

  let session: Awaited<ReturnType<typeof createSession>> | null = null;

  try {
    session = await createSession({
      cwd: options.cwd,
      execPath,
      env: getEnhancedEnv(),
      machineId: 'agent-factory-droid-status-probe',
    });

    return {
      ...baseStatus,
      available: true,
      loginStatus: 'authenticated',
      modelCount: session.initResult.availableModels?.length || 0,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...baseStatus,
      available: true,
      loginStatus: toLoginStatus(error),
      modelCount: 0,
      error: message,
    };
  } finally {
    if (session) {
      await session.close().catch(() => {});
    }
  }
}

export async function checkDroidCliUpdate(options: ProbeDroidModelCatalogOptions): Promise<DroidCliUpdateInfo> {
  const resolvedCli = resolveWorkingDroidCli(options.execPath);
  const currentVersion = normalizeDependencyVersion(resolvedCli.version || undefined);
  const latest = await fetchLatestFactoryCliVersion();
  const currentSemver = currentVersion && (semver.valid(currentVersion) || semver.coerce(currentVersion)?.version);
  const latestSemver = latest.version && (semver.valid(latest.version) || semver.coerce(latest.version)?.version);

  return {
    currentVersion: currentSemver || currentVersion,
    latestVersion: latestSemver || latest.version,
    updateAvailable: Boolean(currentSemver && latestSemver && semver.gt(latestSemver, currentSemver)),
    source: resolvedCli.source,
    registry: latest.registry,
  };
}

export function mapDroidAvailableModelToFactoryModel(model: AvailableModelConfig): FactoryModel | null {
  const supportedReasoningLevels = Array.from(
    new Set(
      model.supportedReasoningEfforts
        .map((level) => toReasoningLevel(level))
        .filter((level): level is ReasoningLevel => Boolean(level))
    )
  );
  const defaultReasoning = toReasoningLevel(model.defaultReasoningEffort);

  if (!model.id || !model.displayName) {
    return null;
  }

  const reasoningLevels = supportedReasoningLevels.length > 0 ? supportedReasoningLevels : [defaultReasoning || 'none'];

  return {
    id: model.id,
    name: model.displayName,
    ...(model.modelProvider ? { modelProvider: model.modelProvider } : {}),
    ...(model.modelId ? { sourceModelId: model.modelId } : {}),
    ...(model.isCustom ? { isCustom: true } : {}),
    reasoningLevels,
    defaultReasoning:
      defaultReasoning && reasoningLevels.includes(defaultReasoning) ? defaultReasoning : reasoningLevels[0],
  };
}

export async function probeDroidModelCatalog(options: ProbeDroidModelCatalogOptions): Promise<FactoryModel[] | null> {
  let session: Awaited<ReturnType<typeof createSession>> | null = null;

  try {
    const resolvedCli = resolveWorkingDroidCli(options.execPath);
    if (!resolvedCli.version) {
      mainWarn('[DroidModelProbe]', 'Droid model probe skipped because CLI is unavailable', {
        cwd: options.cwd,
        execPath: resolvedCli.execPath,
        error: resolvedCli.error,
      });
      return null;
    }

    session = await createSession({
      cwd: options.cwd,
      execPath: resolvedCli.execPath,
      env: getEnhancedEnv(),
      machineId: 'aionui-droid-model-probe',
    });

    const availableModels = session.initResult.availableModels || [];
    const catalog = availableModels
      .map((model) => mapDroidAvailableModelToFactoryModel(model))
      .filter((model): model is FactoryModel => Boolean(model));

    if (catalog.length === 0) {
      mainWarn('[DroidModelProbe]', 'Droid model probe returned no available models');
      return null;
    }

    mainLog('[DroidModelProbe]', 'Probed droid model catalog', {
      cwd: options.cwd,
      execPath: resolvedCli.execPath,
      modelCount: catalog.length,
      sampleModelIds: catalog.slice(0, 8).map((model) => model.id),
    });

    return catalog;
  } catch (error) {
    mainWarn('[DroidModelProbe]', 'Failed to probe droid model catalog', error);
    return null;
  } finally {
    if (session) {
      await session.close().catch(() => {});
    }
  }
}
