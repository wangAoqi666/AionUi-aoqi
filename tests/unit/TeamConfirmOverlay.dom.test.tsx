import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import TeamConfirmOverlay from '@/renderer/pages/team/components/TeamConfirmOverlay';

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

describe('TeamConfirmOverlay ask-user flow', () => {
  beforeEach(() => {
    mockList.mockResolvedValue([]);
    mockConfirm.mockResolvedValue({ success: true });
    confirmationListeners.add = [];
    confirmationListeners.remove = [];
    confirmationListeners.update = [];
  });

  it('submits immediately for non-custom ask-user options in team mode', async () => {
    render(<TeamConfirmOverlay allConversationIds={['conv-1']} />);

    await waitFor(() => {
      expect(mockList).toHaveBeenCalledWith({ conversation_id: 'conv-1' });
    });

    await act(async () => {
      confirmationListeners.add[0]?.({
        conversation_id: 'conv-1',
        id: 'ask-user-team-1',
        callId: 'ask-user-team-1',
        title: 'Please answer the following questions',
        description: '请选择一个答案。',
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
    });

    expect(await screen.findByRole('button', { name: '写代码/开发功能' })).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '写代码/开发功能' }));

    await waitFor(() => {
      expect(mockConfirm).toHaveBeenCalledWith({
        conversation_id: 'conv-1',
        callId: 'ask-user-team-1',
        msg_id: 'ask-user-team-1',
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
});
