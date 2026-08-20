import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { fal } from '@fal-ai/client';
import { getFalStorageHeaders } from '@/lib/falStorage';
import { describeFalError } from '@/lib/falErrors';
import { FAL_NODE_ENDPOINTS } from '@/lib/api/models';

fal.config({ credentials: process.env.FAL_KEY });

const FAL_ENDPOINT = FAL_NODE_ENDPOINTS.videoUpscale.endpoint;

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { videoUrl, upscaleFactor = 2, targetFps, h264Output, sourceId, nodeId } = await request.json();

    if (!videoUrl) {
      return NextResponse.json({ error: 'videoUrl is required' }, { status: 400 });
    }

    if (![2, 3, 4].includes(upscaleFactor)) {
      return NextResponse.json({ error: 'upscaleFactor must be 2, 3, or 4' }, { status: 400 });
    }
    const falHeaders = await getFalStorageHeaders({
      userId: user.id,
      sourceType: 'canvas',
      sourceId,
    });

    const { request_id } = await fal.queue.submit(FAL_ENDPOINT, {
      input: {
        video_url: videoUrl,
        upscale_factor: upscaleFactor,
        ...(targetFps != null ? { target_fps: targetFps } : {}),
        ...(h264Output === true ? { H264_output: true } : {}),
      },
      headers: falHeaders,
    });

    const { error: insertError } = await supabase.from('generations').insert({
      user_id: user.id,
      source_type: 'canvas',
      source_id: sourceId,
      node_id: nodeId,
      model: FAL_ENDPOINT,
      parameters: { upscaleFactor, targetFps, h264Output, endpoint: FAL_ENDPOINT },
      media_type: 'video',
      media_url: '',
      status: 'processing',
      fal_request_id: request_id,
    });

    if (insertError) {
      throw new Error(`Could not save queued video upscale: ${insertError.message}`);
    }

    return NextResponse.json({ requestId: request_id, status: 'pending' });
  } catch (err) {
    console.error('[video-upscale] submit error:', err);
    return NextResponse.json(
      { error: 'Failed to submit upscale job', details: describeFalError(err) },
      { status: 500 },
    );
  }
}
