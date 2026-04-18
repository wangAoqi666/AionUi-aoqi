/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import ReactMarkdown from 'react-markdown';

import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

// Import KaTeX CSS to make it available in the document
import 'katex/dist/katex.min.css';

import { openExternalUrl } from '@/renderer/utils/platform';
import classNames from 'classnames';
import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { convertLatexDelimiters } from '@renderer/utils/chat/latexDelimiters';
import { autoWrapTreeBlocks } from '@renderer/utils/chat/treeTextFormatter';
import LocalImageView from '@renderer/components/media/LocalImageView';
import { extractRichMessageSegments, JsonRenderView } from './JsonRender';
import CodeBlock from './CodeBlock';
import ShadowView from './ShadowView';

const isLocalFilePath = (src: string): boolean => {
  if (src.startsWith('http://') || src.startsWith('https://')) return false;
  if (src.startsWith('data:')) return false;
  return true;
};

type MarkdownViewProps = {
  children: string;
  hiddenCodeCopyButton?: boolean;
  codeStyle?: React.CSSProperties;
  className?: string;
  onRef?: (el?: HTMLDivElement | null) => void;
  /** Enable raw HTML rendering in markdown content. Use with caution — only for trusted sources. */
  allowHtml?: boolean;
};

const MarkdownView: React.FC<MarkdownViewProps> = ({
  hiddenCodeCopyButton,
  codeStyle,
  className,
  onRef,
  allowHtml,
  children: childrenProp,
}) => {
  const { t } = useTranslation();

  const normalizedChildren = useMemo(() => {
    if (typeof childrenProp === 'string') {
      let text = childrenProp.replace(/file:\/\//g, '');
      text = convertLatexDelimiters(text);
      text = autoWrapTreeBlocks(text);
      return text;
    }
    return childrenProp;
  }, [childrenProp]);

  const handleLinkClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const href = (e.currentTarget as HTMLAnchorElement).href;
      if (!href) return;
      openExternalUrl(href).catch((error: unknown) => {
        console.error(t('messages.openLinkFailed'), error);
      });
    },
    [t]
  );

  // Memoize components so React preserves component identity across re-renders.
  // Without this, every streaming update creates new function references → React
  // unmounts/remounts all custom components → hooks & DOM state are lost.
  const components = useMemo(
    () => ({
      span: ({ node: _node, className: cn, children: ch, ...rest }: Record<string, unknown>) => (
        <span {...(rest as React.HTMLAttributes<HTMLSpanElement>)} className={cn as string}>
          {ch as React.ReactNode}
        </span>
      ),
      code: (props: Record<string, unknown>) => (
        <CodeBlock
          {...(props as Parameters<typeof CodeBlock>[0])}
          codeStyle={codeStyle}
          hiddenCodeCopyButton={hiddenCodeCopyButton}
        />
      ),
      a: ({ node: _node, ...rest }: Record<string, unknown>) => (
        <a
          {...(rest as React.AnchorHTMLAttributes<HTMLAnchorElement>)}
          target='_blank'
          rel='noreferrer'
          onClick={handleLinkClick}
        />
      ),
      table: ({ node: _node, ...rest }: Record<string, unknown>) => (
        <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
          <table
            {...(rest as React.TableHTMLAttributes<HTMLTableElement>)}
            style={{
              ...(rest as { style?: React.CSSProperties }).style,
              borderCollapse: 'collapse',
              border: '1px solid var(--bg-3)',
              minWidth: '100%',
            }}
          />
        </div>
      ),
      td: ({ node: _node, ...rest }: Record<string, unknown>) => (
        <td
          {...(rest as React.TdHTMLAttributes<HTMLTableCellElement>)}
          style={{
            ...(rest as { style?: React.CSSProperties }).style,
            padding: '8px',
            border: '1px solid var(--bg-3)',
            minWidth: '120px',
          }}
        />
      ),
      img: ({ node: _node, ...rest }: Record<string, unknown>) => {
        const imgProps = rest as React.ImgHTMLAttributes<HTMLImageElement>;
        if (isLocalFilePath(imgProps.src || '')) {
          const src = decodeURIComponent(imgProps.src || '');
          return <LocalImageView src={src} alt={imgProps.alt || ''} className={imgProps.className} />;
        }
        return <img {...imgProps} />;
      },
    }),
    [codeStyle, hiddenCodeCopyButton, handleLinkClick]
  );

  const rehypePlugins = useMemo(() => (allowHtml ? [rehypeRaw, rehypeKatex] : [rehypeKatex]), [allowHtml]);

  const renderMarkdownSegment = useCallback(
    (content: string, key?: string, segmentRef?: (el?: HTMLDivElement | null) => void) => (
      <ShadowView key={key}>
        <div ref={segmentRef} className='markdown-shadow-body'>
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath, remarkBreaks]}
            rehypePlugins={rehypePlugins}
            components={components}
          >
            {content}
          </ReactMarkdown>
        </div>
      </ShadowView>
    ),
    [components, rehypePlugins]
  );

  const richSegments = useMemo(() => extractRichMessageSegments(normalizedChildren), [normalizedChildren]);
  const hasJsonRenderBlocks = richSegments.some((segment) => segment.type === 'json-render');

  if (hasJsonRenderBlocks) {
    let markdownSegmentIndex = 0;

    return (
      <div className={classNames('relative w-full', className)}>
        {richSegments.map((segment, index) => {
          if (segment.type === 'json-render') {
            return <JsonRenderView key={`json-render-${index}`} spec={segment.spec} />;
          }

          if (!segment.content.trim()) {
            return null;
          }

          const shouldAttachRef = markdownSegmentIndex === 0;
          markdownSegmentIndex += 1;

          return renderMarkdownSegment(segment.content, `markdown-${index}`, shouldAttachRef ? onRef : undefined);
        })}
      </div>
    );
  }

  return (
    <div className={classNames('relative w-full', className)}>
      {renderMarkdownSegment(normalizedChildren, 'markdown-root', onRef)}
    </div>
  );
};

export default MarkdownView;
