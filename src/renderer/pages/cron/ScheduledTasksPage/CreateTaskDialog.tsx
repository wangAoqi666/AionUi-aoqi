/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Form, Input, Message, Radio, Select, TimePicker } from '@arco-design/web-react';
import ModalWrapper from '@renderer/components/base/ModalWrapper';
import { Robot } from '@icon-park/react';
import { ipcBridge } from '@/common';
import type {
  ICreateConversationParams,
  ICreateCronJobParams,
  ICronAgentConfig,
  ICronJob,
} from '@/common/adapter/ipcBridge';
import type { TChatConversation, TProviderWithModel } from '@/common/config/storage';
import { useConversationAgents } from '@renderer/pages/conversation/hooks/useConversationAgents';
import { useOptionalConversationHistoryContext } from '@renderer/hooks/context/ConversationHistoryContext';
import DirectorySelectionModal from '@renderer/components/settings/DirectorySelectionModal';
import {
  getCronWorkspacePath,
  getSelectableCronConversations,
  loadCronWorkspaceDisplayNames,
  resolveDefaultCronWorkspacePath,
} from '@renderer/pages/cron/cronOwnership';
import {
  buildCronScheduleFromDraft,
  createDefaultCronScheduleDraft,
  parseCronSchedule,
  type CronAdvancedMode,
  type CronFrequencyType,
  type CronScheduleDraft,
} from '@renderer/pages/cron/cronUtils';
import {
  buildCliAgentParams,
  buildPresetAssistantParams,
} from '@renderer/pages/conversation/utils/createConversationParams';
import { getActivityTime } from '@renderer/utils/chat/timeline';
import { getAgentLogo } from '@renderer/utils/model/agentLogo';
import type { AvailableAgent } from '@renderer/utils/model/agentTypes';
import { isElectronDesktop } from '@renderer/utils/platform';
import { getWorkspaceDisplayName } from '@renderer/utils/workspace/workspace';
import { buildAgentConversationParams } from '@/common/utils/buildAgentConversationParams';
import { CUSTOM_AVATAR_IMAGE_MAP } from '@/renderer/pages/guid/constants';
import dayjs from 'dayjs';

const FormItem = Form.Item;
const TextArea = Input.TextArea;
const Option = Select.Option;
const AUTO_CREATE_OWNER_CONVERSATION = '__auto_create_owner_conversation__';

interface CreateTaskDialogProps {
  visible: boolean;
  onClose: () => void;
  /** When provided, the dialog operates in edit mode */
  editJob?: ICronJob;
  conversationId?: string;
  conversationTitle?: string;
  agentType?: string;
  defaultWorkspacePath?: string;
  defaultConversationId?: string;
}

type ExecutionMode = 'new_conversation' | 'existing';
type SelectableAgentEntry = {
  key: string;
  agent: AvailableAgent;
};
type WorkspaceOption = {
  path: string;
  displayName: string;
  lastActiveAt: number;
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

function getInputValue(
  valueOrEvent: string | number | React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement> | undefined | null
): string {
  if (typeof valueOrEvent === 'string' || typeof valueOrEvent === 'number') {
    return String(valueOrEvent);
  }

  return valueOrEvent?.target?.value ?? '';
}

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

function buildFallbackConversationParams(
  agent: AvailableAgent,
  workspacePath: string,
  conversationName: string
): ICreateConversationParams {
  const model: TProviderWithModel = {
    id: `${agent.backend}-placeholder`,
    name: agent.name,
    platform: agent.backend,
    baseUrl: '',
    apiKey: '',
    useModel: 'auto',
  };

  return buildAgentConversationParams({
    backend: agent.backend,
    name: conversationName,
    agentName: agent.name,
    workspace: workspacePath,
    cliPath: agent.cliPath,
    customAgentId: agent.customAgentId,
    customWorkspace: true,
    isPreset: agent.isPreset,
    presetAgentType: agent.presetAgentType,
    model,
  });
}

const CreateTaskDialog: React.FC<CreateTaskDialogProps> = ({
  visible,
  onClose,
  editJob,
  conversationId,
  conversationTitle,
  agentType,
  defaultWorkspacePath,
  defaultConversationId,
}) => {
  const { t, i18n } = useTranslation();
  const conversationHistory = useOptionalConversationHistoryContext();
  const availableConversations = conversationHistory?.conversations ?? [];
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const { cliAgents, presetAssistants } = useConversationAgents();
  const [frequency, setFrequency] = useState<CronFrequencyType>('manual');
  const [time, setTime] = useState('09:00');
  const [weekday, setWeekday] = useState('MON');
  const [advancedMode, setAdvancedMode] = useState<CronAdvancedMode>('minuteInterval');
  const [minuteInterval, setMinuteInterval] = useState('5');
  const [hourInterval, setHourInterval] = useState('2');
  const [hourMinute, setHourMinute] = useState('00');
  const [customCronExpr, setCustomCronExpr] = useState('');
  const [selectedWorkspacePath, setSelectedWorkspacePath] = useState('');
  const [selectedOwnerConversationId, setSelectedOwnerConversationId] = useState('');
  const [directorySelectionVisible, setDirectorySelectionVisible] = useState(false);

  const isEditMode = !!editJob;
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('new_conversation');
  const workspaceDisplayNames = useMemo(() => loadCronWorkspaceDisplayNames(), []);
  const conversationMap = useMemo(
    () => new Map(availableConversations.map((conversation) => [conversation.id, conversation] as const)),
    [availableConversations]
  );
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
  const lockedAgentOwnerBackend = lockedAgent?.presetAgentType || lockedAgent?.backend;

  const workspaceOptions = useMemo<WorkspaceOption[]>(() => {
    const workspaceMap = new Map<string, WorkspaceOption>();

    availableConversations.forEach((conversation) => {
      const workspacePath = getCronWorkspacePath(conversation);
      if (!workspacePath) {
        return;
      }

      const lastActiveAt = getActivityTime(conversation);
      const currentOption = workspaceMap.get(workspacePath);
      if (currentOption && currentOption.lastActiveAt >= lastActiveAt) {
        return;
      }

      workspaceMap.set(workspacePath, {
        path: workspacePath,
        displayName: workspaceDisplayNames[workspacePath] || getWorkspaceDisplayName(workspacePath, t),
        lastActiveAt,
      });
    });

    return Array.from(workspaceMap.values()).toSorted(
      (optionA, optionB) => optionB.lastActiveAt - optionA.lastActiveAt
    );
  }, [availableConversations, t, workspaceDisplayNames]);

  const selectableOwnerConversations = useMemo(() => {
    return getSelectableCronConversations(
      availableConversations,
      selectedWorkspacePath || null,
      lockedAgentOwnerBackend
    );
  }, [availableConversations, lockedAgentOwnerBackend, selectedWorkspacePath]);

  const selectedOwnerConversation = selectedOwnerConversationId
    ? conversationMap.get(selectedOwnerConversationId)
    : undefined;
  const selectedWorkspaceDisplayName = selectedWorkspacePath
    ? workspaceDisplayNames[selectedWorkspacePath] || getWorkspaceDisplayName(selectedWorkspacePath, t)
    : '';

  const applyScheduleDraft = useCallback((draft: CronScheduleDraft) => {
    setFrequency(draft.frequency);
    setTime(draft.time);
    setWeekday(draft.weekday);
    setAdvancedMode(draft.advancedMode);
    setMinuteInterval(String(draft.minuteInterval));
    setHourInterval(String(draft.hourInterval));
    setHourMinute(draft.hourMinute);
    setCustomCronExpr(draft.customExpr);
  }, []);

  useEffect(() => {
    if (!visible) return;

    if (editJob) {
      applyScheduleDraft(parseCronSchedule(editJob.schedule));
      setExecutionMode(editJob.target.executionMode || 'existing');
      setSelectedOwnerConversationId(editJob.metadata.conversationId);
      setSelectedWorkspacePath(getCronWorkspacePath(conversationMap.get(editJob.metadata.conversationId)) || '');
      form.setFieldsValue({
        name: editJob.name,
        description: editJob.schedule.description || editJob.name,
        prompt: editJob.target.payload.text,
        agent: getAgentKeyFromJob(editJob),
      });
      return;
    }

    form.resetFields();
    applyScheduleDraft(createDefaultCronScheduleDraft());
    setExecutionMode('new_conversation');

    const initialWorkspacePath = resolveDefaultCronWorkspacePath(availableConversations, {
      preferredConversationId: conversationId || defaultConversationId,
      preferredWorkspacePath: defaultWorkspacePath,
    });
    const preferredConversationId = conversationId || defaultConversationId;
    const defaultOwnerConversationId =
      preferredConversationId &&
      getSelectableCronConversations(availableConversations, initialWorkspacePath, lockedAgentOwnerBackend).some(
        (conversation) => conversation.id === preferredConversationId
      )
        ? preferredConversationId
        : '';

    setSelectedWorkspacePath(initialWorkspacePath || '');
    setSelectedOwnerConversationId(defaultOwnerConversationId || '');
  }, [
    availableConversations,
    conversationId,
    conversationMap,
    defaultConversationId,
    defaultWorkspacePath,
    editJob,
    form,
    lockedAgentOwnerBackend,
    applyScheduleDraft,
    visible,
  ]);

  useEffect(() => {
    if (
      selectedOwnerConversationId &&
      !selectableOwnerConversations.some((conversation) => conversation.id === selectedOwnerConversationId)
    ) {
      setSelectedOwnerConversationId('');
    }
  }, [selectableOwnerConversations, selectedOwnerConversationId]);

  const isAdvancedFrequency = frequency === 'advanced';
  const showTimePicker = frequency === 'daily' || frequency === 'weekdays' || frequency === 'weekly';
  const showWeekdayPicker = frequency === 'weekly';
  const showAdvancedMinuteInterval = isAdvancedFrequency && advancedMode === 'minuteInterval';
  const showAdvancedHourInterval = isAdvancedFrequency && advancedMode === 'hourInterval';
  const showAdvancedTimePicker = isAdvancedFrequency && (advancedMode === 'daily' || advancedMode === 'weekly');
  const showAdvancedWeekdayPicker = isAdvancedFrequency && advancedMode === 'weekly';
  const showAdvancedCronExpr = isAdvancedFrequency && advancedMode === 'cronExpr';

  const scheduleDraft = useMemo<CronScheduleDraft>(
    () => ({
      frequency,
      time,
      weekday,
      advancedMode,
      minuteInterval: Number(minuteInterval),
      hourInterval: Number(hourInterval),
      hourMinute,
      customExpr: customCronExpr,
    }),
    [advancedMode, customCronExpr, frequency, hourInterval, hourMinute, minuteInterval, time, weekday]
  );

  const scheduleInfo = useMemo(() => buildCronScheduleFromDraft(scheduleDraft, t), [scheduleDraft, t]);

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
      const agent = cliAgents.find((entry) => entry.backend === agentId);
      if (agent) {
        resolvedAgentType = agent.backend;
        agentConfig = buildCronAgentConfig(agent);
      }
    } else if (agentKind === 'preset') {
      const agent = presetAssistants.find((entry) => entry.customAgentId === agentId);
      if (agent) {
        resolvedAgentType = (agent.presetAgentType || agent.backend) as ICreateCronJobParams['agentType'];
        agentConfig = buildCronAgentConfig(agent);
      }
    }

    return { agentConfig, resolvedAgentType };
  };

  const handleChooseFolder = useCallback(async () => {
    if (!isElectronDesktop()) {
      setDirectorySelectionVisible(true);
      return;
    }

    try {
      const selectedPaths = await ipcBridge.dialog.showOpen.invoke({ properties: ['openDirectory'] });
      const workspacePath = selectedPaths?.[0];
      if (workspacePath) {
        setSelectedWorkspacePath(workspacePath);
      }
    } catch (error) {
      Message.error(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const handleDirectoryConfirm = useCallback((paths: string[] | undefined) => {
    setDirectorySelectionVisible(false);
    const workspacePath = paths?.[0];
    if (workspacePath) {
      setSelectedWorkspacePath(workspacePath);
    }
  }, []);

  const createOwnerConversation = useCallback(
    async (conversationName: string): Promise<TChatConversation | null> => {
      if (!selectedWorkspacePath || !lockedAgent) {
        return null;
      }

      try {
        const params =
          lockedAgent.isPreset && lockedAgent.customAgentId
            ? await buildPresetAssistantParams(lockedAgent, selectedWorkspacePath, i18n.language)
            : await buildCliAgentParams(lockedAgent, selectedWorkspacePath);

        const nextParams: ICreateConversationParams = {
          ...params,
          name: conversationName,
        };
        return await ipcBridge.conversation.create.invoke(nextParams);
      } catch (error) {
        console.warn('[CreateTaskDialog] Failed to build owner conversation params, falling back:', error);
        return ipcBridge.conversation.create.invoke(
          buildFallbackConversationParams(lockedAgent, selectedWorkspacePath, conversationName)
        );
      }
    },
    [i18n.language, lockedAgent, selectedWorkspacePath]
  );

  const handleSubmit = async () => {
    try {
      const values = await form.validate();
      setSubmitting(true);

      if (frequency === 'advanced' && advancedMode === 'cronExpr' && !customCronExpr.trim()) {
        Message.error(t('cron.page.form.cronExprRequired'));
        return;
      }

      const scheduleExpr = scheduleInfo.expr;
      const scheduleDesc = scheduleInfo.description;
      const selectedAgentKey = lockedAgentEntry?.key || values.agent;

      if (!selectedAgentKey) {
        Message.error(t('cron.page.form.agentRequired'));
        return;
      }

      const { agentConfig, resolvedAgentType } = resolveAgentConfig(selectedAgentKey);

      if (isEditMode) {
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
        let ownerConversation = selectedOwnerConversation;
        let createdOwnerConversationId: string | null = null;
        if (!ownerConversation) {
          if (!selectedWorkspacePath) {
            Message.error(t('cron.page.form.folderRequired'));
            return;
          }

          ownerConversation = await createOwnerConversation(values.name);
          createdOwnerConversationId = ownerConversation?.id || null;
        }

        const params: ICreateCronJobParams = {
          name: values.name,
          description: values.description,
          schedule: { kind: 'cron', expr: scheduleExpr, description: scheduleDesc },
          prompt: values.prompt,
          conversationId: ownerConversation?.id || '',
          conversationTitle: ownerConversation?.name || conversationTitle || values.name,
          agentType: resolvedAgentType,
          createdBy: 'user',
          executionMode,
          agentConfig,
        };
        try {
          await ipcBridge.cron.addJob.invoke(params);
        } catch (error) {
          if (createdOwnerConversationId) {
            void ipcBridge.conversation.remove.invoke({ id: createdOwnerConversationId }).catch(() => {});
          }
          throw error;
        }
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
    <>
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
                    <img
                      src={lockedAgentAvatarImage}
                      alt={lockedAgent?.name}
                      className='h-18px w-18px object-contain'
                    />
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

            {!isEditMode && (
              <>
                <FormItem label={t('cron.page.form.folder', { defaultValue: 'Folder' })}>
                  <div className='flex flex-col gap-10px'>
                    <div className='rounded-14px border border-solid border-[var(--color-border-2)] bg-fill-1 px-14px py-12px'>
                      <div className='truncate text-14px font-medium text-text-1'>
                        {selectedWorkspaceDisplayName ||
                          t('cron.page.form.folderPlaceholder', { defaultValue: 'Choose a folder' })}
                      </div>
                      <div className='mt-4px break-all text-12px leading-18px text-text-3'>
                        {selectedWorkspacePath ||
                          t('cron.page.form.folderHint', {
                            defaultValue: 'Choose where this scheduled task should live.',
                          })}
                      </div>
                    </div>
                    <div className='flex flex-wrap gap-8px'>
                      <Button type='secondary' onClick={() => void handleChooseFolder()}>
                        {t('cron.page.form.chooseFolder', { defaultValue: 'Choose folder' })}
                      </Button>
                      {workspaceOptions.length > 0 && (
                        <Select
                          value={selectedWorkspacePath}
                          onChange={(value) => setSelectedWorkspacePath(value as string)}
                        >
                          {workspaceOptions.map((workspace) => (
                            <Option key={workspace.path} value={workspace.path}>
                              {workspace.displayName}
                            </Option>
                          ))}
                        </Select>
                      )}
                    </div>
                  </div>
                </FormItem>

                <FormItem label={t('cron.page.form.ownerConversation', { defaultValue: 'Owner conversation' })}>
                  <Select
                    value={selectedOwnerConversationId || AUTO_CREATE_OWNER_CONVERSATION}
                    onChange={(value) => {
                      setSelectedOwnerConversationId(value === AUTO_CREATE_OWNER_CONVERSATION ? '' : (value as string));
                    }}
                  >
                    <Option value={AUTO_CREATE_OWNER_CONVERSATION}>
                      {t('cron.page.form.autoCreateConversation', {
                        defaultValue: 'Create a dedicated owner conversation',
                      })}
                    </Option>
                    {selectableOwnerConversations.map((conversation) => (
                      <Option key={conversation.id} value={conversation.id}>
                        {conversation.name}
                      </Option>
                    ))}
                  </Select>
                  <p className='mb-0 mt-8px text-12px leading-18px text-text-3'>
                    {selectedOwnerConversation
                      ? t('cron.page.form.ownerConversationSelectedHint', {
                          defaultValue: 'This scheduled task will be grouped under the selected conversation.',
                        })
                      : t('cron.page.form.ownerConversationHint', {
                          defaultValue:
                            'If you do not select one, Agent Factory will create a dedicated owner conversation in the chosen folder.',
                        })}
                  </p>
                </FormItem>
              </>
            )}

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

            <FormItem label={t('cron.page.form.frequency')}>
              <Select
                value={frequency}
                onChange={(value) => setFrequency(value as CronFrequencyType)}
                data-testid='cron-frequency-select'
              >
                <Option value='manual'>{t('cron.page.freq.manual')}</Option>
                <Option value='everyMinute'>{t('cron.page.freq.everyMinute')}</Option>
                <Option value='hourly'>{t('cron.page.freq.hourly')}</Option>
                <Option value='daily'>{t('cron.page.freq.daily')}</Option>
                <Option value='weekdays'>{t('cron.page.freq.weekdays')}</Option>
                <Option value='weekly'>{t('cron.page.freq.weekly')}</Option>
                <Option value='advanced'>{t('cron.page.freq.advanced')}</Option>
              </Select>
            </FormItem>

            {isAdvancedFrequency && (
              <div className='mb-16px rounded-12px border border-solid border-[var(--color-border-2)] bg-fill-2 px-14px py-12px'>
                <FormItem label={t('cron.page.form.advancedMode')}>
                  <Select
                    value={advancedMode}
                    onChange={(value) => setAdvancedMode(value as CronAdvancedMode)}
                    data-testid='cron-advanced-mode-select'
                  >
                    <Option value='minuteInterval'>{t('cron.page.advancedMode.minuteInterval')}</Option>
                    <Option value='hourInterval'>{t('cron.page.advancedMode.hourInterval')}</Option>
                    <Option value='daily'>{t('cron.page.advancedMode.daily')}</Option>
                    <Option value='weekly'>{t('cron.page.advancedMode.weekly')}</Option>
                    <Option value='cronExpr'>{t('cron.page.advancedMode.cronExpr')}</Option>
                  </Select>
                </FormItem>

                {showAdvancedMinuteInterval && (
                  <FormItem label={t('cron.page.form.intervalMinutes')}>
                    <Input
                      value={minuteInterval}
                      type='number'
                      min={1}
                      max={59}
                      data-testid='cron-minute-interval-input'
                      onChange={(value) => setMinuteInterval(getInputValue(value))}
                    />
                  </FormItem>
                )}

                {showAdvancedHourInterval && (
                  <div className='grid grid-cols-2 gap-12px'>
                    <FormItem label={t('cron.page.form.intervalHours')}>
                      <Input
                        value={hourInterval}
                        type='number'
                        min={1}
                        max={23}
                        data-testid='cron-hour-interval-input'
                        onChange={(value) => setHourInterval(getInputValue(value))}
                      />
                    </FormItem>
                    <FormItem label={t('cron.page.form.minuteOfHour')}>
                      <Input
                        value={hourMinute}
                        type='number'
                        min={0}
                        max={59}
                        data-testid='cron-hour-minute-input'
                        onChange={(value) => setHourMinute(getInputValue(value))}
                      />
                    </FormItem>
                  </div>
                )}

                {showAdvancedTimePicker && (
                  <FormItem label={t('cron.page.form.runAt')}>
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
                  </FormItem>
                )}

                {showAdvancedWeekdayPicker && (
                  <FormItem label={t('cron.page.form.dayOfWeek')}>
                    <Select value={weekday} onChange={(value) => setWeekday(value as string)}>
                      {WEEKDAYS.map((day) => (
                        <Option key={day.value} value={day.value}>
                          {t(`cron.page.weekday.${day.label}`)}
                        </Option>
                      ))}
                    </Select>
                  </FormItem>
                )}

                {showAdvancedCronExpr && (
                  <FormItem label={t('cron.page.form.cronExpr')}>
                    <Input
                      value={customCronExpr}
                      placeholder={t('cron.page.form.cronExprPlaceholder')}
                      data-testid='cron-expression-input'
                      onChange={(value) => setCustomCronExpr(getInputValue(value))}
                    />
                  </FormItem>
                )}
              </div>
            )}

            {showTimePicker && (
              <div className='mb-16px flex items-center gap-12px'>
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

            {showWeekdayPicker && (
              <div className='mb-16px'>
                <Select value={weekday} onChange={(value) => setWeekday(value as string)}>
                  {WEEKDAYS.map((day) => (
                    <Option key={day.value} value={day.value}>
                      {t(`cron.page.weekday.${day.label}`)}
                    </Option>
                  ))}
                </Select>
              </div>
            )}

            {(frequency !== 'manual' || isAdvancedFrequency) && (
              <>
                <div className='mb-12px rounded-12px border border-solid border-[var(--color-border-2)] bg-fill-2 px-14px py-12px'>
                  <p className='m-0 text-12px leading-18px text-text-3'>{t('cron.page.form.schedulePreview')}</p>
                  <p className='m-0 mt-6px break-all text-13px leading-20px text-text-1'>{scheduleInfo.description}</p>
                </div>
                <p className='mb-16px mt-0 text-12px text-text-3'>{t('cron.page.scheduleHint')}</p>
              </>
            )}
          </Form>
        </div>
      </ModalWrapper>
      <DirectorySelectionModal
        visible={directorySelectionVisible}
        onConfirm={handleDirectoryConfirm}
        onCancel={() => setDirectorySelectionVisible(false)}
      />
    </>
  );
};

export default CreateTaskDialog;
