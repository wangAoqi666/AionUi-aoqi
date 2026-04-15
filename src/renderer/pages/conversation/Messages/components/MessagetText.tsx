/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IMessageText } from '@/common/chat/chatLib';
import { AIONUI_FILES_MARKER } from '@/common/config/constants';
import { iconColors } from '@/renderer/styles/colors';
import { Alert, Message, Tooltip } from '@arco-design/web-react';
import { Copy } from '@icon-park/react';
import classNames from 'classnames';
import React, { Fragment, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { copyText } from '@/renderer/utils/ui/clipboard';
import CollapsibleContent from '@renderer/components/chat/CollapsibleContent';
import FilePreview from '@renderer/components/media/FilePreview';
import HorizontalFileList from '@renderer/components/media/HorizontalFileList';
import MarkdownView from '@renderer/components/Markdown';
import { stripThinkTags, hasThinkTags } from '@renderer/utils/chat/thinkTagFilter';
import { stripSkillSuggest, hasSkillSuggest } from '@renderer/utils/chat/skillSuggestParser';

/**
 * Format a timestamp for message display.
 * Today: "HH:mm", older: "MM-DD HH:mm".
 */
export const formatMessageTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  const now = new Date();
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const time = `${hours}:${minutes}`;

  if (
    date.getFullYear() !== now.getFullYear() ||
    date.getMonth() !== now.getMonth() ||
    date.getDate() !== now.getDate()
  ) {
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${month}-${day} ${time}`;
  }
  return time;
};
import MessageCronBadge from './MessageCronBadge';
import { getAgentLogo } from '@/renderer/utils/model/agentLogo';

const parseFileMarker = (content: string) => {
  const markerIndex = content.indexOf(AIONUI_FILES_MARKER);
  if (markerIndex === -1) {
    return { text: content, files: [] as string[] };
  }
  const text = content.slice(0, markerIndex).trimEnd();
  const afterMarker = content.slice(markerIndex + AIONUI_FILES_MARKER.length).trim();
  const files = afterMarker
    ? afterMarker
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    : [];
  return { text, files };
};

type JsonRenderComponentName =
  | 'Badge'
  | 'BarChart'
  | 'Box'
  | 'Callout'
  | 'Card'
  | 'Divider'
  | 'Heading'
  | 'KeyValue'
  | 'List'
  | 'Metric'
  | 'Newline'
  | 'ProgressBar'
  | 'Sparkline'
  | 'Spacer'
  | 'StatusLine'
  | 'Table'
  | 'Text'
  | 'Timeline';

type JsonRenderElement = {
  type: JsonRenderComponentName;
  props?: Record<string, unknown>;
  children?: string[];
};

type JsonRenderSpec = {
  root: string;
  elements: Record<string, JsonRenderElement>;
};

type RichMessageSegment =
  | {
      type: 'markdown';
      content: string;
    }
  | {
      type: 'json-render';
      spec: JsonRenderSpec;
    };

const JSON_RENDER_BLOCK_RE = /<json-render>([\s\S]*?)<\/json-render>/g;

const JSON_RENDER_COLORS: Record<string, string> = {
  blue: 'var(--color-primary, #3b82f6)',
  cyan: '#06b6d4',
  danger: 'var(--color-danger, #ef4444)',
  error: 'var(--color-danger, #ef4444)',
  gray: 'var(--color-text-3, #6b7280)',
  green: 'var(--color-success, #22c55e)',
  info: 'var(--color-primary, #3b82f6)',
  orange: '#f97316',
  primary: 'var(--color-primary, #3b82f6)',
  purple: '#8b5cf6',
  success: 'var(--color-success, #22c55e)',
  warning: 'var(--color-warning, #f59e0b)',
  yellow: '#eab308',
};

const resolveJsonRenderColor = (value?: unknown, fallback = 'var(--color-text-1, #111827)'): string => {
  if (typeof value !== 'string' || !value.trim()) {
    return fallback;
  }
  return JSON_RENDER_COLORS[value] ?? value;
};

const resolveJsonRenderSpace = (value?: unknown, fallback = 0): number => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback;
  }
  return value * 8;
};

const toDisplayText = (value: unknown): string => {
  if (value == null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const isJsonRenderSpec = (value: unknown): value is JsonRenderSpec => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<JsonRenderSpec>;
  return (
    typeof candidate.root === 'string' &&
    !!candidate.root &&
    !!candidate.elements &&
    typeof candidate.elements === 'object'
  );
};

export const extractRichMessageSegments = (content: string): RichMessageSegment[] => {
  if (!content.includes('<json-render>')) {
    return [{ type: 'markdown', content }];
  }

  const segments: RichMessageSegment[] = [];
  let lastIndex = 0;
  JSON_RENDER_BLOCK_RE.lastIndex = 0;

  for (const match of content.matchAll(JSON_RENDER_BLOCK_RE)) {
    const [rawBlock, jsonPayload] = match;
    const matchIndex = match.index ?? 0;
    const prefix = content.slice(lastIndex, matchIndex);

    if (prefix) {
      segments.push({ type: 'markdown', content: prefix });
    }

    try {
      const parsed = JSON.parse(jsonPayload);
      if (isJsonRenderSpec(parsed)) {
        segments.push({ type: 'json-render', spec: parsed });
      } else {
        segments.push({ type: 'markdown', content: rawBlock });
      }
    } catch {
      segments.push({ type: 'markdown', content: rawBlock });
    }

    lastIndex = matchIndex + rawBlock.length;
  }

  const suffix = content.slice(lastIndex);
  if (suffix) {
    segments.push({ type: 'markdown', content: suffix });
  }

  return segments.length > 0 ? segments : [{ type: 'markdown', content }];
};

const JsonRenderStatusLine: React.FC<{ text: string; status?: unknown }> = ({ text, status }) => {
  const tone = typeof status === 'string' ? status : 'info';
  const color = resolveJsonRenderColor(tone, 'var(--color-primary, #3b82f6)');

  return (
    <div
      className='flex items-center gap-8px text-13px'
      style={{
        color: 'var(--color-text-1, #111827)',
      }}
    >
      <span
        className='inline-block h-8px w-8px rounded-full flex-shrink-0'
        style={{
          backgroundColor: color,
          boxShadow: `0 0 0 3px color-mix(in srgb, ${color} 16%, transparent)`,
        }}
      />
      <span className='whitespace-pre-wrap break-words'>{text}</span>
    </div>
  );
};

export const JsonRenderView: React.FC<{ spec: JsonRenderSpec }> = ({ spec }) => {
  const renderNode = (id: string, lineage: string[] = []): React.ReactNode => {
    if (lineage.includes(id)) {
      return null;
    }

    const element = spec.elements[id];
    if (!element) {
      return null;
    }

    const childNodes = (element.children ?? []).map((childId) => (
      <Fragment key={childId}>{renderNode(childId, [...lineage, id])}</Fragment>
    ));
    const props = element.props ?? {};

    switch (element.type) {
      case 'Box':
        return (
          <div
            className='flex min-w-0'
            style={{
              alignItems: 'stretch',
              border:
                typeof props.borderStyle === 'string' && props.borderStyle !== 'none'
                  ? '1px solid var(--bg-3, #e5e7eb)'
                  : undefined,
              borderRadius: 12,
              flexDirection: props.flexDirection === 'row' ? 'row' : 'column',
              gap: resolveJsonRenderSpace(props.gap, 8),
              padding: resolveJsonRenderSpace(props.padding, 0),
            }}
          >
            {childNodes}
          </div>
        );

      case 'Card':
        return (
          <div
            className='min-w-0'
            style={{
              background: 'var(--bg-2, rgba(255,255,255,0.72))',
              border: '1px solid var(--bg-3, #e5e7eb)',
              borderRadius: 14,
              padding: resolveJsonRenderSpace(props.padding, 16),
            }}
          >
            {props.title ? (
              <div className='mb-10px text-13px font-600 text-t-secondary'>{toDisplayText(props.title)}</div>
            ) : null}
            <div className='flex min-w-0 flex-col gap-8px'>{childNodes}</div>
          </div>
        );

      case 'Heading': {
        const level = props.level === 'h1' ? 'h1' : props.level === 'h3' ? 'h3' : 'h2';
        const styleMap: Record<typeof level, React.CSSProperties> = {
          h1: { fontSize: 24, fontWeight: 700, lineHeight: 1.25 },
          h2: { fontSize: 20, fontWeight: 700, lineHeight: 1.3 },
          h3: { fontSize: 16, fontWeight: 600, lineHeight: 1.35 },
        };
        return (
          <div style={{ ...styleMap[level], color: 'var(--color-text-1, #111827)' }}>{toDisplayText(props.text)}</div>
        );
      }

      case 'Text':
        return (
          <div
            style={{
              color: resolveJsonRenderColor(props.color, 'var(--color-text-1, #111827)'),
              fontSize: 13,
              fontWeight: props.bold ? 600 : 400,
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {toDisplayText(props.text)}
          </div>
        );

      case 'Divider':
        return (
          <div className='flex items-center gap-8px'>
            {props.title ? (
              <span className='text-12px font-600 text-t-secondary'>{toDisplayText(props.title)}</span>
            ) : null}
            <div className='h-1px flex-1 bg-[var(--bg-3,#e5e7eb)]' />
          </div>
        );

      case 'Table': {
        const columns = Array.isArray(props.columns)
          ? props.columns.filter((column): column is Record<string, unknown> => !!column && typeof column === 'object')
          : [];
        const rows = Array.isArray(props.rows)
          ? props.rows.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
          : [];

        return (
          <div className='min-w-0 overflow-x-auto rounded-12px border border-solid border-[var(--bg-3,#e5e7eb)]'>
            <table className='min-w-full border-collapse text-left text-13px'>
              <thead
                style={{
                  background: `color-mix(in srgb, ${resolveJsonRenderColor(props.headerColor, '#3b82f6')} 12%, transparent)`,
                }}
              >
                <tr>
                  {columns.map((column) => {
                    const key = toDisplayText(column.key) || toDisplayText(column.header);
                    return (
                      <th
                        key={key}
                        className='border-b border-solid border-[var(--bg-3,#e5e7eb)] px-12px py-10px font-600 text-t-secondary'
                        style={{
                          minWidth: typeof column.width === 'number' ? `${column.width}ch` : undefined,
                        }}
                      >
                        {toDisplayText(column.header)}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIndex) => (
                  <tr key={`${id}-row-${rowIndex}`}>
                    {columns.map((column) => (
                      <td
                        key={`${id}-${rowIndex}-${toDisplayText(column.key)}`}
                        className='border-b border-solid border-[var(--bg-3,#e5e7eb)] px-12px py-10px align-top text-t-primary last:border-b-0'
                        style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                      >
                        {toDisplayText(row[toDisplayText(column.key)])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }

      case 'StatusLine':
        return <JsonRenderStatusLine text={toDisplayText(props.text)} status={props.status} />;

      case 'KeyValue':
        return (
          <div className='flex items-start gap-8px text-13px leading-20px'>
            <span className='min-w-72px flex-shrink-0 font-600 text-t-secondary'>{toDisplayText(props.label)}</span>
            <span className='whitespace-pre-wrap break-words text-t-primary'>{toDisplayText(props.value)}</span>
          </div>
        );

      case 'Badge': {
        const variant = typeof props.variant === 'string' ? props.variant : 'info';
        const color = resolveJsonRenderColor(variant, 'var(--color-primary, #3b82f6)');
        return (
          <span
            className='inline-flex w-fit items-center rounded-full px-10px py-4px text-12px font-600'
            style={{
              background: `color-mix(in srgb, ${color} 14%, transparent)`,
              color,
            }}
          >
            {toDisplayText(props.label)}
          </span>
        );
      }

      case 'Metric': {
        const trend = typeof props.trend === 'string' ? props.trend : undefined;
        const trendColor =
          trend === 'up'
            ? resolveJsonRenderColor('success')
            : trend === 'down'
              ? resolveJsonRenderColor('error')
              : 'var(--color-text-3, #6b7280)';
        return (
          <div className='rounded-12px border border-solid border-[var(--bg-3,#e5e7eb)] px-12px py-10px'>
            <div className='text-12px text-t-secondary'>{toDisplayText(props.label)}</div>
            <div className='mt-4px text-20px font-700 text-t-primary'>{toDisplayText(props.value)}</div>
            {trend ? (
              <div className='mt-4px text-12px font-600' style={{ color: trendColor }}>
                {trend === 'up' ? '↑' : '↓'} {trend}
              </div>
            ) : null}
          </div>
        );
      }

      case 'Callout': {
        const type = typeof props.type === 'string' ? props.type : 'info';
        const color = resolveJsonRenderColor(type, 'var(--color-primary, #3b82f6)');
        return (
          <div
            className='rounded-12px border-l-4 px-12px py-10px'
            style={{
              background: `color-mix(in srgb, ${color} 10%, transparent)`,
              borderColor: color,
            }}
          >
            {props.title ? (
              <div className='mb-4px text-13px font-700 text-t-primary'>{toDisplayText(props.title)}</div>
            ) : null}
            <div className='whitespace-pre-wrap break-words text-13px text-t-primary'>
              {toDisplayText(props.content)}
            </div>
          </div>
        );
      }

      case 'ProgressBar': {
        const progress = typeof props.progress === 'number' ? Math.max(0, Math.min(1, props.progress)) : 0;
        return (
          <div className='min-w-0'>
            {props.label ? <div className='mb-6px text-12px text-t-secondary'>{toDisplayText(props.label)}</div> : null}
            <div className='h-8px w-full overflow-hidden rounded-full bg-[var(--bg-3,#e5e7eb)]'>
              <div
                className='h-full rounded-full bg-[var(--color-primary,#3b82f6)] transition-all'
                style={{ width: `${progress * 100}%` }}
              />
            </div>
          </div>
        );
      }

      case 'BarChart': {
        const data = Array.isArray(props.data)
          ? props.data.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
          : [];
        const maxValue = data.reduce((max, item) => {
          const value = typeof item.value === 'number' ? item.value : 0;
          return Math.max(max, value);
        }, 0);

        return (
          <div className='flex min-w-0 flex-col gap-8px'>
            {data.map((item, index) => {
              const value = typeof item.value === 'number' ? item.value : 0;
              const ratio = maxValue > 0 ? value / maxValue : 0;
              const color = resolveJsonRenderColor(item.color, 'var(--color-primary, #3b82f6)');
              return (
                <div
                  key={`${id}-${index}`}
                  className='grid min-w-0 items-center gap-10px'
                  style={{ gridTemplateColumns: 'minmax(72px,auto) 1fr auto' }}
                >
                  <span className='truncate text-12px text-t-secondary'>{toDisplayText(item.label)}</span>
                  <div className='h-8px overflow-hidden rounded-full bg-[var(--bg-3,#e5e7eb)]'>
                    <div className='h-full rounded-full' style={{ background: color, width: `${ratio * 100}%` }} />
                  </div>
                  <span className='text-12px font-600 text-t-primary'>
                    {props.showPercentage ? `${Math.round(ratio * 100)}%` : value}
                  </span>
                </div>
              );
            })}
          </div>
        );
      }

      case 'Sparkline': {
        const points = Array.isArray(props.data)
          ? props.data.filter((value): value is number => typeof value === 'number')
          : [];
        if (points.length === 0) {
          return null;
        }
        const width = 160;
        const height = 40;
        const max = Math.max(...points);
        const min = Math.min(...points);
        const range = max - min || 1;
        const polyline = points
          .map((value, index) => {
            const x = (index / Math.max(points.length - 1, 1)) * width;
            const y = height - ((value - min) / range) * height;
            return `${x},${y}`;
          })
          .join(' ');

        return (
          <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className='overflow-visible'>
            <polyline
              fill='none'
              points={polyline}
              stroke={resolveJsonRenderColor(props.color, 'var(--color-primary, #3b82f6)')}
              strokeLinecap='round'
              strokeLinejoin='round'
              strokeWidth='2.5'
            />
          </svg>
        );
      }

      case 'List': {
        const items = Array.isArray(props.items) ? props.items.map((item) => toDisplayText(item)) : [];
        const ListTag = props.ordered ? 'ol' : 'ul';
        return (
          <ListTag className='m-0 pl-18px text-13px leading-22px text-t-primary'>
            {items.map((item, index) => (
              <li key={`${id}-${index}`} className='whitespace-pre-wrap break-words'>
                {item}
              </li>
            ))}
          </ListTag>
        );
      }

      case 'Timeline': {
        const items = Array.isArray(props.items)
          ? props.items.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
          : [];
        return (
          <div className='flex flex-col gap-12px'>
            {items.map((item, index) => {
              const color = resolveJsonRenderColor(item.status, 'var(--color-primary, #3b82f6)');
              return (
                <div key={`${id}-${index}`} className='flex gap-10px'>
                  <div className='flex flex-col items-center'>
                    <span className='mt-4px inline-block h-8px w-8px rounded-full' style={{ background: color }} />
                    {index < items.length - 1 ? (
                      <span className='mt-4px h-full min-h-20px w-1px bg-[var(--bg-3,#e5e7eb)]' />
                    ) : null}
                  </div>
                  <div className='pb-4px'>
                    <div className='text-13px font-600 text-t-primary'>{toDisplayText(item.title)}</div>
                    {item.description ? (
                      <div className='mt-2px whitespace-pre-wrap break-words text-12px text-t-secondary'>
                        {toDisplayText(item.description)}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        );
      }

      case 'Spacer':
        return <div style={{ minHeight: 8, minWidth: 8, flex: 1 }} />;

      case 'Newline':
        return <div style={{ height: 8 }} />;

      default:
        return (
          <pre className='m-0 overflow-x-auto rounded-12px bg-[var(--bg-2,#f8fafc)] p-12px text-12px leading-18px text-t-secondary'>
            {JSON.stringify(element, null, 2)}
          </pre>
        );
    }
  };

  return (
    <div className='my-8px overflow-hidden rounded-16px border border-solid border-[var(--bg-3,#e5e7eb)] bg-[var(--bg-1,#ffffff)] p-12px shadow-[0_8px_24px_rgba(15,23,42,0.06)]'>
      {renderNode(spec.root)}
    </div>
  );
};

const useFormatContent = (content: string) => {
  return useMemo(() => {
    try {
      const json = JSON.parse(content);
      const isJson = typeof json === 'object';
      return {
        json: isJson,
        data: isJson ? json : content,
      };
    } catch {
      return { data: content };
    }
  }, [content]);
};

const MessageText: React.FC<{ message: IMessageText }> = ({ message }) => {
  // Filter think tags from content before rendering
  // 在渲染前过滤 think 标签
  const contentToRender = useMemo(() => {
    let content = message.content.content;
    if (typeof content === 'string') {
      if (hasThinkTags(content)) {
        content = stripThinkTags(content);
      }
      // Strip any inline [SKILL_SUGGEST] blocks (now handled via separate skill_suggest message type)
      if (hasSkillSuggest(content)) {
        content = stripSkillSuggest(content);
      }
      return content;
    }
    return content;
  }, [message.content.content]);

  const { text, files } = parseFileMarker(contentToRender);
  const { data, json } = useFormatContent(text);
  const richSegments = useMemo(() => extractRichMessageSegments(text), [text]);
  const hasJsonRenderBlocks = richSegments.some((segment) => segment.type === 'json-render');
  const { t } = useTranslation();
  const [showCopyAlert, setShowCopyAlert] = useState(false);
  const isUserMessage = message.position === 'right';
  const isTeammateMessage = message.position === 'left' && message.content.teammateMessage === true;

  // 过滤空内容，避免渲染空DOM
  if (!message.content.content || (typeof message.content.content === 'string' && !message.content.content.trim())) {
    return null;
  }

  const handleCopy = () => {
    const baseText = json ? JSON.stringify(data, null, 2) : text;
    const fileList = files.length ? `Files:\n${files.map((path) => `- ${path}`).join('\n')}\n\n` : '';
    const textToCopy = fileList + baseText;
    copyText(textToCopy)
      .then(() => {
        setShowCopyAlert(true);
        setTimeout(() => setShowCopyAlert(false), 2000);
      })
      .catch(() => {
        Message.error(t('common.copyFailed'));
      });
  };

  const copyButton = (
    <Tooltip content={t('common.copy', { defaultValue: 'Copy' })}>
      <div
        className='message-copy-action p-4px rd-8px cursor-pointer hover:bg-3 transition-colors opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto'
        onClick={handleCopy}
        style={{ lineHeight: 0 }}
      >
        <Copy theme='outline' size='16' fill={iconColors.secondary} />
      </div>
    </Tooltip>
  );

  const cronMeta = message.content.cronMeta;
  const senderName = message.content.senderName;
  const senderAgentType = message.content.senderAgentType;
  const agentLogo = senderAgentType ? getAgentLogo(senderAgentType) : null;

  return (
    <>
      <div
        className={classNames(
          'message-thread min-w-0 flex flex-col group',
          isUserMessage ? 'items-end' : 'items-start'
        )}
      >
        {cronMeta && <MessageCronBadge meta={cronMeta} />}
        {isTeammateMessage && senderName && (
          <div className='message-sender flex items-center gap-6px mb-6px'>
            {agentLogo ? (
              <img src={agentLogo} alt={senderName} className='w-20px h-20px rounded-full object-contain' />
            ) : (
              <div className='w-20px h-20px rounded-full bg-fill-3 flex items-center justify-center text-10px text-t-secondary font-medium'>
                {senderName.charAt(0).toUpperCase()}
              </div>
            )}
            <span className='text-12px text-t-secondary'>{senderName}</span>
          </div>
        )}
        {files.length > 0 && (
          <div className={classNames('message-attachments mt-6px', { 'self-end': isUserMessage })}>
            {files.length === 1 ? (
              <div className='flex items-center'>
                <FilePreview path={files[0]} onRemove={() => undefined} readonly />
              </div>
            ) : (
              <HorizontalFileList>
                {files.map((path) => (
                  <FilePreview key={path} path={path} onRemove={() => undefined} readonly />
                ))}
              </HorizontalFileList>
            )}
          </div>
        )}
        <div
          className={classNames(
            'message-bubble min-w-0 [&>p:first-child]:mt-0px [&>p:last-child]:mb-0px md:max-w-860px',
            {
              'message-bubble--user': isUserMessage || cronMeta,
              'message-bubble--teammate': isTeammateMessage,
              'message-bubble--assistant w-full': !(isUserMessage || cronMeta || isTeammateMessage),
            }
          )}
        >
          {/* JSON 内容使用折叠组件 Use CollapsibleContent for JSON content */}
          {json ? (
            <CollapsibleContent maxHeight={200} defaultCollapsed={true}>
              <MarkdownView
                codeStyle={{ marginTop: 4, marginBlock: 4 }}
              >{`\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``}</MarkdownView>
            </CollapsibleContent>
          ) : hasJsonRenderBlocks ? (
            <div className='flex min-w-0 flex-col gap-8px'>
              {richSegments.map((segment, index) =>
                segment.type === 'json-render' ? (
                  <JsonRenderView key={`json-render-${index}`} spec={segment.spec} />
                ) : segment.content.trim() ? (
                  <MarkdownView key={`markdown-${index}`} codeStyle={{ marginTop: 4, marginBlock: 4 }}>
                    {segment.content}
                  </MarkdownView>
                ) : null
              )}
            </div>
          ) : (
            <MarkdownView codeStyle={{ marginTop: 4, marginBlock: 4 }}>{data}</MarkdownView>
          )}
        </div>
        <div
          className={classNames('message-meta h-32px flex items-center mt-6px gap-8px', {
            'flex-row-reverse': isUserMessage,
          })}
        >
          {copyButton}
          {message.createdAt && (
            <span className='message-timestamp text-12px c-text-4 opacity-0 group-hover:opacity-100 transition-opacity select-none'>
              {formatMessageTime(message.createdAt)}
            </span>
          )}
        </div>
      </div>
      {showCopyAlert && (
        <Alert
          type='success'
          content={t('messages.copySuccess')}
          showIcon
          className='fixed top-20px left-50% transform -translate-x-50% z-9999 w-max max-w-[80%]'
          style={{ boxShadow: '0px 2px 12px rgba(0,0,0,0.12)' }}
          closable={false}
        />
      )}
    </>
  );
};

export default MessageText;
