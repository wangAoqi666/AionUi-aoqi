/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DroidByokModelProvider, IDroidByokModelConfig, IDroidByokSite } from '@/common/adapter/ipcBridge';
import {
  getFactoryModels,
  getFactoryReasoningLabel,
  isFactoryCustomModel,
  subscribeFactoryModelCatalog,
  type FactoryModel,
  type ReasoningLevel,
} from '@/common/config/factoryModels';
import { Button, Collapse, Divider, Input, Popconfirm, Tag, Tooltip } from '@arco-design/web-react';
import { Check, Close, Delete, Edit, Key, LinkCloud, Pic, Plus, Refresh, Write } from '@icon-park/react';
import React, { useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Tag color per protocol family. Matches the legacy BYOK section to keep the
 * overall settings screen visually coherent.
 *
 * 按协议簇区分色值，保持与旧版 BYOK 视图一致。
 */
const getProviderTagColor = (provider: DroidByokModelProvider): string => {
  switch (provider) {
    case 'anthropic':
      return 'orange';
    case 'openai':
      return 'green';
    default:
      return 'arcoblue';
  }
};

const getProviderLabelKey = (provider: DroidByokModelProvider): string => {
  switch (provider) {
    case 'anthropic':
      return 'settings.droidByok.providerAnthropic';
    case 'openai':
      return 'settings.droidByok.providerOpenai';
    default:
      return 'settings.droidByok.providerGeneric';
  }
};

const getReasoningTagColor = (level: string): string => {
  switch (level) {
    case 'max':
    case 'xhigh':
      return 'purple';
    case 'high':
      return 'blue';
    case 'medium':
      return 'green';
    case 'low':
    case 'minimal':
      return 'gold';
    default:
      return 'gray';
  }
};

type DisplayModel = FactoryModel & { fallbackOnly?: boolean; managedConfig?: IDroidByokModelConfig };

/**
 * Resolve the list of managed models that belong to this site based on the
 * intersection of the site's model ids with the live Factory catalog + BYOK
 * config list. Models that exist in the catalog win; entries present only in
 * the stored BYOK list fall back to a synthetic "fallback only" record so the
 * card still surfaces them until the catalog catches up.
 */
const resolveSiteDisplayModels = (
  site: IDroidByokSite,
  factoryModels: FactoryModel[],
  byokConfigs: IDroidByokModelConfig[]
): DisplayModel[] => {
  const ownedIds = new Set(site.modelIds);
  const ownedConfigs = byokConfigs.filter((config) => ownedIds.has(config.id));

  const customFromCatalog: DisplayModel[] = [];
  for (const model of factoryModels) {
    if (!(model.isCustom || isFactoryCustomModel(model.id))) {
      continue;
    }
    const matching = ownedConfigs.find(
      (config) =>
        model.modelProvider === config.provider &&
        (model.sourceModelId === config.model || model.name === config.displayName)
    );
    if (matching) {
      customFromCatalog.push({ ...model, managedConfig: matching });
    }
  }

  const matchedConfigIds = new Set(
    customFromCatalog.map((model) => model.managedConfig?.id).filter((id): id is string => Boolean(id))
  );

  const fallback: DisplayModel[] = ownedConfigs
    .filter((config) => !matchedConfigIds.has(config.id))
    .map((config) =>
      Object.assign(
        {
          id: `managed-byok:${config.id}`,
          name: config.displayName,
          sourceModelId: config.model,
          modelProvider: config.provider,
          isCustom: true,
          reasoningLevels:
            Array.isArray(config.reasoningLevels) && config.reasoningLevels.length > 0
              ? config.reasoningLevels
              : ([`none`] as ReasoningLevel[]),
          defaultReasoning: config.defaultReasoning ?? `none`,
        },
        config.supportsImageInput === true ? { supportsImageInput: true } : {},
        { fallbackOnly: true, managedConfig: config }
      )
    );

  return [...fallback, ...customFromCatalog];
};

export interface FactoryDroidByokSiteCardProps {
  site: IDroidByokSite;
  byokConfigs: IDroidByokModelConfig[];
  busy?: boolean;
  removing?: boolean;
  onAddModel: (site: IDroidByokSite) => void;
  onRotateKey: (site: IDroidByokSite) => void;
  onRemoveSite: (site: IDroidByokSite) => void;
  onSaveLabel: (site: IDroidByokSite, label: string) => Promise<void> | void;
  onRemoveModel: (config: IDroidByokModelConfig) => void;
  onEditModel: (config: IDroidByokModelConfig) => void;
}

/**
 * Render one BYOK site as a collapsible card with label, stats, actions, and
 * a nested model list that reuses the same visual language as the built-in
 * Factory model section.
 *
 * 渲染一个 BYOK 站点卡片：头部展示站点信息与操作按钮，展开后列出模型。
 */
const FactoryDroidByokSiteCard: React.FC<FactoryDroidByokSiteCardProps> = ({
  site,
  byokConfigs,
  busy = false,
  removing = false,
  onAddModel,
  onRotateKey,
  onRemoveSite,
  onSaveLabel,
  onRemoveModel,
  onEditModel,
}) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [editingLabel, setEditingLabel] = useState(false);
  const [draftLabel, setDraftLabel] = useState(site.label ?? '');
  const [savingLabel, setSavingLabel] = useState(false);

  const factoryCatalog = useSyncExternalStore(subscribeFactoryModelCatalog, getFactoryModels, getFactoryModels);
  const factoryModels = useMemo(() => factoryCatalog.filter((model) => !model.deprecated), [factoryCatalog]);
  const displayModels = useMemo(
    () => resolveSiteDisplayModels(site, factoryModels, byokConfigs),
    [byokConfigs, factoryModels, site]
  );

  const displayLabel = site.label?.trim() || (() => {
    try {
      return new URL(site.baseUrl).hostname;
    } catch {
      return site.baseUrl || t('settings.droidByok.site.untitled');
    }
  })();
  const collapseKey = `byok-site-${site.id}`;

  const commitLabel = async () => {
    if (savingLabel) {
      return;
    }
    const next = draftLabel.trim();
    setSavingLabel(true);
    try {
      await onSaveLabel(site, next);
      setEditingLabel(false);
    } finally {
      setSavingLabel(false);
    }
  };

  return (
    <div className='mb-12px'>
      <Collapse
        activeKey={expanded ? [collapseKey] : []}
        onChange={(_, keys) => setExpanded(keys.includes(collapseKey))}
        bordered
        expandIconPosition='left'
        className={`[&_.arco-collapse-item]:!border-0 [&_.arco-collapse-item]:!rounded-12px [&_.arco-collapse-item]:!overflow-hidden [&_.arco-collapse-item]:!bg-[var(--color-bg-2)] [&_.arco-collapse-item-header]:!bg-[var(--fill-0)] [&_.arco-collapse-item-header]:!pl-36px [&_.arco-collapse-item-header]:!pr-12px [&_.arco-collapse-item-header]:!py-10px [&_.arco-collapse-item-header]:transition-colors [&_.arco-collapse-item-header]:hover:!bg-[var(--color-bg-2)] [&_.arco-collapse-item-header]:!gap-8px [&_.arco-collapse-item-header-title]:!min-w-0 [&_.arco-collapse-item-header-icon]:!text-2 [&_.arco-collapse-item-header:hover_.arco-collapse-item-header-icon]:!text-1 [&_.arco-collapse-item-content]:!bg-fill-1 [&_.arco-collapse-item-content-box]:!px-10px [&_.arco-collapse-item-content-box]:!py-8px [&_.arco-collapse-item-content]:!border-t [&_.arco-collapse-item-content]:!border-[var(--color-border-2)] ${
          expanded
            ? '[&_.arco-collapse-item-header]:!rounded-t-12px [&_.arco-collapse-item-header]:!rounded-b-0 [&_.arco-collapse-item-content]:!rounded-b-12px'
            : '[&_.arco-collapse-item-header]:!rounded-12px'
        }`}
      >
        <Collapse.Item
          name={collapseKey}
          header={
            <div className='flex items-center justify-between w-full min-h-36px gap-8px min-w-0'>
              <div className='flex items-center gap-6px min-w-0 flex-1'>
                <LinkCloud size='18' className='text-t-secondary shrink-0' />
                {editingLabel ? (
                  <div
                    className='flex items-center gap-4px min-w-0'
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <Input
                      size='small'
                      autoFocus
                      value={draftLabel}
                      placeholder={t('settings.droidByok.site.labelPlaceholder')}
                      onChange={setDraftLabel}
                      onPressEnter={() => void commitLabel()}
                      onBlur={() => void commitLabel()}
                      style={{ maxWidth: 220 }}
                    />
                    <Button
                      size='mini'
                      className='!w-28px !h-28px !min-w-28px text-t-secondary hover:text-t-primary'
                      icon={<Check size='14' />}
                      loading={savingLabel}
                      onClick={() => void commitLabel()}
                    />
                    <Button
                      size='mini'
                      className='!w-28px !h-28px !min-w-28px text-t-secondary hover:text-t-primary'
                      icon={<Close size='14' />}
                      disabled={savingLabel}
                      onClick={() => {
                        setDraftLabel(site.label ?? '');
                        setEditingLabel(false);
                      }}
                    />
                  </div>
                ) : (
                  <span
                    className={`text-14px font-500 truncate min-w-0 transition-colors ${expanded ? 'text-t-primary' : 'text-2 group-hover:text-1'}`}
                  >
                    {displayLabel}
                  </span>
                )}
                <span className='text-12px text-t-secondary whitespace-nowrap'>
                  {site.modelCount} {t('settings.modelCount')}
                </span>
              </div>

              <div
                className='flex items-center gap-2px shrink-0'
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
                {!editingLabel && (
                  <Tooltip content={t('settings.droidByok.site.editLabel')}>
                    <Button
                      size='mini'
                      type='text'
                      className='!w-28px !h-28px !min-w-28px text-t-secondary hover:text-t-primary'
                      icon={<Edit size='14' />}
                      disabled={busy}
                      onClick={() => {
                        setDraftLabel(site.label ?? '');
                        setEditingLabel(true);
                      }}
                    />
                  </Tooltip>
                )}
                <Tooltip content={t('settings.droidByok.site.addModel')}>
                  <Button
                    size='mini'
                    type='text'
                    className='!w-28px !h-28px !min-w-28px text-t-secondary hover:text-t-primary'
                    icon={<Plus size='14' />}
                    disabled={busy}
                    onClick={() => onAddModel(site)}
                  />
                </Tooltip>
                <Tooltip content={t('settings.droidByok.site.rotateKey')}>
                  <Button
                    size='mini'
                    type='text'
                    className='!w-28px !h-28px !min-w-28px text-t-secondary hover:text-t-primary'
                    icon={<Refresh size='14' />}
                    disabled={busy}
                    onClick={() => onRotateKey(site)}
                  />
                </Tooltip>
                <Popconfirm title={t('settings.droidByok.site.removeConfirm')} onOk={() => onRemoveSite(site)}>
                  <Tooltip content={t('settings.droidByok.site.removeSite')}>
                    <Button
                      size='mini'
                      type='text'
                      className='!w-28px !h-28px !min-w-28px text-t-secondary hover:text-t-primary'
                      icon={<Delete size='14' />}
                      loading={removing}
                      disabled={busy}
                    />
                  </Tooltip>
                </Popconfirm>
              </div>
            </div>
          }
        >
          {displayModels.length === 0 ? (
            <div className='px-8px py-12px text-13px text-t-secondary'>{t('settings.noAvailableModels')}</div>
          ) : (
            displayModels.map((model, index, arr) => (
              <div key={`${model.id}-${model.name}`}>
                <div className='flex items-center justify-between px-8px py-10px transition-colors hover:bg-[var(--fill-0)]'>
                  <div className='flex items-center gap-8px min-w-0'>
                    <span className='text-13px text-t-primary font-500 shrink-0'>{model.name}</span>
                    <span className='text-11px text-t-tertiary truncate min-w-0'>
                      {model.sourceModelId || model.id}
                    </span>
                  </div>
                  <div className='flex items-center gap-4px shrink-0'>
                    {/* Per-model provider tag: multi-protocol sites show which protocol each model speaks. */}
                    {/* 每条模型自己的 provider 标签，用于混合协议站点区分。 */}
                    {site.providers.length > 1 && model.managedConfig?.provider && (
                      <Tag size='small' color={getProviderTagColor(model.managedConfig.provider)}>
                        {t(getProviderLabelKey(model.managedConfig.provider))}
                      </Tag>
                    )}
                    {model.supportsImageInput === true && (
                      <Tooltip content={t('settings.droidByok.capability.multimodalTooltip')}>
                        <Tag size='small' color='magenta' icon={<Pic size='12' />}>
                          {t('settings.droidByok.capability.multimodalTag')}
                        </Tag>
                      </Tooltip>
                    )}
                    {model.defaultReasoning && model.defaultReasoning !== 'none' && (
                      <Tag size='small' color={getReasoningTagColor(model.defaultReasoning)}>
                        {getFactoryReasoningLabel(model.defaultReasoning)}
                      </Tag>
                    )}
                    {model.managedConfig && (
                      <>
                        <Button
                          size='mini'
                          className='!w-28px !h-28px !min-w-28px text-t-secondary hover:text-t-primary'
                          icon={<Write size='14' />}
                          disabled={busy}
                          onClick={() => onEditModel(model.managedConfig!)}
                        />
                        <Popconfirm
                          title={t('settings.droidByok.deleteCustomModelConfirm')}
                          onOk={() => onRemoveModel(model.managedConfig!)}
                        >
                          <Button
                            size='mini'
                            className='!w-28px !h-28px !min-w-28px text-t-secondary hover:text-t-primary'
                            icon={<Delete size='14' />}
                            disabled={busy}
                          />
                        </Popconfirm>
                      </>
                    )}
                  </div>
                </div>
                {index < arr.length - 1 && <Divider className='!my-0 !border-[var(--color-border-2)]/70' />}
              </div>
            ))
          )}
        </Collapse.Item>
      </Collapse>
    </div>
  );
};

export default FactoryDroidByokSiteCard;
