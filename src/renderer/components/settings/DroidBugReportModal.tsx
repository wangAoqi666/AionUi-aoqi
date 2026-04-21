/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { TChatConversation } from '@/common/config/storage';
import AionModal from '@/renderer/components/base/AionModal';
import ModalHOC from '@/renderer/utils/ui/ModalHOC';
import { Button, Checkbox, Input, Message } from '@arco-design/web-react';
import { Bug } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';

/**
 * DroidBugReportModal — P2-4 "report to Factory" UI entry point.
 *
 * Collects a short title + longer description from the user and forwards them
 * to `DroidSdkAgent.submitBugReport` via the `acp.submit-droid-bug-report`
 * IPC channel. Only enabled when the current route is a live Droid-backed
 * conversation (the Modal owner reads `useLocation().pathname` to resolve
 * the conversation id, then calls `conversation.get` to inspect the
 * `extra.backend` flag).
 *
 * Hard constraints (mirrored from `DroidSdkAgent.submitBugReport`):
 *   1. `clientLogs` is NEVER attached — the main process packs title /
 *      description + environment metadata into `userComment` and leaves the
 *      optional log blob empty on the wire.
 *   2. `includeSessionId` defaults to `true`; the checkbox here lets the
 *      user opt out so they can submit a purely environmental report.
 *   3. No Factory/Agent logo in the Modal chrome (Logo rule L1/L2): we use
 *      IconPark `Bug` as a neutral abstract icon.
 *
 * 调用链：Renderer → `ipcBridge.acpConversation.submitBugReport` →
 *   `acpConversationBridge` → `AcpAgentManager.submitBugReport` →
 *   `DroidSdkAgent.submitBugReport` → `DroidClient.submitBugReport` (SDK)
 */
export interface DroidBugReportModalProps {
  /** Optional override for the conversation id. When omitted the component
   *  resolves the current conversation from the URL (`/conversation/:id`). */
  conversationId?: string;
}

const extractConversationIdFromPath = (pathname: string): string | null => {
  const match = pathname.match(/^\/conversation\/([^/]+)/);
  return match ? match[1] : null;
};

const MIN_DESCRIPTION_LENGTH = 10;
const MAX_TITLE_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 4000;

const DroidBugReportModal = ModalHOC<DroidBugReportModalProps>(({ modalProps, conversationId, modalCtrl }) => {
  const { t } = useTranslation();
  const location = useLocation();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [includeSessionId, setIncludeSessionId] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [resolvedConversation, setResolvedConversation] = useState<TChatConversation | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);

  // Resolve the active conversation when the modal opens. We prefer the
  // explicitly-provided `conversationId` prop; otherwise fall back to the
  // URL-based resolution (only the conversation route carries this segment).
  //
  // 打开时解析当前会话：显式 prop 优先，否则从 URL `/conversation/:id` 取。
  useEffect(() => {
    if (!modalProps.visible) {
      return;
    }
    const targetId = conversationId ?? extractConversationIdFromPath(location.pathname);
    if (!targetId) {
      setResolvedConversation(null);
      setResolveError(
        t('settings.droidBugReport.errorNoConversation', {
          defaultValue: '请先打开一个 Droid 会话再提交反馈。',
        })
      );
      return;
    }

    let cancelled = false;
    setResolveError(null);
    ipcBridge.conversation.get
      .invoke({ id: targetId })
      .then((conversation) => {
        if (cancelled) return;
        setResolvedConversation(conversation ?? null);
      })
      .catch((err) => {
        if (cancelled) return;
        setResolvedConversation(null);
        setResolveError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [modalProps.visible, conversationId, location.pathname, t]);

  // Reset the form when the Modal closes so a re-open starts clean.
  useEffect(() => {
    if (!modalProps.visible) {
      setTitle('');
      setDescription('');
      setIncludeSessionId(true);
      setSubmitting(false);
    }
  }, [modalProps.visible]);

  const isDroidConversation = useMemo(() => {
    if (!resolvedConversation) return false;
    if (resolvedConversation.type !== 'acp') return false;
    const extra = resolvedConversation.extra as { backend?: string } | undefined;
    return extra?.backend === 'droid';
  }, [resolvedConversation]);

  const disabledReason = useMemo(() => {
    if (resolveError) return resolveError;
    if (!resolvedConversation) {
      return t('settings.droidBugReport.errorNoConversation', {
        defaultValue: '请先打开一个 Droid 会话再提交反馈。',
      });
    }
    if (!isDroidConversation) {
      return t('settings.droidBugReport.errorNotDroid', {
        defaultValue: '仅 Droid 后端会话支持提交反馈。',
      });
    }
    return null;
  }, [resolveError, resolvedConversation, isDroidConversation, t]);

  const canSubmit =
    !disabledReason && title.trim().length > 0 && description.trim().length >= MIN_DESCRIPTION_LENGTH && !submitting;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    if (!resolvedConversation) return;
    setSubmitting(true);
    try {
      const result = await ipcBridge.acpConversation.submitBugReport.invoke({
        conversationId: resolvedConversation.id,
        title: title.trim(),
        description: description.trim(),
        includeSessionId,
      });
      if (!result.success) {
        Message.error(
          result.msg ||
            t('settings.droidBugReport.submitFailed', {
              defaultValue: '反馈提交失败，请稍后重试。',
            })
        );
        return;
      }
      const reportId = result.data?.reportId;
      Message.success(
        reportId
          ? t('settings.droidBugReport.submitSuccessWithId', {
              defaultValue: '反馈已提交（编号：{{reportId}}）。',
              reportId,
            })
          : t('settings.droidBugReport.submitSuccess', {
              defaultValue: '反馈已提交，感谢你的支持！',
            })
      );
      modalCtrl.close();
    } catch (err) {
      Message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, resolvedConversation, title, description, includeSessionId, modalCtrl, t]);

  return (
    <AionModal
      {...modalProps}
      size='medium'
      header={{
        title: (
          <div className='flex items-center gap-8px'>
            <span className='inline-flex w-20px h-20px items-center justify-center text-t-primary'>
              <Bug theme='outline' size={20} />
            </span>
            <span>
              {t('settings.droidBugReport.modalTitle', {
                defaultValue: '提交 Droid 使用反馈',
              })}
            </span>
          </div>
        ),
        showClose: true,
      }}
      footer={
        <div className='flex justify-end gap-10px mt-10px'>
          <Button
            onClick={() => modalCtrl.close()}
            disabled={submitting}
            className='px-20px min-w-80px'
            style={{ borderRadius: 8 }}
          >
            {t('settings.droidBugReport.cancel', { defaultValue: '取消' })}
          </Button>
          <Button
            type='primary'
            loading={submitting}
            disabled={!canSubmit}
            onClick={handleSubmit}
            className='px-20px min-w-80px'
            style={{ borderRadius: 8 }}
          >
            {t('settings.droidBugReport.submit', { defaultValue: '提交反馈' })}
          </Button>
        </div>
      }
      contentStyle={{ padding: '20px' }}
    >
      <div className='flex flex-col gap-16px'>
        <div className='flex flex-col gap-6px'>
          <span className='text-14px font-500 text-t-primary'>
            {t('settings.droidBugReport.titleLabel', { defaultValue: '问题标题' })}
          </span>
          <Input
            value={title}
            onChange={setTitle}
            maxLength={MAX_TITLE_LENGTH}
            showWordLimit
            disabled={Boolean(disabledReason) || submitting}
            placeholder={t('settings.droidBugReport.titlePlaceholder', {
              defaultValue: '简要描述你遇到的问题…',
            })}
          />
        </div>

        <div className='flex flex-col gap-6px'>
          <span className='text-14px font-500 text-t-primary'>
            {t('settings.droidBugReport.descriptionLabel', { defaultValue: '详细描述' })}
          </span>
          <Input.TextArea
            value={description}
            onChange={setDescription}
            maxLength={MAX_DESCRIPTION_LENGTH}
            showWordLimit
            autoSize={{ minRows: 4, maxRows: 10 }}
            disabled={Boolean(disabledReason) || submitting}
            placeholder={t('settings.droidBugReport.descriptionPlaceholder', {
              defaultValue: '请补充复现步骤、期望结果、实际结果等信息…',
            })}
          />
          <span className='text-12px text-t-tertiary'>
            {t('settings.droidBugReport.descriptionHint', {
              defaultValue: '描述至少需要 10 个字符。反馈不会携带任何会话内容或本地文件路径。',
            })}
          </span>
        </div>

        <div className='flex flex-col gap-6px'>
          <Checkbox
            checked={includeSessionId}
            onChange={setIncludeSessionId}
            disabled={Boolean(disabledReason) || submitting}
          >
            <span className='text-14px text-t-primary'>
              {t('settings.droidBugReport.includeSessionId', {
                defaultValue: '附带当前 Droid 会话 ID（便于 Factory 定位问题）',
              })}
            </span>
          </Checkbox>
        </div>

        {disabledReason && <div className='text-13px text-warning bg-fill-2 rd-8px p-10px'>{disabledReason}</div>}
      </div>
    </AionModal>
  );
});

export default DroidBugReportModal;
