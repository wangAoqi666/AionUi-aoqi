/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IDroidByokModelConfig, IDroidByokModelConfigInput } from '@/common/adapter/ipcBridge';
import { ipcBridge } from '@/common';
import AionModal from '@/renderer/components/base/AionModal';
import ModalHOC from '@/renderer/utils/ui/ModalHOC';
import { Button, Input, Message } from '@arco-design/web-react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

const buildNormalizedPayload = (payload: IDroidByokModelConfigInput): IDroidByokModelConfigInput => ({
  baseUrl: payload.baseUrl.trim(),
  apiKey: payload.apiKey.trim(),
  model: payload.model.trim(),
  displayName: payload.displayName?.trim() || '',
  ...(payload.existingId ? { existingId: payload.existingId } : {}),
});

const buildConnectionSignature = (payload: IDroidByokModelConfigInput): string => {
  const normalized = buildNormalizedPayload(payload);
  return JSON.stringify({
    baseUrl: normalized.baseUrl,
    apiKey: normalized.apiKey,
    model: normalized.model,
  });
};

const FactoryDroidByokModal = ModalHOC<{
  data?: IDroidByokModelConfig | null;
  onSubmit: (config: IDroidByokModelConfigInput) => Promise<void> | void;
}>(({ modalProps, data, onSubmit, modalCtrl }) => {
  const { t } = useTranslation();
  const [message, messageContext] = Message.useMessage();
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [validatedSignature, setValidatedSignature] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const payload = useMemo<IDroidByokModelConfigInput>(
    () => ({
      baseUrl,
      apiKey,
      model,
      displayName,
      ...(data?.id ? { existingId: data.id } : {}),
    }),
    [apiKey, baseUrl, data?.id, displayName, model]
  );
  const normalizedPayload = useMemo(() => buildNormalizedPayload(payload), [payload]);
  const payloadSignature = useMemo(() => buildConnectionSignature(payload), [payload]);
  const hasRequiredFields = Boolean(normalizedPayload.baseUrl && normalizedPayload.apiKey && normalizedPayload.model);
  const hasValidatedCurrentValues = validatedSignature === payloadSignature;
  const isEditing = Boolean(data);

  useEffect(() => {
    if (!modalProps.visible) {
      return;
    }

    setBaseUrl(data?.baseUrl || '');
    setApiKey(data?.apiKey || '');
    setModel(data?.model || 'claude-sonnet-4-6');
    setDisplayName(data?.displayName || '');
    setValidatedSignature(data ? buildConnectionSignature(data) : null);
  }, [data, modalProps.visible]);

  const handleTest = async () => {
    if (!hasRequiredFields) {
      message.warning(t('settings.droidByok.testConnectionRequired'));
      return;
    }

    setTesting(true);
    try {
      const result = await ipcBridge.acpConversation.testDroidByokConfig.invoke(normalizedPayload);
      if (!result.success || !result.data?.config) {
        throw new Error(result.msg || t('settings.droidByok.testConnectionFailed'));
      }

      setBaseUrl(result.data.config.baseUrl);
      setDisplayName(result.data.config.displayName);
      setValidatedSignature(buildConnectionSignature(result.data.config));
      message.success(t('settings.droidByok.testConnectionSuccess'));
    } catch (error) {
      setValidatedSignature(null);
      message.error(
        t('settings.droidByok.testConnectionFailedWithReason', {
          error: error instanceof Error ? error.message : String(error),
        })
      );
    } finally {
      setTesting(false);
    }
  };

  const handleConfirm = async () => {
    if (!hasRequiredFields) {
      message.warning(t('settings.droidByok.testConnectionRequired'));
      return;
    }

    if (!hasValidatedCurrentValues) {
      message.warning(t('settings.droidByok.testBeforeSave'));
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit(normalizedPayload);
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
        title: isEditing ? t('settings.droidByok.editCustomModel') : t('settings.droidByok.addCustomModel'),
        showClose: true,
      }}
      style={{ maxWidth: '92vw', borderRadius: 16 }}
      contentStyle={{ background: 'var(--bg-1)', borderRadius: 16, padding: '20px 24px 16px', overflow: 'auto' }}
      onOk={handleConfirm}
      confirmLoading={submitting}
      okText={t('common.confirm')}
      cancelText={t('common.cancel')}
      okButtonProps={{ disabled: !hasRequiredFields || !hasValidatedCurrentValues }}
    >
      {messageContext}
      <div className='pt-4px pb-12px space-y-14px'>
        <div className='space-y-8px'>
          <div className='text-13px font-500 text-t-secondary'>{t('settings.baseUrl')}</div>
          <Input value={baseUrl} placeholder={t('settings.droidByok.baseUrlPlaceholder')} onChange={setBaseUrl} />
          <div className='text-11px text-t-secondary leading-4'>{t('settings.droidByok.baseUrlTip')}</div>
        </div>

        <div className='space-y-8px'>
          <div className='text-13px font-500 text-t-secondary'>{t('settings.apiKey')}</div>
          <Input.Password value={apiKey} visibilityToggle onChange={setApiKey} />
        </div>

        <div className='space-y-8px'>
          <div className='text-13px font-500 text-t-secondary'>{t('settings.droidByok.modelId')}</div>
          <Input value={model} placeholder={t('settings.droidByok.modelIdPlaceholder')} onChange={setModel} />
          <div className='text-11px text-t-secondary leading-4'>{t('settings.droidByok.modelIdTip')}</div>
        </div>

        <div className='space-y-8px'>
          <div className='text-13px font-500 text-t-secondary'>
            {t('settings.droidByok.displayName')}
            <span className='ml-6px text-12px text-t-tertiary'>{t('settings.droidByok.optional')}</span>
          </div>
          <Input
            value={displayName}
            placeholder={t('settings.droidByok.displayNamePlaceholder')}
            onChange={setDisplayName}
          />
        </div>

        <div className='flex items-center justify-between gap-12px flex-wrap rounded-12px bg-[var(--fill-0)] px-12px py-10px'>
          <div className='text-12px text-t-secondary leading-5'>{t('settings.droidByok.testConnectionHint')}</div>
          <Button type='outline' shape='round' loading={testing} disabled={!hasRequiredFields} onClick={handleTest}>
            {t('settings.droidByok.testConnection')}
          </Button>
        </div>
      </div>
    </AionModal>
  );
});

export default FactoryDroidByokModal;
