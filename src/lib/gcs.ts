import { Storage } from '@google-cloud/storage';

// Server-only module — never import from client components.

const BUCKET_NAME = process.env.GCS_BUCKET_NAME ?? 'within-glide';
const READ_TTL_MS   = 7 * 24 * 60 * 60 * 1000; // 7 days
const UPLOAD_TTL_MS = 15 * 60 * 1000;           // 15 minutes

let _storage: Storage | null = null;

function getStorage(): Storage {
  if (!_storage) {
    const raw = process.env.GCS_CREDENTIALS_JSON;
    if (!raw) throw new Error('GCS_CREDENTIALS_JSON env var is not set');
    const credentials = JSON.parse(raw);
    // GCS service-account JSON stores the private key with literal \n sequences
    // when set via environment variables; unescape them so the SDK can sign URLs.
    if (credentials.private_key) {
      credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
    }
    _storage = new Storage({ credentials });
  }
  return _storage;
}

// ── Writes ────────────────────────────────────────────────────────────────────

/**
 * Uploads a buffer to GCS and returns the canonical ref string `gcs:<objectPath>`
 * that should be stored in the Supabase database.
 */
export async function uploadToGCS(
  buffer: Buffer | ArrayBuffer,
  objectPath: string,
  contentType: string,
): Promise<string> {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const file = getStorage().bucket(BUCKET_NAME).file(objectPath);
  await file.save(buf, {
    metadata: { contentType },
    resumable: false,
  });
  return `gcs:${objectPath}`;
}

// ── Signed read URL ───────────────────────────────────────────────────────────

/**
 * Returns a signed read URL for an object that is valid for 7 days.
 * `objectPath` must NOT include the `gcs:` prefix.
 */
export async function getSignedReadUrl(objectPath: string): Promise<string> {
  const [url] = await getStorage()
    .bucket(BUCKET_NAME)
    .file(objectPath)
    .getSignedUrl({
      action: 'read',
      version: 'v4',
      expires: Date.now() + READ_TTL_MS,
    });
  return url;
}

/**
 * Returns a signed read URL for a `gcs:<path>` reference string.
 * Convenience wrapper used by API routes.
 */
export async function signGcsRef(ref: string): Promise<string> {
  return getSignedReadUrl(gcsPathFromRef(ref));
}

// ── Signed upload URL ─────────────────────────────────────────────────────────

/**
 * Returns a signed upload URL for direct browser-to-GCS PUT uploads.
 * Valid for 15 minutes.
 *
 * IMPORTANT: The GCS bucket must have CORS configured to allow PUT requests
 * from the app's origin. Example cors.json:
 *
 *   [{ "origin": ["*"], "method": ["PUT","GET","HEAD"],
 *      "responseHeader": ["Content-Type"], "maxAgeSeconds": 3600 }]
 *
 * Apply with: gsutil cors set cors.json gs://within-glide
 */
export async function getSignedUploadUrl(
  objectPath: string,
  contentType: string,
): Promise<string> {
  const [url] = await getStorage()
    .bucket(BUCKET_NAME)
    .file(objectPath)
    .getSignedUrl({
      action: 'write',
      version: 'v4',
      contentType,
      expires: Date.now() + UPLOAD_TTL_MS,
    });
  return url;
}

// ── Deletion ──────────────────────────────────────────────────────────────────

/** Deletes an object from GCS. Silently ignores 404s. */
export async function deleteFromGCS(objectPath: string): Promise<void> {
  await getStorage()
    .bucket(BUCKET_NAME)
    .file(objectPath)
    .delete({ ignoreNotFound: true });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns true if the value is a GCS canonical ref (`gcs:<path>`). */
export function isGcsRef(url: string | null | undefined): url is string {
  return typeof url === 'string' && url.startsWith('gcs:');
}

/** Strips the `gcs:` prefix to get the raw GCS object path. */
export function gcsPathFromRef(ref: string): string {
  return ref.slice(4);
}
