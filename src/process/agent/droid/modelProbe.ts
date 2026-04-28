/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import { FACTORY_PROTOCOL_VERSION, createSession, type AvailableModelConfig } from '@factory/droid-sdk';
import type { FactoryModel, ReasoningLevel } from '@/common/config/factoryModels';
import type {
  DroidCliDiagnostic,
  DroidCliUpdateInfo,
  DroidLoginStatus,
  DroidStatusInfo,
} from '@/common/types/acpTypes';
import { getEnhancedEnv } from '@process/utils/shellEnv';
import { mainLog, mainWarn } from '@process/utils/mainLogger';
import packageJson from '../../../../package.json';
import {
  createCmdShimPipeIncompatibleDiagnostic,
  createDroidCliDiagnostic,
  pickMostRelevantDroidCliDiagnostic,
  resolveWorkingDroidCli,
  resolvePreferredDroidCliDiagnostic,
  toDroidCliDiagnosticUserMessage,
} from './cliRuntime';
import { composeSdkExecArgs, type DroidCliSource } from './cliResolver';
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
export type DroidModelCatalogProbeReport = {
  success: boolean;
  cliSource: DroidCliSource;
  cliVersion: string | null;
  diagnostic?: DroidCliDiagnostic;
  usedSoftPreflight: boolean;
  error?: string;
};

let lastDroidModelCatalogProbeReport: DroidModelCatalogProbeReport | null = null;

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

function getDroidSessionEnv(cliSource: DroidCliSource): Record<string, string> {
  return getEnhancedEnv(undefined, {
    includeBundledDroidInPath: cliSource !== 'system',
  });
}

function shouldSoftContinueAfterPreflightFailure(diagnostic: DroidCliDiagnostic | undefined): boolean {
  return diagnostic?.code === 'probe-timeout';
}

export function getLastDroidModelCatalogProbeReport(): DroidModelCatalogProbeReport | null {
  return lastDroidModelCatalogProbeReport;
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

const SHIM_PIPE_INCOMPATIBLE_ERROR_MESSAGE =
  'Droid CLI is detected via a cmd.exe shell wrapper; its JSON-RPC stdio pipe is not compatible with @factory/droid-sdk. Reinstall @factory/cli so the JS entrypoint is resolvable (e.g. `npm i -g @factory/cli`).';

export async function probeDroidStatus(options: ProbeDroidModelCatalogOptions): Promise<DroidStatusInfo> {
  const resolvedCli = resolveWorkingDroidCli(options.execPath);
  const preflightDiagnostic = resolvedCli.diagnostic;
  const softPreflight = !resolvedCli.version && shouldSoftContinueAfterPreflightFailure(preflightDiagnostic);
  const env = getDroidSessionEnv(resolvedCli.source);
  const execPath = resolvedCli.execPath;
  const baseStatus: Omit<DroidStatusInfo, 'loginStatus' | 'available' | 'modelCount'> = {
    cliSource: resolvedCli.source,
    cliPath: resolvedCli.cliPath,
    cliVersion: resolvedCli.version,
    sdkVersion: FACTORY_DROID_SDK_VERSION,
    protocolVersion: FACTORY_PROTOCOL_VERSION,
  };

  if (!resolvedCli.version && !softPreflight) {
    return {
      ...baseStatus,
      available: false,
      loginStatus: 'unavailable',
      modelCount: 0,
      ...(preflightDiagnostic ? { diagnosticCode: preflightDiagnostic.code } : {}),
      ...(resolvedCli.error ? { error: toDroidCliDiagnosticUserMessage(preflightDiagnostic, resolvedCli.error) } : {}),
    };
  }

  if (softPreflight) {
    mainWarn('[DroidStatusProbe]', 'Droid CLI version preflight timed out; continuing with SDK session spawn', {
      cwd: options.cwd,
      execPath,
      execArgs: resolvedCli.execArgs,
      diagnosticCode: preflightDiagnostic?.code,
      error: resolvedCli.error,
    });
  }

  // Refuse to create a real SDK session against the cmd.exe shell wrapper. The
  // version probe worked (execFileSync consumes stdout once and exits) but the
  // SDK's `initialize_session` hangs for 60 s because cmd.exe breaks the
  // bidirectional JSON-RPC pipe (CRLF translation, stdin EOF handling, ConPTY
  // interference). Surface a clear error instead of a silent timeout so the
  // user can reinstall @factory/cli.
  if (resolvedCli.pipeCompatible === false) {
    mainWarn('[DroidStatusProbe]', SHIM_PIPE_INCOMPATIBLE_ERROR_MESSAGE, {
      cwd: options.cwd,
      execPath,
      execArgs: resolvedCli.execArgs,
    });
    return {
      ...baseStatus,
      available: false,
      loginStatus: 'unavailable',
      modelCount: 0,
      diagnosticCode: 'cmd-shim-pipe-incompatible',
      error: SHIM_PIPE_INCOMPATIBLE_ERROR_MESSAGE,
    };
  }

  let session: Awaited<ReturnType<typeof createSession>> | null = null;

  try {
    session = await createSession({
      cwd: options.cwd,
      execPath,
      // Tail-merge SDK stream-jsonrpc args onto the resolver's launch prefix.
      // Without this, the SDK overrides its own DEFAULT_EXEC_ARGS with our
      // bare `['<js-entrypoint>']` and droid spawns in interactive TUI mode,
      // deadlocking `droid.initialize_session` for 60 s. See
      // `composeSdkExecArgs` docblock in cliResolver.ts.
      execArgs: composeSdkExecArgs(resolvedCli.execArgs),
      env,
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
    const diagnostic = resolvePreferredDroidCliDiagnostic(
      createDroidCliDiagnostic(error, 'session'),
      preflightDiagnostic
    );
    const cliUnavailable = Boolean(diagnostic);
    return {
      ...baseStatus,
      available: !cliUnavailable,
      loginStatus: cliUnavailable ? 'unavailable' : toLoginStatus(error),
      modelCount: 0,
      ...(diagnostic ? { diagnosticCode: diagnostic.code } : {}),
      error: toDroidCliDiagnosticUserMessage(diagnostic, message),
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
  // Factory's AvailableModelConfig uses the INVERTED `noImageSupport` flag —
  // when it's absent or false the model accepts images. We only set
  // supportsImageInput=true when the flag explicitly reports vision, because
  // FactoryModel treats `undefined` as "unknown" (same semantics as the
  // original hard-coded catalog).
  const supportsImageInput = model.noImageSupport === false ? true : undefined;

  return {
    id: model.id,
    name: model.displayName,
    ...(model.modelProvider ? { modelProvider: model.modelProvider } : {}),
    ...(model.modelId ? { sourceModelId: model.modelId } : {}),
    ...(model.isCustom ? { isCustom: true } : {}),
    reasoningLevels,
    defaultReasoning:
      defaultReasoning && reasoningLevels.includes(defaultReasoning) ? defaultReasoning : reasoningLevels[0],
    ...(supportsImageInput === true ? { supportsImageInput: true } : {}),
  };
}

export async function probeDroidModelCatalog(options: ProbeDroidModelCatalogOptions): Promise<FactoryModel[] | null> {
  let session: Awaited<ReturnType<typeof createSession>> | null = null;
  let resolvedCliResult: ReturnType<typeof resolveWorkingDroidCli> | null = null;
  let preflightDiagnostic: DroidCliDiagnostic | undefined;
  let softPreflight = false;

  try {
    const resolvedCli = resolveWorkingDroidCli(options.execPath);
    resolvedCliResult = resolvedCli;
    preflightDiagnostic = resolvedCli.diagnostic;
    softPreflight = !resolvedCli.version && shouldSoftContinueAfterPreflightFailure(preflightDiagnostic);
    if (!resolvedCli.version && !softPreflight) {
      mainWarn('[DroidModelProbe]', 'Droid model probe skipped because CLI preflight failed', {
        cwd: options.cwd,
        execPath: resolvedCli.execPath,
        execArgs: resolvedCli.execArgs,
        error: resolvedCli.error,
        diagnosticCode: preflightDiagnostic?.code,
      });
      lastDroidModelCatalogProbeReport = {
        success: false,
        cliSource: resolvedCli.source,
        cliVersion: resolvedCli.version,
        diagnostic: preflightDiagnostic,
        usedSoftPreflight: false,
        ...(resolvedCli.error ? { error: resolvedCli.error } : {}),
      };
      return null;
    }

    if (softPreflight) {
      mainWarn(
        '[DroidModelProbe]',
        'Droid model probe version preflight timed out; continuing with SDK session spawn',
        {
          cwd: options.cwd,
          execPath: resolvedCli.execPath,
          execArgs: resolvedCli.execArgs,
          error: resolvedCli.error,
          diagnosticCode: preflightDiagnostic?.code,
        }
      );
    }

    // The cmd.exe shell wrapper can answer `--version` but cannot carry the
    // SDK's JSON-RPC stream; attempting createSession deadlocks for 60 s on
    // `droid.initialize_session`. Abort early with a clear warning so the
    // BYOK verifier reports `capabilities_unverified` without a multi-minute
    // wait per site.
    if (resolvedCli.pipeCompatible === false) {
      mainWarn('[DroidModelProbe]', SHIM_PIPE_INCOMPATIBLE_ERROR_MESSAGE, {
        cwd: options.cwd,
        execPath: resolvedCli.execPath,
        execArgs: resolvedCli.execArgs,
      });
      lastDroidModelCatalogProbeReport = {
        success: false,
        cliSource: resolvedCli.source,
        cliVersion: resolvedCli.version,
        diagnostic: createCmdShimPipeIncompatibleDiagnostic(SHIM_PIPE_INCOMPATIBLE_ERROR_MESSAGE),
        usedSoftPreflight: softPreflight,
        error: SHIM_PIPE_INCOMPATIBLE_ERROR_MESSAGE,
      };
      return null;
    }

    const env = getDroidSessionEnv(resolvedCli.source);

    session = await createSession({
      cwd: options.cwd,
      execPath: resolvedCli.execPath,
      // See composeSdkExecArgs docblock (cliResolver.ts) for why this is
      // mandatory: passing bare `['<js-entrypoint>']` to the SDK overrides
      // DEFAULT_EXEC_ARGS and the resulting TUI spawn deadlocks initialize_session.
      execArgs: composeSdkExecArgs(resolvedCli.execArgs),
      env,
      machineId: 'aionui-droid-model-probe',
    });

    const availableModels = session.initResult.availableModels || [];
    const catalog = availableModels
      .map((model) => mapDroidAvailableModelToFactoryModel(model))
      .filter((model): model is FactoryModel => Boolean(model));

    if (catalog.length === 0) {
      mainWarn('[DroidModelProbe]', 'Droid model probe returned no available models');
      lastDroidModelCatalogProbeReport = {
        success: false,
        cliSource: resolvedCli.source,
        cliVersion: resolvedCli.version,
        diagnostic: preflightDiagnostic,
        usedSoftPreflight: softPreflight,
        error: 'Droid model probe returned no available models',
      };
      return null;
    }

    mainLog('[DroidModelProbe]', 'Probed droid model catalog', {
      cwd: options.cwd,
      execPath: resolvedCli.execPath,
      execArgs: resolvedCli.execArgs,
      modelCount: catalog.length,
      sampleModelIds: catalog.slice(0, 8).map((model) => model.id),
      usedSoftPreflight: softPreflight,
    });

    lastDroidModelCatalogProbeReport = {
      success: true,
      cliSource: resolvedCli.source,
      cliVersion: resolvedCli.version,
      usedSoftPreflight: softPreflight,
    };

    return catalog;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const diagnostic = pickMostRelevantDroidCliDiagnostic([
      createDroidCliDiagnostic(error, 'session'),
      preflightDiagnostic,
    ]);
    mainWarn('[DroidModelProbe]', 'Failed to probe droid model catalog', {
      error: message,
      diagnosticCode: diagnostic?.code,
    });
    lastDroidModelCatalogProbeReport = {
      success: false,
      cliSource: resolvedCliResult?.source || 'system',
      cliVersion: resolvedCliResult?.version ?? null,
      diagnostic,
      usedSoftPreflight: softPreflight,
      error: message,
    };
    return null;
  } finally {
    if (session) {
      await session.close().catch(() => {});
    }
  }
}
