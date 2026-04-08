import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ConversationChatConfirm from '@/renderer/pages/conversation/components/ConversationChatConfirm';

const mockList = vi.hoisted(() => vi.fn());
const mockConfirm = vi.hoisted(() => vi.fn());
const confirmationListeners = vi.hoisted(() => ({
  add: [] as Array<(data: unknown) => void>,
  remove: [] as Array<(data: unknown) => void>,
  update: [] as Array<(data: unknown) => void>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue || key,
  }),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      approval: {
        check: {
          invoke: vi.fn().mockResolvedValue(false),
        },
      },
      confirmation: {
        list: {
          invoke: mockList,
        },
        confirm: {
          invoke: mockConfirm,
        },
        add: {
          on: (handler: (data: unknown) => void) => {
            confirmationListeners.add.push(handler);
            return () => {
              confirmationListeners.add = confirmationListeners.add.filter((item) => item !== handler);
            };
          },
        },
        remove: {
          on: (handler: (data: unknown) => void) => {
            confirmationListeners.remove.push(handler);
            return () => {
              confirmationListeners.remove = confirmationListeners.remove.filter((item) => item !== handler);
            };
          },
        },
        update: {
          on: (handler: (data: unknown) => void) => {
            confirmationListeners.update.push(handler);
            return () => {
              confirmationListeners.update = confirmationListeners.update.filter((item) => item !== handler);
            };
          },
        },
      },
    },
  },
}));

vi.mock('@/renderer/hooks/context/ConversationContext', () => ({
  useConversationContextSafe: () => ({ type: 'acp' }),
}));

vi.mock('@/renderer/pages/team/hooks/TeamPermissionContext', () => ({
  useTeamPermission: () => null,
}));

describe('ConversationChatConfirm ask-user flow', () => {
  beforeEach(() => {
    mockList.mockResolvedValue([]);
    mockConfirm.mockResolvedValue({ success: true });
    confirmationListeners.add = [];
    confirmationListeners.remove = [];
    confirmationListeners.update = [];
  });

  it('submits immediately when a non-custom ask-user option is clicked', async () => {
    render(
      <ConversationChatConfirm conversation_id='conv-1'>
        <div>child</div>
      </ConversationChatConfirm>
    );

    await waitFor(() => {
      expect(mockList).toHaveBeenCalledWith({ conversation_id: 'conv-1' });
    });

    confirmationListeners.add[0]?.({
      conversation_id: 'conv-1',
      id: 'ask-user-1',
      callId: 'ask-user-1',
      title: 'Please answer the following questions',
      description: '你想创建什么文件？请提供文件名和内容。',
      interaction: {
        type: 'ask_user',
        questions: [
          {
            index: 1,
            topic: '任务',
            question: '你想让我帮你做什么？',
            options: ['写代码/开发功能', '分析现有代码', '调试问题/修复bug', '其他任务'],
          },
        ],
      },
      options: [],
    });

    expect(await screen.findByRole('button', { name: '写代码/开发功能' })).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '写代码/开发功能' }));

    await waitFor(() => {
      expect(mockConfirm).toHaveBeenCalledWith({
        conversation_id: 'conv-1',
        callId: 'ask-user-1',
        msg_id: 'ask-user-1',
        data: {
          cancelled: false,
          answers: [
            {
              index: 1,
              question: '你想让我帮你做什么？',
              answer: '写代码/开发功能',
            },
          ],
        },
      });
    });
  });

  it('shows a text input for the custom ask-user option', async () => {
    render(
      <ConversationChatConfirm conversation_id='conv-1'>
        <div>child</div>
      </ConversationChatConfirm>
    );

    await waitFor(() => {
      expect(mockList).toHaveBeenCalledWith({ conversation_id: 'conv-1' });
    });

    confirmationListeners.add[0]?.({
      conversation_id: 'conv-1',
      id: 'ask-user-custom-1',
      callId: 'ask-user-custom-1',
      title: 'Please answer the following questions',
      description: '你想让我帮你做什么？',
      interaction: {
        type: 'ask_user',
        questions: [
          {
            index: 1,
            topic: '任务',
            question: '你想让我帮你做什么？',
            options: ['写代码/开发功能', '分析现有代码', '调试问题/修复bug', '其他任务'],
          },
        ],
      },
      options: [],
    });

    expect(await screen.findByRole('button', { name: '其他任务' })).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '其他任务' }));

    const textArea = await screen.findByRole('textbox');
    fireEvent.change(textArea, { target: { value: '帮我整理一份需求文档' } });
    fireEvent.click(screen.getByRole('button', { name: '确认' }));

    await waitFor(() => {
      expect(mockConfirm).toHaveBeenCalledWith({
        conversation_id: 'conv-1',
        callId: 'ask-user-custom-1',
        msg_id: 'ask-user-custom-1',
        data: {
          cancelled: false,
          answers: [
            {
              index: 1,
              question: '你想让我帮你做什么？',
              answer: '帮我整理一份需求文档',
            },
          ],
        },
      });
    });
  });
});
