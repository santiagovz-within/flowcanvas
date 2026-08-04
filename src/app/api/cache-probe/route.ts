import { Storage } from '@google-cloud/storage';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const BUCKET_NAME = process.env.GCS_BUCKET_NAME ?? 'within-glide';
const OBJECT_PATH =
  'cache-probes/codex-private-cache-20260804.jpg';
const CACHE_CONTROL = 'private, max-age=604800, immutable';
const LOGIN_IMAGE_ENDPOINT =
  'https://within-glide.vercel.app/api/settings/login-image';

function storageClient(): Storage {
  const raw = process.env.GCS_CREDENTIALS_JSON;
  if (!raw) throw new Error('GCS_CREDENTIALS_JSON is not configured');

  const credentials = JSON.parse(raw) as { private_key?: string };
  if (credentials.private_key) {
    credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
  }
  return new Storage({ credentials });
}

export async function POST() {
  try {
    const settingsResponse = await fetch(LOGIN_IMAGE_ENDPOINT, {
      cache: 'no-store',
    });
    if (!settingsResponse.ok) {
      throw new Error(`Login image lookup returned ${settingsResponse.status}`);
    }

    const payload = (await settingsResponse.json()) as { url?: string };
    if (!payload.url) throw new Error('No login image is configured');

    const sourceResponse = await fetch(payload.url, { cache: 'no-store' });
    if (!sourceResponse.ok) {
      throw new Error(`Login image returned ${sourceResponse.status}`);
    }

    const storage = storageClient();
    const file = storage.bucket(BUCKET_NAME).file(OBJECT_PATH);
    await file.delete({ ignoreNotFound: true });
    await file.save(Buffer.from(await sourceResponse.arrayBuffer()), {
      resumable: false,
      metadata: {
        contentType: sourceResponse.headers.get('content-type') ?? 'image/jpeg',
        cacheControl: CACHE_CONTROL,
      },
    });

    const [metadata] = await file.getMetadata();
    const [sourceUrl] = await file.getSignedUrl({
      action: 'read',
      version: 'v4',
      expires: Date.now() + 60 * 60 * 1000,
    });

    return NextResponse.json({
      sourceUrl,
      objectPath: OBJECT_PATH,
      cacheControl: metadata.cacheControl,
    });
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: 'Probe setup failed', details }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    await storageClient()
      .bucket(BUCKET_NAME)
      .file(OBJECT_PATH)
      .delete({ ignoreNotFound: true });
    return NextResponse.json({ deleted: true });
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: 'Probe cleanup failed', details }, { status: 500 });
  }
}
