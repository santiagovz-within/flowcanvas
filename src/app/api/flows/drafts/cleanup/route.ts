import { NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';

const STALE_DRAFT_AGE_MS = 24 * 60 * 60 * 1000;

// POST /api/flows/drafts/cleanup
// Best-effort cleanup for drafts left behind by a closed tab or interrupted
// unload request. Active Flows can never match this query.
export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const cutoff = new Date(Date.now() - STALE_DRAFT_AGE_MS).toISOString();
    const admin = createAdminClient();
    const { data: deleted, error } = await admin
      .from('flows')
      .delete()
      .eq('user_id', user.id)
      .eq('lifecycle_state', 'draft')
      .lt('updated_at', cutoff)
      .select('id');

    if (error) throw new Error(error.message);
    return NextResponse.json({ deleted: deleted?.length ?? 0 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error('[flows/drafts/cleanup] POST error:', detail);
    return NextResponse.json({ error: 'Failed to clean up drafts' }, { status: 500 });
  }
}
