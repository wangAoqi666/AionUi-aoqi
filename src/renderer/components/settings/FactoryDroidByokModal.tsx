/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  DroidByokModelProvider,
  IDroidByokImportProgress,
  IDroidByokModelConfig,
  IDroidByokModelConfigInput,
  IDroidByokRemoteModel,
  IDroidByokVerificationResult,
} from '@/common/adapter/ipcBridge';
import { ipcBridge } from '@/common';
import AionSelect from '@/renderer/components/base/AionSelect';
import AionModal from '@/renderer/components/base/AionModal';
import ModalHOC from '@/renderer/utils/ui/ModalHOC';
import { Button, Checkbox, Input, Message, Progress, Spin, Tag } from '@arco-design/web-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

type DraftModelSelection = {
  model: string;
  displayName: string;
  provider: DroidByokModelProvider;
};

const PROVIDER_OPTIONS: DroidByokModelProvider[] = ['anthropic', 'openai', 'generic-chat-completion-api'];

const buildNormalizedPayload = (payload: IDroidByokModelConfigInput): IDroidByokModelConfigInput => ({
  baseUrl: payload.baseUrl.trim(),
  apiKey: payload.apiKey.trim(),
  model: payload.model.trim(),
  displayName: payload.displayName?.trim() || '',
  ...(payload.provider ? { provider: payload.provider } : {}),
  ...(payload.existingId ? { existingId: payload.existingId } : {}),
});

const buildConnectionSignature = (payload: IDroidByokModelConfigInput): string => {
  const normalized = buildNormalizedPayload(payload);
  return JSON.stringify({
    baseUrl: normalized.baseUrl,
    apiKey: normalized.apiKey,
    model: normalized.model,
    provider: normalized.provider || '',
  });
};

const providerKey = (provider: DroidByokModelProvider): string => {
  switch (provider) {
    case 'anthropic':
      return 'settings.droidByok.providerAnthropic';
    case 'openai':
      return 'settings.droidByok.providerOpenai';
    default:
      return 'settings.droidByok.providerGeneric';
  }
};

const toSelectionMap = (models: IDroidByokRemoteModel[]): Record<string, DraftModelSelection> => {
  return Object.fromEntries(
    models.map((model) => [
      model.model,
      {
        model: model.model,
        displayName: model.displayName,
        provider: model.inferredProvider,
      },
    ])
  );
};

/**
 * Prefill hint passed when the user clicks "Add Model" from within a BYOK
 * site card — lets us seed Base URL + provider so the user only has to
 * paste the API key and pick models. API keys intentionally remain
 * renderer-entered to match the existing security model (plaintext keys
 * never leave the main process on their own).
 *
 * 站点内“添加模型”入口携带的预填字段：仅 baseUrl/provider，
 * 明文 apiKey 仍由用户在 renderer 侧输入，避免从主进程外泄。
 */
export type FactoryDroidByokModalPrefill = {
  baseUrl?: string;
  provider?: DroidByokModelProvider;
};

const FactoryDroidByokModal = ModalHOC<{
  data?: IDroidByokModelConfig | null;
  prefill?: FactoryDroidByokModalPrefill;
  /**
   * When provided, the modal switches into "add-model-to-existing-site"
   * mode: baseUrl is locked to the site's baseUrl and the API key field is
   * hidden entirely. Fetch/import requests then go through the site-scoped
   * IPC channels which reuse the stored key inside the main process.
   *
   * 传入 bindToSiteId 时，Modal 切换到“站点内加模型”模式：baseUrl 只读，apiKey 输入
   * 框隐藏，fetch / import 走主进程站点化通道复用已存密钥。
   */
  bindToSiteId?: string;
  onSubmit?: () => Promise<void> | void;
}>(({ modalProps, data, prefill, bindToSiteId, onSubmit, modalCtrl }) => {
  const { t } = useTranslation();
  const [message, messageContext] = Message.useMessage();
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [provider, setProvider] = useState<DroidByokModelProvider>('anthropic');
  const [validatedSignature, setValidatedSignature] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalog, setCatalog] = useState<IDroidByokRemoteModel[]>([]);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [selectionMap, setSelectionMap] = useState<Record<string, DraftModelSelection>>({});
  const [importProgress, setImportProgress] = useState<IDroidByokImportProgress | null>(null);
  const pendingVerificationRef = useRef<IDroidByokVerificationResult | null>(null);
  // Monotonic counter used to ignore stale fetch-models responses — prevents
  // an earlier empty catalog from overwriting a later non-empty one when the
  // user rapid-clicks the Fetch button.
  const fetchSeqRef = useRef(0);

  const isEditing = Boolean(data);
  // Site-bound mode: add more models to an existing site via main-process
  // channels that reuse the stored API key (no plaintext key in renderer).
  // 站点绑定模式：通过主进程站点化通道复用已存 apiKey，不再要求用户重新输入。
  const isSiteBound = Boolean(bindToSiteId && !isEditing);
  const payload = useMemo<IDroidByokModelConfigInput>(
    () => ({
      baseUrl,
      apiKey,
      model,
      displayName,
      provider,
      ...(data?.id ? { existingId: data.id } : {}),
    }),
    [apiKey, baseUrl, data?.id, displayName, model, provider]
  );
  const normalizedPayload = useMemo(() => buildNormalizedPayload(payload), [payload]);
  const payloadSignature = useMemo(() => buildConnectionSignature(payload), [payload]);
  // In site-bound mode the API key lives server-side, so the "has credentials"
  // gate only requires a baseUrl (which itself is locked to the site). In
  // standalone mode we still require apiKey.
  const hasCredentials = isSiteBound ? Boolean(baseUrl.trim()) : Boolean(baseUrl.trim() && apiKey.trim());
  const hasRequiredFields = Boolean(normalizedPayload.baseUrl && normalizedPayload.apiKey && normalizedPayload.model);
  const hasValidatedCurrentValues = validatedSignature === payloadSignature;
  const canImport = !isEditing && hasCredentials && selectedModels.length > 0;

  useEffect(() => {
    if (!modalProps.visible) {
      return;
    }

    setBaseUrl(data?.baseUrl || prefill?.baseUrl || '');
    setApiKey(data?.apiKey || '');
    setModel(data?.model || '');
    setDisplayName(data?.displayName || '');
    setProvider(data?.provider || prefill?.provider || 'anthropic');
    setValidatedSignature(data ? buildConnectionSignature(data) : null);
    setCatalog([]);
    setSelectedModels([]);
    setSelectionMap({});
    setImportProgress(null);
    pendingVerificationRef.current = null;
  }, [data, modalProps.visible, prefill?.baseUrl, prefill?.provider]);

  useEffect(() => {
    const unsubscribe = ipcBridge.acpConversation.droidByokImportProgress.on((payload) => {
      setImportProgress(payload);
    });
    return () => {
      try {
        unsubscribe?.();
      } catch {
        // ignore
      }
    };
  }, []);

  useEffect(() => {
    const unsubscribe = ipcBridge.acpConversation.droidByokCapabilityDrift.on((payload) => {
      pendingVerificationRef.current = payload;
    });
    return () => {
      try {
        unsubscribe?.();
      } catch {
        // ignore
      }
    };
  }, []);

  const flushVerificationWarnings = () => {
    const verification = pendingVerificationRef.current;
    pendingVerificationRef.current = null;
    if (!verification) {
      return;
    }

    if (verification.unreachable) {
      const diagnosticKey =
        verification.cliDiagnosticCode === 'missing-platform-binary'
          ? 'settings.droidByok.warning.missingPlatformBinary'
          : verification.cliDiagnosticCode === 'cli-not-found'
            ? 'settings.droidByok.warning.cliNotFound'
            : verification.cliDiagnosticCode === 'probe-timeout'
              ? 'settings.droidByok.warning.probeTimeout'
              : verification.cliDiagnosticCode === 'cmd-shim-pipe-incompatible'
                ? 'settings.droidByok.warning.cmdShim'
                : 'settings.droidByok.warning.cliUnavailable';
      message.warning(t(diagnosticKey));
      return;
    }

    if (verification.missing.length > 0) {
      message.warning(
        t('settings.droidByok.warning.missingModels', {
          count: verification.missing.length,
        })
      );
    }
    if (verification.conflict.length > 0) {
      message.warning(
        t('settings.droidByok.warning.capabilityConflict', {
          count: verification.conflict.length,
        })
      );
    }
  };

  const handleFetchModels = async (refresh = false) => {
    if (!hasCredentials) {
      message.warning(t('settings.droidByok.fetchModelsRequired'));
      return;
    }

    const mySeq = fetchSeqRef.current + 1;
    fetchSeqRef.current = mySeq;
    setCatalogLoading(true);
    try {
      // Site-bound mode uses the main-process channel that reuses stored apiKey.
      // 站点绑定模式：走主进程站点化通道，apiKey 不会从 renderer 回传。
      const result = isSiteBound
        ? await ipcBridge.acpConversation.fetchDroidByokModelsForSite.invoke({
            siteId: bindToSiteId!,
            refresh,
          })
        : await ipcBridge.acpConversation.fetchDroidByokModels.invoke({
            baseUrl: baseUrl.trim(),
            apiKey: apiKey.trim(),
            refresh,
          });
      // Drop stale responses — a later fetch has already superseded us.
      if (fetchSeqRef.current !== mySeq) {
        return;
      }
      if (!result.success || !result.data?.catalog) {
        throw new Error(result.msg || t('settings.droidByok.fetchModelsFailed'));
      }

      const remoteModels = result.data.catalog.models || [];
      setCatalog(remoteModels);
      setSelectionMap((prev) => ({ ...toSelectionMap(remoteModels), ...prev }));
      if (remoteModels.length === 0) {
        message.warning(t('settings.droidByok.fetchReturnedEmpty'));
      } else if (refresh) {
        message.success(t('settings.droidByok.refreshSuccess'));
      }
    } catch (error) {
      if (fetchSeqRef.current !== mySeq) {
        return;
      }
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      if (fetchSeqRef.current === mySeq) {
        setCatalogLoading(false);
      }
    }
  };

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
      setDisplayName((current) => current.trim() || result.data.config.displayName);
      setProvider(result.data.config.provider);
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

  const handleSingleSave = async () => {
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
      pendingVerificationRef.current = null;
      const result = await ipcBridge.acpConversation.saveDroidByokConfig.invoke(normalizedPayload);
      if (!result.success || !result.data?.config) {
        throw new Error(result.msg || t('settings.droidByok.saveFailed'));
      }
      await onSubmit?.();
      message.success(t('settings.droidByok.saveSuccess'));
      flushVerificationWarnings();
      modalCtrl.close();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  const handleBatchImport = async () => {
    if (!canImport) {
      message.warning(t('settings.droidByok.selectModelsRequired'));
      return;
    }

    const catalogMap = new Map(catalog.map((item) => [item.model, item]));
    setImportProgress({ current: 0, total: selectedModels.length, model: '', status: 'probing' });
    setSubmitting(true);
    try {
      pendingVerificationRef.current = null;
      const modelsPayload = selectedModels.map((modelId) => ({
        model: modelId,
        displayName: selectionMap[modelId]?.displayName || `${modelId} [BYOK]`,
        provider: selectionMap[modelId]?.provider,
        supportedEndpointTypes: catalogMap.get(modelId)?.supportedEndpointTypes,
      }));
      // Site-bound mode uses the main-process channel that reuses stored apiKey.
      // 站点绑定模式：走主进程站点化通道，apiKey 不会从 renderer 回传。
      const result = isSiteBound
        ? await ipcBridge.acpConversation.importDroidByokConfigsIntoSite.invoke({
            siteId: bindToSiteId!,
            skipProbe: true,
            models: modelsPayload,
          })
        : await ipcBridge.acpConversation.importDroidByokConfigs.invoke({
            baseUrl: baseUrl.trim(),
            apiKey: apiKey.trim(),
            skipProbe: true,
            models: modelsPayload,
          });
      if (!result.success || !result.data) {
        throw new Error(result.msg || t('settings.droidByok.importFailed'));
      }

      await onSubmit?.();
      if (result.data.failed.length > 0) {
        message.warning(t('settings.droidByok.importPartialSuccess', { count: result.data.imported.length }));
      } else {
        message.success(t('settings.droidByok.importSuccess', { count: result.data.imported.length }));
      }
      flushVerificationWarnings();
      modalCtrl.close();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
      setImportProgress(null);
    }
  };

  const handleConfirm = async () => {
    if (isEditing) {
      await handleSingleSave();
      return;
    }

    await handleBatchImport();
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
      okButtonProps={{ disabled: isEditing ? !hasRequiredFields || !hasValidatedCurrentValues : !canImport }}
    >
      {messageContext}
      <div className='pt-4px pb-12px space-y-14px'>
        <div className='space-y-8px'>
          <div className='text-13px font-500 text-t-secondary'>{t('settings.baseUrl')}</div>
          <Input
            value={baseUrl}
            placeholder={t('settings.droidByok.baseUrlPlaceholder')}
            onChange={setBaseUrl}
            disabled={isSiteBound}
          />
          <div className='text-11px text-t-secondary leading-4'>{t('settings.droidByok.baseUrlTip')}</div>
        </div>

        {/* In site-bound mode the apiKey is reused from storage by the main process. */}
        {/* 站点绑定模式下 apiKey 由主进程复用，无需再次输入，也不再展示该输入框。 */}
        {isSiteBound ? (
          <div className='rounded-12px bg-[var(--fill-0)] px-12px py-10px text-12px text-t-secondary leading-5'>
            {t('settings.droidByok.site.useExistingKey')}
          </div>
        ) : (
          <div className='space-y-8px'>
            <div className='text-13px font-500 text-t-secondary'>{t('settings.apiKey')}</div>
            <Input.Password value={apiKey} visibilityToggle onChange={setApiKey} />
          </div>
        )}

        {isEditing ? (
          <>
            <div className='space-y-8px'>
              <div className='text-13px font-500 text-t-secondary'>{t('settings.droidByok.modelId')}</div>
              <Input value={model} placeholder={t('settings.droidByok.modelIdPlaceholder')} onChange={setModel} />
            </div>

            <div className='space-y-8px'>
              <div className='text-13px font-500 text-t-secondary'>{t('settings.droidByok.provider')}</div>
              <AionSelect value={provider} onChange={(value) => setProvider(value as DroidByokModelProvider)}>
                {PROVIDER_OPTIONS.map((item) => (
                  <AionSelect.Option key={item} value={item}>
                    {t(providerKey(item))}
                  </AionSelect.Option>
                ))}
              </AionSelect>
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
          </>
        ) : (
          <>
            <div className='flex items-center gap-8px flex-wrap'>
              <Button
                type='outline'
                shape='round'
                loading={catalogLoading}
                disabled={!hasCredentials}
                onClick={() => void handleFetchModels(false)}
              >
                {t('settings.droidByok.fetchModels')}
              </Button>
              <Button
                type='outline'
                shape='round'
                disabled={!hasCredentials || catalogLoading}
                onClick={() => void handleFetchModels(true)}
              >
                {t('settings.droidByok.refreshModels')}
              </Button>
              <Button
                type='outline'
                shape='round'
                disabled={catalog.length === 0}
                onClick={() => setSelectedModels(catalog.map((item) => item.model))}
              >
                {t('settings.droidByok.importAll')}
              </Button>
              {catalog.length > 0 && (
                <Tag size='small' color='arcoblue'>
                  {t('settings.droidByok.modelsFound', { count: catalog.length })}
                </Tag>
              )}
            </div>

            <div className='text-11px text-t-secondary leading-4'>{t('settings.droidByok.fetchModelsHint')}</div>

            {importProgress && importProgress.total > 0 ? (
              <div className='rounded-12px border border-[var(--color-border-2)] bg-[var(--fill-0)] px-12px py-10px space-y-6px'>
                <div className='flex items-center justify-between gap-8px'>
                  <span className='text-12px font-500 text-t-primary'>
                    {importProgress.status === 'persisting'
                      ? t('settings.droidByok.importPersisting')
                      : importProgress.status === 'done'
                        ? t('settings.droidByok.importDone')
                        : t('settings.droidByok.importProgressLabel', {
                            current: importProgress.current,
                            total: importProgress.total,
                          })}
                  </span>
                  {importProgress.model ? (
                    <span className='truncate text-11px text-t-secondary max-w-240px'>{importProgress.model}</span>
                  ) : null}
                </div>
                <Progress
                  size='small'
                  percent={
                    importProgress.total > 0 ? Math.round((importProgress.current / importProgress.total) * 100) : 0
                  }
                  status={importProgress.status === 'done' ? 'success' : undefined}
                />
              </div>
            ) : null}

            <div className='rounded-12px bg-[var(--fill-0)] px-12px py-10px'>
              {catalogLoading ? (
                <div className='flex items-center justify-center py-16px'>
                  <Spin />
                </div>
              ) : catalog.length === 0 ? (
                <div className='text-12px text-t-secondary'>{t('settings.droidByok.noRemoteModels')}</div>
              ) : (
                <div className='space-y-10px max-h-360px overflow-auto pr-4px'>
                  {catalog.map((item) => {
                    const draft = selectionMap[item.model] || {
                      model: item.model,
                      displayName: item.displayName,
                      provider: item.inferredProvider,
                    };
                    const checked = selectedModels.includes(item.model);

                    return (
                      <div
                        key={item.model}
                        className='rounded-10px border border-[var(--color-border-2)] px-10px py-10px space-y-8px'
                      >
                        <div className='flex items-start justify-between gap-10px'>
                          <Checkbox
                            checked={checked}
                            onChange={(value) => {
                              setSelectedModels((prev) =>
                                value
                                  ? Array.from(new Set([...prev, item.model]))
                                  : prev.filter((current) => current !== item.model)
                              );
                            }}
                          >
                            <span className='text-13px text-t-primary font-500'>{item.model}</span>
                          </Checkbox>
                          <Tag size='small' color='green'>
                            {t(providerKey(item.inferredProvider))}
                          </Tag>
                        </div>

                        <Input
                          value={draft.displayName}
                          placeholder={t('settings.droidByok.displayNamePlaceholder')}
                          onChange={(value) => {
                            setSelectionMap((prev) => ({
                              ...prev,
                              [item.model]: {
                                ...draft,
                                displayName: value,
                              },
                            }));
                          }}
                        />

                        <AionSelect
                          value={draft.provider}
                          disabled={!checked}
                          onChange={(value) => {
                            setSelectionMap((prev) => ({
                              ...prev,
                              [item.model]: {
                                ...draft,
                                provider: value as DroidByokModelProvider,
                              },
                            }));
                          }}
                        >
                          {PROVIDER_OPTIONS.map((providerOption) => (
                            <AionSelect.Option key={`${item.model}-${providerOption}`} value={providerOption}>
                              {t(providerKey(providerOption))}
                            </AionSelect.Option>
                          ))}
                        </AionSelect>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </AionModal>
  );
});

export default FactoryDroidByokModal;
