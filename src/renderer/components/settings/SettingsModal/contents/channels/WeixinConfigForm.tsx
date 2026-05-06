/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IChannelPairingRequest, IChannelPluginStatus, IChannelUser } from '@process/channels/types';
import { acpConversation, channel } from '@/common/adapter/ipcBridge';
import DroidChannelRuntimeSettings from '@/renderer/components/settings/DroidChannelRuntimeSettings';
import {
  DEFAULT_CHANNEL_CONVERSATION_AGENT,
  getChannelConversationAgentKey,
  resolveChannelConversationAgentSelection,
  type ChannelConversationAgentOption,
} from '@/renderer/components/settings/channelConversationAgentOptions';
import { useOptionalConversationHistoryContext } from '@/renderer/hooks/context/ConversationHistoryContext';
import GeminiModelSelector from '@/renderer/pages/conversation/platforms/gemini/GeminiModelSelector';
import DroidChannelModelSelector from './DroidChannelModelSelector';
import type { GeminiModelSelection } from '@/renderer/pages/conversation/platforms/gemini/useGeminiModelSelection';
import {
  buildPublishedWorkspaceOptions,
  rememberPublishedWorkspace,
} from '@/renderer/utils/workspace/publishedWorkspaceOptions';
import { Button, Dropdown, Empty, Menu, Message, Select, Spin, Tooltip } from '@arco-design/web-react';
import { CheckOne, CloseOne, Copy, Delete, Down, Refresh } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { QRCodeSVG } from 'qrcode.react';
import { loadChannelInstanceSettings, updateChannelInstanceSettings } from './channelInstanceSettings';
import { useChannelInstanceModelSelection } from './useChannelInstanceModelSelection';

type LoginState = 'idle' | 'loading_qr' | 'showing_qr' | 'scanned' | 'connected';

/**
 * Preference row component (local, mirrors other config forms)
 */
const PreferenceRow: React.FC<{
  label: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}> = ({ label, description, children }) => (
  <div className='flex items-center justify-between gap-24px py-12px'>
    <div className='flex-1'>
      <span className='text-14px text-t-primary'>{label}</span>
      {description && <div className='text-12px text-t-tertiary mt-2px'>{description}</div>}
    </div>
    <div className='flex items-center'>{children}</div>
  </div>
);

const SectionHeader: React.FC<{ title: string; action?: React.ReactNode }> = ({ title, action }) => (
  <div className='flex items-center justify-between mb-12px'>
    <h3 className='text-14px font-500 text-t-primary m-0'>{title}</h3>
    {action}
  </div>
);

interface WeixinConfigFormProps {
  pluginId?: string;
  pluginStatus: IChannelPluginStatus | null;
  modelSelection?: GeminiModelSelection;
  onStatusChange: (status: IChannelPluginStatus | null) => void;
}

const getRemainingTime = (expiresAt: number) => {
  const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000 / 60));
  return `${remaining} min`;
};

const formatTime = (timestamp: number) => new Date(timestamp).toLocaleString();

const WeixinConfigForm: React.FC<WeixinConfigFormProps> = ({
  pluginId = 'weixin_default',
  pluginStatus,
  modelSelection: externalModelSelection,
  onStatusChange,
}) => {
  const { t } = useTranslation();
  const conversationHistory = useOptionalConversationHistoryContext();
  const instanceModelSelection = useChannelInstanceModelSelection(pluginId, 'weixin');
  const modelSelection = externalModelSelection ?? instanceModelSelection;

  const [loginState, setLoginState] = useState<LoginState>(
    pluginStatus?.hasToken && pluginStatus?.enabled ? 'connected' : 'idle'
  );
  // In Electron mode this holds a base64 data URL; in WebUI mode it holds the raw QR ticket string.
  const [qrcodeDataUrl, setQrcodeDataUrl] = useState<string | null>(null);
  const [isWebUIMode, setIsWebUIMode] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Pairing state
  const [pairingLoading, setPairingLoading] = useState(false);
  const [usersLoading, setUsersLoading] = useState(false);
  const [pendingPairings, setPendingPairings] = useState<IChannelPairingRequest[]>([]);
  const [authorizedUsers, setAuthorizedUsers] = useState<IChannelUser[]>([]);
  const [instanceWorkspace, setInstanceWorkspace] = useState('');

  // Agent selection
  const [availableAgents, setAvailableAgents] = useState<ChannelConversationAgentOption[]>([
    DEFAULT_CHANNEL_CONVERSATION_AGENT,
  ]);
  const [selectedAgent, setSelectedAgent] = useState<ChannelConversationAgentOption>(
    DEFAULT_CHANNEL_CONVERSATION_AGENT
  );
  const workspaceOptions = useMemo(
    () =>
      buildPublishedWorkspaceOptions(conversationHistory?.conversations ?? [], t, {
        includePaths: instanceWorkspace ? [instanceWorkspace] : [],
      }),
    [conversationHistory?.conversations, instanceWorkspace, t]
  );

  // Close EventSource on unmount to prevent connection leaks.
  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };
  }, []);

  // Sync connected state when pluginStatus changes externally.
  // Require enabled to be true so that a post-disable pluginStatusChanged event
  // (which still carries hasToken: true but enabled: false) does not flip back to connected.
  useEffect(() => {
    if (pluginStatus?.hasToken && pluginStatus?.enabled && loginState === 'idle') {
      setLoginState('connected');
    }
  }, [pluginStatus, loginState]);

  const loadPendingPairings = useCallback(
    async (silent = false) => {
      if (!silent) setPairingLoading(true);
      try {
        const result = await channel.getPendingPairings.invoke();
        if (result.success && result.data) {
          setPendingPairings(result.data.filter((p) => p.platformType === 'weixin' && p.pluginId === pluginId));
        }
      } catch (error) {
        console.error('[WeixinConfig] Failed to load pending pairings:', error);
      } finally {
        if (!silent) setPairingLoading(false);
      }
    },
    [pluginId]
  );

  const loadAuthorizedUsers = useCallback(
    async (silent = false) => {
      if (!silent) setUsersLoading(true);
      try {
        const result = await channel.getAuthorizedUsers.invoke();
        if (result.success && result.data) {
          setAuthorizedUsers(result.data.filter((u) => u.platformType === 'weixin' && u.pluginId === pluginId));
        }
      } catch (error) {
        console.error('[WeixinConfig] Failed to load authorized users:', error);
      } finally {
        if (!silent) setUsersLoading(false);
      }
    },
    [pluginId]
  );

  const pluginEnabled = !!pluginStatus?.enabled;
  const pluginConnected = !!pluginStatus?.connected;
  useEffect(() => {
    void loadPendingPairings();
    void loadAuthorizedUsers();
  }, [loadPendingPairings, loadAuthorizedUsers, pluginEnabled, pluginConnected]);

  // Background polling: while the plugin is enabled and the Settings page is open,
  // re-fetch pending pairings every 5s so new users' pairing requests appear even
  // when the live IPC event was missed.
  useEffect(() => {
    if (!pluginEnabled) return;
    const timer = setInterval(() => {
      void loadPendingPairings(true);
    }, 5000);
    return () => clearInterval(timer);
  }, [pluginEnabled, loadPendingPairings]);

  useEffect(() => {
    const loadWorkspace = async () => {
      const settings = await loadChannelInstanceSettings(pluginId, 'weixin');
      setInstanceWorkspace(settings.workspace || '');
    };

    void loadWorkspace();
  }, [pluginId]);

  // Listen for incoming weixin pairing requests
  useEffect(() => {
    const unsubscribe = channel.pairingRequested.on((request) => {
      if (request.platformType !== 'weixin' || request.pluginId !== pluginId) return;
      setPendingPairings((prev) => {
        const exists = prev.some((p) => p.code === request.code);
        if (exists) return prev;
        return [request, ...prev];
      });
    });
    return () => unsubscribe();
  }, [pluginId]);

  // Listen for user authorization
  useEffect(() => {
    const unsubscribe = channel.userAuthorized.on((user) => {
      if (user.platformType !== 'weixin' || user.pluginId !== pluginId) return;
      setAuthorizedUsers((prev) => {
        const exists = prev.some((u) => u.id === user.id);
        if (exists) return prev;
        return [user, ...prev];
      });
      setPendingPairings((prev) => prev.filter((p) => p.platformUserId !== user.platformUserId));
    });
    return () => unsubscribe();
  }, [pluginId]);

  const handleApprovePairing = async (code: string) => {
    try {
      const result = await channel.approvePairing.invoke({ code });
      if (result.success) {
        Message.success(t('settings.assistant.pairingApproved', 'Pairing approved'));
        await loadPendingPairings();
        await loadAuthorizedUsers();
      } else {
        Message.error(result.msg || t('settings.assistant.approveFailed', 'Failed to approve pairing'));
      }
    } catch (error) {
      Message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const handleRejectPairing = async (code: string) => {
    try {
      const result = await channel.rejectPairing.invoke({ code });
      if (result.success) {
        Message.info(t('settings.assistant.pairingRejected', 'Pairing rejected'));
        await loadPendingPairings();
      } else {
        Message.error(result.msg || t('settings.assistant.rejectFailed', 'Failed to reject pairing'));
      }
    } catch (error) {
      Message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const handleRevokeUser = async (userId: string) => {
    try {
      const result = await channel.revokeUser.invoke({ userId });
      if (result.success) {
        Message.success(t('settings.assistant.userRevoked', 'User access revoked'));
        await loadAuthorizedUsers();
      } else {
        Message.error(result.msg || t('settings.assistant.revokeFailed', 'Failed to revoke user'));
      }
    } catch (error) {
      Message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const copyToClipboard = (text: string) => {
    void navigator.clipboard.writeText(text);
    Message.success(t('common.copySuccess', 'Copied'));
  };

  // Load agents + saved selection
  useEffect(() => {
    const load = async () => {
      try {
        const [agentsResp, saved] = await Promise.all([
          acpConversation.getAvailableAgents.invoke(),
          loadChannelInstanceSettings(pluginId, 'weixin').then((settings) => settings.agent),
        ]);
        const resolved = resolveChannelConversationAgentSelection(
          saved,
          agentsResp.success && agentsResp.data
            ? agentsResp.data.map((agent) => ({
                backend: agent.backend,
                name: agent.name,
                customAgentId: agent.customAgentId,
                isPreset: agent.isPreset,
                isExtension: agent.isExtension,
              }))
            : undefined
        );
        setAvailableAgents(resolved.availableAgents);
        setSelectedAgent(resolved.selectedAgent);

        if (resolved.shouldPersistSelection) {
          await updateChannelInstanceSettings(pluginId, (current) => ({
            ...current,
            agent: resolved.selectedAgent,
          }));
          await channel.syncChannelSettings
            .invoke({ platform: 'weixin', pluginId, agent: resolved.selectedAgent })
            .catch((err) => console.warn('[WeixinConfig] syncChannelSettings failed:', err));
        }
      } catch (error) {
        console.error('[WeixinConfig] Failed to load agents:', error);
      }
    };
    void load();
  }, [pluginId]);

  const persistSelectedAgent = async (agent: ChannelConversationAgentOption, showSuccessMessage = true) => {
    try {
      await updateChannelInstanceSettings(pluginId, (current) => ({
        ...current,
        agent,
      }));
      await channel.syncChannelSettings
        .invoke({ platform: 'weixin', pluginId, agent })
        .catch((err) => console.warn('[WeixinConfig] syncChannelSettings failed:', err));
      if (showSuccessMessage) {
        Message.success(t('settings.assistant.agentSwitched', 'Agent switched successfully'));
      }
    } catch (error) {
      console.error('[WeixinConfig] Failed to save agent:', error);
      Message.error(t('common.saveFailed', 'Failed to save'));
    }
  };

  const enableWeixinPlugin = async (accountId: string, botToken: string) => {
    const enableResult = await channel.enablePlugin.invoke({
      pluginId,
      config: { accountId, botToken },
    });
    if (enableResult.success) {
      Message.success(t('settings.weixin.pluginEnabled', 'WeChat channel enabled'));
      const statusResult = await channel.getPluginStatus.invoke();
      if (statusResult.success && statusResult.data) {
        const weixinPlugin = statusResult.data.find((p) => p.id === pluginId);
        onStatusChange(weixinPlugin || null);
      }
      setLoginState('connected');
    } else {
      Message.error(enableResult.msg || t('settings.weixin.enableFailed', 'Failed to enable WeChat plugin'));
      setLoginState('idle');
    }
  };

  const handleLoginWebUI = () => {
    setIsWebUIMode(true);
    setLoginState('loading_qr');
    setQrcodeDataUrl(null);

    const es = new EventSource('/api/channel/weixin/login', { withCredentials: true });
    eventSourceRef.current = es;

    es.addEventListener('qr', (e: MessageEvent) => {
      const { qrcodeData } = JSON.parse(e.data) as { qrcodeData: string };
      setQrcodeDataUrl(qrcodeData);
      setLoginState('showing_qr');
    });

    es.addEventListener('scanned', () => {
      setLoginState('scanned');
    });

    es.addEventListener('done', (e: MessageEvent) => {
      es.close();
      const { accountId, botToken } = JSON.parse(e.data) as { accountId: string; botToken: string };
      enableWeixinPlugin(accountId, botToken).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        Message.error(msg || t('settings.weixin.enableFailed', 'Failed to enable WeChat plugin'));
        setLoginState('idle');
        setQrcodeDataUrl(null);
      });
    });

    es.addEventListener('error', (e: MessageEvent) => {
      es.close();
      const msg = e.data ? ((JSON.parse(e.data) as { message?: string }).message ?? '') : '';
      if (msg.toLowerCase().includes('expired') || msg.toLowerCase().includes('too many')) {
        Message.warning(t('settings.weixin.loginExpired', 'QR code expired, please try again'));
      } else {
        Message.error(t('settings.weixin.loginError', 'WeChat login failed'));
      }
      setLoginState('idle');
      setQrcodeDataUrl(null);
    });
  };

  const handleLogin = async () => {
    if (!window.electronAPI?.weixinLoginStart) {
      handleLoginWebUI();
      return;
    }

    setLoginState('loading_qr');
    setQrcodeDataUrl(null);

    const unsubQR =
      window.electronAPI.weixinLoginOnQR?.(({ qrcodeUrl: dataUrl }: { qrcodeUrl: string }) => {
        setQrcodeDataUrl(dataUrl);
        setLoginState('showing_qr');
      }) ?? (() => {});
    const unsubScanned =
      window.electronAPI.weixinLoginOnScanned?.(() => {
        setLoginState('scanned');
      }) ?? (() => {});
    const unsubDone =
      window.electronAPI.weixinLoginOnDone?.(() => {
        // credentials come from the Promise resolve — not this event
      }) ?? (() => {});

    try {
      const result = await window.electronAPI.weixinLoginStart();
      const { accountId, botToken } = result as {
        accountId: string;
        botToken: string;
      };
      await enableWeixinPlugin(accountId, botToken);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.toLowerCase().includes('expired') || msg.toLowerCase().includes('too many')) {
        Message.warning(t('settings.weixin.loginExpired', 'QR code expired, please try again'));
      } else if (msg !== 'Aborted') {
        Message.error(t('settings.weixin.loginError', 'WeChat login failed'));
      }
      setLoginState('idle');
      setQrcodeDataUrl(null);
    } finally {
      unsubQR();
      unsubScanned();
      unsubDone();
    }
  };

  const isGeminiAgent = selectedAgent.backend === 'gemini';
  const agentOptions = availableAgents.length > 0 ? availableAgents : [DEFAULT_CHANNEL_CONVERSATION_AGENT];
  const isAgentSwitchDisabled = agentOptions.length <= 1;

  const handleDisconnect = async () => {
    try {
      const result = await channel.disablePlugin.invoke({ pluginId });
      if (result.success) {
        Message.success(t('settings.weixin.pluginDisabled', 'WeChat channel disabled'));
        onStatusChange(null);
        setLoginState('idle');
        setQrcodeDataUrl(null);
      } else {
        Message.error(result.msg || t('settings.weixin.disableFailed', 'Failed to disconnect'));
      }
    } catch (error) {
      Message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const handleWorkspaceChange = (value?: string | number) => {
    const nextWorkspace = typeof value === 'string' ? value.trim() : '';
    setInstanceWorkspace(nextWorkspace);
    if (nextWorkspace) {
      rememberPublishedWorkspace(nextWorkspace);
    }
    void updateChannelInstanceSettings(pluginId, (current) => ({
      ...current,
      workspace: nextWorkspace || undefined,
    }));
  };

  const renderLoginArea = () => {
    if (loginState === 'connected' || (pluginStatus?.hasToken && pluginStatus?.enabled)) {
      return (
        <div className='flex items-center gap-8px'>
          <CheckOne theme='filled' size={16} className='text-green-500' />
          <span className='text-14px text-t-primary'>{t('settings.weixin.connected', 'Connected')}</span>
          {pluginStatus?.botUsername && <span className='text-12px text-t-tertiary'>({pluginStatus.botUsername})</span>}
          <Button
            type='secondary'
            size='small'
            status='danger'
            onClick={() => {
              void handleDisconnect();
            }}
          >
            {t('settings.weixin.disconnect', 'Disconnect')}
          </Button>
        </div>
      );
    }

    if (loginState === 'showing_qr' || loginState === 'scanned') {
      return (
        <div className='flex flex-col items-center gap-8px'>
          {qrcodeDataUrl &&
            (isWebUIMode ? (
              <QRCodeSVG value={qrcodeDataUrl} size={160} />
            ) : (
              <img src={qrcodeDataUrl} alt='WeChat QR code' className='w-160px h-160px rd-8px' />
            ))}
          {loginState === 'scanned' ? (
            <div className='flex items-center gap-6px text-13px text-t-secondary'>
              <Spin size={14} />
              <span>{t('settings.weixin.scanned', 'Scanned, waiting for confirmation...')}</span>
            </div>
          ) : (
            <span className='text-13px text-t-secondary'>
              {t('settings.weixin.scanPrompt', 'Please scan the QR code with WeChat')}
            </span>
          )}
        </div>
      );
    }

    // idle or loading_qr
    return (
      <Button
        type='primary'
        loading={loginState === 'loading_qr'}
        onClick={() => {
          void handleLogin();
        }}
      >
        {t('settings.weixin.loginButton', 'Scan to Login')}
      </Button>
    );
  };

  return (
    <div className='flex flex-col gap-24px'>
      {/* Login / connection status */}
      <PreferenceRow
        label={t('settings.weixin.accountId', 'Account ID')}
        description={
          loginState === 'idle' || loginState === 'loading_qr'
            ? t('settings.weixin.scanPrompt', 'Please scan the QR code with WeChat')
            : undefined
        }
      >
        {renderLoginArea()}
      </PreferenceRow>

      <PreferenceRow
        label={t('settings.channels.workspace', 'Published Workspace')}
        description={t(
          'settings.channels.workspaceDesc',
          'Messages routed through this WeChat instance will share this workspace context.'
        )}
      >
        <div className='flex flex-col items-end gap-4px'>
          <Select
            value={instanceWorkspace || undefined}
            onChange={(value) => handleWorkspaceChange(typeof value === 'string' ? value : undefined)}
            allowClear
            showSearch
            allowCreate
            placeholder={t('settings.channels.workspacePlaceholder', 'Select a workspace')}
            style={{ width: 240 }}
          >
            {workspaceOptions.map((workspace) => (
              <Select.Option key={workspace.path} value={workspace.path}>
                {workspace.displayName}
              </Select.Option>
            ))}
          </Select>
          <div className='max-w-240px break-all text-right text-11px leading-16px text-t-tertiary'>
            {instanceWorkspace
              ? instanceWorkspace
              : t('settings.channels.workspaceEmptyState', 'Open or create a workspace in the sidebar first.')}
          </div>
        </div>
      </PreferenceRow>

      {/* Agent Selection */}
      <PreferenceRow
        label={t('settings.weixin.agent', 'Agent')}
        description={t('settings.weixin.agentDesc', 'Used for WeChat conversations')}
      >
        <Dropdown
          trigger='click'
          position='br'
          droplist={
            <Menu selectedKeys={[getChannelConversationAgentKey(selectedAgent)]}>
              {agentOptions.map((a) => {
                const key = getChannelConversationAgentKey(a);
                return (
                  <Menu.Item
                    key={key}
                    onClick={() => {
                      const currentKey = getChannelConversationAgentKey(selectedAgent);
                      if (key === currentKey) return;
                      const next = {
                        backend: a.backend,
                        customAgentId: a.customAgentId,
                        name: a.name,
                      };
                      setSelectedAgent(next);
                      void persistSelectedAgent(next);
                    }}
                  >
                    {a.name}
                  </Menu.Item>
                );
              })}
            </Menu>
          }
        >
          <Button
            type='secondary'
            disabled={isAgentSwitchDisabled}
            className='min-w-160px flex items-center justify-between gap-8px'
          >
            <span className='truncate'>
              {selectedAgent.name ||
                availableAgents.find(
                  (a) => getChannelConversationAgentKey(a) === getChannelConversationAgentKey(selectedAgent)
                )?.name ||
                selectedAgent.backend}
            </span>
            <Down theme='outline' size={14} />
          </Button>
        </Dropdown>
      </PreferenceRow>

      {/* Default Model Selection */}
      <PreferenceRow
        label={t('settings.assistant.defaultModel', 'Default Model')}
        description={t('settings.weixin.defaultModelDesc', 'Model used for WeChat conversations')}
      >
        {selectedAgent.backend === 'droid' ? (
          <DroidChannelModelSelector pluginId={pluginId} platform='weixin' agent={selectedAgent} />
        ) : (
          <GeminiModelSelector
            selection={isGeminiAgent ? modelSelection : undefined}
            disabled={!isGeminiAgent}
            label={
              !isGeminiAgent
                ? t('settings.assistant.autoFollowCliModel', 'Automatically follow the model when CLI is running')
                : undefined
            }
            variant='settings'
          />
        )}
      </PreferenceRow>

      {selectedAgent.backend === 'droid' && (
        <DroidChannelRuntimeSettings mode='override' platform='weixin' pluginId={pluginId} />
      )}

      {/* Next Steps Guide - shown when connected but no authorized users yet */}
      {pluginStatus?.connected && authorizedUsers.length === 0 && (
        <div className='bg-blue-50 dark:bg-blue-900/20 rd-12px p-16px border border-blue-200 dark:border-blue-800'>
          <SectionHeader title={t('settings.assistant.nextSteps', 'Next Steps')} />
          <div className='text-14px text-t-secondary space-y-8px'>
            <p className='m-0'>
              <strong>1.</strong> {t('settings.weixin.step1', 'Find and send a message to your bot in WeChat')}
            </p>
            <p className='m-0'>
              <strong>2.</strong>{' '}
              {t(
                'settings.weixin.step2',
                'A pairing request will appear below. Click "Approve" to authorize the user.'
              )}
            </p>
            <p className='m-0'>
              <strong>3.</strong>{' '}
              {t(
                'settings.weixin.step3',
                'Once approved, you can start chatting with the AI assistant through WeChat!'
              )}
            </p>
          </div>
        </div>
      )}

      {/* Pending Pairing Requests */}
      {pluginStatus?.connected && (
        <div className='bg-fill-1 rd-12px pt-16px pr-16px pb-16px pl-0'>
          <SectionHeader
            title={
              pendingPairings.length > 0
                ? `${t('settings.assistant.pendingPairings', 'Pending Pairing Requests')} (${pendingPairings.length})`
                : t('settings.assistant.pendingPairings', 'Pending Pairing Requests')
            }
            action={
              <Button
                size='mini'
                type='text'
                icon={<Refresh size={14} />}
                loading={pairingLoading}
                onClick={() => loadPendingPairings()}
              >
                {t('common.refresh', 'Refresh')}
              </Button>
            }
          />
          {pairingLoading ? (
            <div className='flex justify-center py-24px'>
              <Spin />
            </div>
          ) : pendingPairings.length === 0 ? (
            <Empty description={t('settings.assistant.noPendingPairings', 'No pending pairing requests')} />
          ) : (
            <div className='flex flex-col gap-12px'>
              {pendingPairings.map((pairing) => (
                <div key={pairing.code} className='flex items-center justify-between bg-fill-2 rd-8px p-12px'>
                  <div className='flex-1'>
                    <div className='flex items-center gap-8px'>
                      <span className='text-14px font-500 text-t-primary'>{pairing.displayName || 'Unknown User'}</span>
                      <Tooltip content={t('settings.assistant.copyCode', 'Copy pairing code')}>
                        <Button
                          type='text'
                          size='mini'
                          icon={<Copy size={14} />}
                          onClick={() => copyToClipboard(pairing.code)}
                        />
                      </Tooltip>
                    </div>
                    <div className='text-12px text-t-tertiary mt-4px'>
                      {t('settings.assistant.pairingCode', 'Code')}:{' '}
                      <code className='bg-fill-3 px-4px rd-2px'>{pairing.code}</code>
                      <span className='mx-8px'>|</span>
                      {t('settings.assistant.expiresIn', 'Expires in')}: {getRemainingTime(pairing.expiresAt)}
                    </div>
                  </div>
                  <div className='flex items-center gap-8px'>
                    <Button
                      type='primary'
                      size='small'
                      icon={<CheckOne size={14} />}
                      onClick={() => handleApprovePairing(pairing.code)}
                    >
                      {t('settings.assistant.approve', 'Approve')}
                    </Button>
                    <Button
                      type='secondary'
                      size='small'
                      status='danger'
                      icon={<CloseOne size={14} />}
                      onClick={() => handleRejectPairing(pairing.code)}
                    >
                      {t('settings.assistant.reject', 'Reject')}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Authorized Users */}
      {authorizedUsers.length > 0 && (
        <div className='bg-fill-1 rd-12px pt-16px pr-16px pb-16px pl-0'>
          <SectionHeader
            title={t('settings.assistant.authorizedUsers', 'Authorized Users')}
            action={
              <Button
                size='mini'
                type='text'
                icon={<Refresh size={14} />}
                loading={usersLoading}
                onClick={() => loadAuthorizedUsers()}
              >
                {t('common.refresh', 'Refresh')}
              </Button>
            }
          />
          {usersLoading ? (
            <div className='flex justify-center py-24px'>
              <Spin />
            </div>
          ) : (
            <div className='flex flex-col gap-12px'>
              {authorizedUsers.map((user) => (
                <div key={user.id} className='flex items-center justify-between bg-fill-2 rd-8px p-12px'>
                  <div className='flex-1'>
                    <div className='text-14px font-500 text-t-primary'>{user.displayName || 'Unknown User'}</div>
                    <div className='text-12px text-t-tertiary mt-4px'>
                      {t('settings.assistant.authorizedAt', 'Authorized')}: {formatTime(user.authorizedAt)}
                    </div>
                  </div>
                  <Tooltip content={t('settings.assistant.revokeAccess', 'Revoke access')}>
                    <Button
                      type='text'
                      status='danger'
                      size='small'
                      icon={<Delete size={16} />}
                      onClick={() => handleRevokeUser(user.id)}
                    />
                  </Tooltip>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default WeixinConfigForm;
