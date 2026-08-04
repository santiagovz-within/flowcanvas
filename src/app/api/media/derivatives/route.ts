import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  gcsPathFromRef,
  getGcsBucket,
  isGcsRef,
  MEDIA_CACHE_CONTROL,
} from '@/lib/gcs';
import { ensureMediaDerivatives } from '@/lib/mediaDerivatives';

const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/mpeg',
]);

/** Finalizes a direct-to-GCS upload and creates its stored preview assets. */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { ref, contentType } = await request.json() as {
    ref?: string;
    contentType?: string;
  };
  if (!isGcsRef(ref) || !contentType || !ALLOWED_TYPES.has(contentType)) {
    return NextResponse.json({ error: 'Invalid media upload' }, { status: 400 });
  }

  const objectPath = gcsPathFromRef(ref);
  if (
    !objectPath.startsWith(`${user.id}/refs/`)
    && !objectPath.startsWith(`user-gifs/${user.id}/`)
  ) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const file = getGcsBucket().file(objectPath);
  let storedContentType: string;
  try {
    const [metadata] = await file.getMetadata();
    storedContentType = metadata.contentType ?? '';
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code === 404) {
      return NextResponse.json({ error: 'Upload not found' }, { status: 404 });
    }
    throw error;
  }
  if (storedContentType !== contentType || !ALLOWED_TYPES.has(storedContentType)) {
    return NextResponse.json({ error: 'Stored media type does not match' }, { status: 409 });
  }

  await file.setMetadata({
    cacheControl: MEDIA_CACHE_CONTROL,
  });

  try {
    const derivatives = await ensureMediaDerivatives(objectPath, storedContentType);
    return NextResponse.json({ success: true, derivatives });
  } catch (error) {
    console.error('[media-derivatives] Direct upload preview failed', {
      objectPath,
      error,
    });
    return NextResponse.json(
      { error: 'Upload succeeded, but preview creation failed' },
      { status: 502 },
    );
  }
}
