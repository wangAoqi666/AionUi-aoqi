/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IDroidByokModelConfig, IDroidByokSite } from '@/common/adapter/ipcBridge';
import { ipcBridge } from '@/common';
import { Empty, Message, Spin } from '@arco-design/web-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import FactoryDroidByokSiteCard from './FactoryDroidByokSiteCard';
import FactoryDroidByokRotateKeyModal from './FactoryDroidByokRotateKeyModal';
import FactoryDroidByokModelEditModal from './FactoryDroidByokModelEditModal';

export interface FactoryDroidByokSiteListProps {
  byokConfigs: IDroidByokModelConfig[];
  refreshToken?: number;
  onRequestAddModel: (site: IDroidByokSite) => void;
  /**
   * Fallback hook when the site-aware capability modal cannot resolve the
   * target config (e.g., the config was just removed). The parent can still
   * open the full BYOK modal for advanced edits.
   */
  onEditModel: (config: IDroidByokModelConfig) => void;
  onRemoveModel: (config: IDroidByokModelConfig) => void | Promise<void>;
  onAfterChange: () => void | Promise<void>;
}

/**
 * Aggregated station view for BYOK models. Fetches the server-side site list
 * through `listDroidByokSites`, delegates per-site actions to the card + its
 * modals, and notifies the parent so the flat catalog refresh stays in sync
 * with the site CRUD flow.
 *
 * 站点聚合视图：通过 listDroidByokSites 拉数据，卡片内的操作完成后通过 onAfterChange
 * 通知上层刷新 Factory catalog / 扁平列表。
 */
const FactoryDroidByokSiteList: React.FC<FactoryDroidByokSiteListProps> = ({
  byokConfigs,
  refreshToken,
  onRequestAddModel,
  onEditModel,
  onRemoveModel,
  onAfterChange,
}) => {
  const { t } = useTranslation();
  const [sites, setSites] = useState<IDroidByokSite[]>([]);
  const [loading, setLoading] = useState(true);
  const [busySiteId, setBusySiteId] = useState<string | null>(null);
  const [removingSiteId, setRemovingSiteId] = useState<string | null>(null);
  const [message, messageContext] = Message.useMessage();
  const messageRef = useRef(message);
  messageRef.current = message;

  const [rotateKeyCtrl, rotateKeyContext] = FactoryDroidByokRotateKeyModal.useModal({
    site: null,
    onSuccess: async () => {
      await Promise.all([loadSites(), onAfterChange?.()]);
    },
  });

  const [editCapabilityCtrl, editCapabilityContext] = FactoryDroidByokModelEditModal.useModal({
    config: null,
    onSuccess: async () => {
      await Promise.all([loadSites(), onAfterChange?.()]);
    },
  });

  const loadSites = useCallback(async () => {
    setLoading(true);
    try {
      const result = await ipcBridge.acpConversation.listDroidByokSites.invoke();
      if (!result.success) {
        throw new Error(result.msg || t('settings.droidByok.site.loadFailed'));
      }
      setSites(result.data?.sites || []);
    } catch (error) {
      messageRef.current.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadSites();
  }, [loadSites, refreshToken]);

  const handleSaveLabel = async (site: IDroidByokSite, label: string) => {
    const trimmed = label.trim();
    if ((site.label ?? '') === trimmed) {
      return;
    }
    setBusySiteId(site.id);
    try {
      // Omit `provider` so upsert preserves per-model providers (mixed-protocol sites stay intact).
      // 不传 provider，保留每条模型原有的 provider 设置（混合协议站点保持原样）。
      const result = await ipcBridge.acpConversation.upsertDroidByokSite.invoke({
        id: site.id,
        baseUrl: site.baseUrl,
        label: trimmed,
      });
      if (!result.success) {
        throw new Error(result.msg || t('settings.droidByok.site.saveLabelFailed'));
      }
      await loadSites();
      await onAfterChange?.();
      message.success(t('settings.droidByok.site.saveLabelSuccess'));
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusySiteId(null);
    }
  };

  const handleRemoveSite = async (site: IDroidByokSite) => {
    setRemovingSiteId(site.id);
    try {
      const result = await ipcBridge.acpConversation.removeDroidByokSite.invoke({ id: site.id });
      if (!result.success) {
        throw new Error(result.msg || t('settings.droidByok.site.removeSiteFailed'));
      }
      await loadSites();
      await onAfterChange?.();
      message.success(t('settings.droidByok.site.removeSiteSuccess'));
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setRemovingSiteId(null);
    }
  };

  const handleRemoveModel = async (config: IDroidByokModelConfig) => {
    try {
      await onRemoveModel(config);
      await loadSites();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className='mb-16px'>
      {messageContext}
      {rotateKeyContext}
      {editCapabilityContext}
      {loading ? (
        <div className='flex items-center justify-center py-24px'>
          <Spin />
        </div>
      ) : sites.length === 0 ? (
        <div className='rounded-12px border border-[var(--color-border-2)] bg-[var(--color-bg-2)] py-24px flex items-center justify-center'>
          <Empty description={t('settings.droidByok.site.emptyHint')} />
        </div>
      ) : (
        sites.map((site) => (
          <FactoryDroidByokSiteCard
            key={site.id}
            site={site}
            byokConfigs={byokConfigs}
            busy={busySiteId === site.id || removingSiteId === site.id}
            removing={removingSiteId === site.id}
            onAddModel={onRequestAddModel}
            onRotateKey={(target) => rotateKeyCtrl.open({ site: target })}
            onRemoveSite={(target) => void handleRemoveSite(target)}
            onSaveLabel={handleSaveLabel}
            onRemoveModel={(config) => void handleRemoveModel(config)}
            onEditModel={(config) => {
              // Prefer the focused capability modal; full advanced edits can
              // still be reached via the primary ModelModalContent flow.
              if (config) {
                editCapabilityCtrl.open({ config });
              } else {
                onEditModel(config);
              }
            }}
          />
        ))
      )}
    </div>
  );
};

export default FactoryDroidByokSiteList;
