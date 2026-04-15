/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Fragment } from 'react';

export type JsonRenderComponentName =
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

export type JsonRenderElement = {
  type: JsonRenderComponentName;
  props?: Record<string, unknown>;
  children?: string[];
};

export type JsonRenderSpec = {
  root: string;
  elements: Record<string, JsonRenderElement>;
};

export type RichMessageSegment =
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

const statusLineStyle: React.CSSProperties = {
  alignItems: 'center',
  color: 'var(--color-text-1, #111827)',
  display: 'flex',
  fontSize: 13,
  gap: 8,
};

const JsonRenderStatusLine: React.FC<{ text: string; status?: unknown }> = ({ text, status }) => {
  const tone = typeof status === 'string' ? status : 'info';
  const color = resolveJsonRenderColor(tone, 'var(--color-primary, #3b82f6)');

  return (
    <div style={statusLineStyle}>
      <span
        style={{
          backgroundColor: color,
          borderRadius: '9999px',
          boxShadow: `0 0 0 3px color-mix(in srgb, ${color} 16%, transparent)`,
          display: 'inline-block',
          flexShrink: 0,
          height: 8,
          width: 8,
        }}
      />
      <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{text}</span>
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
            style={{
              alignItems: 'stretch',
              border:
                typeof props.borderStyle === 'string' && props.borderStyle !== 'none'
                  ? '1px solid var(--bg-3, #e5e7eb)'
                  : undefined,
              borderRadius: 12,
              display: 'flex',
              flexDirection: props.flexDirection === 'row' ? 'row' : 'column',
              gap: resolveJsonRenderSpace(props.gap, 8),
              minWidth: 0,
              padding: resolveJsonRenderSpace(props.padding, 0),
            }}
          >
            {childNodes}
          </div>
        );

      case 'Card':
        return (
          <div
            style={{
              background: 'var(--bg-2, rgba(255,255,255,0.72))',
              border: '1px solid var(--bg-3, #e5e7eb)',
              borderRadius: 14,
              minWidth: 0,
              padding: resolveJsonRenderSpace(props.padding, 16),
            }}
          >
            {props.title ? (
              <div style={{ color: 'var(--color-text-3, #6b7280)', fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
                {toDisplayText(props.title)}
              </div>
            ) : null}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>{childNodes}</div>
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
          <div style={{ alignItems: 'center', display: 'flex', gap: 8 }}>
            {props.title ? (
              <span style={{ color: 'var(--color-text-3, #6b7280)', fontSize: 12, fontWeight: 600 }}>
                {toDisplayText(props.title)}
              </span>
            ) : null}
            <div style={{ background: 'var(--bg-3, #e5e7eb)', flex: 1, height: 1 }} />
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
          <div style={{ border: '1px solid var(--bg-3, #e5e7eb)', borderRadius: 12, minWidth: 0, overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 13, minWidth: '100%', textAlign: 'left' }}>
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
                        style={{
                          borderBottom: '1px solid var(--bg-3, #e5e7eb)',
                          color: 'var(--color-text-3, #6b7280)',
                          fontWeight: 600,
                          minWidth: typeof column.width === 'number' ? `${column.width}ch` : undefined,
                          padding: '10px 12px',
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
                        style={{
                          borderBottom: rowIndex < rows.length - 1 ? '1px solid var(--bg-3, #e5e7eb)' : undefined,
                          color: 'var(--color-text-1, #111827)',
                          padding: '10px 12px',
                          verticalAlign: 'top',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        }}
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
          <div style={{ alignItems: 'flex-start', display: 'flex', fontSize: 13, gap: 8, lineHeight: '20px' }}>
            <span style={{ color: 'var(--color-text-3, #6b7280)', flexShrink: 0, fontWeight: 600, minWidth: 72 }}>
              {toDisplayText(props.label)}
            </span>
            <span style={{ color: 'var(--color-text-1, #111827)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {toDisplayText(props.value)}
            </span>
          </div>
        );

      case 'Badge': {
        const variant = typeof props.variant === 'string' ? props.variant : 'info';
        const color = resolveJsonRenderColor(variant, 'var(--color-primary, #3b82f6)');
        return (
          <span
            style={{
              background: `color-mix(in srgb, ${color} 14%, transparent)`,
              borderRadius: '9999px',
              color,
              display: 'inline-flex',
              fontSize: 12,
              fontWeight: 600,
              padding: '4px 10px',
              width: 'fit-content',
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
          <div
            style={{
              border: '1px solid var(--bg-3, #e5e7eb)',
              borderRadius: 12,
              padding: '10px 12px',
            }}
          >
            <div style={{ color: 'var(--color-text-3, #6b7280)', fontSize: 12 }}>{toDisplayText(props.label)}</div>
            <div style={{ color: 'var(--color-text-1, #111827)', fontSize: 20, fontWeight: 700, marginTop: 4 }}>
              {toDisplayText(props.value)}
            </div>
            {trend ? (
              <div style={{ color: trendColor, fontSize: 12, fontWeight: 600, marginTop: 4 }}>
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
            style={{
              background: `color-mix(in srgb, ${color} 10%, transparent)`,
              borderLeft: `4px solid ${color}`,
              borderRadius: 12,
              padding: '10px 12px',
            }}
          >
            {props.title ? (
              <div style={{ color: 'var(--color-text-1, #111827)', fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                {toDisplayText(props.title)}
              </div>
            ) : null}
            <div
              style={{
                color: 'var(--color-text-1, #111827)',
                fontSize: 13,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {toDisplayText(props.content)}
            </div>
          </div>
        );
      }

      case 'ProgressBar': {
        const progress = typeof props.progress === 'number' ? Math.max(0, Math.min(1, props.progress)) : 0;
        return (
          <div style={{ minWidth: 0 }}>
            {props.label ? (
              <div style={{ color: 'var(--color-text-3, #6b7280)', fontSize: 12, marginBottom: 6 }}>
                {toDisplayText(props.label)}
              </div>
            ) : null}
            <div
              style={{
                background: 'var(--bg-3, #e5e7eb)',
                borderRadius: '9999px',
                height: 8,
                overflow: 'hidden',
                width: '100%',
              }}
            >
              <div
                style={{
                  background: 'var(--color-primary, #3b82f6)',
                  borderRadius: '9999px',
                  height: '100%',
                  transition: 'width 160ms ease',
                  width: `${progress * 100}%`,
                }}
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
            {data.map((item, index) => {
              const value = typeof item.value === 'number' ? item.value : 0;
              const ratio = maxValue > 0 ? value / maxValue : 0;
              const color = resolveJsonRenderColor(item.color, 'var(--color-primary, #3b82f6)');
              return (
                <div
                  key={`${id}-${index}`}
                  style={{
                    alignItems: 'center',
                    display: 'grid',
                    gap: 10,
                    gridTemplateColumns: 'minmax(72px,auto) 1fr auto',
                    minWidth: 0,
                  }}
                >
                  <span
                    style={{
                      color: 'var(--color-text-3, #6b7280)',
                      fontSize: 12,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {toDisplayText(item.label)}
                  </span>
                  <div
                    style={{
                      background: 'var(--bg-3, #e5e7eb)',
                      borderRadius: '9999px',
                      height: 8,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{ background: color, borderRadius: '9999px', height: '100%', width: `${ratio * 100}%` }}
                    />
                  </div>
                  <span style={{ color: 'var(--color-text-1, #111827)', fontSize: 12, fontWeight: 600 }}>
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
          <svg className='overflow-visible' height={height} viewBox={`0 0 ${width} ${height}`} width={width}>
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
          <ListTag
            style={{
              color: 'var(--color-text-1, #111827)',
              fontSize: 13,
              lineHeight: '22px',
              margin: 0,
              paddingInlineStart: 18,
            }}
          >
            {items.map((item, index) => (
              <li key={`${id}-${index}`} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {items.map((item, index) => {
              const color = resolveJsonRenderColor(item.status, 'var(--color-primary, #3b82f6)');
              return (
                <div key={`${id}-${index}`} style={{ display: 'flex', gap: 10 }}>
                  <div style={{ alignItems: 'center', display: 'flex', flexDirection: 'column' }}>
                    <span
                      style={{
                        background: color,
                        borderRadius: '9999px',
                        display: 'inline-block',
                        height: 8,
                        marginTop: 4,
                        width: 8,
                      }}
                    />
                    {index < items.length - 1 ? (
                      <span
                        style={{
                          background: 'var(--bg-3, #e5e7eb)',
                          height: '100%',
                          marginTop: 4,
                          minHeight: 20,
                          width: 1,
                        }}
                      />
                    ) : null}
                  </div>
                  <div style={{ paddingBottom: 4 }}>
                    <div style={{ color: 'var(--color-text-1, #111827)', fontSize: 13, fontWeight: 600 }}>
                      {toDisplayText(item.title)}
                    </div>
                    {item.description ? (
                      <div
                        style={{
                          color: 'var(--color-text-3, #6b7280)',
                          fontSize: 12,
                          marginTop: 2,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        }}
                      >
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
        return <div style={{ flex: 1, minHeight: 8, minWidth: 8 }} />;

      case 'Newline':
        return <div style={{ height: 8 }} />;

      default:
        return (
          <pre
            style={{
              background: 'var(--bg-2, #f8fafc)',
              borderRadius: 12,
              color: 'var(--color-text-3, #6b7280)',
              fontSize: 12,
              lineHeight: '18px',
              margin: 0,
              overflowX: 'auto',
              padding: 12,
            }}
          >
            {JSON.stringify(element, null, 2)}
          </pre>
        );
    }
  };

  return (
    <div
      style={{
        background: 'var(--bg-1, #ffffff)',
        border: '1px solid var(--bg-3, #e5e7eb)',
        borderRadius: 16,
        boxShadow: '0 8px 24px rgba(15,23,42,0.06)',
        margin: '8px 0',
        overflow: 'hidden',
        padding: 12,
      }}
    >
      {renderNode(spec.root)}
    </div>
  );
};
