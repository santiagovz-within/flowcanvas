import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { signStoredThumbnail } from '@/lib/gcs';

// GET /api/flows/recent — the current user's active flows with thumbnails
// already signed, so the dashboard renders images in a single round trip
// instead of query → render → /api/media/sign → re-render.
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data, error } = await supabase
      .from('flows')
      .select('id, title, description, thumbnail_url, created_at, updated_at')
      .eq('user_id', user.id)
      .eq('is_template', false)
      .eq('lifecycle_state', 'active')
      .order('updated_at', { ascending: false });

    if (error) return NextResponse.json({ flows: [] });

    const flows = await Promise.all((data ?? []).map(async (flow) => ({
      ...flow,
      thumbnail_signed_url: await signStoredThumbnail(flow.thumbnail_url),
    })));

    return NextResponse.json({ flows });
  } catch {
    return NextResponse.json({ flows: [] });
  }
}
