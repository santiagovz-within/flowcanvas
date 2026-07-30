import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { uploadToGCS } from '@/lib/gcs';

const TARGET_BYTES = 150 * 1024;

async function sharpCompress(input: Buffer): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  let buf = await sharp(input)
    .resize(640, 640, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 72 })
    .toBuffer();
  if (buf.byteLength > TARGET_BYTES) {
    buf = await sharp(input)
      .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 62 })
      .toBuffer();
  }
  if (buf.byteLength > TARGET_BYTES) {
    buf = await sharp(input)
      .resize(300, 300, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 55 })
      .toBuffer();
  }
  return buf;
}

// Migrates all flow thumbnails (data URLs and Supabase Storage URLs) to GCS.
// Data URLs are compressed with sharp before uploading.
// External URLs are fetched, optionally compressed, then uploaded.
export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: profile } = await supabase
      .from('profiles').select('is_admin').eq('id', user.id).single();
    if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Use admin client to bypass RLS and read all users' flows
    const adminDb = createAdminClient();
    const { data: flows } = await adminDb
      .from('flows')
      .select('id, user_id, thumbnail_url')
      .not('thumbnail_url', 'is', null);

    if (!flows?.length) return NextResponse.json({ updated: 0, skipped: 0, failed: 0, total: 0 });

    let updated = 0, skipped = 0, failed = 0;

    for (const flow of flows) {
      const thumb = flow.thumbnail_url as string;

      // Already-migrated refs and signed GCS URLs do not need another upload.
      if (thumb.startsWith('gcs:') || thumb.includes('storage.googleapis.com')) {
        skipped++;
        continue;
      }

      try {
        let imageBuffer: Buffer;

        if (thumb.startsWith('data:')) {
          const base64 = thumb.split(',')[1];
          if (!base64) { skipped++; continue; }
          imageBuffer = Buffer.from(base64, 'base64');
        } else {
          // External URL (Supabase Storage public URL, etc.) — fetch it
          const res = await fetch(thumb);
          if (!res.ok) { failed++; continue; }
          imageBuffer = Buffer.from(await res.arrayBuffer());
        }

        // Compress if over target
        const compressed = imageBuffer.byteLength > TARGET_BYTES
          ? await sharpCompress(imageBuffer)
          : imageBuffer;

        const ownerId = (flow.user_id as string | null) ?? user.id;
        const objectPath = `thumbnails/${ownerId}/${flow.id}.jpg`;
        const ref = await uploadToGCS(compressed, objectPath, 'image/jpeg');

        await adminDb.from('flows').update({ thumbnail_url: ref }).eq('id', flow.id);
        updated++;
      } catch {
        failed++;
      }
    }

    return NextResponse.json({ updated, skipped, failed, total: flows.length });
  } catch (err) {
    const details = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'Failed', details }, { status: 500 });
  }
}
