/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IChannelPluginStatus } from '@process/channels/types';
import { channel, webui, type IWebUIStatus } from '@/common/adapter/ipcBridge';
import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import DroidChannelRuntimeSettings from '@/renderer/components/settings/DroidChannelRuntimeSettings';
import { Button, Input, InputNumber, Message, Select, Switch } from '@arco-design/web-react';
import { CheckOne } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsViewMode } from '../../settingsViewContext';
import ChannelItem from './ChannelItem';
import type { ChannelConfig } from './types';
import DingTalkConfigForm from './DingTalkConfigForm';
import LarkConfigForm from './LarkConfigForm';
import TelegramConfigForm from './TelegramConfigForm';
import WeixinConfigForm from './WeixinConfigForm';

type ExtensionFieldType = 'text' | 'password' | 'select' | 'number' | 'boolean';

type ExtensionFieldSchema = {
  key: string;
  label: string;
  type: ExtensionFieldType;
  required?: boolean;
  options?: string[];
  default?: string | number | boolean;
};

type ExtensionFieldValues = Record<string, Record<string, string | number | boolean>>;

const BUILTIN_CHANNEL_TYPES = new Set(['telegram', 'lark', 'dingtalk', 'weixin', 'slack', 'discord']);
const BUILTIN_INSTANCEABLE_PLATFORMS = ['telegram', 'lark', 'dingtalk', 'weixin'] as const;
type BuiltinInstanceablePlatform = (typeof BUILTIN_INSTANCEABLE_PLATFORMS)[number];

const CHANNEL_COPY: Record<BuiltinInstanceablePlatform, { title: string; desc: string }> = {
  telegram: {
    title: 'Telegram',
    desc: 'Chat with 智能体工厂 assistant via Telegram',
  },
  lark: {
    title: 'Lark / Feishu',
    desc: 'Chat with 智能体工厂 assistant via Lark or Feishu',
  },
  dingtalk: {
    title: 'DingTalk',
    desc: 'Chat with 智能体工厂 assistant via DingTalk',
  },
  weixin: {
    title: 'WeChat',
    desc: 'Chat with 智能体工厂 assistant via WeChat',
  },
};

/**
 * Assistant Settings Content Component
 */
const ChannelModalContent: React.FC = () => {
  const { t } = useTranslation();
  const viewMode = useSettingsViewMode();
  const isPageMode = viewMode === 'page';

  // Plugin state
  const [pluginStatuses, setPluginStatuses] = useState<Record<string, IChannelPluginStatus>>({});
  const [pluginLoadingMap, setPluginLoadingMap] = useState<Record<string, boolean>>({});
  const [createLoadingMap, setCreateLoadingMap] = useState<Record<string, boolean>>({});
  const [extensionLoadingMap, setExtensionLoadingMap] = useState<Record<string, boolean>>({});
  const [extensionFieldValues, setExtensionFieldValues] = useState<ExtensionFieldValues>({});
  const [webuiStatus, setWebuiStatus] = useState<IWebUIStatus | null>(null);

  // Track the token entered in each TelegramConfigForm so the toggle handler can use it
  const telegramTokenRef = useRef<Record<string, string>>({});

  // Collapse state - true means collapsed (closed), false means expanded (open)
  const [collapseKeys, setCollapseKeys] = useState<Record<string, boolean>>({});

  // Load plugin status
  const loadPluginStatus = useCallback(async () => {
    try {
      const result = await channel.getPluginStatus.invoke();
      if (result.success && result.data) {
        setPluginStatuses(Object.fromEntries(result.data.map((status) => [status.id, status])));
        setExtensionFieldValues((prev) => {
          const next: ExtensionFieldValues = { ...prev };
          for (const plugin of result.data.filter((status) => status.isExtension)) {
            const fields = [
              ...(plugin.extensionMeta?.credentialFields || []),
              ...(plugin.extensionMeta?.configFields || []),
            ] as ExtensionFieldSchema[];
            if (!next[plugin.id]) {
              next[plugin.id] = {};
            }
            for (const field of fields) {
              if (next[plugin.id][field.key] === undefined && field.default !== undefined) {
                next[plugin.id][field.key] = field.default;
              }
            }
          }
          return next;
        });
        setCollapseKeys((prev) => {
          const next = { ...prev };
          for (const status of result.data) {
            if (next[status.id] === undefined) {
              next[status.id] = true;
            }
          }
          return next;
        });
      }
    } catch (error) {
      console.error('[ChannelSettings] Failed to load plugin status:', error);
    }
  }, []);

  // Initial load
  useEffect(() => {
    void loadPluginStatus();
  }, [loadPluginStatus]);

  useEffect(() => {
    const loadWebuiStatus = async () => {
      try {
        const result = await webui.getStatus.invoke();
        if (result?.success && result.data) {
          setWebuiStatus(result.data);
        }
      } catch {
        // Best-effort only: channel settings should not fail if webui status is unavailable.
      }
    };
    void loadWebuiStatus();
  }, []);

  const updatePluginStatus = useCallback((pluginId: string, nextStatus: IChannelPluginStatus | null) => {
    setPluginStatuses((prev) => {
      if (nextStatus) {
        return {
          ...prev,
          [pluginId]: nextStatus,
        };
      }

      const existing = prev[pluginId];
      if (!existing) {
        return prev;
      }

      return {
        ...prev,
        [pluginId]: {
          ...existing,
          enabled: false,
          connected: false,
          status: 'stopped',
          error: undefined,
        },
      };
    });
  }, []);

  // Listen for plugin status changes
  useEffect(() => {
    const unsubscribe = channel.pluginStatusChanged.on(({ status }) => {
      setPluginStatuses((prev) => ({
        ...prev,
        [status.id]: {
          ...prev[status.id],
          ...status,
          extensionMeta: status.extensionMeta || prev[status.id]?.extensionMeta,
        },
      }));
      setCollapseKeys((prev) =>
        prev[status.id] === undefined
          ? {
              ...prev,
              [status.id]: true,
            }
          : prev
      );
      if (!BUILTIN_CHANNEL_TYPES.has(status.type)) {
        setExtensionFieldValues((prev) => {
          if (prev[status.id]) {
            return prev;
          }
          return {
            ...prev,
            [status.id]: {},
          };
        });
      }
    });
    return () => unsubscribe();
  }, []);

  // Toggle collapse
  const handleToggleCollapse = (channelId: string) => {
    setCollapseKeys((prev) => ({
      ...prev,
      [channelId]: !prev[channelId],
    }));
  };

  const handleToggleBuiltinPlugin = useCallback(
    async (pluginId: string, enabled: boolean) => {
      const status = pluginStatuses[pluginId];
      if (!status) {
        return;
      }

      setPluginLoadingMap((prev) => ({ ...prev, [pluginId]: true }));
      try {
        if (enabled) {
          let result:
            | {
                success: boolean;
                msg?: string;
              }
            | undefined;

          if (status.type === 'telegram') {
            const pendingToken = telegramTokenRef.current[pluginId]?.trim() || '';
            if (!status.hasToken && !pendingToken) {
              Message.warning(t('settings.assistant.tokenRequired', 'Please enter a bot token first'));
              return;
            }
            result = await channel.enablePlugin.invoke({
              pluginId,
              config: pendingToken ? { token: pendingToken } : {},
            });
          } else if (status.type === 'lark') {
            if (!status.hasToken) {
              Message.warning(t('settings.lark.credentialsRequired', 'Please configure Lark credentials first'));
              return;
            }
            result = await channel.enablePlugin.invoke({
              pluginId,
              config: {},
            });
          } else if (status.type === 'dingtalk') {
            if (!status.hasToken) {
              Message.warning(
                t('settings.dingtalk.credentialsRequired', 'Please configure DingTalk credentials first')
              );
              return;
            }
            result = await channel.enablePlugin.invoke({
              pluginId,
              config: {},
            });
          } else if (status.type === 'weixin') {
            if (!status.hasToken) {
              Message.warning(t('settings.weixin.loginRequired', 'Please login with WeChat QR code first'));
              return;
            }
            result = await channel.enablePlugin.invoke({
              pluginId,
              config: {},
            });
          }

          if (result?.success) {
            const messageKey =
              status.type === 'telegram'
                ? t('settings.assistant.pluginEnabled', 'Telegram bot enabled')
                : status.type === 'lark'
                  ? t('settings.lark.pluginEnabled', 'Lark bot enabled')
                  : status.type === 'dingtalk'
                    ? t('settings.dingtalk.pluginEnabled', 'DingTalk bot enabled')
                    : t('settings.weixin.pluginEnabled', 'WeChat channel enabled');
            Message.success(messageKey);
            await loadPluginStatus();
          } else {
            const errorMessage =
              result?.msg ||
              (status.type === 'telegram'
                ? t('settings.assistant.enableFailed', 'Failed to enable plugin')
                : status.type === 'lark'
                  ? t('settings.lark.enableFailed', 'Failed to enable Lark plugin')
                  : status.type === 'dingtalk'
                    ? t('settings.dingtalk.enableFailed', 'Failed to enable DingTalk plugin')
                    : t('settings.weixin.enableFailed', 'Failed to enable WeChat plugin'));
            Message.error(errorMessage);
          }
          return;
        }

        const result = await channel.disablePlugin.invoke({
          pluginId,
        });

        if (result.success) {
          const messageKey =
            status.type === 'telegram'
              ? t('settings.assistant.pluginDisabled', 'Telegram bot disabled')
              : status.type === 'lark'
                ? t('settings.lark.pluginDisabled', 'Lark bot disabled')
                : status.type === 'dingtalk'
                  ? t('settings.dingtalk.pluginDisabled', 'DingTalk bot disabled')
                  : t('settings.weixin.pluginDisabled', 'WeChat channel disabled');
          Message.success(messageKey);
          await loadPluginStatus();
        } else {
          const errorMessage =
            result.msg ||
            (status.type === 'telegram'
              ? t('settings.assistant.disableFailed', 'Failed to disable plugin')
              : status.type === 'lark'
                ? t('settings.assistant.disableFailed', 'Failed to disable plugin')
                : status.type === 'dingtalk'
                  ? t('settings.dingtalk.disableFailed', 'Failed to disable DingTalk plugin')
                  : t('settings.weixin.disableFailed', 'Failed to disable WeChat plugin'));
          Message.error(errorMessage);
        }
      } catch (error: any) {
        Message.error(error.message || String(error));
      } finally {
        setPluginLoadingMap((prev) => ({ ...prev, [pluginId]: false }));
      }
    },
    [loadPluginStatus, pluginStatuses, t]
  );

  const handleCreatePluginInstance = useCallback(
    async (platform: BuiltinInstanceablePlatform) => {
      setCreateLoadingMap((prev) => ({
        ...prev,
        [platform]: true,
      }));
      try {
        const result = await channel.createPluginInstance.invoke({ platform });
        if (result.success) {
          const createdPluginId =
            result.data && typeof result.data === 'object' && 'pluginId' in result.data
              ? String((result.data as { pluginId?: unknown }).pluginId || '')
              : '';
          await loadPluginStatus();
          if (createdPluginId) {
            setCollapseKeys((prev) => ({
              ...prev,
              [createdPluginId]: false,
            }));
          }
          Message.success(
            t('settings.channels.instanceCreated', {
              defaultValue: 'Created {{channel}} instance',
              channel: CHANNEL_COPY[platform].title,
            })
          );
        } else {
          Message.error(
            result.msg ||
              t('settings.channels.instanceCreateFailed', {
                defaultValue: 'Failed to create channel instance',
              })
          );
        }
      } catch (error: any) {
        Message.error(error.message || String(error));
      } finally {
        setCreateLoadingMap((prev) => ({
          ...prev,
          [platform]: false,
        }));
      }
    },
    [loadPluginStatus, t]
  );

  const updateExtensionFieldValue = useCallback((pluginId: string, key: string, value: string | number | boolean) => {
    setExtensionFieldValues((prev) => ({
      ...prev,
      [pluginId]: {
        ...prev[pluginId],
        [key]: value,
      },
    }));
  }, []);

  const handleToggleExtensionPlugin = useCallback(
    async (pluginId: string, enabled: boolean) => {
      const status = pluginStatuses[pluginId];
      if (!status) return;

      setExtensionLoadingMap((prev) => ({ ...prev, [pluginId]: true }));
      try {
        if (enabled) {
          const fieldValues = extensionFieldValues[pluginId] || {};
          const credentialFields = (status.extensionMeta?.credentialFields || []) as ExtensionFieldSchema[];
          const missingField = credentialFields.find((field) => {
            if (!field.required) return false;
            const value = fieldValues[field.key];
            if (field.type === 'boolean') return value === undefined;
            return value === undefined || value === '';
          });

          if (missingField) {
            Message.warning(
              t('settings.channels.extension.requiredField', {
                defaultValue: 'Please fill required field: {{field}}',
                field: missingField.label,
              })
            );
            return;
          }

          const result = await channel.enablePlugin.invoke({
            pluginId,
            config: fieldValues,
          });

          if (result.success) {
            Message.success(
              t('settings.channels.extension.enabled', {
                defaultValue: 'Channel enabled',
              })
            );
            await loadPluginStatus();
          } else {
            Message.error(
              result.msg ||
                t('settings.channels.extension.enableFailed', {
                  defaultValue: 'Failed to enable channel',
                })
            );
          }
        } else {
          const result = await channel.disablePlugin.invoke({
            pluginId,
          });
          if (result.success) {
            Message.success(
              t('settings.channels.extension.disabled', {
                defaultValue: 'Channel disabled',
              })
            );
            await loadPluginStatus();
          } else {
            Message.error(
              result.msg ||
                t('settings.channels.extension.disableFailed', {
                  defaultValue: 'Failed to disable channel',
                })
            );
          }
        }
      } catch (error: any) {
        Message.error(error.message || String(error));
      } finally {
        setExtensionLoadingMap((prev) => ({ ...prev, [pluginId]: false }));
      }
    },
    [extensionFieldValues, loadPluginStatus, pluginStatuses, t]
  );

  const renderExtensionConfigForm = useCallback(
    (status: IChannelPluginStatus) => {
      const pluginId = status.id;
      const pluginType = status.type;
      const fields = [
        ...((status.extensionMeta?.credentialFields || []) as ExtensionFieldSchema[]),
        ...((status.extensionMeta?.configFields || []) as ExtensionFieldSchema[]),
      ];
      const values = extensionFieldValues[pluginId] || {};
      const callbackPath = '/ext-wecom-bot/webhook';
      const localCallbackUrl = webuiStatus?.localUrl
        ? `${webuiStatus.localUrl}${callbackPath}`
        : `http://localhost:25808${callbackPath}`;
      const lanCallbackUrl = webuiStatus?.networkUrl ? `${webuiStatus.networkUrl}${callbackPath}` : null;
      const publicBaseUrl =
        typeof values.publicBaseUrl === 'string' ? values.publicBaseUrl.trim().replace(/\/+$/, '') : '';
      const publicCallbackUrl = publicBaseUrl ? `${publicBaseUrl}${callbackPath}` : null;

      if (fields.length === 0) {
        return (
          <div className='text-14px text-t-secondary py-12px'>
            {status.extensionMeta?.description ||
              t('settings.channels.extension.noConfig', {
                defaultValue: 'No extra configuration required.',
              })}
          </div>
        );
      }

      return (
        <div className='space-y-10px py-4px'>
          {status.extensionMeta?.description && (
            <div className='text-13px text-t-secondary leading-relaxed'>{status.extensionMeta.description}</div>
          )}
          {pluginType === 'ext-wecom-bot' && (
            <div className='text-12px leading-relaxed p-10px rd-8px bg-[rgba(var(--orange-6),0.08)] border border-[rgba(var(--orange-6),0.3)] text-t-secondary'>
              <div className='font-500 text-t-primary mb-6px'>企微回调地址说明</div>
              <div>本机 Callback URL: {localCallbackUrl}</div>
              {lanCallbackUrl ? <div>局域网 Callback URL: {lanCallbackUrl}</div> : null}
              {publicCallbackUrl ? <div>公网 Callback URL(配置值): {publicCallbackUrl}</div> : null}
              <div className='mt-6px'>
                仅开启 WebUI 远程访问（LAN）通常不能直接通过企微回调。企微服务器需要可访问的公网 HTTPS 地址。
              </div>
              <div>建议：使用反向代理 + 证书，或 Cloudflare Tunnel / ngrok 映射到本机。</div>
            </div>
          )}
          {fields.map((field) => {
            const rawValue = values[field.key];
            const label = `${field.label}${field.required ? ' *' : ''}`;

            if (field.type === 'boolean') {
              return (
                <div key={`${pluginId}-${field.key}`} className='flex items-center justify-between'>
                  <span className='text-13px text-t-primary'>{label}</span>
                  <Switch
                    checked={Boolean(rawValue)}
                    onChange={(checked) => updateExtensionFieldValue(pluginId, field.key, checked)}
                  />
                </div>
              );
            }

            if (field.type === 'number') {
              return (
                <div key={`${pluginId}-${field.key}`} className='space-y-6px'>
                  <div className='text-13px text-t-primary'>{label}</div>
                  <InputNumber
                    value={typeof rawValue === 'number' ? rawValue : undefined}
                    onChange={(value) => updateExtensionFieldValue(pluginId, field.key, Number(value || 0))}
                    className='w-full'
                  />
                </div>
              );
            }

            if (field.type === 'select') {
              return (
                <div key={`${pluginId}-${field.key}`} className='space-y-6px'>
                  <div className='text-13px text-t-primary'>{label}</div>
                  <Select
                    value={typeof rawValue === 'string' ? rawValue : undefined}
                    options={(field.options || []).map((option) => ({
                      label: option,
                      value: option,
                    }))}
                    onChange={(value) => updateExtensionFieldValue(pluginId, field.key, String(value))}
                    placeholder={t('settings.channels.extension.selectPlaceholder', { defaultValue: 'Please select' })}
                    allowClear
                  />
                </div>
              );
            }

            return (
              <div key={`${pluginId}-${field.key}`} className='space-y-6px'>
                <div className='text-13px text-t-primary'>{label}</div>
                <Input
                  value={typeof rawValue === 'string' ? rawValue : ''}
                  onChange={(value) => updateExtensionFieldValue(pluginId, field.key, value)}
                  placeholder={field.label}
                  type={field.type === 'password' ? 'password' : 'text'}
                />
              </div>
            );
          })}
        </div>
      );
    },
    [extensionFieldValues, t, updateExtensionFieldValue, webuiStatus]
  );

  const getBuiltinTitle = useCallback(
    (platform: BuiltinInstanceablePlatform) =>
      platform === 'telegram'
        ? t('settings.channels.telegramTitle', CHANNEL_COPY.telegram.title)
        : platform === 'lark'
          ? t('settings.channels.larkTitle', CHANNEL_COPY.lark.title)
          : platform === 'dingtalk'
            ? t('settings.channels.dingtalkTitle', CHANNEL_COPY.dingtalk.title)
            : t('settings.channels.weixinTitle', CHANNEL_COPY.weixin.title),
    [t]
  );

  const getBuiltinDescription = useCallback(
    (platform: BuiltinInstanceablePlatform) =>
      platform === 'telegram'
        ? t('settings.channels.telegramDesc', CHANNEL_COPY.telegram.desc)
        : platform === 'lark'
          ? t('settings.channels.larkDesc', CHANNEL_COPY.lark.desc)
          : platform === 'dingtalk'
            ? t('settings.channels.dingtalkDesc', CHANNEL_COPY.dingtalk.desc)
            : t('settings.channels.weixinDesc', CHANNEL_COPY.weixin.desc),
    [t]
  );

  const renderBuiltinConfigForm = useCallback(
    (status: IChannelPluginStatus) => {
      if (status.type === 'telegram') {
        return (
          <TelegramConfigForm
            pluginId={status.id}
            pluginStatus={status}
            onStatusChange={(nextStatus) => updatePluginStatus(status.id, nextStatus)}
            onTokenChange={(token) => {
              telegramTokenRef.current[status.id] = token;
            }}
          />
        );
      }

      if (status.type === 'lark') {
        return (
          <LarkConfigForm
            pluginId={status.id}
            pluginStatus={status}
            onStatusChange={(nextStatus) => updatePluginStatus(status.id, nextStatus)}
          />
        );
      }

      if (status.type === 'dingtalk') {
        return (
          <DingTalkConfigForm
            pluginId={status.id}
            pluginStatus={status}
            onStatusChange={(nextStatus) => updatePluginStatus(status.id, nextStatus)}
          />
        );
      }

      if (status.type === 'weixin') {
        return (
          <WeixinConfigForm
            pluginId={status.id}
            pluginStatus={status}
            onStatusChange={(nextStatus) => updatePluginStatus(status.id, nextStatus)}
          />
        );
      }

      return null;
    },
    [updatePluginStatus]
  );

  // Build channel configurations
  const channels: ChannelConfig[] = useMemo(() => {
    const allStatuses = Object.values(pluginStatuses);
    const builtinChannels: ChannelConfig[] = BUILTIN_INSTANCEABLE_PLATFORMS.flatMap((platform) =>
      allStatuses
        .filter((status) => status.type === platform)
        .toSorted((left, right) => {
          const leftDefault = left.id === `${platform}_default`;
          const rightDefault = right.id === `${platform}_default`;
          if (leftDefault !== rightDefault) {
            return leftDefault ? -1 : 1;
          }
          return left.name.localeCompare(right.name);
        })
        .map((status) => {
          const isDefaultInstance = status.id === `${platform}_default`;
          return {
            id: status.id,
            logoType: platform,
            title: isDefaultInstance
              ? getBuiltinTitle(platform)
              : status.name ||
                t('settings.channels.instanceFallbackTitle', {
                  defaultValue: '{{channel}} instance',
                  channel: getBuiltinTitle(platform),
                }),
            description: isDefaultInstance
              ? getBuiltinDescription(platform)
              : t('settings.channels.instanceDesc', {
                  defaultValue: 'Published instance: {{name}}',
                  name: status.name || status.id,
                }),
            status: 'active' as const,
            enabled: status.enabled || false,
            disabled: pluginLoadingMap[status.id] || false,
            isConnected: status.connected || false,
            botUsername: status.type === 'telegram' ? status.botUsername : undefined,
            content: renderBuiltinConfigForm(status),
          };
        })
    );

    const extensionChannels: ChannelConfig[] = allStatuses
      .filter((status) => status.isExtension)
      .toSorted((a, b) => a.name.localeCompare(b.name))
      .map((status) => ({
        id: status.id,
        title: status.name,
        description:
          status.extensionMeta?.description ||
          t('settings.channels.extension.defaultDesc', {
            defaultValue: 'Extension channel plugin',
          }),
        status: 'active',
        enabled: status.enabled || false,
        disabled: extensionLoadingMap[status.id] || false,
        isConnected: status.connected || false,
        icon: status.extensionMeta?.icon,
        isExtension: true,
        content: renderExtensionConfigForm(status),
      }));

    const extensionTypeSet = new Set(extensionChannels.map((channel) => String(channel.id).toLowerCase()));
    const comingSoonChannels: ChannelConfig[] = [
      {
        id: 'slack',
        title: t('settings.channels.slackTitle', 'Slack'),
        description: t('settings.channels.slackDesc', 'Chat with 智能体工厂 assistant via Slack'),
        status: 'coming_soon' as const,
        enabled: false,
        disabled: true,
        content: (
          <div className='text-14px text-t-secondary py-12px'>
            {t('settings.channels.comingSoonDesc', 'Support for {{channel}} is coming soon', {
              channel: t('settings.channels.slackTitle', 'Slack'),
            })}
          </div>
        ),
      },
      {
        id: 'discord',
        title: t('settings.channels.discordTitle', 'Discord'),
        description: t('settings.channels.discordDesc', 'Chat with 智能体工厂 assistant via Discord'),
        status: 'coming_soon' as const,
        enabled: false,
        disabled: true,
        content: (
          <div className='text-14px text-t-secondary py-12px'>
            {t('settings.channels.comingSoonDesc', 'Support for {{channel}} is coming soon', {
              channel: t('settings.channels.discordTitle', 'Discord'),
            })}
          </div>
        ),
      },
    ].filter((channel) => !extensionTypeSet.has(String(channel.id).toLowerCase()));

    return [...builtinChannels, ...extensionChannels, ...comingSoonChannels];
  }, [
    extensionLoadingMap,
    getBuiltinDescription,
    getBuiltinTitle,
    pluginLoadingMap,
    pluginStatuses,
    renderExtensionConfigForm,
    renderBuiltinConfigForm,
    t,
  ]);

  // Get toggle handler for each channel
  const getToggleHandler = (channelId: string) => {
    const status = pluginStatuses[channelId];
    if (!status) {
      return undefined;
    }

    if (status.isExtension) {
      return (enabled: boolean) => {
        void handleToggleExtensionPlugin(channelId, enabled);
      };
    }

    return (enabled: boolean) => {
      void handleToggleBuiltinPlugin(channelId, enabled);
    };
  };
  const channelGuideText = t('settings.webui.featureChannelsDesc', {
    defaultValue: 'Publish one or more channel instances per platform and route each instance to its own workspace.',
  });
  const channelSetupSteps = [
    t('settings.channels.selectFirst', {
      defaultValue: 'Select a channel and configure credentials.',
    }),
    t('settings.channels.enableAfterConfig', {
      defaultValue: 'Enable it and start chatting with your AI agent.',
    }),
    t('settings.channels.createExtraInstances', {
      defaultValue: 'Create extra instances when you want multiple workspaces on the same platform.',
    }),
  ];

  return (
    <AionScrollArea className={isPageMode ? 'h-full' : ''}>
      <div className='px-[12px] md:px-[28px]'>
        <h2 className='text-20px font-500 text-t-primary m-0'>{t('settings.channels.title', 'Channels')}</h2>
        <div className='space-y-8px mt-10px'>
          <div className='text-13px text-t-secondary leading-relaxed'>{channelGuideText}</div>
          <div className='flex flex-wrap gap-x-12px gap-y-6px'>
            {channelSetupSteps.map((stepLabel, idx) => (
              <div key={stepLabel} className='inline-flex items-center gap-6px'>
                <span className='inline-flex items-center justify-center w-16px h-16px rd-50% text-10px font-600 bg-[rgba(var(--primary-6),0.12)] text-[rgb(var(--primary-6))]'>
                  {idx + 1}
                </span>
                <CheckOne theme='outline' size='12' className='text-[rgb(var(--primary-6))]' />
                <span className='text-12px text-t-secondary'>{stepLabel}</span>
              </div>
            ))}
          </div>
          <div className='flex flex-wrap gap-8px'>
            {BUILTIN_INSTANCEABLE_PLATFORMS.map((platform) => (
              <Button
                key={platform}
                size='mini'
                loading={Boolean(createLoadingMap[platform])}
                onClick={() => {
                  void handleCreatePluginInstance(platform);
                }}
              >
                {t('settings.channels.addInstance', {
                  defaultValue: 'Add {{channel}} instance',
                  channel: getBuiltinTitle(platform),
                })}
              </Button>
            ))}
          </div>
        </div>

        <div className='space-y-12px mt-12px'>
          <DroidChannelRuntimeSettings mode='defaults' />
          {channels.map((channelConfig) => (
            <ChannelItem
              key={channelConfig.id}
              channel={channelConfig}
              isCollapsed={collapseKeys[channelConfig.id] ?? true}
              onToggleCollapse={() => handleToggleCollapse(channelConfig.id)}
              onToggleEnabled={getToggleHandler(channelConfig.id)}
            />
          ))}
        </div>
      </div>
    </AionScrollArea>
  );
};

export default ChannelModalContent;
