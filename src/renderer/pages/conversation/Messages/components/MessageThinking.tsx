/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IMessageThinking } from '@/common/chat/chatLib';
import { Spin } from '@arco-design/web-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './MessageThinking.module.css';

const formatDuration = (ms: number): string => {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m ${remaining}s`;
};

const getFirstLine = (content: string): string => {
  const firstLine = content.split('\n')[0] || '';
  return firstLine.length > 80 ? firstLine.slice(0, 80) + '...' : firstLine;
};

const MessageThinking: React.FC<{ message: IMessageThinking }> = ({ message }) => {
  const { t } = useTranslation();
  const { content: text, status, duration, subject } = message.content;
  const isDone = status === 'done';
  const [expanded, setExpanded] = useState(false);

  const summaryText = isDone
    ? `${t('conversation.thinking.completed')} (${formatDuration(duration || 0)}) — ${getFirstLine(text)}`
    : subject || getFirstLine(text) || t('conversation.thinking.processing');

  return (
    <div className={styles.container}>
      <div className={styles.header} onClick={() => setExpanded((v) => !v)}>
        {!isDone && <Spin size={12} />}
        <span className={`${styles.arrow} ${expanded ? styles.arrowExpanded : ''}`}>{'\u25B6'}</span>
        <span className={styles.summary}>{summaryText}</span>
      </div>
      <div className={`${styles.body} ${!expanded ? styles.collapsed : ''}`}>{text}</div>
    </div>
  );
};

export default MessageThinking;
