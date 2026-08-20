import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { fal } from '@fal-ai/client';
import { getSignedReadUrl } from '@/lib/gcs';
import { uploadMediaToGCS } from '@/lib/mediaDerivatives';
import { describeFalError, isTerminalFalError } from '@/lib/falErrors';
import { failGeneration } from '@/lib/generationFailures';
import { FAL_NODE_ENDPOINTS } from '@/lib/api/models';
import {
  fetchFalQueueResult,
  getFalBillingColumns,
  mergeFalBillingParameters,
  persistFalBillingBestEffort,
} from '@/lib/falResult';

fal.config({ credentials: process.env.FAL_KEY });

const FAL_ENDPOINT = FAL_NODE_ENDPOINTS.videoUpscale.endpoint;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { requestId } = await params;

    const { data: existingGeneration, error: lookupError } = await supabase
      .from('generations')
      .select('id, parameters')
      .eq('fal_request_id', requestId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (lookupError) {
      throw new Error(`Could not load queued video upscale: ${lookupError.message}`);
    }
    if (!existingGeneration) {
      throw new Error('Queued video upscale record was not found.');
    }

    const status = await fal.queue.status(FAL_ENDPOINT, {
      requestId,
      logs: false,
    });

    if (status.status === 'COMPLETED') {
      // A failed run is also reported COMPLETED — fetching the result is what
      // surfaces FAL's reason for the failure.
      let result;
      try {
        result = await fetchFalQueueResult<Record<string, unknown>>(status.response_url, requestId);
      } catch (err) {
        if (!isTerminalFalError(err)) throw err;
        const message = describeFalError(err);
        console.error(`[video-upscale/status] request ${requestId} failed: ${message}`);
        return failGeneration(supabase, user.id, requestId, message);
      }
      const falResult = result.data as { video?: { url: string }; output_video?: { url: string } };
      const videoUrl = falResult.video?.url ?? falResult.output_video?.url;

      if (!videoUrl) {
        console.error('[video-upscale/status] no video URL in result:', JSON.stringify(result.data));
        return failGeneration(
          supabase,
          user.id,
          requestId,
          'FAL returned no video URL in the result.',
        );
      }

      const videoRes = await fetch(videoUrl);
      const videoBuffer = await videoRes.arrayBuffer();
      const genId = existingGeneration.id;
      const objectPath = `${user.id}/${genId}.mp4`;
      const gcsRef = await uploadMediaToGCS(videoBuffer, objectPath, 'video/mp4');
      const signedUrl = await getSignedReadUrl(objectPath);
      const billing = await getFalBillingColumns(FAL_ENDPOINT, result.billableUnits);

      const { error: updateError } = await supabase
        .from('generations')
        .update({
          media_url: gcsRef,
          status: 'completed',
          fal_request_id: requestId,
          parameters: mergeFalBillingParameters(existingGeneration.parameters, billing),
        })
        .eq('id', existingGeneration.id)
        .eq('user_id', user.id);

      if (updateError) {
        throw new Error(`Could not save completed video upscale: ${updateError.message}`);
      }

      await persistFalBillingBestEffort(
        billing,
        columns => supabase
          .from('generations')
          .update(columns)
          .eq('id', existingGeneration.id)
          .eq('user_id', user.id),
        `video upscale request ${requestId}`,
      );

      return NextResponse.json({
        status: 'completed',
        mediaUrls: [signedUrl],
      });
    }

    const inQueue = status as { status: string; queue_position?: number; error?: string };

    if (inQueue.status === 'FAILED' || inQueue.status === 'ERROR') {
      return failGeneration(
        supabase,
        user.id,
        requestId,
        inQueue.error ?? 'FAL reported that the upscale failed.',
      );
    }

    return NextResponse.json({ status: 'pending', queuePosition: inQueue.queue_position ?? null });
  } catch (err) {
    console.error('[video-upscale/status] error:', err);
    return NextResponse.json({ error: describeFalError(err) }, { status: 500 });
  }
}
