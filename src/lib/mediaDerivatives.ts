import 'server-only';

import { fal } from '@fal-ai/client';
import sharp from 'sharp';
import {
  getFreshSignedReadUrl,
  getGcsBucket,
  MEDIA_CACHE_CONTROL,
  uploadToGCS,
} from '@/lib/gcs';
import {
  mediaDerivativePaths,
  shouldCreateMediaDerivatives,
  type MediaDerivativePaths,
  type MediaKind,
} from '@/lib/mediaDerivativePaths';

const THUMBNAIL_EDGE = 128;
const THUMBNAIL_TARGET_BYTES = 10 * 1024;
const POSTER_EDGE = 2048;
async function makeThumbnail(input: Buffer): Promise<Buffer> {
  const qualities = [72, 56, 40, 28, 18, 10];
  let output: Buffer | undefined;

  for (const quality of qualities) {
    output = await sharp(input, { animated: false })
      .rotate()
      .resize({
        width: THUMBNAIL_EDGE,
        withoutEnlargement: true,
      })
      .webp({ quality, alphaQuality: Math.max(20, quality) })
      .toBuffer();
    if (output.byteLength <= THUMBNAIL_TARGET_BYTES) return output;
  }

  return output ?? Buffer.alloc(0);
}

async function makePoster(input: Buffer): Promise<Buffer> {
  return sharp(input)
    .rotate()
    .resize({
      width: POSTER_EDGE,
      withoutEnlargement: true,
    })
    .webp({ quality: 78 })
    .toBuffer();
}

async function downloadObject(objectPath: string): Promise<Buffer> {
  const [buffer] = await getGcsBucket().file(objectPath).download();
  return buffer;
}

async function extractVideoFrame(objectPath: string): Promise<Buffer> {
  fal.config({ credentials: process.env.FAL_KEY });
  const videoUrl = await getFreshSignedReadUrl(objectPath);
  const result = await fal.subscribe('fal-ai/ffmpeg-api/extract-frame', {
    input: { video_url: videoUrl, frame_type: 'first' },
  });
  const frameUrl = result.data.images?.[0]?.url;
  if (!frameUrl) throw new Error('Frame extraction returned no image');

  const response = await fetch(frameUrl);
  if (!response.ok) {
    throw new Error(`Could not download extracted frame (${response.status})`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Creates missing derivatives only. It is safe to call repeatedly and is used
 * by both new uploads and the one-time backfill.
 */
export async function ensureMediaDerivatives(
  objectPath: string,
  contentType: string,
  sourceBuffer?: Buffer,
): Promise<MediaDerivativePaths | null> {
  if (!shouldCreateMediaDerivatives(objectPath, contentType)) return null;

  const kind: MediaKind = contentType.startsWith('video/') ? 'video' : 'image';
  const paths = mediaDerivativePaths(objectPath, kind);
  const thumbnailFile = getGcsBucket().file(paths.thumbnailPath);
  const posterFile = paths.posterPath
    ? getGcsBucket().file(paths.posterPath)
    : null;
  const [[thumbnailExists], posterExistsResult] = await Promise.all([
    thumbnailFile.exists(),
    posterFile ? posterFile.exists() : Promise.resolve([true]),
  ]);
  const posterExists = posterExistsResult[0];
  if (thumbnailExists && posterExists) return paths;

  if (kind === 'image') {
    const input = sourceBuffer ?? await downloadObject(objectPath);
    if (!thumbnailExists) {
      const thumbnail = await makeThumbnail(input);
      await uploadToGCS(thumbnail, paths.thumbnailPath, 'image/webp', {
        cacheControl: MEDIA_CACHE_CONTROL,
      });
    }
    return paths;
  }

  const frame = await extractVideoFrame(objectPath);
  const poster = posterExists ? null : await makePoster(frame);
  const thumbnail = thumbnailExists ? null : await makeThumbnail(frame);
  await Promise.all([
    poster && paths.posterPath
      ? uploadToGCS(poster, paths.posterPath, 'image/webp', {
          cacheControl: MEDIA_CACHE_CONTROL,
        })
      : Promise.resolve(),
    thumbnail
      ? uploadToGCS(thumbnail, paths.thumbnailPath, 'image/webp', {
          cacheControl: MEDIA_CACHE_CONTROL,
        })
      : Promise.resolve(),
  ]);
  return paths;
}

/** Uploads durable media first, then best-effort creates its preview assets. */
export async function uploadMediaToGCS(
  buffer: Buffer | ArrayBuffer,
  objectPath: string,
  contentType: string,
): Promise<string> {
  const source = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const ref = await uploadToGCS(source, objectPath, contentType, {
    cacheControl: MEDIA_CACHE_CONTROL,
  });

  try {
    await ensureMediaDerivatives(objectPath, contentType, source);
  } catch (error) {
    // Never turn a successful generation/upload into a failure because a
    // repairable preview could not be produced. The admin backfill retries it.
    console.error('[media-derivatives] Could not create preview', {
      objectPath,
      error,
    });
  }

  return ref;
}

export async function deleteMediaAndDerivatives(
  objectPath: string,
  kind: MediaKind,
): Promise<void> {
  const paths = mediaDerivativePaths(objectPath, kind);
  await Promise.all([
    getGcsBucket().file(objectPath).delete({ ignoreNotFound: true }),
    getGcsBucket().file(paths.thumbnailPath).delete({ ignoreNotFound: true }),
    paths.posterPath
      ? getGcsBucket().file(paths.posterPath).delete({ ignoreNotFound: true })
      : Promise.resolve(),
  ]);
}
