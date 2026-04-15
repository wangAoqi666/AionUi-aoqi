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

vi.mock('@/renderer/components/Markdown', () => ({
  __esModule: true,
  default: ({ children }: { children: string }) => <div data-testid='markdown-view'>{children}</div>,
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

  it('renders SPEC confirmations with markdown content in team mode', async () => {
    render(<TeamConfirmOverlay allConversationIds={['conv-1']} />);

    await waitFor(() => {
      expect(mockList).toHaveBeenCalledWith({ conversation_id: 'conv-1' });
    });

    await act(async () => {
      confirmationListeners.add[0]?.({
        conversation_id: 'conv-1',
        id: 'spec-team-1',
        callId: 'spec-team-1',
        title: 'Specification Review',
        description: '## 导出功能\n\n- 生成 ZIP\n- 通知用户',
        descriptionFormat: 'markdown',
        options: [{ label: 'Proceed with implementation', value: 'proceed_once' }],
      });
    });

    expect((await screen.findAllByText('Specification Review')).length).toBeGreaterThan(0);
    expect(screen.getByTestId('markdown-view').textContent).toContain('导出功能');
    expect(screen.getByText('Proceed with implementation')).toBeTruthy();
  });

  it('renders ask-user confirmations in a scrollable body in team mode', async () => {
    render(<TeamConfirmOverlay allConversationIds={['conv-1']} />);

    await waitFor(() => {
      expect(mockList).toHaveBeenCalledWith({ conversation_id: 'conv-1' });
    });

    await act(async () => {
      confirmationListeners.add[0]?.({
        conversation_id: 'conv-1',
        id: 'ask-user-team-layout-1',
        callId: 'ask-user-team-layout-1',
        title: 'Please answer the following questions',
        description: '这是一个较长的说明，用于验证团队模式问卷可以完整滚动展示。',
        interaction: {
          type: 'ask_user',
          questions: [
            {
              index: 1,
              topic: '技术栈',
              question: '你希望用什么技术栈来实现这个游戏？',
              options: ['Python + Pygame', 'HTML + Canvas + JavaScript', 'React + Canvas', '其他方案'],
            },
            {
              index: 2,
              topic: '复杂度',
              question: '游戏复杂度你期望哪个级别？',
              options: ['基础版', '进阶版', '完整版', '其他要求'],
            },
          ],
        },
        options: [],
      });
    });

    const questionText = await screen.findByText('你希望用什么技术栈来实现这个游戏？');
    const scroller = questionText.closest('.min-h-0.flex-1.overflow-y-auto.pr-4px');
    expect(scroller).toBeTruthy();
  });
});
