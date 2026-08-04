import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { signGcsRef, isGcsRef, getSignedReadUrl } from '@/lib/gcs';
import { isSignedGcsUrl, extractGcsPathFromSignedUrl } from '@/lib/utils/mediaUtils';
import { mediaDerivativePaths, type MediaKind } from '@/lib/mediaDerivativePaths';

const MEDIA_BUCKET = process.env.GCS_BUCKET_NAME ?? 'within-glide';

function isExpectedBucketUrl(source: string): boolean {
  try {
    const url = new URL(source);
    if (url.hostname === 'storage.googleapis.com') {
      return decodeURIComponent(url.pathname.split('/')[1] ?? '') === MEDIA_BUCKET;
    }
    return url.hostname === `${MEDIA_BUCKET}.storage.googleapis.com`;
  } catch {
    return false;
  }
}

function sourcePath(source: string): string | null {
  if (isGcsRef(source)) return source.slice(4);
  if (isSignedGcsUrl(source) && isExpectedBucketUrl(source)) {
    return extractGcsPathFromSignedUrl(source);
  }
  return null;
}

function isUserOwnedPath(path: string, userId: string): boolean {
  return path.startsWith(`${userId}/`)
    || path.startsWith(`refs/${userId}/`)
    || path.startsWith(`user-gifs/${userId}/`)
    || path.startsWith(`thumbnails/${userId}/`);
}

/**
 * A teammate receives a signed source only after the Flow GET authorization
 * check. Validate that capability with a one-byte range request before using
 * it to mint the related deterministic derivative URLs.
 */
async function hasReadableCapability(source: string): Promise<boolean> {
  if (!isSignedGcsUrl(source)) return false;
  try {
    const response = await fetch(source, {
      headers: { Range: 'bytes=0-0' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    });
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { paths = [], assets = [] } = await request.json() as {
    paths?: string[];
    assets?: Array<{
      key: string;
      source: string;
      kind: MediaKind;
    }>;
  };
  if (!Array.isArray(paths) || !Array.isArray(assets)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  if (paths.length > 500 || assets.length > 500) {
    return NextResponse.json({ error: 'Too many media paths' }, { status: 400 });
  }

  // Accept both canonical gcs: refs (new records) and stored signed GCS URLs (old records).
  // Signed URLs may be stale or have been signed with a malformed key — always re-sign fresh.
  const capabilityChecks = new Map<string, Promise<boolean>>();
  const canSign = (source: string, path: string) => {
    if (isUserOwnedPath(path, user.id)) return Promise.resolve(true);
    const existing = capabilityChecks.get(source);
    if (existing) return existing;
    const check = hasReadableCapability(source);
    capabilityChecks.set(source, check);
    return check;
  };

  const signable = paths.filter(p => isGcsRef(p) || isSignedGcsUrl(p));

  const entries = await Promise.all(
    signable.map(async (ref) => {
      const path = sourcePath(ref);
      if (!path || !await canSign(ref, path)) return null;
      let url: string;
      if (isGcsRef(ref)) {
        url = await signGcsRef(ref);
      } else {
        url = await getSignedReadUrl(path);
      }
      return [ref, url] as [string, string];
    })
  );

  const assetEntries = await Promise.all(
    assets.map(async ({ key, source, kind }) => {
      if (!key || (kind !== 'image' && kind !== 'video')) return null;
      const path = sourcePath(source);
      if (!path) return [key, { original: source }] as const;
      if (!await canSign(source, path)) {
        return [key, { original: source }] as const;
      }

      const derivativePaths = mediaDerivativePaths(path, kind);
      const [original, thumbnail, poster] = await Promise.all([
        getSignedReadUrl(path),
        getSignedReadUrl(derivativePaths.thumbnailPath),
        derivativePaths.posterPath
          ? getSignedReadUrl(derivativePaths.posterPath)
          : Promise.resolve(undefined),
      ]);
      return [key, { original, thumbnail, ...(poster ? { poster } : {}) }] as const;
    }),
  );

  return NextResponse.json({
    urls: Object.fromEntries(entries.filter(entry => entry !== null)),
    assets: Object.fromEntries(assetEntries.filter(entry => entry !== null)),
  });
}
