/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Form, Input, Select, Message, TimePicker, Radio } from '@arco-design/web-react';
import ModalWrapper from '@renderer/components/base/ModalWrapper';
import { Robot } from '@icon-park/react';
import { ipcBridge } from '@/common';
import type { ICreateCronJobParams, ICronAgentConfig, ICronJob } from '@/common/adapter/ipcBridge';
import { useConversationAgents } from '@renderer/pages/conversation/hooks/useConversationAgents';
import { getAgentLogo } from '@renderer/utils/model/agentLogo';
import type { AvailableAgent } from '@renderer/utils/model/agentTypes';
import { CUSTOM_AVATAR_IMAGE_MAP } from '@/renderer/pages/guid/constants';
import dayjs from 'dayjs';

const FormItem = Form.Item;
const TextArea = Input.TextArea;
const Option = Select.Option;

interface CreateTaskDialogProps {
  visible: boolean;
  onClose: () => void;
  /** When provided, the dialog operates in edit mode */
  editJob?: ICronJob;
  conversationId?: string;
  conversationTitle?: string;
  agentType?: string;
}

type FrequencyType = 'manual' | 'hourly' | 'daily' | 'weekdays' | 'weekly';
type ExecutionMode = 'new_conversation' | 'existing';
type SelectableAgentEntry = {
  key: string;
  agent: AvailableAgent;
};

const WEEKDAYS = [
  { value: 'MON', label: 'monday' },
  { value: 'TUE', label: 'tuesday' },
  { value: 'WED', label: 'wednesday' },
  { value: 'THU', label: 'thursday' },
  { value: 'FRI', label: 'friday' },
  { value: 'SAT', label: 'saturday' },
  { value: 'SUN', label: 'sunday' },
];

/**
 * Infer frequency type and time/weekday from a cron expression for edit mode.
 */
function parseCronExpr(expr: string): { frequency: FrequencyType; time: string; weekday: string } {
  if (!expr) return { frequency: 'manual', time: '09:00', weekday: 'MON' };

  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return { frequency: 'daily', time: '09:00', weekday: 'MON' };

  const [min, hour, , , dow] = parts;

  // Hourly: 0 * * * *
  if (hour === '*') return { frequency: 'hourly', time: '09:00', weekday: 'MON' };

  const hh = String(hour).padStart(2, '0');
  const mm = String(min).padStart(2, '0');
  const time = `${hh}:${mm}`;

  // Weekdays: min hour * * MON-FRI
  if (dow === 'MON-FRI') return { frequency: 'weekdays', time, weekday: 'MON' };

  // Weekly: min hour * * DAY
  if (dow !== '*') {
    const dayUpper = dow.toUpperCase();
    const matched = WEEKDAYS.find((d) => d.value === dayUpper);
    if (matched) return { frequency: 'weekly', time, weekday: dayUpper };
    return { frequency: 'daily', time, weekday: 'MON' };
  }

  // Daily: min hour * * *
  return { frequency: 'daily', time, weekday: 'MON' };
}

/**
 * Infer the agent selection key from an ICronJob's agentConfig.
 */
function getAgentKeyFromJob(job: ICronJob): string | undefined {
  const config = job.metadata.agentConfig;
  if (!config) return undefined;
  if (config.isPreset && config.customAgentId) return `preset:${config.customAgentId}`;
  return `cli:${config.backend}`;
}

function buildCronAgentConfig(agent: AvailableAgent): ICronAgentConfig {
  return {
    backend: agent.backend,
    name: agent.name,
    cliPath: agent.cliPath,
    ...(agent.isPreset && agent.customAgentId
      ? {
          isPreset: true,
          customAgentId: agent.customAgentId,
          presetAgentType: agent.presetAgentType,
        }
      : {}),
  };
}

const CreateTaskDialog: React.FC<CreateTaskDialogProps> = ({
  visible,
  onClose,
  editJob,
  conversationId: _conversationId,
  conversationTitle,
  agentType,
}) => {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const { cliAgents, presetAssistants } = useConversationAgents();
  const [frequency, setFrequency] = useState<FrequencyType>('manual');
  const [time, setTime] = useState('09:00');
  const [weekday, setWeekday] = useState('MON');

  const isEditMode = !!editJob;
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('new_conversation');
  const availableAgentEntries = useMemo<SelectableAgentEntry[]>(
    () => [
      ...cliAgents.map((agent) => ({ key: `cli:${agent.backend}`, agent })),
      ...presetAssistants
        .filter((agent): agent is AvailableAgent & { customAgentId: string } => Boolean(agent.customAgentId))
        .map((agent) => ({ key: `preset:${agent.customAgentId}`, agent })),
    ],
    [cliAgents, presetAssistants]
  );

  const lockedAgentEntry = useMemo<SelectableAgentEntry | undefined>(() => {
    if (editJob) {
      const editAgentKey = getAgentKeyFromJob(editJob);
      const existingEntry = editAgentKey
        ? availableAgentEntries.find((entry) => entry.key === editAgentKey)
        : undefined;
      if (existingEntry) {
        return existingEntry;
      }

      const config = editJob.metadata.agentConfig;
      if (editAgentKey) {
        return {
          key: editAgentKey,
          agent: {
            backend: (config?.backend || editJob.metadata.agentType) as AvailableAgent['backend'],
            name: config?.name || editJob.metadata.agentType,
            cliPath: config?.cliPath,
            customAgentId: config?.customAgentId,
            isPreset: config?.isPreset,
            presetAgentType: config?.presetAgentType,
          },
        };
      }
    }

    if (agentType) {
      const currentConversationAgent = availableAgentEntries.find(({ agent }) => {
        const effectiveType = agent.presetAgentType || agent.backend;
        return effectiveType === agentType || agent.backend === agentType;
      });
      if (currentConversationAgent) {
        return currentConversationAgent;
      }
    }

    return availableAgentEntries.find(({ agent }) => agent.backend === 'droid') || availableAgentEntries[0];
  }, [agentType, availableAgentEntries, editJob]);

  const lockedAgent = lockedAgentEntry?.agent;
  const lockedAgentLogo = lockedAgent ? getAgentLogo(lockedAgent.backend) : null;
  const lockedAgentAvatarImage = lockedAgent?.avatar ? CUSTOM_AVATAR_IMAGE_MAP[lockedAgent.avatar] : undefined;
  const lockedAgentIsEmoji =
    Boolean(lockedAgent?.avatar) && !lockedAgentAvatarImage && !lockedAgent?.avatar?.endsWith('.svg');
  const lockedAgentCategoryLabel = lockedAgentEntry?.key.startsWith('preset:')
    ? t('conversation.dropdown.presetAssistants')
    : t('conversation.dropdown.cliAgents');

  // Populate form when entering edit mode
  useEffect(() => {
    if (!visible) return;
    if (editJob) {
      const cronExpr = editJob.schedule.kind === 'cron' ? editJob.schedule.expr : '';
      const parsed = parseCronExpr(cronExpr);
      setFrequency(parsed.frequency);
      setTime(parsed.time);
      setWeekday(parsed.weekday);
      setExecutionMode(editJob.target.executionMode || 'existing');
      form.setFieldsValue({
        name: editJob.name,
        description: editJob.schedule.description || editJob.name,
        prompt: editJob.target.payload.text,
        agent: getAgentKeyFromJob(editJob),
      });
    } else {
      form.resetFields();
      setFrequency('manual');
      setTime('09:00');
      setWeekday('MON');
      setExecutionMode('new_conversation');
    }
  }, [visible, editJob, form]);

  const showTimePicker = frequency === 'daily' || frequency === 'weekdays' || frequency === 'weekly';
  const showWeekdayPicker = frequency === 'weekly';

  // Build cron expression and description from frequency settings
  const scheduleInfo = useMemo(() => {
    const [hour, minute] = time.split(':').map(Number);
    switch (frequency) {
      case 'manual':
        return { expr: '', description: t('cron.page.scheduleDesc.manual') };
      case 'hourly':
        return { expr: '0 * * * *', description: t('cron.page.scheduleDesc.hourly') };
      case 'daily':
        return { expr: `${minute} ${hour} * * *`, description: t('cron.page.scheduleDesc.dailyAt', { time }) };
      case 'weekdays':
        return { expr: `${minute} ${hour} * * MON-FRI`, description: t('cron.page.scheduleDesc.weekdaysAt', { time }) };
      case 'weekly': {
        const dayLabel = WEEKDAYS.find((d) => d.value === weekday)?.label ?? weekday;
        return {
          expr: `${minute} ${hour} * * ${weekday}`,
          description: t('cron.page.scheduleDesc.weeklyAt', { day: t(`cron.page.weekday.${dayLabel}`), time }),
        };
      }
      default:
        return { expr: '', description: '' };
    }
  }, [frequency, time, weekday, t]);

  const executionModeOptions = useMemo(
    () => [
      {
        value: 'new_conversation' as const,
        label: t('cron.page.form.newConversation'),
        description: t('cron.detail.executionModeDescriptionNew'),
      },
      {
        value: 'existing' as const,
        label: t('cron.page.form.existingConversation'),
        description: t('cron.detail.executionModeDescriptionExisting'),
      },
    ],
    [t]
  );

  const selectedExecutionModeOption =
    executionModeOptions.find((option) => option.value === executionMode) ?? executionModeOptions[0];

  const handleFrequencyChange = (value: FrequencyType) => {
    setFrequency(value);
  };

  const resolveAgentConfig = (agentValue?: string) => {
    let agentConfig = lockedAgent ? buildCronAgentConfig(lockedAgent) : editJob?.metadata.agentConfig;
    let resolvedAgentType: ICreateCronJobParams['agentType'] = (lockedAgent?.presetAgentType ||
      lockedAgent?.backend ||
      editJob?.metadata.agentType ||
      agentType ||
      'droid') as ICreateCronJobParams['agentType'];

    if (!agentValue) {
      return { agentConfig, resolvedAgentType };
    }

    const colonIdx = agentValue.indexOf(':');
    const agentKind = agentValue.substring(0, colonIdx);
    const agentId = agentValue.substring(colonIdx + 1);

    if (agentKind === 'cli') {
      const agent = cliAgents.find((a) => a.backend === agentId);
      if (agent) {
        resolvedAgentType = agent.backend;
        agentConfig = buildCronAgentConfig(agent);
      }
    } else if (agentKind === 'preset') {
      const agent = presetAssistants.find((a) => a.customAgentId === agentId);
      if (agent) {
        resolvedAgentType = (agent.presetAgentType || agent.backend) as ICreateCronJobParams['agentType'];
        agentConfig = buildCronAgentConfig(agent);
      }
    }

    return { agentConfig, resolvedAgentType };
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validate();
      setSubmitting(true);

      const scheduleExpr = scheduleInfo.expr;
      const scheduleDesc = scheduleInfo.description;
      const selectedAgentKey = lockedAgentEntry?.key || values.agent;

      if (!selectedAgentKey) {
        Message.error(t('cron.page.form.agentRequired'));
        return;
      }

      const { agentConfig, resolvedAgentType } = resolveAgentConfig(selectedAgentKey);

      if (isEditMode) {
        // Edit mode: update existing job
        await ipcBridge.cron.updateJob.invoke({
          jobId: editJob!.id,
          updates: {
            name: values.name,
            schedule: { kind: 'cron', expr: scheduleExpr, description: scheduleDesc },
            target: {
              ...editJob!.target,
              payload: { kind: 'message', text: values.prompt },
              executionMode,
            },
            metadata: {
              ...editJob!.metadata,
              agentType: resolvedAgentType,
              agentConfig,
              updatedAt: Date.now(),
            },
          },
        });
        Message.success(t('cron.page.updateSuccess'));
      } else {
        // Create mode
        const params: ICreateCronJobParams = {
          name: values.name,
          description: values.description,
          schedule: { kind: 'cron', expr: scheduleExpr, description: scheduleDesc },
          prompt: values.prompt,
          conversationId: '',
          conversationTitle,
          agentType: resolvedAgentType,
          createdBy: 'user',
          executionMode,
          agentConfig,
        };
        await ipcBridge.cron.addJob.invoke(params);
        Message.success(t('cron.page.createSuccess'));
      }

      onClose();
    } catch (err) {
      if (err instanceof Error) {
        Message.error(err.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalWrapper
      title={isEditMode ? t('cron.page.editTask') : t('cron.page.createTask')}
      visible={visible}
      onCancel={onClose}
      onOk={handleSubmit}
      confirmLoading={submitting}
      okText={t('cron.page.save')}
      cancelText={t('cron.page.cancel')}
      className='w-[min(560px,calc(100vw-32px))] max-w-560px rd-16px'
      unmountOnExit
    >
      <div className='overflow-y-auto px-24px pb-16px pr-18px max-h-[min(72vh,680px)]'>
        <Form form={form} layout='vertical'>
          <FormItem
            label={t('cron.page.form.name')}
            field='name'
            rules={[{ required: true, message: t('cron.page.form.nameRequired') }]}
          >
            <Input placeholder={t('cron.page.form.namePlaceholder')} />
          </FormItem>

          <FormItem
            label={t('cron.page.form.description')}
            field='description'
            rules={[{ required: true, message: t('cron.page.form.descriptionRequired') }]}
          >
            <Input placeholder={t('cron.page.form.descriptionPlaceholder')} />
          </FormItem>

          <FormItem label={t('cron.page.form.agent')}>
            <div className='flex items-center gap-12px rounded-14px border border-solid border-[var(--color-border-2)] bg-fill-1 px-14px py-12px'>
              <div className='flex h-36px w-36px shrink-0 items-center justify-center rounded-12px bg-[var(--color-bg-2)] text-[var(--color-text-2)]'>
                {lockedAgentAvatarImage ? (
                  <img src={lockedAgentAvatarImage} alt={lockedAgent?.name} className='h-18px w-18px object-contain' />
                ) : lockedAgentIsEmoji ? (
                  <span className='text-16px leading-18px'>{lockedAgent?.avatar}</span>
                ) : lockedAgentLogo ? (
                  <img src={lockedAgentLogo} alt={lockedAgent?.name} className='h-18px w-18px object-contain' />
                ) : (
                  <Robot size='18' />
                )}
              </div>
              <div className='min-w-0 flex-1'>
                <div className='truncate text-14px font-medium text-text-1'>
                  {lockedAgent?.name || t('cron.page.form.agentRequired')}
                </div>
                {lockedAgent && <div className='text-12px leading-18px text-text-3'>{lockedAgentCategoryLabel}</div>}
              </div>
            </div>
          </FormItem>

          <FormItem label={t('cron.page.form.executionMode')}>
            <Radio.Group
              value={executionMode}
              onChange={(value) => setExecutionMode(value as ExecutionMode)}
              disabled={isEditMode}
              className='flex flex-wrap items-center gap-20px'
            >
              {executionModeOptions.map((option) => {
                return (
                  <Radio
                    key={option.value}
                    value={option.value}
                    className={[
                      'm-0 min-w-0 text-14px text-text-2',
                      isEditMode ? 'cursor-not-allowed opacity-70' : 'cursor-pointer',
                    ].join(' ')}
                  >
                    <span className='pl-4px text-14px font-medium text-text-1'>{option.label}</span>
                  </Radio>
                );
              })}
            </Radio.Group>
            <div className='mt-10px rounded-12px border border-solid border-[var(--color-border-2)] bg-fill-2 px-14px py-12px'>
              <p className='m-0 text-12px leading-18px text-text-2'>{selectedExecutionModeOption.description}</p>
              {isEditMode && (
                <p className='m-0 mt-8px text-12px leading-18px text-text-3'>
                  {t('cron.page.form.executionModeEditHint')}
                </p>
              )}
            </div>
          </FormItem>

          <FormItem
            label={t('cron.page.form.prompt')}
            field='prompt'
            rules={[{ required: true, message: t('cron.page.form.promptRequired') }]}
          >
            <TextArea placeholder={t('cron.page.form.promptPlaceholder')} autoSize={{ minRows: 4, maxRows: 8 }} />
          </FormItem>

          {/* Frequency */}
          <FormItem label={t('cron.page.form.frequency')}>
            <Select value={frequency} onChange={handleFrequencyChange}>
              <Option value='manual'>{t('cron.page.freq.manual')}</Option>
              <Option value='hourly'>{t('cron.page.freq.hourly')}</Option>
              <Option value='daily'>{t('cron.page.freq.daily')}</Option>
              <Option value='weekdays'>{t('cron.page.freq.weekdays')}</Option>
              <Option value='weekly'>{t('cron.page.freq.weekly')}</Option>
            </Select>
          </FormItem>

          {/* Time picker - shown for daily/weekdays/weekly */}
          {showTimePicker && (
            <div className='flex items-center gap-12px mb-16px'>
              <TimePicker
                format='HH:mm'
                value={dayjs(`2000-01-01 ${time}`)}
                onChange={(_timeStr, pickedTime) => {
                  if (pickedTime) {
                    setTime(pickedTime.format('HH:mm'));
                  }
                }}
                allowClear={false}
                className='w-120px'
              />
            </div>
          )}

          {/* Weekday picker - shown for weekly */}
          {showWeekdayPicker && (
            <div className='mb-16px'>
              <Select value={weekday} onChange={setWeekday}>
                {WEEKDAYS.map((d) => (
                  <Option key={d.value} value={d.value}>
                    {t(`cron.page.weekday.${d.label}`)}
                  </Option>
                ))}
              </Select>
            </div>
          )}

          {/* Hint text */}
          {frequency !== 'manual' && (
            <p className='text-text-3 text-12px mt-0 mb-16px'>{t('cron.page.scheduleHint')}</p>
          )}
        </Form>
      </div>
    </ModalWrapper>
  );
};

export default CreateTaskDialog;
