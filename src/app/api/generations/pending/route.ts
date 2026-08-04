import { NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { FAL_MODELS } from '@/lib/api/models';
import type { FlowData, NodeType } from '@/types';

const RECOVERY_WINDOW_MS = 2 * 60 * 60 * 1000;

function resolveEndpoint(
  model: string,
  parameters: Record<string, unknown> | null,
  referenceImageUrls: string[] | null,
  nodeData: Record<string, unknown>,
  requestId: string,
): string | null {
  if (typeof parameters?.endpoint === 'string') return parameters.endpoint;
  const pendingRequests = Array.isArray(nodeData.pendingRequests)
    ? nodeData.pendingRequests as Array<{ requestId?: string; endpoint?: string }>
    : [];
  const savedRequest = pendingRequests.find((request) => request.requestId === requestId);
  if (typeof savedRequest?.endpoint === 'string') return savedRequest.endpoint;
  if (
    nodeData.pendingRequestId === requestId
    && typeof nodeData.pendingEndpoint === 'string'
  ) {
    return nodeData.pendingEndpoint;
  }
  if (model.startsWith('fal-ai/')) return model;
  const config = FAL_MODELS[model as keyof typeof FAL_MODELS];
  if (!config) return null;
  if (
    (referenceImageUrls?.length || (Array.isArray(nodeData.inputImageUrls) && nodeData.inputImageUrls.length > 0))
    && 'editEndpoint' in config
  ) {
    return config.editEndpoint as string;
  }
  if (nodeData.startFrameUrl && 'imageToVideoEndpoint' in config) {
    return config.imageToVideoEndpoint as string;
  }
  return config.endpoint as string;
}

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const admin = createAdminClient();
    const { data: pending, error: pendingError } = await admin
      .from('generations')
      .select('source_id, node_id, model, media_type, fal_request_id, parameters, reference_image_urls, created_at')
      .eq('user_id', user.id)
      .eq('source_type', 'canvas')
      .eq('status', 'processing')
      .not('source_id', 'is', null)
      .not('node_id', 'is', null)
      .not('fal_request_id', 'is', null)
      .gte('created_at', new Date(Date.now() - RECOVERY_WINDOW_MS).toISOString())
      .order('created_at', { ascending: true });
    if (pendingError) throw new Error(pendingError.message);

    const flowIds = [...new Set((pending ?? []).map((generation) => generation.source_id as string))];
    if (flowIds.length === 0) return NextResponse.json({ generations: [] });

    const { data: flows, error: flowError } = await admin
      .from('flows')
      .select('id, title, flow_data')
      .eq('user_id', user.id)
      .in('id', flowIds);
    if (flowError) throw new Error(flowError.message);
    const flowMap = new Map((flows ?? []).map((flow) => [flow.id, flow]));

    const generations = (pending ?? []).flatMap((generation) => {
      const flow = flowMap.get(generation.source_id as string);
      const flowData = flow?.flow_data as FlowData | undefined;
      const node = flowData?.nodes?.find((candidate) => candidate.id === generation.node_id);
      if (!flow || !node || !generation.fal_request_id) return [];
      if (node.type !== 'imageGenNode' && node.type !== 'videoGenNode') return [];
      const parameters = generation.parameters as Record<string, unknown> | null;
      const endpoint = resolveEndpoint(
        generation.model,
        parameters,
        generation.reference_image_urls as string[] | null,
        node.data as Record<string, unknown>,
        generation.fal_request_id,
      );
      if (!endpoint) return [];
      return [{
        flowId: flow.id,
        flowTitle: flow.title,
        nodeId: node.id,
        nodeType: node.type as NodeType,
        nodeData: node.data,
        requestId: generation.fal_request_id,
        endpoint,
        mediaType: generation.media_type === 'image' ? 'image' as const : 'video' as const,
        slotIndex: typeof parameters?.slotIndex === 'number' ? parameters.slotIndex : undefined,
        createdAt: generation.created_at,
      }];
    });

    return NextResponse.json({ generations });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error('[generations/pending] GET error:', detail);
    return NextResponse.json({ error: 'Failed to load pending generations' }, { status: 500 });
  }
}
