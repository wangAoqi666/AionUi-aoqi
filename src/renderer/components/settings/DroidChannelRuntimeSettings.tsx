/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Input, InputNumber, Message, Select, Switch } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import {
  type DroidChannelPlatform,
  type DroidChannelRuntimeConfig,
  DEFAULT_DROID_CHANNEL_RUNTIME_CONFIG,
  resolveDroidChannelRuntimeConfig,
  sanitizeDroidChannelRuntimeConfig,
} from '@/common/config/storage';
import { ConfigStorage } from '@/common/config/storage';
import {
  loadChannelInstanceSettings,
  updateChannelInstanceSettings,
} from './SettingsModal/contents/channels/channelInstanceSettings';

type RuntimeStorageKey =
  | 'assistant.droidRuntime.defaults'
  | 'assistant.telegram.droidRuntime'
  | 'assistant.lark.droidRuntime'
  | 'assistant.dingtalk.droidRuntime'
  | 'assistant.weixin.droidRuntime';

type DroidChannelRuntimeSettingsProps =
  | {
      mode: 'defaults';
    }
  | {
      mode: 'override';
      platform: DroidChannelPlatform;
      pluginId: string;
    };

const platformKeyMap: Record<DroidChannelPlatform, RuntimeStorageKey> = {
  telegram: 'assistant.telegram.droidRuntime',
  lark: 'assistant.lark.droidRuntime',
  dingtalk: 'assistant.dingtalk.droidRuntime',
  weixin: 'assistant.weixin.droidRuntime',
};

const defaultsStorageKey: RuntimeStorageKey = 'assistant.droidRuntime.defaults';

const toMinutes = (milliseconds?: number) => (milliseconds ? Math.max(1, Math.round(milliseconds / 60000)) : undefined);

const toMilliseconds = (minutes?: number) =>
  typeof minutes === 'number' && Number.isFinite(minutes) ? Math.max(1, Math.trunc(minutes)) * 60 * 1000 : undefined;

const parseMultilineList = (value: string): string[] =>
  value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);

const FieldLabel: React.FC<{ title: string; description: string }> = ({ title, description }) => (
  <div className='space-y-4px'>
    <div className='text-13px text-t-primary'>{title}</div>
    <div className='text-12px text-t-tertiary leading-relaxed'>{description}</div>
  </div>
);

const RuntimeBlock: React.FC<{
  title: string;
  description: string;
  children: React.ReactNode;
}> = ({ title, description, children }) => (
  <div className='bg-fill-1 rd-12px p-16px space-y-16px'>
    <div className='space-y-4px'>
      <div className='text-14px font-500 text-t-primary'>{title}</div>
      <div className='text-12px text-t-tertiary leading-relaxed'>{description}</div>
    </div>
    {children}
  </div>
);

const DroidChannelRuntimeSettings: React.FC<DroidChannelRuntimeSettingsProps> = (props) => {
  const { t } = useTranslation();
  const [globalDefaults, setGlobalDefaults] = useState<DroidChannelRuntimeConfig>({});
  const [config, setConfig] = useState<DroidChannelRuntimeConfig>({});
  const [loaded, setLoaded] = useState(false);
  const skipPersistRef = useRef(true);

  const storageKey = props.mode === 'defaults' ? defaultsStorageKey : platformKeyMap[props.platform];

  const loadConfig = useCallback(async () => {
    try {
      const [defaultsValue, currentValue] = await Promise.all([
        ConfigStorage.get(defaultsStorageKey),
        props.mode === 'defaults'
          ? ConfigStorage.get(storageKey)
          : loadChannelInstanceSettings(props.pluginId, props.platform).then((settings) => settings.droidRuntime),
      ]);
      setGlobalDefaults(sanitizeDroidChannelRuntimeConfig(defaultsValue));
      setConfig(sanitizeDroidChannelRuntimeConfig(currentValue));
      skipPersistRef.current = true;
      setLoaded(true);
    } catch (error) {
      console.error('[DroidChannelRuntimeSettings] Failed to load config:', error);
    }
  }, [storageKey]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    if (!loaded) {
      return;
    }
    if (skipPersistRef.current) {
      skipPersistRef.current = false;
      return;
    }

    const persist = async () => {
      try {
        const nextConfig = sanitizeDroidChannelRuntimeConfig(config);
        if (props.mode === 'defaults') {
          await ConfigStorage.set(storageKey, nextConfig);
          return;
        }

        await updateChannelInstanceSettings(props.pluginId, (current) => ({
          ...current,
          droidRuntime: nextConfig,
        }));
      } catch (error) {
        console.error('[DroidChannelRuntimeSettings] Failed to save config:', error);
        Message.error(t('common.saveFailed', 'Failed to save'));
      }
    };

    void persist();
  }, [config, loaded, props, storageKey, t]);

  const effectiveConfig = useMemo(
    () => resolveDroidChannelRuntimeConfig(globalDefaults, props.mode === 'defaults' ? config : config),
    [config, globalDefaults, props.mode]
  );

  const isOverrideMode = props.mode === 'override';
  const inheritDefaults = isOverrideMode ? config.inheritDefaults !== false : false;

  const updateField = <K extends keyof DroidChannelRuntimeConfig>(key: K, value: DroidChannelRuntimeConfig[K]) => {
    setConfig((previous) => ({
      ...previous,
      [key]: value,
    }));
  };

  const handleOverrideToggle = async (enabled: boolean) => {
    if (!isOverrideMode) {
      return;
    }

    if (!enabled) {
      setConfig({ inheritDefaults: true });
      return;
    }

    const defaultsValue = sanitizeDroidChannelRuntimeConfig(await ConfigStorage.get(defaultsStorageKey));
    const resolved = resolveDroidChannelRuntimeConfig(defaultsValue, {});
    setGlobalDefaults(defaultsValue);
    setConfig({
      inheritDefaults: false,
      maxConcurrentStarts: resolved.maxConcurrentStarts,
      maxConcurrentRuns: resolved.maxConcurrentRuns,
      maxWarmSessions: resolved.maxWarmSessions,
      warmTtlMs: resolved.warmTtlMs,
      askReplyTtlMs: resolved.askReplyTtlMs,
      maxQueuePerConversation: resolved.maxQueuePerConversation,
      maxQueuePerPublishedAgent: resolved.maxQueuePerPublishedAgent,
      overloadStrategy: resolved.overloadStrategy,
      permissionMode: resolved.permissionMode,
      allowExecCommands: resolved.allowExecCommands,
      allowEditRoots: resolved.allowEditRoots,
      allowMcpTools: resolved.allowMcpTools,
    });
  };

  const title = isOverrideMode
    ? t('settings.channels.droidRuntime.overrideTitle', {
        defaultValue: 'Droid published runtime override',
      })
    : t('settings.channels.droidRuntime.defaultsTitle', {
        defaultValue: 'Droid published runtime defaults',
      });

  const description = isOverrideMode
    ? t('settings.channels.droidRuntime.overrideDesc', {
        defaultValue:
          'Override queueing, warm pool, AskUser, and permission policy for this channel when Droid is selected.',
      })
    : t('settings.channels.droidRuntime.defaultsDesc', {
        defaultValue: 'Global defaults used by Droid-powered published channels.',
      });

  return (
    <RuntimeBlock title={title} description={description}>
      {isOverrideMode && (
        <div className='flex items-center justify-between gap-16px'>
          <FieldLabel
            title={t('settings.channels.droidRuntime.customizeTitle', {
              defaultValue: 'Customize this channel runtime',
            })}
            description={t('settings.channels.droidRuntime.customizeDesc', {
              defaultValue: 'Turn this on to override the global Droid published runtime defaults for this channel.',
            })}
          />
          <Switch checked={!inheritDefaults} onChange={handleOverrideToggle} />
        </div>
      )}

      {inheritDefaults ? (
        <div className='text-12px text-t-tertiary leading-relaxed'>
          {t('settings.channels.droidRuntime.inheritingDefaults', {
            defaultValue: 'This channel is currently inheriting the global Droid published runtime defaults.',
          })}
        </div>
      ) : (
        <div className='space-y-12px'>
          <div className='grid grid-cols-1 gap-12px md:grid-cols-2'>
            <div className='space-y-6px'>
              <FieldLabel
                title={t('settings.channels.droidRuntime.maxConcurrentStarts', {
                  defaultValue: 'Max concurrent starts',
                })}
                description={t('settings.channels.droidRuntime.maxConcurrentStartsDesc', {
                  defaultValue: 'How many Droid cold starts or resumes may run at the same time.',
                })}
              />
              <InputNumber
                value={config.maxConcurrentStarts ?? effectiveConfig.maxConcurrentStarts}
                min={1}
                className='w-full'
                onChange={(value) => updateField('maxConcurrentStarts', Number(value || 1))}
              />
            </div>
            <div className='space-y-6px'>
              <FieldLabel
                title={t('settings.channels.droidRuntime.maxConcurrentRuns', {
                  defaultValue: 'Max concurrent runs',
                })}
                description={t('settings.channels.droidRuntime.maxConcurrentRunsDesc', {
                  defaultValue: 'How many Droid turns may actively run at the same time.',
                })}
              />
              <InputNumber
                value={config.maxConcurrentRuns ?? effectiveConfig.maxConcurrentRuns}
                min={1}
                className='w-full'
                onChange={(value) => updateField('maxConcurrentRuns', Number(value || 1))}
              />
            </div>
            <div className='space-y-6px'>
              <FieldLabel
                title={t('settings.channels.droidRuntime.maxWarmSessions', {
                  defaultValue: 'Max warm sessions',
                })}
                description={t('settings.channels.droidRuntime.maxWarmSessionsDesc', {
                  defaultValue: 'How many idle Droid sessions may stay warm before the oldest one is reclaimed.',
                })}
              />
              <InputNumber
                value={config.maxWarmSessions ?? effectiveConfig.maxWarmSessions}
                min={1}
                className='w-full'
                onChange={(value) => updateField('maxWarmSessions', Number(value || 1))}
              />
            </div>
            <div className='space-y-6px'>
              <FieldLabel
                title={t('settings.channels.droidRuntime.warmTtlMinutes', {
                  defaultValue: 'Warm TTL (minutes)',
                })}
                description={t('settings.channels.droidRuntime.warmTtlMinutesDesc', {
                  defaultValue: 'How long an idle Droid session stays warm before it is closed.',
                })}
              />
              <InputNumber
                value={toMinutes(config.warmTtlMs) ?? toMinutes(effectiveConfig.warmTtlMs)}
                min={1}
                className='w-full'
                onChange={(value) => updateField('warmTtlMs', toMilliseconds(Number(value || 1)))}
              />
            </div>
            <div className='space-y-6px'>
              <FieldLabel
                title={t('settings.channels.droidRuntime.askReplyTtlMinutes', {
                  defaultValue: 'Ask reply TTL (minutes)',
                })}
                description={t('settings.channels.droidRuntime.askReplyTtlMinutesDesc', {
                  defaultValue: 'How long Droid waits for a text answer to AskUser before cancelling it.',
                })}
              />
              <InputNumber
                value={toMinutes(config.askReplyTtlMs) ?? toMinutes(effectiveConfig.askReplyTtlMs)}
                min={1}
                className='w-full'
                onChange={(value) => updateField('askReplyTtlMs', toMilliseconds(Number(value || 1)))}
              />
            </div>
            <div className='space-y-6px'>
              <FieldLabel
                title={t('settings.channels.droidRuntime.maxQueuePerConversation', {
                  defaultValue: 'Max queue per conversation',
                })}
                description={t('settings.channels.droidRuntime.maxQueuePerConversationDesc', {
                  defaultValue: 'Maximum queued turns allowed for a single published conversation.',
                })}
              />
              <InputNumber
                value={config.maxQueuePerConversation ?? effectiveConfig.maxQueuePerConversation}
                min={1}
                className='w-full'
                onChange={(value) => updateField('maxQueuePerConversation', Number(value || 1))}
              />
            </div>
            <div className='space-y-6px'>
              <FieldLabel
                title={t('settings.channels.droidRuntime.maxQueuePerPublishedAgent', {
                  defaultValue: 'Max queue per published agent',
                })}
                description={t('settings.channels.droidRuntime.maxQueuePerPublishedAgentDesc', {
                  defaultValue: 'Maximum queued turns allowed across all conversations for this published channel.',
                })}
              />
              <InputNumber
                value={config.maxQueuePerPublishedAgent ?? effectiveConfig.maxQueuePerPublishedAgent}
                min={1}
                className='w-full'
                onChange={(value) => updateField('maxQueuePerPublishedAgent', Number(value || 1))}
              />
            </div>
            <div className='space-y-6px'>
              <FieldLabel
                title={t('settings.channels.droidRuntime.overloadStrategy', {
                  defaultValue: 'Overload strategy',
                })}
                description={t('settings.channels.droidRuntime.overloadStrategyDesc', {
                  defaultValue: 'Choose whether excess traffic should queue or be rejected immediately.',
                })}
              />
              <Select
                value={config.overloadStrategy ?? effectiveConfig.overloadStrategy}
                options={[
                  {
                    label: t('settings.channels.droidRuntime.queueLabel', { defaultValue: 'Queue' }),
                    value: 'queue',
                  },
                  {
                    label: t('settings.channels.droidRuntime.rejectLabel', { defaultValue: 'Reject' }),
                    value: 'reject',
                  },
                ]}
                onChange={(value) =>
                  updateField('overloadStrategy', value as DroidChannelRuntimeConfig['overloadStrategy'])
                }
              />
            </div>
            <div className='space-y-6px'>
              <FieldLabel
                title={t('settings.channels.droidRuntime.permissionMode', {
                  defaultValue: 'Permission mode',
                })}
                description={t('settings.channels.droidRuntime.permissionModeDesc', {
                  defaultValue: 'Choose how Droid should resolve permission requests in published mode.',
                })}
              />
              <Select
                value={config.permissionMode ?? effectiveConfig.permissionMode}
                options={[
                  {
                    label: t('settings.channels.droidRuntime.safeAutoLabel', { defaultValue: 'Safe auto' }),
                    value: 'safe-auto',
                  },
                  {
                    label: t('settings.channels.droidRuntime.denyAllLabel', { defaultValue: 'Deny all' }),
                    value: 'deny-all',
                  },
                  {
                    label: t('settings.channels.droidRuntime.customLabel', { defaultValue: 'Custom allowlists' }),
                    value: 'custom',
                  },
                ]}
                onChange={(value) =>
                  updateField('permissionMode', value as DroidChannelRuntimeConfig['permissionMode'])
                }
              />
            </div>
          </div>

          <div className='space-y-6px'>
            <FieldLabel
              title={t('settings.channels.droidRuntime.allowExecCommands', {
                defaultValue: 'Allowed Execute commands',
              })}
              description={t('settings.channels.droidRuntime.allowExecCommandsDesc', {
                defaultValue:
                  'One command prefix per line. These commands can run without waiting for a permission click.',
              })}
            />
            <Input.TextArea
              value={(config.allowExecCommands ?? effectiveConfig.allowExecCommands).join('\n')}
              autoSize={{ minRows: 3, maxRows: 6 }}
              onChange={(value) => updateField('allowExecCommands', parseMultilineList(value))}
              placeholder={t('settings.channels.droidRuntime.listPlaceholder', {
                defaultValue: 'One item per line',
              })}
            />
          </div>

          <div className='space-y-6px'>
            <FieldLabel
              title={t('settings.channels.droidRuntime.allowEditRoots', {
                defaultValue: 'Allowed edit roots',
              })}
              description={t('settings.channels.droidRuntime.allowEditRootsDesc', {
                defaultValue:
                  'One workspace-relative directory per line. File edits outside these paths will be denied.',
              })}
            />
            <Input.TextArea
              value={(config.allowEditRoots ?? effectiveConfig.allowEditRoots).join('\n')}
              autoSize={{ minRows: 3, maxRows: 6 }}
              onChange={(value) => updateField('allowEditRoots', parseMultilineList(value))}
              placeholder={t('settings.channels.droidRuntime.listPlaceholder', {
                defaultValue: 'One item per line',
              })}
            />
          </div>

          <div className='space-y-6px'>
            <FieldLabel
              title={t('settings.channels.droidRuntime.allowMcpTools', {
                defaultValue: 'Allowed MCP tools',
              })}
              description={t('settings.channels.droidRuntime.allowMcpToolsDesc', {
                defaultValue: 'One tool name per line. Example: figma___get_design.',
              })}
            />
            <Input.TextArea
              value={(config.allowMcpTools ?? effectiveConfig.allowMcpTools).join('\n')}
              autoSize={{ minRows: 3, maxRows: 6 }}
              onChange={(value) => updateField('allowMcpTools', parseMultilineList(value))}
              placeholder={t('settings.channels.droidRuntime.listPlaceholder', {
                defaultValue: 'One item per line',
              })}
            />
          </div>
        </div>
      )}
    </RuntimeBlock>
  );
};

export default DroidChannelRuntimeSettings;
