/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import WebviewHost from '@/renderer/components/media/WebviewHost';
import { isElectronDesktop, openExternalUrl } from '@/renderer/utils/platform';
import { Button, Message, Spin } from '@arco-design/web-react';
import { Copy } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

type DocType = 'ppt' | 'word' | 'excel';

const BRIDGE = {
  ppt: ipcBridge.pptPreview,
  word: ipcBridge.wordPreview,
  excel: ipcBridge.excelPreview,
} as const;

// Web-server proxy base paths (Electron uses the direct localhost URL instead)
const PROXY_PATH: Record<DocType, string> = {
  ppt: '/api/ppt-proxy',
  word: '/api/office-watch-proxy',
  excel: '/api/office-watch-proxy',
};

const IFRAME_TITLE: Record<DocType, string> = {
  ppt: 'PPT Preview',
  word: 'Word Preview',
  excel: 'Excel Preview',
};

const I18N_KEYS = {
  ppt: {
    loading: 'preview.ppt.loading',
    installing: 'preview.ppt.installing',
    startFailed: 'preview.ppt.startFailed',
    installHint: 'preview.ppt.installHint',
  },
  word: {
    loading: 'preview.word.watch.loading',
    installing: 'preview.word.watch.installing',
    startFailed: 'preview.word.watch.startFailed',
    installHint: 'preview.word.watch.installHint',
  },
  excel: {
    loading: 'preview.excel.watch.loading',
    installing: 'preview.excel.watch.installing',
    startFailed: 'preview.excel.watch.startFailed',
    installHint: 'preview.excel.watch.installHint',
  },
} as const;

const MANUAL_INSTALL_URL = 'https://github.com/iOfficeAI/OfficeCli';

const UNIX_INSTALL_COMMAND = 'curl -fsSL https://raw.githubusercontent.com/iOfficeAI/OfficeCli/main/install.sh | bash';
const WIN_INSTALL_COMMAND =
  'powershell -NoProfile -Command "irm https://raw.githubusercontent.com/iOfficeAI/OfficeCli/main/install.ps1 | iex"';

interface OfficeWatchViewerProps {
  docType: DocType;
  filePath?: string;
  content?: string;
}

interface FailureMeta {
  hintKey?: string;
  manualCommand?: string;
}

type ViewerPlatform = 'windows' | 'darwin' | 'linux' | 'other';

/**
 * Detect the renderer-side platform. Kept local (not in the shared platform
 * helper) because the viewer needs to pick per-platform hint keys without
 * depending on IPC — `navigator.platform` is always synchronously available
 * in Electron and WebUI alike. Returns `'other'` when detection fails so the
 * component still renders a reasonable default command.
 *
 * Note: the check order and token list matters. `darwin` contains the substring
 * `win`, so we must test for `darwin`/`mac` before `win`; and we match a
 * specific token list for Windows (`win32`, `win64`, `windows`, `winnt`)
 * instead of bare `win` to avoid false positives from `darwin` or `winapi`.
 */
function detectPlatform(): ViewerPlatform {
  if (typeof navigator === 'undefined') return 'other';
  const source = `${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`.toLowerCase();
  if (source.includes('darwin') || source.includes('mac')) return 'darwin';
  if (source.includes('linux')) return 'linux';
  if (source.includes('win32') || source.includes('win64') || source.includes('windows') || source.includes('winnt'))
    return 'windows';
  return 'other';
}

/**
 * Resolve the default install command for a given platform.
 */
function defaultCommandFor(platform: ViewerPlatform): string {
  return platform === 'windows' ? WIN_INSTALL_COMMAND : UNIX_INSTALL_COMMAND;
}

/**
 * Resolve the default hint key for a given platform. Bridges can override
 * this via `hintKey` on the failure status payload when they detect a more
 * specific condition (e.g. Windows ExecutionPolicy block).
 */
function defaultHintKeyFor(platform: ViewerPlatform): string {
  switch (platform) {
    case 'windows':
      return 'preview.officecli.hints.windowsGeneric';
    case 'darwin':
      return 'preview.officecli.hints.darwin';
    case 'linux':
      return 'preview.officecli.hints.linux';
    default:
      return 'preview.officecli.hints.linux';
  }
}

/**
 * Copy text to the clipboard. Prefers the async Clipboard API and falls back
 * to the deprecated `document.execCommand('copy')` for legacy environments
 * that block the Clipboard API (e.g. certain Electron restricted contexts).
 * Returns `true` on success.
 */
async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to legacy path
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Shared Office watch viewer.
 *
 * Launches an `officecli watch` child process via IPC, waits for the local
 * HTTP server to be ready, then renders it in a webview (Electron) or iframe
 * (web server mode). Cleans up the process on unmount.
 *
 * On install failure it surfaces a structured Card with:
 *   - Retry (triggers `installOfficecli` over IPC and re-runs `start`)
 *   - Manual install (opens the OfficeCli project page in the user's browser)
 *   - Copy command (puts the platform-appropriate install command on the
 *     clipboard; on Windows the panel also shows the ExecutionPolicy hint
 *     when the bridge detected that failure shape).
 */
const OfficeWatchViewer: React.FC<OfficeWatchViewerProps> = ({ docType, filePath }) => {
  const { t } = useTranslation();
  const keys = I18N_KEYS[docType];

  const [watchUrl, setWatchUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<'starting' | 'installing'>('starting');
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<FailureMeta | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [startKey, setStartKey] = useState(0);
  const filePathRef = useRef(filePath);
  const platform = useMemo(detectPlatform, []);

  // Stash t/keys in refs so the start effect does not list them as deps — the
  // `useTranslation` hook returns a new `t` function on every render which, if
  // included in the effect deps, would re-run the entire bridge lifecycle on
  // every render.
  const tRef = useRef(t);
  const keysRef = useRef(keys);
  tRef.current = t;
  keysRef.current = keys;

  useEffect(() => {
    filePathRef.current = filePath;
    const bridge = BRIDGE[docType];

    if (!filePath) {
      setLoading(false);
      setError(tRef.current('preview.errors.missingFilePath'));
      return;
    }

    let cancelled = false;

    const unsubStatus = bridge.status.on((evt) => {
      if (cancelled) return;
      if (evt.state === 'installing') setStatus('installing');
      else if (evt.state === 'starting') setStatus('starting');
      if (evt.state === 'error' && (evt.hintKey || evt.manualCommand)) {
        setFailure({ hintKey: evt.hintKey, manualCommand: evt.manualCommand });
      }
    });

    const start = async () => {
      setLoading(true);
      setStatus('starting');
      setError(null);
      setFailure(null);
      try {
        const result = await bridge.start.invoke({ filePath });
        const url = result.url;
        if (!url || ('error' in result && result.error)) {
          throw new Error((result as { error?: string }).error || tRef.current(keysRef.current.startFailed));
        }
        // Small delay to ensure the watch HTTP server is fully ready for the webview
        await new Promise((r) => setTimeout(r, 300));
        if (!cancelled) {
          let resolvedUrl = url;
          if (!isElectronDesktop()) {
            const port = new URL(url).port;
            resolvedUrl = `${PROXY_PATH[docType]}/${port}/`;
          }
          setWatchUrl(resolvedUrl);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : tRef.current(keysRef.current.startFailed);
          setError(msg);
          setLoading(false);
        }
      }
    };

    void start();

    return () => {
      cancelled = true;
      unsubStatus();
      if (filePathRef.current) {
        bridge.stop.invoke({ filePath: filePathRef.current }).catch(() => {});
      }
    };
  }, [docType, filePath, startKey]);

  const manualCommand = failure?.manualCommand ?? defaultCommandFor(platform);
  const hintKey = failure?.hintKey ?? defaultHintKeyFor(platform);

  const handleRetry = useCallback(async () => {
    setRetrying(true);
    setStatus('installing');
    try {
      const response = await ipcBridge.officeCli.installOfficecli.invoke();
      if (response?.success === false) {
        Message.error(t('preview.officecli.hints.cooldown'));
      }
    } catch {
      // Errors propagate through status emitter; swallow to avoid double-surfacing.
    } finally {
      setRetrying(false);
      // Trigger the start effect by bumping the key — this also resets
      // `watchUrl`/`error` so the UI returns to the loading state while the
      // retry spawn runs.
      setStartKey((k) => k + 1);
    }
  }, [t]);

  const handleCopyCommand = useCallback(async () => {
    const ok = await copyTextToClipboard(manualCommand);
    if (ok) {
      Message.success(t('preview.officecli.actions.copySuccess'));
    }
  }, [manualCommand, t]);

  const handleManualInstall = useCallback(async () => {
    await openExternalUrl(MANUAL_INSTALL_URL);
  }, []);

  if (loading) {
    return (
      <div className='h-full w-full flex items-center justify-center bg-bg-1'>
        <div className='flex flex-col items-center gap-12px'>
          <Spin size={32} />
          <span className='text-13px text-t-secondary'>
            {status === 'installing' ? t(keys.installing) : t(keys.loading)}
          </span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className='h-full w-full flex items-center justify-center bg-bg-1 p-24px'>
        <div
          role='alert'
          className='w-full max-w-520px rounded-8px bg-bg-2 border border-solid border-color-border p-20px'
          data-testid='officecli-failure-card'
        >
          <div className='text-15px font-medium text-t-primary mb-8px'>{t('preview.officecli.failed.title')}</div>
          <div className='text-13px text-danger mb-12px break-words'>{error}</div>
          <div className='text-12px text-t-secondary mb-16px leading-relaxed'>{t(hintKey)}</div>

          <div
            className='text-12px font-mono bg-bg-1 border border-solid border-color-border rounded-4px p-10px mb-16px break-all'
            data-testid='officecli-manual-command'
          >
            {manualCommand}
          </div>

          <div className='flex flex-wrap items-center gap-8px'>
            <Button type='primary' size='small' onClick={handleRetry} loading={retrying}>
              {t('preview.officecli.actions.retry')}
            </Button>
            <Button type='secondary' size='small' onClick={handleManualInstall}>
              {t('preview.officecli.actions.manualInstall')}
            </Button>
            <Button type='secondary' size='small' icon={<Copy theme='outline' size='14' />} onClick={handleCopyCommand}>
              {t('preview.officecli.actions.copyCommand')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!watchUrl) return null;

  // Electron: use <webview> via WebviewHost for full Electron integration.
  // Web server mode: use <iframe> since <webview> is Electron-only.
  if (isElectronDesktop()) {
    return <WebviewHost url={watchUrl} className='bg-bg-1' />;
  }
  return <iframe src={watchUrl} className='w-full h-full border-0 bg-bg-1' title={IFRAME_TITLE[docType]} />;
};

export default OfficeWatchViewer;
