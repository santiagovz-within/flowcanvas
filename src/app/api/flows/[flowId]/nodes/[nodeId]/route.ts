import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';

const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ flowId: string; nodeId: string }> },
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { flowId, nodeId } = await params;
    const body = await request.json() as { data?: unknown; unset?: unknown };
    if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) {
      return NextResponse.json({ error: 'Node data updates are required' }, { status: 400 });
    }
    const safeUpdates = Object.fromEntries(
      Object.entries(body.data as Record<string, unknown>)
        .filter(([key]) => !BLOCKED_KEYS.has(key)),
    );
    const unsetKeys = Array.isArray(body.unset)
      ? body.unset.filter(
          (key): key is string => typeof key === 'string' && !BLOCKED_KEYS.has(key),
        )
      : [];

    const admin = createAdminClient();
    // Flow autosave can run at the same time as background completion. Use an
    // optimistic retry so neither update overwrites the other's node changes.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const { data: flow, error: loadError } = await admin
        .from('flows')
        .select('user_id, flow_data, updated_at')
        .eq('id', flowId)
        .single();
      if (loadError || !flow) {
        return NextResponse.json({ error: 'Flow not found' }, { status: 404 });
      }
      if (flow.user_id !== user.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      const flowData = flow.flow_data as {
        nodes?: Array<{ id?: string; data?: Record<string, unknown> }>;
        edges?: unknown[];
        viewport?: unknown;
      };
      const nodes = Array.isArray(flowData?.nodes) ? flowData.nodes : [];
      let found = false;
      const nextNodes = nodes.map((node) => {
        if (node.id !== nodeId) return node;
        found = true;
        const nextData = { ...(node.data ?? {}), ...safeUpdates };
        unsetKeys.forEach((key) => { delete nextData[key]; });
        return { ...node, data: nextData };
      });
      if (!found) return NextResponse.json({ error: 'Node not found' }, { status: 404 });

      const { data: updatedRows, error: updateError } = await admin
        .from('flows')
        .update({
          flow_data: { ...flowData, nodes: nextNodes },
          updated_at: new Date().toISOString(),
        })
        .eq('id', flowId)
        .eq('user_id', user.id)
        .eq('updated_at', flow.updated_at)
        .select('id');
      if (updateError) throw new Error(updateError.message);
      if (updatedRows?.length) return NextResponse.json({ ok: true });
    }

    return NextResponse.json(
      { error: 'Flow changed while the generation result was being saved' },
      { status: 409 },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error('[flows/nodes] PATCH error:', detail);
    return NextResponse.json({ error: 'Failed to update node' }, { status: 500 });
  }
}
