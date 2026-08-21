import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { signStoredThumbnail } from '@/lib/gcs';

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

// GET /api/flows/base — returns all is_template=true flows (visible to all users)
export async function GET() {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('flows')
      .select('id, title, description, thumbnail_url, base_flow_order, created_at, updated_at, user_id')
      .eq('is_template', true)
      .eq('lifecycle_state', 'active')
      .order('base_flow_order', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });

    if (error) return NextResponse.json({ baseFlows: [] });

    const rows = data ?? [];

    // Resolve creator usernames in a single lookup.
    const userIds = [...new Set(rows.map((f) => f.user_id).filter(Boolean))];
    const nameById = new Map<string, string>();
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, username, display_name')
        .in('id', userIds);
      // Prefer the human-friendly display name, fall back to username.
      for (const p of profiles ?? []) nameById.set(p.id, p.display_name || p.username);
    }

    // Base flows are public, but their thumbnails live under their author's
    // GCS prefix, so `/api/media/sign` refuses to sign them for other users.
    // Sign them here instead — this route is the shared, admin-scoped read path.
    const baseFlows = await Promise.all(rows.map(async ({ user_id, ...rest }) => ({
      ...rest,
      author_username: nameById.get(user_id) ?? null,
      thumbnail_signed_url: await signStoredThumbnail(rest.thumbnail_url),
    })));

    return NextResponse.json({ baseFlows });
  } catch {
    return NextResponse.json({ baseFlows: [] });
  }
}

// PATCH /api/flows/base — persist the complete base-flow card order (admins only)
export async function PATCH(request: NextRequest) {
  try {
    const adminUser = await requireAdmin();
    if (!adminUser) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json() as { flowIds?: unknown };
    if (
      !Array.isArray(body.flowIds)
      || body.flowIds.length === 0
      || body.flowIds.some((id) => typeof id !== 'string' || id.length === 0)
      || new Set(body.flowIds).size !== body.flowIds.length
    ) {
      return NextResponse.json({ error: 'flowIds must be a non-empty list of unique IDs' }, { status: 400 });
    }

    const supabase = createAdminClient();
    const { error } = await supabase.rpc('set_base_flow_order', {
      ordered_flow_ids: body.flowIds,
    });

    if (error) {
      const isStaleOrder = error.message.includes('must contain every base flow');
      return NextResponse.json(
        { error: isStaleOrder ? 'Base Flows changed while you were reordering. Refresh and try again.' : 'Failed to save Base Flow order' },
        { status: isStaleOrder ? 409 : 500 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error('[flows/base] PATCH error:', detail);
    return NextResponse.json({ error: 'Failed to save Base Flow order' }, { status: 500 });
  }
}
