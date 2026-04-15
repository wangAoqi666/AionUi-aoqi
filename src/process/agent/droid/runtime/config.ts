/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ConversationSource,
  DroidChannelPlatform,
  DroidChannelRuntimeConfig,
  ResolvedDroidChannelRuntimeConfig,
} from '@/common/config/storage';
import {
  CHANNEL_DROID_RUNTIME_PLATFORMS,
  resolveDroidChannelRuntimeConfig,
  sanitizeDroidChannelRuntimeConfig,
} from '@/common/config/storage';
import { ProcessConfig } from '@process/utils/initStorage';

export const isDroidChannelPlatform = (source?: ConversationSource): source is DroidChannelPlatform =>
  typeof source === 'string' && (CHANNEL_DROID_RUNTIME_PLATFORMS as readonly string[]).includes(source.toLowerCase());

export const getDroidRuntimeScopeKey = (source?: ConversationSource): string =>
  isDroidChannelPlatform(source) ? source : 'default';

export const getDroidRuntimeConfigStorageKey = (
  platform: DroidChannelPlatform
): `assistant.${DroidChannelPlatform}.droidRuntime` => `assistant.${platform}.droidRuntime`;

export const resolveStoredDroidRuntimeConfig = (
  defaults?: DroidChannelRuntimeConfig | null,
  override?: DroidChannelRuntimeConfig | null
): ResolvedDroidChannelRuntimeConfig => resolveDroidChannelRuntimeConfig(defaults, override);

export const loadDroidRuntimeConfigForSource = async (
  source?: ConversationSource
): Promise<ResolvedDroidChannelRuntimeConfig> => {
  const defaults = sanitizeDroidChannelRuntimeConfig(await ProcessConfig.get('assistant.droidRuntime.defaults'));

  if (!isDroidChannelPlatform(source)) {
    return resolveStoredDroidRuntimeConfig(defaults);
  }

  const override = sanitizeDroidChannelRuntimeConfig(await ProcessConfig.get(getDroidRuntimeConfigStorageKey(source)));

  return resolveStoredDroidRuntimeConfig(defaults, override);
};
