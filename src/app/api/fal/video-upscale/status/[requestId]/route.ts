import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { fal } from '@fal-ai/client';
import { getSignedReadUrl } from '@/lib/gcs';
import { uploadMediaToGCS } from '@/lib/mediaDerivatives';

fal.config({ credentials: process.env.FAL_KEY });

const FAL_ENDPOINT = 'fal-ai/topaz/upscale/video';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { requestId } = await params;

    const status = await fal.queue.status(FAL_ENDPOINT, {
      requestId,
      logs: false,
    });

    if (status.status === 'COMPLETED') {
      const result = await fal.queue.result(FAL_ENDPOINT, { requestId });
      const falResult = result.data as { video?: { url: string }; output_video?: { url: string } };
      const videoUrl = falResult.video?.url ?? falResult.output_video?.url;

      if (!videoUrl) {
        console.error('[video-upscale/status] no video URL in result:', JSON.stringify(result.data));
        return NextResponse.json({ status: 'failed' });
      }

      const videoRes = await fetch(videoUrl);
      const videoBuffer = await videoRes.arrayBuffer();
      const genId = crypto.randomUUID();
      const objectPath = `${user.id}/${genId}.mp4`;
      const gcsRef = await uploadMediaToGCS(videoBuffer, objectPath, 'video/mp4');
      const signedUrl = await getSignedReadUrl(objectPath);

      await supabase
        .from('generations')
        .update({
          media_url: gcsRef,
          status: 'completed',
          fal_request_id: requestId,
        })
        .eq('fal_request_id', requestId)
        .eq('user_id', user.id);

      return NextResponse.json({
        status: 'completed',
        mediaUrls: [signedUrl],
      });
    }

    const inQueue = status as { status: string; queue_position?: number };

    if (inQueue.status === 'FAILED') {
      await supabase
        .from('generations')
        .update({ status: 'failed' })
        .eq('fal_request_id', requestId)
        .eq('user_id', user.id);
      return NextResponse.json({ status: 'failed' });
    }

    return NextResponse.json({ status: 'pending', queuePosition: inQueue.queue_position ?? null });
  } catch (err) {
    console.error('[video-upscale/status] error:', err);
    return NextResponse.json({ error: 'Status check failed' }, { status: 500 });
  }
}
