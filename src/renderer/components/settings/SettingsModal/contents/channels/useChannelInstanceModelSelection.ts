/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IProvider, TProviderWithModel } from '@/common/config/storage';
import { channel } from '@/common/adapter/ipcBridge';
import { Message } from '@arco-design/web-react';
import { useModelProviderList } from '@/renderer/hooks/agent/useModelProviderList';
import {
  useGeminiModelSelection,
  type GeminiModelSelection,
} from '@/renderer/pages/conversation/platforms/gemini/useGeminiModelSelection';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  loadChannelInstanceSettings,
  updateChannelInstanceSettings,
  type ChannelInstancePlatform,
} from './channelInstanceSettings';

export function useChannelInstanceModelSelection(
  pluginId: string,
  platform: ChannelInstancePlatform
): GeminiModelSelection {
  const { t } = useTranslation();
  const { providers } = useModelProviderList();
  const [resolvedInitialModel, setResolvedInitialModel] = useState<TProviderWithModel | undefined>(undefined);
  const [restored, setRestored] = useState(false);
  const retryCountRef = useRef(0);
  const MAX_RESTORE_RETRIES = 5;

  useEffect(() => {
    retryCountRef.current = 0;
    setResolvedInitialModel(undefined);
    setRestored(false);
  }, [platform, pluginId]);

  useEffect(() => {
    if (restored || providers.length === 0) return;

    const restore = async () => {
      try {
        const settings = await loadChannelInstanceSettings(pluginId, platform);
        const saved = settings.defaultModel;
        if (!saved?.id || !saved.useModel) {
          setRestored(true);
          return;
        }

        const provider = providers.find((item) => item.id === saved.id);
        if (!provider) {
          retryCountRef.current += 1;
          if (retryCountRef.current >= MAX_RESTORE_RETRIES) {
            setRestored(true);
          }
          return;
        }

        const isGoogleAuth = provider.platform?.toLowerCase().includes('gemini-with-google-auth');
        if (isGoogleAuth || provider.model?.includes(saved.useModel)) {
          setResolvedInitialModel({
            ...provider,
            useModel: saved.useModel,
          } as TProviderWithModel);
        }
        setRestored(true);
      } catch (error) {
        console.error(`[ChannelInstanceModelSelection] Failed to restore model for ${pluginId}:`, error);
        setRestored(true);
      }
    };

    void restore();
  }, [platform, pluginId, providers, restored]);

  const onSelectModel = useCallback(
    async (provider: IProvider, modelName: string) => {
      try {
        const modelRef = {
          id: provider.id,
          useModel: modelName,
        };
        await updateChannelInstanceSettings(pluginId, (current) => ({
          ...current,
          defaultModel: modelRef,
        }));

        const currentSettings = await loadChannelInstanceSettings(pluginId, platform);
        await channel.syncChannelSettings
          .invoke({
            platform,
            pluginId,
            agent: currentSettings.agent || { backend: 'gemini' },
            model: modelRef,
          })
          .catch((error) =>
            console.warn(`[ChannelInstanceModelSelection] syncChannelSettings failed for ${pluginId}:`, error)
          );

        Message.success(t('settings.assistant.modelSwitched', 'Model switched successfully'));
        return true;
      } catch (error) {
        console.error(`[ChannelInstanceModelSelection] Failed to save model for ${pluginId}:`, error);
        Message.error(t('settings.assistant.modelSaveFailed', 'Failed to save model'));
        return false;
      }
    },
    [platform, pluginId, t]
  );

  return useGeminiModelSelection({
    initialModel: resolvedInitialModel,
    onSelectModel,
  });
}
