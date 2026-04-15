import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@arco-design/web-react', () => ({
  Alert: ({ content }: { content: React.ReactNode }) => <div>{content}</div>,
  Message: { error: vi.fn() },
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@icon-park/react', () => ({
  Copy: () => <span>copy</span>,
}));

vi.mock('../../src/renderer/utils/ui/clipboard', () => ({
  copyText: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../src/renderer/components/chat/CollapsibleContent', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('../../src/renderer/components/media/FilePreview', () => ({
  default: () => <div>file-preview</div>,
}));

vi.mock('../../src/renderer/components/media/HorizontalFileList', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('../../src/renderer/components/Markdown', () => ({
  default: ({ children }: { children: string }) => <div>{children}</div>,
}));

vi.mock('../../src/renderer/pages/conversation/Messages/components/MessageCronBadge', () => ({
  default: () => <div>cron-badge</div>,
}));

vi.mock('../../src/renderer/utils/model/agentLogo', () => ({
  getAgentLogo: vi.fn(() => null),
}));

import MessageText, {
  JsonRenderView,
  extractRichMessageSegments,
} from '../../src/renderer/pages/conversation/Messages/components/MessagetText';

describe('extractRichMessageSegments', () => {
  it('splits markdown and json-render blocks', () => {
    const content =
      '测试前缀\n<json-render>{"root":"box","elements":{"box":{"type":"Box","props":{},"children":[]}}}</json-render>\n测试后缀';

    const segments = extractRichMessageSegments(content);

    expect(segments).toHaveLength(3);
    expect(segments[0]).toMatchObject({ type: 'markdown', content: '测试前缀\n' });
    expect(segments[1]).toMatchObject({ type: 'json-render' });
    expect(segments[2]).toMatchObject({ type: 'markdown', content: '\n测试后缀' });
  });
});

describe('MessageText rich json-render integration', () => {
  it('renders json-render payloads as structured UI instead of raw tags', () => {
    const content = [
      '全部接口都正常。',
      '<json-render>{"root":"box","elements":{"box":{"type":"Box","props":{"padding":1,"gap":1},"children":["title","table","note"]},"title":{"type":"Heading","props":{"text":"交易 MCP 接口测试结果","level":"h2"},"children":[]},"table":{"type":"Table","props":{"columns":[{"header":"接口","key":"api"},{"header":"状态","key":"status"}],"rows":[{"api":"list_records","status":"✓ 正常"}]},"children":[]},"note":{"type":"StatusLine","props":{"text":"所有已测试接口均响应正常","status":"success"},"children":[]}}}</json-render>',
      '还有后续说明。',
    ].join('\n');

    render(
      <MessageText
        message={{
          type: 'text',
          content: { content },
          position: 'left',
          status: 'finish',
        }}
      />
    );

    expect(screen.getByText('全部接口都正常。')).toBeInTheDocument();
    expect(screen.getByText('交易 MCP 接口测试结果')).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('list_records')).toBeInTheDocument();
    expect(screen.getByText('所有已测试接口均响应正常')).toBeInTheDocument();
    expect(screen.getByText('还有后续说明。')).toBeInTheDocument();
    expect(screen.queryByText(/<json-render>/)).not.toBeInTheDocument();
  });

  it('renders standalone json-render tables with headings', () => {
    render(
      <JsonRenderView
        spec={{
          root: 'card',
          elements: {
            card: { type: 'Card', props: { title: '结果摘要', padding: 1 }, children: ['table'] },
            table: {
              type: 'Table',
              props: {
                columns: [
                  { header: '接口', key: 'api' },
                  { header: '状态', key: 'status' },
                ],
                rows: [{ api: 'list_time_entries', status: '✓ 正常' }],
              },
              children: [],
            },
          },
        }}
      />
    );

    expect(screen.getByText('结果摘要')).toBeInTheDocument();
    expect(screen.getByText('list_time_entries')).toBeInTheDocument();
    expect(screen.getByText('✓ 正常')).toBeInTheDocument();
  });
});
