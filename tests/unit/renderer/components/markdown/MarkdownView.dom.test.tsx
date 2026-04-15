import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/renderer/components/Markdown/ShadowView', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div data-testid='shadow-view'>{children}</div>,
}));

vi.mock('@/renderer/utils/platform', () => ({
  openExternalUrl: vi.fn(),
}));

vi.mock('@/renderer/components/media/LocalImageView', () => ({
  __esModule: true,
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

import MarkdownView from '@/renderer/components/Markdown';

describe('MarkdownView', () => {
  it('auto-renders json-render payloads mixed with markdown text', () => {
    const content = [
      '测试开始',
      '<json-render>{"root":"box","elements":{"box":{"type":"Box","props":{"padding":1,"gap":1},"children":["title","table"]},"title":{"type":"Heading","props":{"text":"接口结果","level":"h2"},"children":[]},"table":{"type":"Table","props":{"columns":[{"header":"接口","key":"api"},{"header":"状态","key":"status"}],"rows":[{"api":"list_records","status":"✓ 正常"}]},"children":[]}}}</json-render>',
      '测试结束',
    ].join('\n');

    render(<MarkdownView>{content}</MarkdownView>);

    expect(screen.getByText('测试开始')).toBeInTheDocument();
    expect(screen.getByText('接口结果')).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('list_records')).toBeInTheDocument();
    expect(screen.getByText('✓ 正常')).toBeInTheDocument();
    expect(screen.getByText('测试结束')).toBeInTheDocument();
    expect(screen.queryByText(/<json-render>/)).not.toBeInTheDocument();
  });
});
