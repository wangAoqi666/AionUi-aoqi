/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { DroidCliInstallProgress, DroidCliUpdateInfo, DroidStatusInfo } from '@/common/types/acpTypes';
import DroidLogo from '@/renderer/assets/logos/brand/droid.svg';
import { Alert, Badge, Button, Message, Modal, Spin, Typography } from '@arco-design/web-react';
import { Download, Refresh, Setting } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';

const CLI_UPDATE_CHECK_TIMEOUT_MS = 8000;
const STATUS_CACHE_TTL_MS = 60 * 1000;
const CLI_UPDATE_CACHE_TTL_MS = 10 * 60 * 1000;

type TimedCache<T> = {
  data: T;
  timestamp: number;
};

let localAgentsStatusCache: TimedCache<DroidStatusInfo> | null = null;
let localAgentsCliUpdateCache: TimedCache<DroidCliUpdateInfo> | null = null;

function readCache<T>(cache: TimedCache<T> | null, ttlMs: number): T | null {
  if (!cache) {
    return null;
  }

  return Date.now() - cache.timestamp <= ttlMs ? cache.data : null;
}

export function resetLocalAgentsCache(): void {
  localAgentsStatusCache = null;
  localAgentsCliUpdateCache = null;
}

function getBadgeStatus(loginStatus: DroidStatusInfo['loginStatus']): 'success' | 'warning' | 'error' | 'processing' {
  switch (loginStatus) {
    case 'authenticated':
      return 'success';
    case 'unauthenticated':
      return 'warning';
    case 'unavailable':
    case 'error':
      return 'error';
    default:
      return 'processing';
  }
}

function getStatusLabel(
  t: ReturnType<typeof useTranslation>['t'],
  loginStatus: DroidStatusInfo['loginStatus']
): string {
  switch (loginStatus) {
    case 'authenticated':
      return t('settings.agentManagement.statusAuthenticated');
    case 'unauthenticated':
      return t('settings.agentManagement.statusUnauthenticated');
    case 'unavailable':
      return t('settings.agentManagement.statusUnavailable');
    case 'error':
    default:
      return t('settings.agentManagement.statusError');
  }
}

function getCliSourceLabel(t: ReturnType<typeof useTranslation>['t'], cliSource: DroidStatusInfo['cliSource']): string {
  switch (cliSource) {
    case 'bundled':
      return t('settings.agentManagement.cliSourceBundled');
    case 'custom':
      return t('settings.agentManagement.cliSourceCustom');
    case 'system':
    default:
      return t('settings.agentManagement.cliSourceSystem');
  }
}

function getRuntimeLabel(
  t: ReturnType<typeof useTranslation>['t'],
  available: boolean | undefined,
  isLoading: boolean,
  hasError: boolean
): string {
  if (isLoading) {
    return t('settings.agentManagement.runtimeChecking');
  }

  if (hasError) {
    return t('settings.agentManagement.statusError');
  }

  return available ? t('settings.agentManagement.runtimeAvailable') : t('settings.agentManagement.runtimeUnavailable');
}

function getLoginLabel(
  t: ReturnType<typeof useTranslation>['t'],
  status: DroidStatusInfo['loginStatus'] | undefined,
  available: boolean | undefined,
  isLoading: boolean
): string {
  if (isLoading) {
    return t('settings.agentManagement.runtimeChecking');
  }

  if (!available) {
    return t('settings.agentManagement.loginStatusWaitingRuntime');
  }

  return getStatusLabel(t, status || 'error');
}

function getCardToneClass(tone: 'success' | 'warning' | 'error' | 'processing' | 'neutral'): string {
  switch (tone) {
    case 'success':
      return 'border-success-3 bg-success-1';
    case 'warning':
      return 'border-warning-3 bg-warning-1';
    case 'error':
      return 'border-danger-3 bg-danger-1';
    case 'processing':
      return 'border-primary-3 bg-primary-1';
    default:
      return 'border-border-2 bg-aou-1';
  }
}

function getRuntimeTone(
  available: boolean | undefined,
  isLoading: boolean,
  hasError: boolean
): 'success' | 'warning' | 'error' | 'processing' {
  if (isLoading) {
    return 'processing';
  }

  if (hasError) {
    return 'error';
  }

  return available ? 'success' : 'warning';
}

function getLoginTone(
  status: DroidStatusInfo['loginStatus'] | undefined,
  available: boolean | undefined,
  isLoading: boolean
): 'success' | 'warning' | 'error' | 'processing' | 'neutral' {
  if (isLoading) {
    return 'processing';
  }

  if (!available) {
    return 'neutral';
  }

  return getBadgeStatus(status || 'error');
}

function getUpdateRecommendation(
  t: ReturnType<typeof useTranslation>['t'],
  source: DroidCliUpdateInfo['source'] | DroidStatusInfo['cliSource'] | undefined
): string | null {
  switch (source) {
    case 'bundled':
      return t('settings.agentManagement.cliUpdateBundledAction');
    case 'custom':
      return t('settings.agentManagement.cliUpdateCustomAction');
    case 'system':
      return t('settings.agentManagement.cliUpdateSystemAction');
    default:
      return null;
  }
}

function getCliUpdateAlert(
  t: ReturnType<typeof useTranslation>['t'],
  info: DroidCliUpdateInfo | null,
  error: string | null
): { type: 'success' | 'warning' | 'error' | 'info'; title: string; details: string[] } | null {
  if (error) {
    return {
      type: 'error',
      title: error,
      details: [],
    };
  }

  if (!info) {
    return null;
  }

  const details = [
    info.currentVersion
      ? `${t('settings.agentManagement.currentCliVersion')}: ${info.currentVersion}`
      : t('settings.agentManagement.cliUpdateLocalMissing'),
    info.latestVersion ? `${t('settings.agentManagement.latestCliVersion')}: ${info.latestVersion}` : null,
    info.registry ? `${t('settings.agentManagement.registrySource')}: ${info.registry}` : null,
    getUpdateRecommendation(t, info.source),
  ].filter((item): item is string => Boolean(item));

  if (info.updateAvailable && info.currentVersion && info.latestVersion) {
    return {
      type: 'warning',
      title: t('settings.agentManagement.cliUpdateAvailable', {
        current: info.currentVersion,
        latest: info.latestVersion,
      }),
      details,
    };
  }

  if (info.currentVersion && info.latestVersion) {
    return {
      type: 'success',
      title: t('settings.agentManagement.cliUpdateUpToDate', {
        version: info.latestVersion,
      }),
      details,
    };
  }

  return {
    type: 'info',
    title: t('settings.agentManagement.cliUpdateUnavailable'),
    details,
  };
}

const InfoCard: React.FC<{
  label: string;
  value: React.ReactNode;
  helper?: React.ReactNode;
  tone?: 'success' | 'warning' | 'error' | 'processing' | 'neutral';
  valueClassName?: string;
  className?: string;
}> = ({ label, value, helper, tone = 'neutral', valueClassName = '', className = '' }) => {
  return (
    <div
      className={`flex min-h-0 flex-col gap-10px rounded-16px border border-solid px-16px py-14px ${getCardToneClass(tone)} ${className}`}
    >
      <Typography.Text className='text-12px text-t-secondary'>{label}</Typography.Text>
      <div className={valueClassName}>{value}</div>
      {helper ? <div className='text-12px leading-18px text-t-secondary'>{helper}</div> : null}
    </div>
  );
};

const LocalAgents: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const droidName = t('settings.droidByok.factoryDroid');
  const hasAutoCheckedRef = useRef(false);
  const cachedStatus = readCache(localAgentsStatusCache, STATUS_CACHE_TTL_MS);
  const cachedCliUpdate = readCache(localAgentsCliUpdateCache, CLI_UPDATE_CACHE_TTL_MS);
  const [cliUpdateChecking, setCliUpdateChecking] = useState(false);
  const [cliUpdateInfo, setCliUpdateInfo] = useState<DroidCliUpdateInfo | null>(() => cachedCliUpdate);
  const [cliUpdateError, setCliUpdateError] = useState<string | null>(null);
  const [installBusy, setInstallBusy] = useState(false);
  const [installLogs, setInstallLogs] = useState<DroidCliInstallProgress[]>([]);
  const [installVisible, setInstallVisible] = useState(false);
  const { data, error, isLoading, isValidating, mutate } = useSWR(
    'acp.droid.status.settings',
    async () => {
      const result = await ipcBridge.acpConversation.getDroidStatus.invoke();
      if (!result.success || !result.data) {
        throw new Error(result.msg || t('settings.agentManagement.statusLoadFailed'));
      }

      return result.data;
    },
    {
      fallbackData: cachedStatus || undefined,
      revalidateOnFocus: false,
      onSuccess: (status) => {
        localAgentsStatusCache = {
          data: status,
          timestamp: Date.now(),
        };
      },
    }
  );

  const detailsMessage = error instanceof Error ? error.message : data?.error;
  const bundledCliHint = data?.cliSource === 'bundled' ? t('settings.agentManagement.bundledRuntimeHint') : null;
  const runtimeTone = getRuntimeTone(data?.available, isLoading, Boolean(error));
  const loginTone = getLoginTone(data?.loginStatus, data?.available, isLoading);
  const runtimeLabel = getRuntimeLabel(t, data?.available, isLoading, Boolean(error));
  const loginLabel = getLoginLabel(t, data?.loginStatus, data?.available, isLoading);
  const cliUpdateAlert = useMemo(
    () => getCliUpdateAlert(t, cliUpdateInfo, cliUpdateError),
    [cliUpdateError, cliUpdateInfo, t]
  );

  const runCliUpdateCheck = useCallback(
    async ({
      background = false,
      silentOnLatest = false,
      suppressErrorToast = false,
      suppressErrorState = false,
      persistNonUpdateResult = true,
    }: {
      background?: boolean;
      silentOnLatest?: boolean;
      suppressErrorToast?: boolean;
      suppressErrorState?: boolean;
      persistNonUpdateResult?: boolean;
    } = {}) => {
      if (!background) {
        setCliUpdateChecking(true);
      }
      setCliUpdateError(null);

      try {
        const result = await new Promise<
          Awaited<ReturnType<typeof ipcBridge.acpConversation.checkDroidCliUpdate.invoke>>
        >((resolve, reject) => {
          const timeoutId = window.setTimeout(() => {
            reject(new Error(t('settings.agentManagement.cliUpdateCheckTimeout')));
          }, CLI_UPDATE_CHECK_TIMEOUT_MS);

          void ipcBridge.acpConversation.checkDroidCliUpdate
            .invoke()
            .then(resolve)
            .catch(reject)
            .finally(() => window.clearTimeout(timeoutId));
        });

        if (!result.success || !result.data) {
          throw new Error(result.msg || t('settings.agentManagement.cliUpdateCheckFailed'));
        }

        if (result.data.updateAvailable || persistNonUpdateResult) {
          localAgentsCliUpdateCache = {
            data: result.data,
            timestamp: Date.now(),
          };
        } else {
          localAgentsCliUpdateCache = null;
        }
        setCliUpdateInfo(result.data.updateAvailable || persistNonUpdateResult ? result.data : null);
        const alert = getCliUpdateAlert(t, result.data, null);
        if (alert) {
          if (alert.type === 'warning') {
            Message.warning(alert.title);
          } else if (!silentOnLatest) {
            if (alert.type === 'success') {
              Message.success(alert.title);
            } else {
              Message.info(alert.title);
            }
          }
        }
      } catch (checkError) {
        const message =
          checkError instanceof Error ? checkError.message : t('settings.agentManagement.cliUpdateCheckFailed');
        if (!suppressErrorState) {
          setCliUpdateInfo(null);
          setCliUpdateError(message);
        }
        if (!suppressErrorToast) {
          Message.error(message);
        }
      } finally {
        if (!background) {
          setCliUpdateChecking(false);
        }
      }
    },
    [t]
  );

  useEffect(() => {
    if (hasAutoCheckedRef.current || cachedCliUpdate || isLoading || error || !data?.available || !data.cliVersion) {
      return;
    }

    hasAutoCheckedRef.current = true;
    void runCliUpdateCheck({
      background: true,
      silentOnLatest: true,
      suppressErrorToast: true,
      suppressErrorState: true,
      persistNonUpdateResult: false,
    });
  }, [data?.available, data?.cliVersion, error, isLoading, runCliUpdateCheck]);

  const handleCheckCliUpdate = async () => {
    await runCliUpdateCheck();
  };

  useEffect(() => {
    const unsubscribe = ipcBridge.acpConversation.droidCliInstallProgress.on((payload) => {
      setInstallLogs((prev) => [...prev, payload].slice(-200));
    });
    return () => {
      try {
        unsubscribe?.();
      } catch {
        // ignore
      }
    };
  }, []);

  const handleInstallOrUpdateCli = async (mode: 'install' | 'update') => {
    setInstallBusy(true);
    setInstallLogs([]);
    setInstallVisible(true);
    try {
      const detection = await ipcBridge.acpConversation.detectDroidNodeRuntime.invoke();
      if (!detection.success || !detection.data) {
        Message.error(detection.msg || t('settings.agentManagement.nodeDetectionFailed'));
        setInstallLogs((prev) => [...prev, { phase: 'error', message: detection.msg || 'Node detection failed' }]);
        return;
      }

      if (!detection.data.available || !detection.data.meetsMinimum) {
        const msg =
          detection.data.recommendedAction === 'installNode'
            ? t('settings.agentManagement.nodeMissingHint', { url: detection.data.downloadUrl })
            : t('settings.agentManagement.nodeTooOldHint', {
                version: detection.data.nodeVersion || '-',
                url: detection.data.downloadUrl,
              });
        Message.warning(msg);
        setInstallLogs((prev) => [...prev, { phase: 'error', message: msg }]);
        return;
      }

      const result = await ipcBridge.acpConversation.installDroidCli.invoke({ mode });
      if (result.success && result.data?.success) {
        Message.success(
          mode === 'install'
            ? t('settings.agentManagement.installCliSuccess')
            : t('settings.agentManagement.updateCliSuccess')
        );
        void mutate();
        void runCliUpdateCheck({ background: true, silentOnLatest: true, suppressErrorToast: true });
      } else {
        Message.error(
          result.data?.message ||
            result.msg ||
            (mode === 'install'
              ? t('settings.agentManagement.installCliFailed')
              : t('settings.agentManagement.updateCliFailed'))
        );
      }
    } catch (err) {
      Message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setInstallBusy(false);
    }
  };

  return (
    <div className='flex flex-col gap-16px px-16px py-16px'>
      <div className='flex flex-col gap-16px rounded-20px border border-solid border-border-2 bg-2 p-16px md:p-20px'>
        <div className='rounded-18px border border-solid border-border-2 bg-aou-1 px-18px py-18px md:px-20px md:py-20px'>
          <div className='flex flex-col gap-18px xl:flex-row xl:items-start xl:justify-between'>
            <div className='min-w-0 flex-1'>
              <div className='flex min-w-0 items-start gap-14px'>
                <div className='flex h-56px w-56px shrink-0 items-center justify-center rounded-16px border border-solid border-border-2 bg-2 p-10px'>
                  <img src={DroidLogo} alt={droidName} className='h-full w-full object-contain' />
                </div>
                <div className='min-w-0 flex-1'>
                  <Typography.Text className='block text-20px font-600 text-t-primary'>{droidName}</Typography.Text>
                  <Typography.Text className='mt-6px block text-12px leading-18px text-t-secondary'>
                    {t('settings.agentManagement.factoryDroidCardDescription')}
                  </Typography.Text>
                </div>
              </div>

              <div className='mt-16px flex flex-wrap gap-8px'>
                <span
                  className={`inline-flex items-center rounded-full border border-solid px-10px py-5px text-12px font-500 ${getCardToneClass(runtimeTone)}`}
                >
                  {runtimeLabel}
                </span>
                <span
                  className={`inline-flex items-center rounded-full border border-solid px-10px py-5px text-12px font-500 ${getCardToneClass(loginTone)}`}
                >
                  {loginLabel}
                </span>
                <span className='inline-flex items-center rounded-full border border-solid border-border-2 bg-2 px-10px py-5px text-12px font-500 text-t-primary'>
                  {getCliSourceLabel(t, data?.cliSource || 'system')}
                </span>
              </div>
            </div>

            <div className='grid gap-12px sm:grid-cols-3 xl:min-w-360px xl:max-w-420px xl:flex-1'>
              <InfoCard
                label={t('settings.agentManagement.cliVersion')}
                value={
                  <Typography.Text className='text-20px font-600 leading-none text-t-primary'>
                    {data?.cliVersion || '-'}
                  </Typography.Text>
                }
                helper={data?.cliPath || '-'}
              />
              <InfoCard
                label={t('settings.agentManagement.sdkVersion')}
                value={
                  <Typography.Text className='text-20px font-600 leading-none text-t-primary'>
                    {data?.sdkVersion || '-'}
                  </Typography.Text>
                }
              />
              <InfoCard
                label={t('settings.agentManagement.protocolVersion')}
                value={
                  <Typography.Text className='text-20px font-600 leading-none text-t-primary'>
                    {data?.protocolVersion || '-'}
                  </Typography.Text>
                }
              />
            </div>
          </div>

          <div className='mt-16px grid gap-12px md:grid-cols-3'>
            <InfoCard
              label={t('settings.agentManagement.runtimeStatus')}
              tone={runtimeTone}
              value={
                isLoading ? (
                  <Spin />
                ) : (
                  <Typography.Text className='text-22px font-600 text-t-primary'>{runtimeLabel}</Typography.Text>
                )
              }
              helper={detailsMessage || bundledCliHint || data?.cliPath || '-'}
            />
            <InfoCard
              label={t('settings.agentManagement.loginStatus')}
              tone={loginTone}
              value={
                isLoading ? (
                  <Spin />
                ) : (
                  <Badge
                    status={data?.available ? getBadgeStatus(data?.loginStatus || 'error') : 'default'}
                    text={loginLabel}
                  />
                )
              }
              helper={
                data?.available
                  ? getCliSourceLabel(t, data?.cliSource || 'system')
                  : t('settings.agentManagement.loginStatusWaitingRuntime')
              }
            />
            <InfoCard
              label={t('settings.agentManagement.modelCount')}
              value={
                <Typography.Text className='text-28px font-600 leading-none text-t-primary'>
                  {data?.available ? (data?.modelCount ?? 0) : '--'}
                </Typography.Text>
              }
              helper={data?.available ? t('settings.agentManagement.statusAuthenticated') : runtimeLabel}
            />
          </div>
        </div>

        <div className='grid gap-16px xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]'>
          <div className='rounded-18px border border-solid border-border-2 bg-aou-1 px-18px py-18px md:px-20px md:py-20px'>
            <div className='flex flex-col gap-14px'>
              <div>
                <Typography.Text className='text-16px font-600 text-t-primary'>
                  {t('settings.agentManagement.runtimeDetails')}
                </Typography.Text>
              </div>

              <div className='grid gap-10px'>
                <InfoCard
                  label={t('settings.agentManagement.cliSource')}
                  value={
                    <Typography.Text className='text-18px font-600 text-t-primary'>
                      {getCliSourceLabel(t, data?.cliSource || 'system')}
                    </Typography.Text>
                  }
                />
                <InfoCard
                  label={t('settings.agentManagement.cliPath')}
                  value={
                    <Typography.Text className='break-all text-14px leading-22px text-t-primary'>
                      {data?.cliPath || '-'}
                    </Typography.Text>
                  }
                />
              </div>

              {detailsMessage ? <Alert type='error' content={detailsMessage} /> : null}
              {!detailsMessage && bundledCliHint ? <Alert type='info' content={bundledCliHint} /> : null}
            </div>
          </div>

          <div className='rounded-18px border border-solid border-border-2 bg-aou-1 px-18px py-18px md:px-20px md:py-20px'>
            <div className='flex h-full flex-col gap-14px'>
              <Typography.Text className='text-16px font-600 text-t-primary'>
                {t('settings.agentManagement.actionCenter')}
              </Typography.Text>

              <div className='flex flex-col gap-10px'>
                <Button
                  type='primary'
                  icon={<Refresh theme='outline' size='14' />}
                  loading={isValidating && !isLoading}
                  onClick={() => void mutate()}
                >
                  {t('settings.agentManagement.refreshStatus')}
                </Button>
                {!data?.available || data?.cliSource !== 'system' ? null : null}
                {data?.available && cliUpdateInfo?.updateAvailable ? null : null}
                <Button
                  type='outline'
                  icon={<Setting theme='outline' size='14' />}
                  onClick={() => navigate('/settings/model')}
                >
                  {t('settings.agentManagement.openModelSettings')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <Modal
        title={t('settings.agentManagement.installCliTitle')}
        visible={installVisible}
        onCancel={() => {
          if (!installBusy) setInstallVisible(false);
        }}
        footer={
          <Button type='primary' disabled={installBusy} onClick={() => setInstallVisible(false)}>
            {t('common.close')}
          </Button>
        }
        maskClosable={!installBusy}
        style={{ width: 600 }}
      >
        <div className='max-h-360px overflow-auto rounded-8px bg-[var(--fill-0)] p-12px font-mono text-12px leading-20px text-t-primary'>
          {installLogs.length === 0 ? (
            <div className='text-t-secondary'>{t('settings.agentManagement.installCliPending')}</div>
          ) : (
            installLogs.map((log, idx) => (
              <div
                key={`${idx}-${log.message.slice(0, 40)}`}
                className={log.phase === 'error' ? 'text-color-danger' : ''}
              >
                [{log.phase}] {log.message}
              </div>
            ))
          )}
        </div>
      </Modal>
    </div>
  );
};

export default LocalAgents;
