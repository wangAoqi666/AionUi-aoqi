/**
 * @license
 * Copyright 2025 Agent Factory
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { Image } from '@arco-design/web-react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const IMAGE_NOT_FOUND_B64_MARKER = 'kltYWdlIG5vdCBmb3VuZD';
const MAX_IMAGE_RETRIES = 5;
const IMAGE_RETRY_DELAY_MS = 800;

interface ImagePreviewProps {
  filePath?: string;
  content?: string;
  fileName?: string;
}

const ImagePreview: React.FC<ImagePreviewProps> = ({ filePath, content, fileName }) => {
  const { t } = useTranslation();
  const [imageSrc, setImageSrc] = useState<string>(content || '');
  const [loading, setLoading] = useState<boolean>(!!filePath && !content);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    let retryCount = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const loadImage = async () => {
      if (content) {
        setImageSrc(content);
        setLoading(false);
        setError(null);
        return;
      }

      if (!filePath) {
        setImageSrc('');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);
        const base64 = await ipcBridge.fs.getImageBase64.invoke({ path: filePath });
        if (!isMounted) return;
        if (base64.includes(IMAGE_NOT_FOUND_B64_MARKER)) {
          throw new Error('IMAGE_NOT_FOUND');
        }
        setImageSrc(base64);
      } catch (err) {
        if (!isMounted) return;
        const shouldRetry = err instanceof Error && err.message === 'IMAGE_NOT_FOUND' && !content && Boolean(filePath);
        if (shouldRetry) {
          if (retryCount < MAX_IMAGE_RETRIES) {
            retryCount += 1;
            retryTimer = setTimeout(() => {
              retryTimer = null;
              void loadImage();
            }, IMAGE_RETRY_DELAY_MS);
            return;
          }
        }
        console.error('[ImagePreview] Failed to load image:', err);
        setError(t('messages.imageLoadFailed', { defaultValue: 'Failed to load image' }));
      } finally {
        if (isMounted && !retryTimer) {
          setLoading(false);
        }
      }
    };

    void loadImage();

    return () => {
      isMounted = false;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
    };
  }, [content, filePath, t]);

  const renderStatus = () => {
    if (loading) {
      return <div className='text-14px text-t-secondary'>{t('common.loading', { defaultValue: 'Loading...' })}</div>;
    }

    if (error) {
      return (
        <div className='text-center text-14px text-t-secondary'>
          <div>{error}</div>
          {filePath && <div className='text-12px'>{filePath}</div>}
        </div>
      );
    }

    return (
      <Image
        src={imageSrc}
        alt={fileName || filePath || 'Image preview'}
        className='w-full h-full flex items-center justify-center [&_.arco-image-img]:w-full [&_.arco-image-img]:h-full [&_.arco-image-img]:object-contain'
        preview={false}
      />
    );
  };

  return <div className='flex-1 flex items-center justify-center bg-bg-1 p-24px overflow-auto'>{renderStatus()}</div>;
};

export default ImagePreview;
