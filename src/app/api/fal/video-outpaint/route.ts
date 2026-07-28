import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { fal } from '@fal-ai/client';
import { getFalStorageHeaders } from '@/lib/falStorage';

fal.config({ credentials: process.env.FAL_KEY });

const FAL_ENDPOINT = 'fal-ai/ltx-2.3-quality/outpaint';

function getOutpaintDimensions(aspectRatio: string, resolution: '720p' | '1080p') {
  const baseHeight = resolution === '1080p' ? 1080 : 720;
  const [w, h] = aspectRatio.split(':').map(Number);
  return { width: Math.round(baseHeight * w / h), height: baseHeight };
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const {
      videoUrl,
      aspectRatio = '16:9',
      resolution = '720p',
      fps = 24,
      numFrames,
      prompt,
      negativePrompt,
      sourceId,
      nodeId,
    } = await request.json();

    if (!videoUrl) return NextResponse.json({ error: 'videoUrl is required' }, { status: 400 });
    if (!prompt?.trim()) return NextResponse.json({ error: 'prompt is required' }, { status: 400 });

    const dimensions = getOutpaintDimensions(aspectRatio, resolution as '720p' | '1080p');
    const falHeaders = await getFalStorageHeaders({
      userId: user.id,
      sourceType: 'canvas',
      sourceId,
    });

    const { request_id } = await fal.queue.submit(FAL_ENDPOINT, {
      input: {
        video_url: videoUrl,
        prompt: prompt.trim(),
        negative_prompt: negativePrompt?.trim() || undefined,
        aspect_ratio: aspectRatio,
        output_resolution: resolution,
        resolution: dimensions,
        frames_per_second: fps,
        ...(numFrames ? { num_frames: numFrames } : {}),
        source_scale: 1,
        generate_audio: false,
        video_strength: 1,
        num_inference_steps: 15,
        guidance_scale: 1,
        enable_prompt_expansion: true,
        video_quality: 'high',
        video_write_mode: 'balanced',
      },
      headers: falHeaders,
    });

    await supabase.from('generations').insert({
      user_id: user.id,
      source_type: 'canvas',
      source_id: sourceId,
      node_id: nodeId ?? null,
      model: FAL_ENDPOINT,
      prompt: prompt.trim(),
      parameters: { aspectRatio, resolution, fps },
      media_type: 'video',
      media_url: '',
      status: 'processing',
      fal_request_id: request_id,
    });

    return NextResponse.json({ requestId: request_id, status: 'pending' });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[video-outpaint] submit error:', detail, err);
    return NextResponse.json({ error: 'Failed to submit outpaint job', details: detail }, { status: 500 });
  }
}
