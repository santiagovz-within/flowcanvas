import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getGcsBucket, MEDIA_CACHE_CONTROL } from '@/lib/gcs';
import { ensureMediaDerivatives } from '@/lib/mediaDerivatives';
import { shouldCreateMediaDerivatives } from '@/lib/mediaDerivativePaths';

export const maxDuration = 300;

const DEFAULT_PAGE_SIZE = 40;
const MAX_PAGE_SIZE = 100;
const CONCURRENCY = 4;

function inferContentType(name: string): string | null {
  const extension = name.split('.').pop()?.toLowerCase();
  const types: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    mpeg: 'video/mpeg',
    mpg: 'video/mpeg',
  };
  return extension ? types[extension] ?? null : null;
}

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single();
  return profile?.is_admin ? user : null;
}

/**
 * Idempotent, page-by-page batch for existing media. Call again with the
 * returned nextPageToken until done=true. It never runs from a canvas request.
 */
export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => ({})) as {
    pageToken?: string;
    pageSize?: number;
  };
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.floor(body.pageSize ?? DEFAULT_PAGE_SIZE)),
  );
  const [files, nextQuery] = await getGcsBucket().getFiles({
    autoPaginate: false,
    maxResults: pageSize,
    ...(body.pageToken ? { pageToken: body.pageToken } : {}),
  });

  let updated = 0;
  let skipped = 0;
  const failures: Array<{ path: string; error: string }> = [];
  let cursor = 0;

  async function worker() {
    while (cursor < files.length) {
      const file = files[cursor++];
      try {
        const [metadata] = await file.getMetadata();
        const contentType = metadata.contentType ?? inferContentType(file.name);
        if (!contentType || !shouldCreateMediaDerivatives(file.name, contentType)) {
          skipped++;
          continue;
        }

        if (metadata.cacheControl !== MEDIA_CACHE_CONTROL) {
          await file.setMetadata({ cacheControl: MEDIA_CACHE_CONTROL });
        }
        await ensureMediaDerivatives(file.name, contentType);
        updated++;
      } catch (error) {
        failures.push({
          path: file.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, files.length) }, () => worker()),
  );

  const nextPageToken = nextQuery?.pageToken ?? null;
  return NextResponse.json({
    processed: files.length,
    updated,
    skipped,
    failed: failures.length,
    failures,
    nextPageToken,
    done: !nextPageToken,
  });
}
