import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { getSignedReadUrl, signGcsRef, isGcsRef } from '@/lib/gcs';
import { shouldDiscardAbandonedFlow } from '@/lib/utils/flowPersistence';

const BUCKET = process.env.GCS_BUCKET_NAME ?? 'within-glide';
const SIGNED_URL_RE = new RegExp(
  `^https://storage\\.googleapis\\.com/${BUCKET}/([^?]+)\\?`,
);

function extractPath(url: string): string | null {
  const m = url.match(SIGNED_URL_RE);
  return m ? decodeURIComponent(m[1]) : null;
}

function needsResigning(url: string): boolean {
  const dateMatch = url.match(/[?&]X-Goog-Date=(\d{8}T\d{6}Z)/);
  const expiresMatch = url.match(/[?&]X-Goog-Expires=(\d+)/);
  if (!dateMatch || !expiresMatch) return true;
  const s = dateMatch[1];
  const signedAt = Date.UTC(
    +s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8),
    +s.slice(9, 11), +s.slice(11, 13), +s.slice(13, 15),
  );
  const expiryMs = signedAt + parseInt(expiresMatch[1]) * 1000;
  return expiryMs < Date.now() + 24 * 60 * 60 * 1000;
}

async function resignString(value: string): Promise<string> {
  if (isGcsRef(value)) return signGcsRef(value);
  const path = extractPath(value);
  if (path && needsResigning(value)) return getSignedReadUrl(path);
  return value;
}

async function resignValue(value: unknown): Promise<unknown> {
  if (typeof value === 'string') return resignString(value);
  if (Array.isArray(value)) return Promise.all(value.map(resignValue));
  if (value !== null && typeof value === 'object') {
    const entries = await Promise.all(
      Object.entries(value as Record<string, unknown>).map(async ([k, v]) => [k, await resignValue(v)]),
    );
    return Object.fromEntries(entries);
  }
  return value;
}

// GET /api/flows/[flowId]
// Accessible to the owner, or any authenticated user when shared or a base template.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ flowId: string }> },
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { flowId } = await params;

    // Use admin client so we can read the row even when RLS would block a non-owner.
    // Authorization is enforced in code below.
    const admin = createAdminClient();
    const { data: flow, error } = await admin
      .from('flows')
      .select('*')
      .eq('id', flowId)
      .single();

    if (error || !flow) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const isOwner = flow.user_id === user.id;
    if (
      !isOwner
      && (flow.lifecycle_state !== 'active' || (!flow.is_shared && !flow.is_template))
    ) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    let thumbnailUrl = flow.thumbnail_url as string | null;
    if (thumbnailUrl) thumbnailUrl = await resignString(thumbnailUrl);

    const freshFlowData = await resignValue(flow.flow_data);

    return NextResponse.json({
      data: { ...flow, thumbnail_url: thumbnailUrl, flow_data: freshFlowData },
      isOwner,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[flows/[flowId]] GET error:', detail);
    return NextResponse.json({ error: 'Failed to load flow' }, { status: 500 });
  }
}

// PATCH /api/flows/[flowId]
// Owner-only. GCS-only mode additionally requires an admin.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ flowId: string }> },
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { flowId } = await params;
    const body = await request.json() as {
      is_shared?: unknown;
      is_gcs_only?: unknown;
    };

    const admin = createAdminClient();
    const { data: flow } = await admin
      .from('flows')
      .select('user_id, is_gcs_only, gcs_only_eligible')
      .eq('id', flowId)
      .single();

    if (!flow || flow.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const updates: {
      is_shared?: boolean;
      is_gcs_only?: boolean;
      gcs_only_eligible?: boolean;
      updated_at?: string;
    } = {};

    if (typeof body.is_shared === 'boolean') {
      updates.is_shared = body.is_shared;
    }

    if (typeof body.is_gcs_only === 'boolean') {
      if (!body.is_gcs_only) {
        return NextResponse.json(
          { error: 'GCS-only mode cannot be disabled once enabled' },
          { status: 409 },
        );
      }

      if (flow.is_gcs_only) {
        return NextResponse.json({ ok: true, is_gcs_only: true });
      }

      if (!flow.gcs_only_eligible) {
        return NextResponse.json(
          { error: 'GCS-only mode is only available on a new Flow before its first Fal generation' },
          { status: 409 },
        );
      }

      const { data: profile } = await admin
        .from('profiles')
        .select('is_admin')
        .eq('id', user.id)
        .single();

      if (!profile?.is_admin) {
        return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
      }
      updates.is_gcs_only = true;
      updates.gcs_only_eligible = false;
    }

    if (updates.is_shared === undefined && updates.is_gcs_only === undefined) {
      return NextResponse.json({ error: 'No supported Flow setting provided' }, { status: 400 });
    }

    updates.updated_at = new Date().toISOString();
    let updateQuery = admin.from('flows').update(updates).eq('id', flowId);
    if (updates.is_gcs_only) {
      // Eligibility may be consumed concurrently by the first Fal request.
      updateQuery = updateQuery
        .eq('is_gcs_only', false)
        .eq('gcs_only_eligible', true);
    }

    const { data: updatedRows, error } = await updateQuery.select('id');
    if (error) throw new Error(error.message);
    if (updates.is_gcs_only && updatedRows?.length === 0) {
      return NextResponse.json(
        { error: 'This Flow started a Fal generation before GCS-only mode was enabled' },
        { status: 409 },
      );
    }

    return NextResponse.json({ ok: true, ...updates });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[flows/[flowId]] PATCH error:', detail);
    return NextResponse.json({ error: 'Failed to update flow' }, { status: 500 });
  }
}

// DELETE /api/flows/[flowId]
// Removes only a blank draft owned by the current user.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ flowId: string }> },
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { flowId } = await params;
    const admin = createAdminClient();
    const { data: flow, error: loadError } = await admin
      .from('flows')
      .select('user_id, is_template, lifecycle_state, flow_data')
      .eq('id', flowId)
      .single();

    if (loadError || !flow) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (flow.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const nodes = Array.isArray(flow.flow_data?.nodes) ? flow.flow_data.nodes : [];
    if (
      flow.lifecycle_state !== 'draft'
      || flow.is_template
      || !shouldDiscardAbandonedFlow(nodes)
    ) {
      return NextResponse.json(
        { error: 'Flow is active or contains content and cannot be discarded' },
        { status: 409 },
      );
    }

    const { data: deletedRows, error: deleteError } = await admin
      .from('flows')
      .delete()
      .eq('id', flowId)
      .eq('user_id', user.id)
      .eq('lifecycle_state', 'draft')
      .select('id');
    if (deleteError) throw new Error(deleteError.message);
    if (deletedRows?.length === 0) {
      return NextResponse.json(
        { error: 'Flow was activated before it could be discarded' },
        { status: 409 },
      );
    }

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[flows/[flowId]] DELETE error:', detail);
    return NextResponse.json({ error: 'Failed to discard flow' }, { status: 500 });
  }
}
