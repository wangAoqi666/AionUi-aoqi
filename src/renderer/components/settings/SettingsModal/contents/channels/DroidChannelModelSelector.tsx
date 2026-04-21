/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import { channel } from '@/common/adapter/ipcBridge';
import { getFactoryModels, subscribeFactoryModelCatalog, type FactoryModel } from '@/common/config/factoryModels';
import { Button, Dropdown, Menu, Message, Tooltip } from '@arco-design/web-react';
import { Down } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import {
  loadChannelInstanceSettings,
  updateChannelInstanceSettings,
  type ChannelInstancePlatform,
} from './channelInstanceSettings';

const DROID_PROVIDER_ID = 'droid';

interface DroidChannelModelSelectorProps {
  pluginId: string;
  platform: ChannelInstancePlatform;
  agent: { backend: string; customAgentId?: string; name?: string };
  disabled?: boolean;
}

const isByokModel = (model: FactoryModel): boolean =>
  model.isCustom === true || model.id.startsWith('custom:') || model.id.includes('[BYOK]');

const DroidChannelModelSelector: React.FC<DroidChannelModelSelectorProps> = ({
  pluginId,
  platform,
  agent,
  disabled,
}) => {
  const { t } = useTranslation();
  const factoryCatalog = useSyncExternalStore(subscribeFactoryModelCatalog, getFactoryModels, getFactoryModels);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setRestoring(true);
    loadChannelInstanceSettings(pluginId, platform)
      .then((settings) => {
        if (cancelled) return;
        const saved = settings.defaultModel;
        if (saved?.id === DROID_PROVIDER_ID && typeof saved.useModel === 'string' && saved.useModel.length > 0) {
          setSelectedModelId(saved.useModel);
        } else {
          setSelectedModelId(null);
        }
      })
      .catch((error) => {
        console.warn(`[DroidChannelModelSelector] Failed to load saved model for ${pluginId}:`, error);
      })
      .finally(() => {
        if (!cancelled) setRestoring(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pluginId, platform]);

  const visibleModels = useMemo(() => factoryCatalog.filter((model) => !model.deprecated), [factoryCatalog]);

  const byokModels = useMemo(() => visibleModels.filter(isByokModel), [visibleModels]);
  const cloudModels = useMemo(() => visibleModels.filter((model) => !isByokModel(model)), [visibleModels]);

  const selectedModel = useMemo(
    () => visibleModels.find((model) => model.id === selectedModelId) || null,
    [visibleModels, selectedModelId]
  );

  const defaultLabel = t('settings.assistant.droidDefaultModelButton', 'Choose Droid model');
  const displayLabel = selectedModel ? selectedModel.name : defaultLabel;

  const handleSelect = useCallback(
    async (modelId: string) => {
      const previous = selectedModelId;
      setSelectedModelId(modelId);
      try {
        await updateChannelInstanceSettings(pluginId, (current) => ({
          ...current,
          defaultModel: { id: DROID_PROVIDER_ID, useModel: modelId },
        }));
        await channel.syncChannelSettings
          .invoke({
            platform,
            pluginId,
            agent,
            model: { id: DROID_PROVIDER_ID, useModel: modelId },
          })
          .catch((error) => {
            console.warn(`[DroidChannelModelSelector] syncChannelSettings failed for ${pluginId}:`, error);
          });
        Message.success(t('settings.assistant.modelSwitched', 'Model switched successfully'));
      } catch (error) {
        console.error(`[DroidChannelModelSelector] Failed to save model for ${pluginId}:`, error);
        Message.error(t('settings.assistant.modelSaveFailed', 'Failed to save model'));
        setSelectedModelId(previous);
      }
    },
    [agent, pluginId, platform, selectedModelId, t]
  );

  const renderModelItem = (model: FactoryModel) => {
    const isSelected = model.id === selectedModelId;
    return (
      <Menu.Item
        key={model.id}
        className={isSelected ? 'bg-2!' : ''}
        onClick={() => {
          void handleSelect(model.id);
        }}
      >
        <div className='flex items-center justify-between gap-8px w-full'>
          <span className='truncate'>{model.name}</span>
          {isByokModel(model) && (
            <span className='text-11px px-6px py-1px rd-4px bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200 shrink-0'>
              BYOK
            </span>
          )}
        </div>
      </Menu.Item>
    );
  };

  const isEmpty = visibleModels.length === 0;

  if (disabled || isEmpty) {
    return (
      <Tooltip
        content={
          isEmpty
            ? t('settings.assistant.droidNoModelsAvailable', 'No Droid models available. Open the main app first.')
            : undefined
        }
        position='top'
      >
        <Button className='min-w-200px flex items-center justify-between gap-8px' disabled>
          <span className='truncate'>{displayLabel}</span>
          <Down theme='outline' size={14} />
        </Button>
      </Tooltip>
    );
  }

  return (
    <Dropdown
      trigger='click'
      droplist={
        <Menu style={{ maxHeight: '360px', overflowY: 'auto' }}>
          {byokModels.length > 0 && (
            <Menu.ItemGroup title={t('settings.assistant.droidByokModelsGroup', 'Your BYOK models')}>
              {byokModels.map(renderModelItem)}
            </Menu.ItemGroup>
          )}
          {cloudModels.length > 0 && (
            <Menu.ItemGroup title={t('settings.assistant.droidCloudModelsGroup', 'Factory built-in')}>
              {cloudModels.map(renderModelItem)}
            </Menu.ItemGroup>
          )}
        </Menu>
      }
    >
      <Button className='min-w-200px flex items-center justify-between gap-8px'>
        <span className='truncate'>{restoring ? t('common.loading', 'Loading...') : displayLabel}</span>
        <Down theme='outline' size={14} />
      </Button>
    </Dropdown>
  );
};

export default DroidChannelModelSelector;
