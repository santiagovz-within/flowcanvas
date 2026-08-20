'use client';

import { useEffect, useMemo, useState } from 'react';
import type { FalMediaMetadata } from '@/lib/falPricing';

const metadataCache = new Map<string, Promise<FalMediaMetadata | null>>();

function loadImageMetadata(url: string): Promise<FalMediaMetadata | null> {
  return new Promise((resolve) => {
    const image = new window.Image();
    image.onload = () => resolve(
      image.naturalWidth > 0 && image.naturalHeight > 0
        ? { width: image.naturalWidth, height: image.naturalHeight }
        : null,
    );
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

function loadVideoMetadata(url: string): Promise<FalMediaMetadata | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => resolve(
      video.videoWidth > 0 && video.videoHeight > 0 && Number.isFinite(video.duration)
        ? { width: video.videoWidth, height: video.videoHeight, duration: video.duration }
        : null,
    );
    video.onerror = () => resolve(null);
    video.src = url;
    video.load();
  });
}

function getMetadata(url: string, mediaType: 'image' | 'video'): Promise<FalMediaMetadata | null> {
  const key = `${mediaType}:${url}`;
  const cached = metadataCache.get(key);
  if (cached) return cached;
  const pending = mediaType === 'image' ? loadImageMetadata(url) : loadVideoMetadata(url);
  metadataCache.set(key, pending);
  return pending;
}

export function useMediaMetadata(
  urls: string[],
  mediaType: 'image' | 'video' | null,
): Map<string, FalMediaMetadata | null> {
  const cacheKey = [...new Set(urls.filter(Boolean))].join('\u0000');
  const uniqueUrls = useMemo(() => cacheKey ? cacheKey.split('\u0000') : [], [cacheKey]);
  const requestKey = `${mediaType ?? 'none'}:${cacheKey}`;
  const [result, setResult] = useState<{
    requestKey: string;
    metadata: Map<string, FalMediaMetadata | null>;
  }>({ requestKey: '', metadata: new Map() });

  useEffect(() => {
    let cancelled = false;
    if (!mediaType || uniqueUrls.length === 0) return;

    void Promise.all(uniqueUrls.map(async (url) => [url, await getMetadata(url, mediaType)] as const))
      .then((entries) => {
        if (!cancelled) setResult({ requestKey, metadata: new Map(entries) });
      });

    return () => {
      cancelled = true;
    };
  }, [mediaType, requestKey, uniqueUrls]);

  return result.requestKey === requestKey ? result.metadata : new Map();
}
