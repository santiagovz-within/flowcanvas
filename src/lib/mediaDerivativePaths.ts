import { createHash } from 'node:crypto';

export const MEDIA_DERIVATIVE_PREFIX = 'media-derivatives/v1';

export type MediaKind = 'image' | 'video';

export interface MediaDerivativePaths {
  thumbnailPath: string;
  posterPath?: string;
}

export function mediaDerivativePaths(
  objectPath: string,
  kind: MediaKind,
): MediaDerivativePaths {
  const key = createHash('sha256').update(objectPath).digest('hex');
  return {
    thumbnailPath: `${MEDIA_DERIVATIVE_PREFIX}/thumbs/${key}.webp`,
    ...(kind === 'video'
      ? { posterPath: `${MEDIA_DERIVATIVE_PREFIX}/posters/${key}.webp` }
      : {}),
  };
}

export function shouldCreateMediaDerivatives(
  objectPath: string,
  contentType: string,
): boolean {
  if (!contentType.startsWith('image/') && !contentType.startsWith('video/')) {
    return false;
  }

  return ![
    `${MEDIA_DERIVATIVE_PREFIX}/`,
    'thumbnails/',
    'resized-inputs/',
    'site-settings/',
    'prompts/',
    'cache-probes/',
  ].some(prefix => objectPath.startsWith(prefix));
}
