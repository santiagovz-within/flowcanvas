// Shared media helpers — safe to import in both server and client modules.

const resolvedRefCache = new Map<string, string>();
const resolvedAssetCache = new Map<string, Promise<ResolvedMediaAsset>>();
const APP_GCS_BUCKET = 'within-glide';

const SIGNED_URL_REFRESH_BUFFER_MS = 5 * 60 * 1000;

function signedUrlExpiryMs(url: string): number | null {
  try {
    const params = new URL(url).searchParams;

    // GCS V2 signed URLs use an absolute Unix timestamp.
    const v2Expires = params.get('Expires');
    if (v2Expires) {
      const expiresAtMs = Number(v2Expires) * 1000;
      return Number.isFinite(expiresAtMs) ? expiresAtMs : null;
    }

    // GCS V4 signed URLs use a signing time plus a lifetime in seconds.
    const signedAt = params.get('X-Goog-Date');
    const lifetime = params.get('X-Goog-Expires');
    if (!signedAt || !lifetime || !/^\d{8}T\d{6}Z$/.test(signedAt)) return null;

    const signedAtMs = Date.UTC(
      Number(signedAt.slice(0, 4)),
      Number(signedAt.slice(4, 6)) - 1,
      Number(signedAt.slice(6, 8)),
      Number(signedAt.slice(9, 11)),
      Number(signedAt.slice(11, 13)),
      Number(signedAt.slice(13, 15)),
    );
    const lifetimeMs = Number(lifetime) * 1000;
    return Number.isFinite(lifetimeMs) ? signedAtMs + lifetimeMs : null;
  } catch {
    return null;
  }
}

function isFreshSignedUrl(url: string): boolean {
  const expiresAtMs = signedUrlExpiryMs(url);
  return expiresAtMs !== null && expiresAtMs > Date.now() + SIGNED_URL_REFRESH_BUFFER_MS;
}

/** Returns true when `url` is a GCS canonical reference (`gcs:<objectPath>`). */
export function isGcsRef(url: string | null | undefined): url is string {
  return typeof url === 'string' && url.startsWith('gcs:');
}

/** Strips the `gcs:` prefix to get the raw GCS object path. */
export function gcsPathFromRef(ref: string): string {
  return ref.slice(4);
}

/**
 * Returns true when `url` is an old stored signed GCS URL
 * (V2 uses `Signature`; V4 uses `X-Goog-Signature`).
 * These were stored directly in the DB before canonical gcs: refs were adopted,
 * and they expire after 7 days.
 */
export function isSignedGcsUrl(url: string | null | undefined): url is string {
  if (typeof url !== 'string') return false;

  try {
    const parsed = new URL(url);
    const isGcsHost = parsed.protocol === 'https:' && (
      (
        parsed.hostname === 'storage.googleapis.com'
        && decodeURIComponent(parsed.pathname.split('/')[1] ?? '') === APP_GCS_BUCKET
      )
      || parsed.hostname === `${APP_GCS_BUCKET}.storage.googleapis.com`
    );
    if (!isGcsHost) return false;

    const params = parsed.searchParams;
    const isV4 = params.has('X-Goog-Signature');
    const isV2 = (
      params.has('GoogleAccessId')
      && params.has('Expires')
      && params.has('Signature')
    );
    return isV2 || isV4;
  } catch {
    return false;
  }
}

/**
 * Extracts the raw GCS object path from a stored signed URL.
 * Returns null if the URL doesn't match the expected pattern.
 */
export function extractGcsPathFromSignedUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const encodedPath = parsed.hostname === 'storage.googleapis.com'
      // Path-style URL: first segment is the bucket name.
      ? parsed.pathname.split('/').slice(2).join('/')
      // Virtual-hosted URL: the pathname is already the object path.
      : parsed.pathname.slice(1);
    return encodedPath ? decodeURIComponent(encodedPath) : null;
  } catch {
    return null;
  }
}

/** Converts a canonical ref or historical signed GCS URL to a stable ref. */
export function canonicalizeGcsUrl(value: string): string {
  if (isGcsRef(value)) return value;
  if (!isSignedGcsUrl(value)) return value;
  const path = extractGcsPathFromSignedUrl(value);
  return path ? `gcs:${path}` : value;
}

/** Recursively canonicalizes media strings before node data is persisted. */
export function canonicalizeGcsValue<T>(value: T): T {
  if (typeof value === 'string') return canonicalizeGcsUrl(value) as T;
  if (Array.isArray(value)) {
    return value.map(item => canonicalizeGcsValue(item)) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, canonicalizeGcsValue(item)]),
    ) as T;
  }
  return value;
}

/**
 * Batch-resolves GCS refs and old stored signed URLs to fresh signed read URLs
 * via the `/api/media/sign` endpoint.
 * Non-GCS values pass through unchanged.
 * Returns a Map of original ref/url → resolved URL.
 */
export async function resolveGcsRefs(
  refs: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const uniqueSignable = [...new Set(
    refs.filter(r => isGcsRef(r) || isSignedGcsUrl(r)) as string[],
  )];
  const toSign = uniqueSignable.filter((ref) => {
    const cached = resolvedRefCache.get(ref);
    if (!cached || !isFreshSignedUrl(cached)) return true;
    result.set(ref, cached);
    return false;
  });

  if (toSign.length === 0) return result;

  const res = await fetch('/api/media/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths: toSign }),
  });
  if (!res.ok) return result;
  const { urls } = await res.json() as { urls: Record<string, string> };
  for (const [ref, url] of Object.entries(urls)) {
    resolvedRefCache.set(ref, url);
    result.set(ref, url);
  }
  return result;
}

/**
 * Resolves a single URL: if it's a GCS ref or an old stored signed URL,
 * fetches a fresh signed URL; otherwise returns it unchanged.
 */
export async function resolveMediaUrl(url: string): Promise<string> {
  if (!isGcsRef(url) && !isSignedGcsUrl(url)) return url;
  const map = await resolveGcsRefs([url]);
  return map.get(url) ?? url;
}

export type MediaAssetKind = 'image' | 'video';

export interface ResolvedMediaAsset {
  original: string;
  thumbnail?: string;
  poster?: string;
}

interface PendingAsset {
  key: string;
  source: string;
  kind: MediaAssetKind;
  resolve: (asset: ResolvedMediaAsset) => void;
}

let pendingAssets: PendingAsset[] = [];
let assetFlushQueued = false;

async function flushPendingAssets() {
  assetFlushQueued = false;
  const batch = pendingAssets;
  pendingAssets = [];
  if (batch.length === 0) return;

  try {
    const response = await fetch('/api/media/sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assets: batch.map(({ key, source, kind }) => ({ key, source, kind })),
      }),
    });
    if (!response.ok) throw new Error(`Media signing failed (${response.status})`);
    const payload = await response.json() as {
      assets: Record<string, ResolvedMediaAsset>;
    };
    for (const item of batch) {
      item.resolve(payload.assets[item.key] ?? { original: item.source });
    }
  } catch {
    for (const item of batch) item.resolve({ original: item.source });
  }
}

/**
 * Resolves an original plus deterministic stored preview URLs. Calls made by
 * sibling nodes in the same render are coalesced into one signing request.
 */
export function resolveMediaAsset(
  source: string,
  kind: MediaAssetKind,
): Promise<ResolvedMediaAsset> {
  if (!isGcsRef(source) && !isSignedGcsUrl(source)) {
    return Promise.resolve({ original: source });
  }

  const key = `${kind}:${source}`;
  const cached = resolvedAssetCache.get(key);
  if (cached) return cached;

  const promise = new Promise<ResolvedMediaAsset>((resolve) => {
    pendingAssets.push({ key, source, kind, resolve });
    if (!assetFlushQueued) {
      assetFlushQueued = true;
      queueMicrotask(flushPendingAssets);
    }
  });
  resolvedAssetCache.set(key, promise);
  return promise;
}
