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
import {
  buildPublishedWorkspaceOptions,
  rememberPublishedWorkspace,
} from '@/renderer/utils/workspace/publishedWorkspaceOptions';
import { Button, Dropdown, Empty, Input, Menu, Message, Select, Spin, Tooltip } from '@arco-design/web-react';
import { CheckOne, CloseOne, Copy, Delete, Down, Refresh } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { loadChannelInstanceSettings, updateChannelInstanceSettings } from './channelInstanceSettings';
import { useChannelInstanceModelSelection } from './useChannelInstanceModelSelection';

/**
 * Preference row component
 */
const PreferenceRow: React.FC<{
  label: string;
  description?: React.ReactNode;
  extra?: React.ReactNode;
  children: React.ReactNode;
}> = ({ label, description, extra, children }) => (
  <div className='flex items-center justify-between gap-24px py-12px'>
    <div className='flex-1'>
      <div className='flex items-center gap-8px'>
        <span className='text-14px text-t-primary'>{label}</span>
        {extra}
      </div>
      {description && <div className='text-12px text-t-tertiary mt-2px'>{description}</div>}
    </div>
    <div className='flex items-center'>{children}</div>
  </div>
);

/**
 * Section header component
 */
const SectionHeader: React.FC<{ title: string; action?: React.ReactNode }> = ({ title, action }) => (
  <div className='flex items-center justify-between mb-12px'>
    <h3 className='text-14px font-500 text-t-primary m-0'>{title}</h3>
    {action}
  </div>
);

interface TelegramConfigFormProps {
  pluginId: string;
  pluginStatus: IChannelPluginStatus | null;
  onStatusChange: (status: IChannelPluginStatus | null) => void;
  onTokenChange?: (token: string) => void;
}

const getErrorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const formatTime = (timestamp: number): string => new Date(timestamp).toLocaleString();

const getRemainingTime = (expiresAt: number): string => {
  const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000 / 60));
  return `${remaining} min`;
};

const TelegramConfigForm: React.FC<TelegramConfigFormProps> = ({
  pluginId,
  pluginStatus,
  onStatusChange,
  onTokenChange,
}) => {
  const { t } = useTranslation();
  const conversationHistory = useOptionalConversationHistoryContext();
  const modelSelection = useChannelInstanceModelSelection(pluginId, 'telegram');

  const [telegramToken, setTelegramToken] = useState('');
  const [testLoading, setTestLoading] = useState(false);
  const [, setTokenTested] = useState(false);
  const [pairingLoading, setPairingLoading] = useState(false);
  const [usersLoading, setUsersLoading] = useState(false);
  const [pendingPairings, setPendingPairings] = useState<IChannelPairingRequest[]>([]);
  const [authorizedUsers, setAuthorizedUsers] = useState<IChannelUser[]>([]);
  const [instanceWorkspace, setInstanceWorkspace] = useState('');

  // Agent selection (used for Telegram conversations)
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

  // Load pending pairings
  const loadPendingPairings = useCallback(async () => {
    setPairingLoading(true);
    try {
      const result = await channel.getPendingPairings.invoke();
      if (result.success && result.data) {
        setPendingPairings(result.data.filter((p) => p.platformType === 'telegram' && p.pluginId === pluginId));
      }
    } catch (error) {
      console.error('[ChannelSettings] Failed to load pending pairings:', error);
    } finally {
      setPairingLoading(false);
    }
  }, [pluginId]);

  // Load authorized users
  const loadAuthorizedUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const result = await channel.getAuthorizedUsers.invoke();
      if (result.success && result.data) {
        setAuthorizedUsers(result.data.filter((u) => u.platformType === 'telegram' && u.pluginId === pluginId));
      }
    } catch (error) {
      console.error('[ChannelSettings] Failed to load authorized users:', error);
    } finally {
      setUsersLoading(false);
    }
  }, [pluginId]);

  // Initial load
  useEffect(() => {
    void loadPendingPairings();
    void loadAuthorizedUsers();
  }, [loadPendingPairings, loadAuthorizedUsers]);

  useEffect(() => {
    const loadWorkspace = async () => {
      const settings = await loadChannelInstanceSettings(pluginId, 'telegram');
      setInstanceWorkspace(settings.workspace || '');
    };

    void loadWorkspace();
  }, [pluginId]);

  // Load available agents + saved selection
  useEffect(() => {
    const loadAgentsAndSelection = async () => {
      try {
        const [agentsResp, saved] = await Promise.all([
          acpConversation.getAvailableAgents.invoke(),
          loadChannelInstanceSettings(pluginId, 'telegram').then((settings) => settings.agent),
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
            .invoke({ platform: 'telegram', pluginId, agent: resolved.selectedAgent })
            .catch((err) => console.warn('[TelegramConfig] syncChannelSettings failed:', err));
        }
      } catch (error) {
        console.error('[TelegramConfig] Failed to load agents:', error);
      }
    };

    void loadAgentsAndSelection();
  }, [pluginId]);

  const persistSelectedAgent = async (agent: ChannelConversationAgentOption, showSuccessMessage = true) => {
    try {
      await updateChannelInstanceSettings(pluginId, (current) => ({
        ...current,
        agent,
      }));
      await channel.syncChannelSettings
        .invoke({ platform: 'telegram', pluginId, agent })
        .catch((err) => console.warn('[TelegramConfig] syncChannelSettings failed:', err));
      if (showSuccessMessage) {
        Message.success(t('settings.assistant.agentSwitched', 'Agent switched successfully'));
      }
    } catch (error) {
      console.error('[TelegramConfig] Failed to save agent:', error);
      Message.error(t('common.saveFailed', 'Failed to save'));
    }
  };

  // Listen for pairing requests
  useEffect(() => {
    const unsubscribe = channel.pairingRequested.on((request) => {
      if (request.platformType !== 'telegram' || request.pluginId !== pluginId) return;
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
      if (user.pluginId !== pluginId || user.platformType !== 'telegram') return;
      setAuthorizedUsers((prev) => {
        const exists = prev.some((u) => u.id === user.id);
        if (exists) return prev;
        return [user, ...prev];
      });
      setPendingPairings((prev) => prev.filter((p) => p.platformUserId !== user.platformUserId));
    });
    return () => unsubscribe();
  }, [pluginId]);

  // Test Telegram connection
  const handleTestConnection = async () => {
    if (!telegramToken.trim()) {
      Message.warning(t('settings.assistant.tokenRequired', 'Please enter a bot token'));
      return;
    }

    setTestLoading(true);
    setTokenTested(false);
    try {
      const result = await channel.testPlugin.invoke({
        pluginId,
        token: telegramToken.trim(),
      });

      if (result.success && result.data?.success) {
        setTokenTested(true);
        Message.success(
          t('settings.assistant.connectionSuccess', `Connected! Bot: @${result.data.botUsername || 'unknown'}`)
        );

        // Auto-enable bot after successful test
        await handleAutoEnable();
      } else {
        setTokenTested(false);
        Message.error(result.data?.error || t('settings.assistant.connectionFailed', 'Connection failed'));
      }
    } catch (error) {
      setTokenTested(false);
      Message.error(getErrorMessage(error) || t('settings.assistant.connectionFailed', 'Connection failed'));
    } finally {
      setTestLoading(false);
    }
  };

  // Auto-enable plugin after successful test
  const handleAutoEnable = async () => {
    try {
      const result = await channel.enablePlugin.invoke({
        pluginId,
        config: { token: telegramToken.trim() },
      });

      if (result.success) {
        Message.success(t('settings.assistant.pluginEnabled', 'Telegram bot enabled'));
        const statusResult = await channel.getPluginStatus.invoke();
        if (statusResult.success && statusResult.data) {
          const telegramPlugin = statusResult.data.find((p) => p.id === pluginId);
          onStatusChange(telegramPlugin || null);
        }
      }
    } catch (error) {
      console.error('[ChannelSettings] Auto-enable failed:', error);
    }
  };

  // Reset token tested state when token changes
  const handleTokenChange = (value: string) => {
    setTelegramToken(value);
    setTokenTested(false);
    onTokenChange?.(value);
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

  // Approve pairing
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
      Message.error(getErrorMessage(error));
    }
  };

  // Reject pairing
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
      Message.error(getErrorMessage(error));
    }
  };

  // Revoke user
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
      Message.error(getErrorMessage(error));
    }
  };

  // Copy to clipboard
  const copyToClipboard = (text: string) => {
    void navigator.clipboard.writeText(text);
    Message.success(t('common.copySuccess', 'Copied'));
  };

  const isGeminiAgent = selectedAgent.backend === 'gemini';
  const agentOptions = availableAgents.length > 0 ? availableAgents : [DEFAULT_CHANNEL_CONVERSATION_AGENT];
  const isAgentSwitchDisabled = agentOptions.length <= 1;

  return (
    <div className='flex flex-col gap-24px'>
      <PreferenceRow
        label={t('settings.assistant.botToken', 'Bot Token')}
        description={t(
          'settings.assistant.botTokenDesc',
          'Open Telegram, find @BotFather and send /newbot to get your Bot Token.'
        )}
      >
        <div className='flex items-center gap-8px'>
          {authorizedUsers.length > 0 ? (
            <Tooltip
              content={t(
                'settings.assistant.tokenLocked',
                'Please close the Channel and delete all authorized users before modifying the configuration'
              )}
            >
              <span>
                <Input.Password
                  value={telegramToken}
                  onChange={handleTokenChange}
                  placeholder={
                    authorizedUsers.length > 0 || pluginStatus?.hasToken ? '••••••••••••••••' : '123456:ABC-DEF...'
                  }
                  style={{ width: 240 }}
                  visibilityToggle
                  disabled={authorizedUsers.length > 0}
                />
              </span>
            </Tooltip>
          ) : (
            <Input.Password
              value={telegramToken}
              onChange={handleTokenChange}
              placeholder={
                authorizedUsers.length > 0 || pluginStatus?.hasToken ? '••••••••••••••••' : '123456:ABC-DEF...'
              }
              style={{ width: 240 }}
              visibilityToggle
              disabled={authorizedUsers.length > 0}
            />
          )}
          {authorizedUsers.length > 0 ? (
            <Tooltip
              content={t(
                'settings.assistant.tokenLocked',
                'Please close the Channel and delete all authorized users before modifying the configuration'
              )}
            >
              <span>
                <Button
                  type='outline'
                  loading={testLoading}
                  onClick={handleTestConnection}
                  disabled={authorizedUsers.length > 0}
                >
                  {t('settings.assistant.testConnection', 'Test')}
                </Button>
              </span>
            </Tooltip>
          ) : (
            <Button
              type='outline'
              loading={testLoading}
              onClick={handleTestConnection}
              disabled={authorizedUsers.length > 0}
            >
              {t('settings.assistant.testConnection', 'Test')}
            </Button>
          )}
        </div>
      </PreferenceRow>

      <PreferenceRow
        label={t('settings.channels.workspace', 'Published Workspace')}
        description={t(
          'settings.channels.workspaceDesc',
          'Messages routed through this Telegram instance will share this workspace context.'
        )}
      >
        <div className='flex flex-col items-end gap-4px'>
          <Select
            value={instanceWorkspace || undefined}
            onChange={(value) => handleWorkspaceChange(typeof value === 'string' ? value : undefined)}
            allowClear
            showSearch
            disabled={workspaceOptions.length === 0}
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
      <div className='flex flex-col gap-8px'>
        <PreferenceRow
          label={t('settings.agent', 'Agent')}
          description={t('settings.assistant.agentDescTelegram', 'Used for Telegram conversations')}
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
                        if (key === currentKey) {
                          return;
                        }
                        const next = { backend: a.backend, customAgentId: a.customAgentId, name: a.name };
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
      </div>

      {/* Default Model Selection */}
      <PreferenceRow
        label={t('settings.assistant.defaultModel', 'Default Model')}
        description={t('settings.assistant.defaultModelDesc', 'Model used for Telegram conversations')}
      >
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
      </PreferenceRow>

      {selectedAgent.backend === 'droid' && (
        <DroidChannelRuntimeSettings mode='override' platform='telegram' pluginId={pluginId} />
      )}

      {/* Next Steps Guide - show when bot is enabled and no authorized users yet */}
      {pluginStatus?.enabled && pluginStatus?.connected && authorizedUsers.length === 0 && (
        <div className='bg-blue-50 dark:bg-blue-900/20 rd-12px p-16px border border-blue-200 dark:border-blue-800'>
          <SectionHeader title={t('settings.assistant.nextSteps', 'Next Steps')} />
          <div className='text-14px text-t-secondary space-y-8px'>
            <p className='m-0'>
              <strong>1.</strong> {t('settings.assistant.step1', 'Open Telegram and search for your bot')}
              {pluginStatus.botUsername && (
                <span className='ml-4px'>
                  <code className='bg-fill-2 px-6px py-2px rd-4px'>@{pluginStatus.botUsername}</code>
                </span>
              )}
            </p>
            <p className='m-0'>
              <strong>2.</strong>{' '}
              {t('settings.assistant.step2', 'Send any message or click /start to initiate pairing')}
            </p>
            <p className='m-0'>
              <strong>3.</strong>{' '}
              {t(
                'settings.assistant.step3',
                'A pairing request will appear below. Click "Approve" to authorize the user.'
              )}
            </p>
            <p className='m-0'>
              <strong>4.</strong>{' '}
              {t('settings.assistant.step4', 'Once approved, you can start chatting with Gemini through Telegram!')}
            </p>
          </div>
        </div>
      )}

      {/* Pending Pairings */}
      {pluginStatus?.enabled && (
        <div className='bg-fill-1 rd-12px pt-16px pr-16px pb-16px pl-0'>
          <SectionHeader
            title={t('settings.assistant.pendingPairings', 'Pending Pairing Requests')}
            action={
              <Button
                size='mini'
                type='text'
                icon={<Refresh size={14} />}
                loading={pairingLoading}
                onClick={loadPendingPairings}
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
                        <button
                          className='p-4px bg-transparent border-none text-t-tertiary hover:text-t-primary cursor-pointer'
                          onClick={() => copyToClipboard(pairing.code)}
                        >
                          <Copy size={14} />
                        </button>
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

      {/* Authorized Users - show when there are authorized users */}
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
                onClick={loadAuthorizedUsers}
              >
                {t('common.refresh', 'Refresh')}
              </Button>
            }
          />

          {usersLoading ? (
            <div className='flex justify-center py-24px'>
              <Spin />
            </div>
          ) : authorizedUsers.length === 0 ? (
            <Empty description={t('settings.assistant.noAuthorizedUsers', 'No authorized users yet')} />
          ) : (
            <div className='flex flex-col gap-12px'>
              {authorizedUsers.map((user) => (
                <div key={user.id} className='flex items-center justify-between bg-fill-2 rd-8px p-12px'>
                  <div className='flex-1'>
                    <div className='text-14px font-500 text-t-primary'>{user.displayName || 'Unknown User'}</div>
                    <div className='text-12px text-t-tertiary mt-4px'>
                      {t('settings.assistant.platform', 'Platform')}: {user.platformType}
                      <span className='mx-8px'>|</span>
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

export default TelegramConfigForm;
