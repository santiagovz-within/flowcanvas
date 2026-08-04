import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { isGcsRef, gcsPathFromRef, deleteFromGCS } from '@/lib/gcs';
import { deleteMediaAndDerivatives } from '@/lib/mediaDerivatives';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  const { data: gen } = await supabase
    .from('generations')
    .select('id, media_url, media_type, user_id')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (!gen) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (gen.media_url) {
    if (isGcsRef(gen.media_url)) {
      const objectPath = gcsPathFromRef(gen.media_url);
      if (gen.media_type === 'image' || gen.media_type === 'video') {
        await deleteMediaAndDerivatives(objectPath, gen.media_type).catch(() => {});
      } else {
        await deleteFromGCS(objectPath).catch(() => {});
      }
    } else {
      // Legacy Supabase URL: /storage/v1/object/public/<bucket>/<path...>
      try {
        const url = new URL(gen.media_url);
        const parts = url.pathname.split('/');
        if (parts[4] === 'public' && parts[5]) {
          const bucket = parts[5];
          const storagePath = parts.slice(6).join('/');
          const admin = createAdminClient();
          await admin.storage.from(bucket).remove([storagePath]);
        }
      } catch { /* best-effort cleanup */ }
    }
  }

  await supabase.from('generations').delete().eq('id', id).eq('user_id', user.id);
  return NextResponse.json({ success: true });
}
