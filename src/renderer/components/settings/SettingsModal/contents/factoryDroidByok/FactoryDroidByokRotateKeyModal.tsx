/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IDroidByokSite } from '@/common/adapter/ipcBridge';
import { ipcBridge } from '@/common';
import AionModal from '@/renderer/components/base/AionModal';
import ModalHOC from '@/renderer/utils/ui/ModalHOC';
import { Input, Message } from '@arco-design/web-react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Rotate the API key on every model entry inside a BYOK site. Re-uses the
 * `rotateDroidByokSiteApiKey` bridge so the main process can cascade the new
 * key through `customModels` atomically and the catalog refresher can pick up
 * the change. The plaintext key never persists in renderer state.
 *
 * 站点级 API Key 轮换：新 key 通过 bridge 原子写入所有模型条目，renderer 不留副本。
 */
const FactoryDroidByokRotateKeyModal = ModalHOC<{
  site: IDroidByokSite | null;
  onSuccess?: () => void | Promise<void>;
}>(({ modalProps, site, onSuccess, modalCtrl }) => {
  const { t } = useTranslation();
  const [message, messageContext] = Message.useMessage();
  const [apiKey, setApiKey] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (modalProps.visible) {
      setApiKey('');
    }
  }, [modalProps.visible, site?.id]);

  const handleSubmit = async () => {
    if (!site) {
      modalCtrl.close();
      return;
    }
    const next = apiKey.trim();
    if (!next) {
      message.warning(t('settings.droidByok.site.rotateKeyRequired'));
      return;
    }
    setSubmitting(true);
    try {
      const result = await ipcBridge.acpConversation.rotateDroidByokSiteApiKey.invoke({
        id: site.id,
        newApiKey: next,
      });
      if (!result.success) {
        throw new Error(result.msg || t('settings.droidByok.site.rotateKeyFailed'));
      }
      await onSuccess?.();
      message.success(t('settings.droidByok.site.rotateKeySuccess'));
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
        title: t('settings.droidByok.site.rotateKeyTitle'),
        showClose: true,
      }}
      style={{ maxWidth: '92vw', width: 520, borderRadius: 16 }}
      contentStyle={{ background: 'var(--bg-1)', borderRadius: 16, padding: '20px 24px 16px' }}
      onOk={handleSubmit}
      confirmLoading={submitting}
      okText={t('common.confirm')}
      cancelText={t('common.cancel')}
      okButtonProps={{ disabled: !apiKey.trim() }}
    >
      {messageContext}
      <div className='pt-4px pb-12px space-y-14px'>
        <div className='text-12px text-t-secondary leading-5'>{t('settings.droidByok.site.rotateKeyHint')}</div>
        <div className='rounded-10px bg-[var(--fill-0)] px-10px py-8px text-12px text-t-secondary'>
          <div>
            <span className='text-t-tertiary mr-4px'>{t('settings.baseUrl')}:</span>
            <span className='text-t-primary break-all'>{site?.baseUrl ?? ''}</span>
          </div>
          <div className='mt-4px'>
            <span className='text-t-tertiary mr-4px'>{t('settings.droidByok.site.label')}:</span>
            <span className='text-t-primary break-all'>
              {site?.label?.trim() || t('settings.droidByok.site.untitled')}
            </span>
          </div>
        </div>
        <div className='space-y-6px'>
          <div className='text-13px font-500 text-t-secondary'>{t('settings.droidByok.site.newApiKey')}</div>
          <Input.Password
            value={apiKey}
            visibilityToggle
            onChange={setApiKey}
            placeholder={t('settings.droidByok.site.newApiKeyPlaceholder')}
          />
        </div>
      </div>
    </AionModal>
  );
});

export default FactoryDroidByokRotateKeyModal;
