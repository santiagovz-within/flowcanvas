import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  getSignedUploadUrl,
  getSignedReadUrl,
  MEDIA_CACHE_CONTROL,
} from '@/lib/gcs';

const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg':      'jpg',
  'image/png':       'png',
  'image/webp':      'webp',
  'image/gif':       'gif',
  'video/mp4':       'mp4',
  'video/webm':      'webm',
  'video/quicktime': 'mov',
  'video/mpeg':      'mpeg',
};

// POST /api/upload/sign
// Returns a one-time signed write URL so the browser can PUT the file
// directly to GCS — file bytes never cross a Vercel function.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { contentType } = await request.json();
  const ext = ALLOWED_TYPES[contentType as string];
  if (!ext) {
    return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 });
  }

  const objectPath = `${user.id}/refs/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const ref = `gcs:${objectPath}`;

  const [uploadUrl, readUrl] = await Promise.all([
    getSignedUploadUrl(objectPath, contentType as string),
    getSignedReadUrl(objectPath),
  ]);

  return NextResponse.json({
    uploadUrl,
    readUrl,
    ref,
    cacheControl: MEDIA_CACHE_CONTROL,
  });
}
