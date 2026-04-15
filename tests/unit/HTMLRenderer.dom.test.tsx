/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React, { useMemo, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PreviewToolbarExtrasProvider,
  type PreviewToolbarExtras,
} from '../../src/renderer/pages/conversation/Preview/context/PreviewToolbarExtrasContext';
import HTMLRenderer from '../../src/renderer/pages/conversation/Preview/components/renderers/HTMLRenderer';

vi.mock('@/common', () => ({
  ipcBridge: {
    fs: {
      getImageBase64: {
        invoke: vi.fn(),
      },
      readFile: {
        invoke: vi.fn(),
      },
    },
  },
}));

vi.mock('@/renderer/hooks/chat/useTypingAnimation', () => ({
  useTypingAnimation: ({ content }: { content: string }) => ({
    displayedContent: content,
    isAnimating: false,
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

const ToolbarHarness: React.FC<React.ComponentProps<typeof HTMLRenderer>> = (props) => {
  const [extras, setExtras] = useState<PreviewToolbarExtras | null>(null);
  const contextValue = useMemo(() => ({ setExtras }), [setExtras]);

  return (
    <PreviewToolbarExtrasProvider value={contextValue}>
      <div data-testid='toolbar-right'>{extras?.right}</div>
      <HTMLRenderer {...props} />
    </PreviewToolbarExtrasProvider>
  );
};

describe('HTMLRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads file-backed previews from the real file URL when requested', () => {
    render(
      <ToolbarHarness
        content='<html><body><div id="graph"></div></body></html>'
        filePath='/Users/wayz/Desktop/我的云盘/test graph.html'
        preferFileSource
      />
    );

    const webview = document.querySelector('webview');

    expect(webview).toBeInTheDocument();
    expect(webview).toHaveAttribute(
      'src',
      'file:///Users/wayz/Desktop/%E6%88%91%E7%9A%84%E4%BA%91%E7%9B%98/test%20graph.html'
    );
  });

  it('keeps dirty previews on an inline data URL so unsaved edits remain visible', () => {
    render(
      <ToolbarHarness
        content='<html><body><script>fetch("./graph.json")</script></body></html>'
        filePath='/Users/wayz/Desktop/我的云盘/test graph.html'
        preferFileSource={false}
      />
    );

    const webview = document.querySelector('webview');

    expect(webview).toBeInTheDocument();
    expect(webview?.getAttribute('src')).toMatch(/^data:text\/html;charset=utf-8,/);
  });

  it('exposes a refresh control that remounts the preview surface', async () => {
    const { container } = render(
      <ToolbarHarness
        content='<html><body><div id="graph"></div></body></html>'
        filePath='/Users/wayz/Desktop/我的云盘/test graph.html'
        preferFileSource
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Refresh')).toBeInTheDocument();
    });

    const firstWebview = container.querySelector('webview');
    fireEvent.click(screen.getByText('Refresh'));
    const secondWebview = container.querySelector('webview');

    expect(secondWebview).toBeInTheDocument();
    expect(firstWebview).not.toBeNull();
    expect(secondWebview).not.toBe(firstWebview);
  });
});
