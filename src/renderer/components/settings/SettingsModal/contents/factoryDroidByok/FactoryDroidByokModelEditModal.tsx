/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IDroidByokModelConfig } from '@/common/adapter/ipcBridge';
import type { ReasoningLevel } from '@/common/config/factoryModels';
import { getFactoryReasoningLabel } from '@/common/config/factoryModels';
import { ipcBridge } from '@/common';
import AionModal from '@/renderer/components/base/AionModal';
import ModalHOC from '@/renderer/utils/ui/ModalHOC';
import { Checkbox, Message, Radio, Switch } from '@arco-design/web-react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * All reasoning levels that can be enabled for a BYOK model. The order here
 * drives the modal's UI order so selection lists stay consistent between
 * models that expose different subsets.
 *
 * 所有可选的 reasoning level，按强度从弱到强排序，用户通过 CheckboxGroup 勾选后，
 * defaultReasoning 的 RadioGroup 只会显示已勾选的子集。
 */
const ALL_REASONING_LEVELS: ReasoningLevel[] = ['off', 'none', 'minimal', 'low', 'medium', 'high', 'max', 'xhigh'];

/**
 * Dedicated modal for editing ONLY the capability fields of a BYOK model
 * (multimodal / reasoning levels / default reasoning). Existing fields
 * (baseUrl, apiKey, model id, provider) are carried through unchanged; the
 * main `saveDroidByokConfig` bridge is used in `skip-probe` style by reusing
 * the stored apiKey, so no network round-trip is needed.
 *
 * 仅编辑 BYOK 模型的能力字段：多模态开关 + reasoning levels 复选 + default 单选。
 * 其他字段（baseUrl / apiKey / model / provider）由调用方透传，不改动 Probing。
 */
const FactoryDroidByokModelEditModal = ModalHOC<{
  config: IDroidByokModelConfig | null;
  onSuccess?: (next: IDroidByokModelConfig) => void | Promise<void>;
}>(({ modalProps, config, onSuccess, modalCtrl }) => {
  const { t } = useTranslation();
  const [message, messageContext] = Message.useMessage();
  const [supportsImageInput, setSupportsImageInput] = useState<boolean>(false);
  const [reasoningLevels, setReasoningLevels] = useState<ReasoningLevel[]>([]);
  const [defaultReasoning, setDefaultReasoning] = useState<ReasoningLevel>('none');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!modalProps.visible || !config) {
      return;
    }
    setSupportsImageInput(Boolean(config.supportsImageInput));
    const storedLevels: ReasoningLevel[] =
      Array.isArray(config.reasoningLevels) && config.reasoningLevels.length > 0
        ? [...config.reasoningLevels]
        : ['none'];
    setReasoningLevels(storedLevels);
    setDefaultReasoning(storedLevels.includes(config.defaultReasoning) ? config.defaultReasoning : storedLevels[0]);
  }, [config, modalProps.visible]);

  const availableDefaults = useMemo(
    () => (reasoningLevels.length > 0 ? reasoningLevels : (['none'] as ReasoningLevel[])),
    [reasoningLevels]
  );

  const handleLevelsChange = (values: string[]) => {
    const next = values.filter((value): value is ReasoningLevel =>
      ALL_REASONING_LEVELS.includes(value as ReasoningLevel)
    );
    const dedupedNext = Array.from(new Set(next));
    const nextLevels: ReasoningLevel[] = dedupedNext.length > 0 ? dedupedNext : ['none'];
    setReasoningLevels(nextLevels);
    if (!nextLevels.includes(defaultReasoning)) {
      setDefaultReasoning(nextLevels[0]);
    }
  };

  const handleSubmit = async () => {
    if (!config) {
      modalCtrl.close();
      return;
    }
    setSubmitting(true);
    try {
      const result = await ipcBridge.acpConversation.saveDroidByokConfig.invoke({
        existingId: config.id,
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.model,
        displayName: config.displayName,
        provider: config.provider,
        supportsImageInput,
        reasoningLevels,
        defaultReasoning,
      });
      if (!result.success || !result.data?.config) {
        throw new Error(result.msg || t('settings.droidByok.capability.saveFailed'));
      }
      await onSuccess?.(result.data.config);
      message.success(t('settings.droidByok.capability.saveSuccess'));
      modalCtrl.close();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AionModal
      visible={modalProps.visible}
      onCancel={modalCtrl.close}
      header={{
        title: t('settings.droidByok.capability.editTitle'),
        showClose: true,
      }}
      style={{ maxWidth: '94vw', width: 560, borderRadius: 16 }}
      contentStyle={{ background: 'var(--bg-1)', borderRadius: 16, padding: '20px 24px 16px' }}
      onOk={handleSubmit}
      confirmLoading={submitting}
      okText={t('common.save')}
      cancelText={t('common.cancel')}
      okButtonProps={{ disabled: !config }}
    >
      {messageContext}
      <div className='pt-4px pb-12px space-y-16px'>
        <div className='text-12px text-t-secondary leading-5'>{t('settings.droidByok.capability.editHint')}</div>

        <div className='rounded-10px bg-[var(--fill-0)] px-10px py-8px text-12px text-t-secondary'>
          <div>
            <span className='text-t-tertiary mr-4px'>{t('settings.droidByok.displayName')}:</span>
            <span className='text-t-primary break-all'>{config?.displayName ?? ''}</span>
          </div>
          <div className='mt-4px'>
            <span className='text-t-tertiary mr-4px'>{t('settings.droidByok.model')}:</span>
            <span className='text-t-primary break-all'>{config?.model ?? ''}</span>
          </div>
        </div>

        <div className='flex items-center justify-between gap-12px'>
          <div>
            <div className='text-13px font-500 text-t-primary'>
              {t('settings.droidByok.capability.multimodalLabel')}
            </div>
            <div className='text-12px text-t-secondary mt-2px'>{t('settings.droidByok.capability.multimodalHint')}</div>
          </div>
          <Switch
            checked={supportsImageInput}
            onChange={setSupportsImageInput}
            aria-label={t('settings.droidByok.capability.multimodalLabel')}
          />
        </div>

        <div className='space-y-6px'>
          <div className='text-13px font-500 text-t-primary'>
            {t('settings.droidByok.capability.reasoningLevelsLabel')}
          </div>
          <div className='text-12px text-t-secondary'>{t('settings.droidByok.capability.reasoningLevelsHint')}</div>
          <Checkbox.Group value={reasoningLevels} onChange={handleLevelsChange}>
            <div className='flex flex-wrap gap-x-12px gap-y-6px pt-2px'>
              {ALL_REASONING_LEVELS.map((level) => (
                <Checkbox key={level} value={level}>
                  {getFactoryReasoningLabel(level)}
                </Checkbox>
              ))}
            </div>
          </Checkbox.Group>
        </div>

        <div className='space-y-6px'>
          <div className='text-13px font-500 text-t-primary'>
            {t('settings.droidByok.capability.defaultReasoningLabel')}
          </div>
          <div className='text-12px text-t-secondary'>{t('settings.droidByok.capability.defaultReasoningHint')}</div>
          <Radio.Group
            value={defaultReasoning}
            onChange={(value: string) => {
              if (ALL_REASONING_LEVELS.includes(value as ReasoningLevel)) {
                setDefaultReasoning(value as ReasoningLevel);
              }
            }}
          >
            <div className='flex flex-wrap gap-x-12px gap-y-6px pt-2px'>
              {availableDefaults.map((level) => (
                <Radio key={level} value={level}>
                  {getFactoryReasoningLabel(level)}
                </Radio>
              ))}
            </div>
          </Radio.Group>
        </div>
      </div>
    </AionModal>
  );
});

export default FactoryDroidByokModelEditModal;
