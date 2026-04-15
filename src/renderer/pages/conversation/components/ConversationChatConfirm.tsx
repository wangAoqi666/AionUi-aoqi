import { ipcBridge } from '@/common';
import type { AskUserConfirmationQuestion, IConfirmation } from '@/common/chat/chatLib';
import MarkdownView from '@/renderer/components/Markdown';
import { useConversationContextSafe } from '@/renderer/hooks/context/ConversationContext';
import { useTeamPermission } from '@/renderer/pages/team/hooks/TeamPermissionContext';
import { Button, Divider, Input, Typography } from '@arco-design/web-react';
import type { PropsWithChildren } from 'react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { removeStack } from '../../../utils/common';

/** IConfirmation extended with the conversation it belongs to (needed for team-mode cross-agent routing) */
type StoredConfirmation = IConfirmation<unknown> & { conversation_id: string };

export type AskUserAnswerResult = {
  cancelled?: boolean;
  answers: Array<{
    index: number;
    question: string;
    answer: string;
  }>;
};

type AskUserConfirmationRenderable = Pick<IConfirmation<unknown>, 'id' | 'interaction'>;

export const AskUserConfirmCard: React.FC<{
  confirmation: AskUserConfirmationRenderable;
  onSubmit: (result: AskUserAnswerResult) => void;
}> = ({ confirmation, onSubmit }) => {
  const { t } = useTranslation();
  const questions = confirmation.interaction?.questions || [];
  const [selectedOptions, setSelectedOptions] = useState<Record<number, string>>({});
  const [customAnswers, setCustomAnswers] = useState<Record<number, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setSelectedOptions({});
    setCustomAnswers({});
    setIsSubmitting(false);
  }, [confirmation.id]);

  const getCustomOption = useCallback(
    (question: AskUserConfirmationQuestion): string | undefined =>
      question.options.length === 4 ? question.options[question.options.length - 1] : undefined,
    []
  );

  const resolveAnswer = useCallback(
    (
      question: AskUserConfirmationQuestion,
      nextSelectedOptions: Record<number, string> = selectedOptions,
      nextCustomAnswers: Record<number, string> = customAnswers
    ): string => {
      const selectedOption = nextSelectedOptions[question.index] || '';
      const customOption = getCustomOption(question);
      if (customOption && selectedOption === customOption) {
        return (nextCustomAnswers[question.index] || '').trim();
      }
      return selectedOption.trim();
    },
    [customAnswers, getCustomOption, selectedOptions]
  );

  const canSubmitWithState = useCallback(
    (nextSelectedOptions: Record<number, string>, nextCustomAnswers: Record<number, string>): boolean =>
      questions.every((question) => Boolean(resolveAnswer(question, nextSelectedOptions, nextCustomAnswers))),
    [questions, resolveAnswer]
  );

  const buildSubmitResult = useCallback(
    (
      nextSelectedOptions: Record<number, string> = selectedOptions,
      nextCustomAnswers: Record<number, string> = customAnswers
    ): AskUserAnswerResult => ({
      cancelled: false,
      answers: questions.map((question) => ({
        index: question.index,
        question: question.question,
        answer: resolveAnswer(question, nextSelectedOptions, nextCustomAnswers),
      })),
    }),
    [customAnswers, questions, resolveAnswer, selectedOptions]
  );

  const canSubmit = canSubmitWithState(selectedOptions, customAnswers);

  const handleSubmit = async (cancelled: boolean) => {
    if (isSubmitting) return;
    if (!cancelled && !canSubmit) return;

    setIsSubmitting(true);
    onSubmit(cancelled ? { cancelled: true, answers: [] } : buildSubmitResult());
  };

  const handleOptionClick = (question: AskUserConfirmationQuestion, option: string) => {
    if (isSubmitting) return;

    const nextSelectedOptions = {
      ...selectedOptions,
      [question.index]: option,
    };
    setSelectedOptions(nextSelectedOptions);

    const customOption = getCustomOption(question);
    if (customOption && option === customOption) {
      return;
    }

    if (!canSubmitWithState(nextSelectedOptions, customAnswers)) {
      return;
    }

    setIsSubmitting(true);
    onSubmit(buildSubmitResult(nextSelectedOptions, customAnswers));
  };

  return (
    <div className='shrink-0 mt-12px flex flex-col gap-12px'>
      {questions.map((question) => {
        const selectedOption = selectedOptions[question.index] || '';
        const customOption = getCustomOption(question);
        const shouldShowCustomInput = Boolean(customOption && selectedOption === customOption);
        const shouldShowInput = question.options.length === 0 || !customOption || shouldShowCustomInput;
        const value = shouldShowCustomInput ? customAnswers[question.index] || '' : selectedOption;

        return (
          <div key={`${confirmation.id}-${question.index}`} className='rounded-12px bg-fill-1 p-12px'>
            <div className='mb-6px text-12px text-t-secondary'>{question.topic}</div>
            <div className='mb-10px text-14px text-t-primary'>{question.question}</div>
            {question.options.length > 0 && (
              <div className='mb-10px flex flex-wrap gap-8px'>
                {question.options.map((option) => (
                  <Button
                    key={option}
                    size='mini'
                    type={selectedOption === option ? 'primary' : 'secondary'}
                    onClick={() => {
                      handleOptionClick(question, option);
                    }}
                  >
                    {option}
                  </Button>
                ))}
              </div>
            )}
            {shouldShowInput && (
              <Input.TextArea
                autoSize={{ minRows: 2, maxRows: 6 }}
                placeholder={
                  customOption && shouldShowCustomInput
                    ? customOption
                    : question.options.join(' / ') || question.question
                }
                value={value}
                onChange={(nextValue) => {
                  if (shouldShowCustomInput) {
                    setCustomAnswers((prev) => ({ ...prev, [question.index]: nextValue }));
                    return;
                  }
                  setSelectedOptions((prev) => ({ ...prev, [question.index]: nextValue }));
                }}
              />
            )}
          </div>
        );
      })}

      <div className='flex items-center justify-end gap-8px'>
        <Button disabled={isSubmitting} onClick={() => void handleSubmit(true)}>
          {t('common.cancel', { defaultValue: '取消' })}
        </Button>
        <Button type='primary' disabled={!canSubmit || isSubmitting} onClick={() => void handleSubmit(false)}>
          {t('common.confirm', { defaultValue: '确认' })}
        </Button>
      </div>
    </div>
  );
};

const ConversationChatConfirm: React.FC<PropsWithChildren<{ conversation_id: string }>> = ({
  conversation_id,
  children,
}) => {
  const [confirmations, setConfirmations] = useState<StoredConfirmation[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { t } = useTranslation();
  const conversationContext = useConversationContextSafe();
  const agentType = conversationContext?.type || 'unknown';
  const teamPermission = useTeamPermission();

  // In team mode: confirmation UI is handled by TeamConfirmOverlay at the page level.
  // Each slot's ConversationChatConfirm only passes through children without showing any dialog.
  // In standalone mode: only this conversation.
  const listenConversationIds = useMemo(() => {
    if (!teamPermission) return [conversation_id];
    // Team mode: no local confirmation listening — TeamConfirmOverlay handles it
    return [];
  }, [teamPermission, conversation_id]);

  // Check if confirmation should be auto-confirmed via backend approval store
  // 通过后端 approval store 检查是否应该自动确认
  // Keys are parsed in backend (single source of truth)
  // Keys 在后端解析（单一数据源）
  const checkAndAutoConfirm = useCallback(
    async (confirmation: StoredConfirmation): Promise<boolean> => {
      // Only check agent types that have approval store
      if (agentType !== 'gemini' && agentType !== 'aionrs') return false;

      const { action, commandType } = confirmation;
      // Skip if no action (backend will return false for empty keys)
      if (!action) return false;

      try {
        const isApproved = await ipcBridge.conversation.approval.check.invoke({
          conversation_id: confirmation.conversation_id,
          action,
          commandType,
        });

        if (isApproved) {
          // Find the "proceed_always" or "proceed_once" option to use for auto-confirm
          const allowOption = confirmation.options.find(
            (opt) => opt.value === 'proceed_always' || opt.value === 'proceed_once'
          );
          if (allowOption) {
            void ipcBridge.conversation.confirmation.confirm.invoke({
              conversation_id: confirmation.conversation_id,
              callId: confirmation.callId,
              msg_id: confirmation.id,
              data: allowOption.value,
            });
            return true;
          }
        }
      } catch {
        // Ignore errors, will show confirmation dialog
      }

      return false;
    },
    [agentType]
  );

  useEffect(() => {
    // Fix #475: Add error handling and retry mechanism
    let retryCount = 0;
    const maxRetries = 3;
    const idSet = new Set(listenConversationIds);

    const loadConfirmations = async () => {
      try {
        const confirmationGroups = await Promise.all(
          listenConversationIds.map(async (cid) => {
            const data = await ipcBridge.conversation.confirmation.list.invoke({ conversation_id: cid });
            const nextConfirmations: StoredConfirmation[] = [];
            for (const confirmation of data) {
              nextConfirmations.push({ ...confirmation, conversation_id: cid });
            }
            return nextConfirmations;
          })
        );
        const allData = confirmationGroups.flat();
        const manualConfirmationResults = await Promise.all(
          allData.map(async (confirmation) => ({
            confirmation,
            shouldAutoConfirm: await checkAndAutoConfirm(confirmation),
          }))
        );
        const manualConfirmations = manualConfirmationResults.flatMap(({ confirmation, shouldAutoConfirm }) => {
          if (shouldAutoConfirm) {
            return [];
          }
          return [confirmation];
        });
        setConfirmations(manualConfirmations);
        setLoadError(null);
      } catch (error) {
        console.error('[ConversationChatConfirm] Failed to load confirmations:', error);
        if (retryCount < maxRetries) {
          retryCount++;
          setTimeout(loadConfirmations, 1000);
        } else {
          const errorMsg = error instanceof Error ? error.message : 'Failed to load confirmations';
          setLoadError(errorMsg);
        }
      }
    };

    void loadConfirmations();

    return removeStack(
      ipcBridge.conversation.confirmation.add.on((data) => {
        if (!idSet.has(data.conversation_id)) return;
        // Check if should auto-confirm (async)
        const stored: StoredConfirmation = { ...data, conversation_id: data.conversation_id };
        void checkAndAutoConfirm(stored).then((autoConfirmed) => {
          if (!autoConfirmed) {
            setConfirmations((prev) => prev.concat(stored));
            setLoadError(null);
          }
        });
      }),
      ipcBridge.conversation.confirmation.remove.on((data) => {
        if (!idSet.has(data.conversation_id)) return;
        setConfirmations((prev) => prev.filter((p) => p.id !== data.id));
      }),
      ipcBridge.conversation.confirmation.update.on(({ ...data }) => {
        if (!idSet.has(data.conversation_id)) return;
        setConfirmations((list) => list.map((p) => (p.id === data.id ? { ...p, ...data } : p)));
      })
    );
  }, [listenConversationIds, checkAndAutoConfirm]);

  // Handle keyboard shortcuts for confirmation actions
  // 处理确认操作的键盘快捷键
  useEffect(() => {
    if (!confirmations.length) return;

    const confirmation = confirmations[0];
    if (confirmation.interaction?.type === 'ask_user') return;

    const confirmOption = (option: (typeof confirmation.options)[number]) => {
      setConfirmations((prev) => prev.filter((p) => p.id !== confirmation.id));
      void ipcBridge.conversation.confirmation.confirm.invoke({
        conversation_id: confirmation.conversation_id,
        callId: confirmation.callId,
        msg_id: confirmation.id,
        data: option.value,
      });
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      // Skip if user is typing in an input
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

      const options = confirmation.options;

      // Enter → first option (typically Allow)
      if (event.key === 'Enter') {
        event.preventDefault();
        if (options[0]) confirmOption(options[0]);
        return;
      }

      // Escape / N → cancel
      if (event.key === 'Escape' || event.key.toLowerCase() === 'n') {
        const cancelOpt = options.find((opt) => opt.value === 'cancel');
        if (cancelOpt) {
          event.preventDefault();
          confirmOption(cancelOpt);
        }
        return;
      }

      // Y → proceed_once (Allow)
      if (event.key.toLowerCase() === 'y') {
        const allowOpt = options.find((opt) => opt.value === 'proceed_once');
        if (allowOpt) {
          event.preventDefault();
          confirmOption(allowOpt);
        }
        return;
      }

      // A → proceed_always (Always Allow)
      if (event.key.toLowerCase() === 'a') {
        const alwaysOpt = options.find((opt) => opt.value === 'proceed_always');
        if (alwaysOpt) {
          event.preventDefault();
          confirmOption(alwaysOpt);
        }
        return;
      }

      // Number keys 1-9 → select by index
      const num = parseInt(event.key, 10);
      if (num >= 1 && num <= options.length) {
        event.preventDefault();
        confirmOption(options[num - 1]);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [confirmations, conversation_id]);
  // 修复 #475: 如果加载出错，显示错误信息和重试按钮
  // Fix #475: If loading fails, show error message and retry button
  if (loadError && !confirmations.length) {
    return (
      <div>
        {/* 错误提示卡片 / Error notification card */}
        <div
          className={`relative p-16px bg-white flex flex-col overflow-hidden m-b-20px rd-20px max-w-800px w-full mx-auto box-border`}
          style={{
            boxShadow: '0px 2px 20px 0px rgba(74, 88, 250, 0.1)',
          }}
        >
          {/* 错误标题 / Error title */}
          <div className='color-[rgba(217,45,32,1)] text-14px font-medium mb-8px'>
            {t('conversation.chat.confirmationLoadError', 'Failed to load confirmation dialog')}
          </div>
          {/* 错误详情 / Error details */}
          <div className='text-12px color-[rgba(134,144,156,1)] mb-12px'>{loadError}</div>
          {/* 手动重试按钮 / Manual retry button */}
          <button
            onClick={() => {
              setLoadError(null);
              void Promise.all(
                listenConversationIds.map((cid) =>
                  ipcBridge.conversation.confirmation.list
                    .invoke({ conversation_id: cid })
                    .then((data) => data.map((c) => ({ ...c, conversation_id: cid })))
                )
              )
                .then((results) => setConfirmations(results.flat()))
                .catch((err) => setLoadError(err instanceof Error ? err.message : 'Failed to load'));
            }}
            className='px-12px py-6px bg-[rgba(22,93,255,1)] text-white rd-6px text-12px cursor-pointer hover:opacity-80 transition-opacity'
          >
            {t('common.retry', 'Retry')}
          </button>
        </div>
        {children}
      </div>
    );
  }

  const hasConfirmation = confirmations.length > 0;
  const confirmation = hasConfirmation ? confirmations[0] : null;
  const isAskUserConfirmation = confirmation?.interaction?.type === 'ask_user';
  const $t = (key: string, params?: Record<string, string>) => t(key, { ...params, defaultValue: key });
  const submitConfirmation = useCallback((currentConfirmation: StoredConfirmation, data: unknown) => {
    setConfirmations((prev) => prev.filter((p) => p.id !== currentConfirmation.id));
    void ipcBridge.conversation.confirmation.confirm.invoke({
      conversation_id: currentConfirmation.conversation_id,
      callId: currentConfirmation.callId,
      msg_id: currentConfirmation.id,
      data,
    });
  }, []);

  // Keep children in a stable tree position to prevent unmount/remount when confirmation state changes.
  // Previously, switching between <>{children}</> and <div>...<div className='hidden'>{children}</div></div>
  // caused React to unmount and remount children (e.g., AcpSendBox), which triggered duplicate message sends.
  return (
    <>
      {hasConfirmation && confirmation && (
        <div
          className={`relative p-16px bg-white flex flex-col overflow-hidden m-b-20px rd-20px max-w-800px max-h-[calc(100vh-120px)] w-full mx-auto box-border`}
          style={{
            boxShadow: '0px 2px 20px 0px rgba(74, 88, 250, 0.1)',
          }}
        >
          <div className={isAskUserConfirmation ? 'shrink-0' : 'flex-1 overflow-y-auto min-h-0'}>
            <Typography.Ellipsis className='text-16px font-bold color-[rgba(29,33,41,1)]' rows={2} expandable>
              {$t(confirmation.title) || 'Choose an action'}
            </Typography.Ellipsis>
            <Divider className={'!my-10px'}></Divider>
            {confirmation.descriptionFormat === 'markdown' ? (
              <div className='rounded-8px border border-[var(--border-base)] bg-[var(--bg-2)] p-12px max-h-360px overflow-auto'>
                <MarkdownView className='text-13px'>{confirmation.description}</MarkdownView>
              </div>
            ) : (
              <Typography.Ellipsis className='text-14px color-[rgba(29,33,41,1)]' rows={5} expandable>
                {$t(confirmation.description)}
              </Typography.Ellipsis>
            )}
          </div>
          {confirmation.interaction?.type === 'ask_user' ? (
            <div className='min-h-0 flex-1 overflow-y-auto pr-4px'>
              <AskUserConfirmCard
                confirmation={confirmation}
                onSubmit={(result) => {
                  submitConfirmation(confirmation, result);
                }}
              />
            </div>
          ) : (
            <div className='shrink-0'>
              {confirmation.options.map((option, index) => {
                const label = $t(option.label, option.params);
                const shortcut =
                  index === 0
                    ? 'Enter'
                    : option.value === 'cancel'
                      ? 'Esc'
                      : option.value === 'proceed_always'
                        ? 'A'
                        : option.value === 'proceed_once'
                          ? 'Y'
                          : String(index + 1);
                return (
                  <div
                    onClick={() => {
                      submitConfirmation(confirmation, option.value);
                    }}
                    key={label + option.value + index}
                    className='b-1px b-solid h-30px lh-30px b-[rgba(229,230,235,1)] rd-8px px-12px hover:bg-[rgba(229,231,240,1)] cursor-pointer mt-10px flex items-center gap-8px'
                  >
                    <span className='inline-flex items-center justify-center px-4px h-18px rd-4px bg-[rgba(229,230,235,0.6)] text-11px text-[rgba(134,144,156,1)] font-mono shrink-0'>
                      {shortcut}
                    </span>
                    {label}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      <div className={hasConfirmation ? 'hidden' : ''}>{children}</div>
    </>
  );
};

export default ConversationChatConfirm;
