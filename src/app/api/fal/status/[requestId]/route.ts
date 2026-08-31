import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { fal } from '@fal-ai/client';
import { getSignedReadUrl, isGcsRef, signGcsRef } from '@/lib/gcs';
import { uploadMediaToGCS } from '@/lib/mediaDerivatives';
import { describeFalError, isTerminalFalError } from '@/lib/falErrors';
import { failGeneration } from '@/lib/generationFailures';
import {
  fetchFalQueueResult,
  getFalBillingColumns,
  mergeFalBillingParameters,
  persistFalBillingBestEffort,
} from '@/lib/falResult';

fal.config({ credentials: process.env.FAL_KEY });

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { requestId } = await params;
    const mediaType = request.nextUrl.searchParams.get('mediaType') === 'image'
      ? 'image'
      : 'video';

    // The endpoint must match whatever was used to submit the job.
    // The client passes it as a query param so we don't have to hardcode a model.
    const requestedEndpoint = request.nextUrl.searchParams.get('endpoint');

    const { data: existingGeneration, error: lookupError } = await supabase
      .from('generations')
      .select('id, media_url, status, error_message, parameters')
      .eq('fal_request_id', requestId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (lookupError) {
      throw new Error(`Could not load queued generation: ${lookupError.message}`);
    }

    const storedParameters = existingGeneration?.parameters;
    const storedEndpoint = storedParameters
      && typeof storedParameters === 'object'
      && typeof (storedParameters as { endpoint?: unknown }).endpoint === 'string'
      ? (storedParameters as { endpoint: string }).endpoint
      : null;
    const endpoint = storedEndpoint
      ?? requestedEndpoint
      ?? 'fal-ai/kling-video/v3/pro/text-to-video';

    if (existingGeneration?.status === 'completed' && existingGeneration.media_url) {
      const mediaUrl = isGcsRef(existingGeneration.media_url)
        ? await signGcsRef(existingGeneration.media_url)
        : existingGeneration.media_url;
      return NextResponse.json({
        status: 'completed',
        mediaUrls: [mediaUrl],
        generationId: existingGeneration.id,
      });
    }
    if (existingGeneration?.status === 'failed') {
      return NextResponse.json({
        status: 'failed',
        error: existingGeneration.error_message ?? 'FAL reported the job failed.',
        generationId: existingGeneration.id,
        requestId,
      });
    }

    const status = await fal.queue.status(endpoint, {
      requestId,
      logs: false,
    });

    if (status.status === 'COMPLETED') {
      // FAL marks a failed run COMPLETED and only reveals why when the result is
      // fetched: it answers 422/500 with the reason in `detail`.
      let result;
      try {
        result = await fetchFalQueueResult<Record<string, unknown>>(status.response_url, requestId);
      } catch (err) {
        if (!isTerminalFalError(err)) throw err;
        const message = describeFalError(err);
        console.error(`[fal/status] ${endpoint} request ${requestId} failed: ${message}`);
        return failGeneration(supabase, user.id, requestId, message);
      }

      if (mediaType === 'image') {
        const falResult = result.data as {
          images?: Array<{ url: string }>;
          image?: { url: string };
        };
        const imageUrl = falResult.images?.[0]?.url ?? falResult.image?.url;

        if (!imageUrl) {
          return failGeneration(supabase, user.id, requestId, 'FAL returned no image URL in the result.');
        }
        if (!existingGeneration) {
          return NextResponse.json({
            status: 'failed',
            error: 'Queued generation record was not found.',
            requestId,
          });
        }

        const imageRes = await fetch(imageUrl);
        if (!imageRes.ok) {
          throw new Error(`Could not download completed FAL image (${imageRes.status}).`);
        }
        const imageBuffer = await imageRes.arrayBuffer();
        const contentType = imageRes.headers.get('content-type') ?? 'image/jpeg';
        const ext = contentType.split('/')[1]?.split(';')[0] ?? 'jpg';
        const objectPath = `${user.id}/${existingGeneration.id}.${ext}`;
        const gcsRef = await uploadMediaToGCS(imageBuffer, objectPath, contentType);
        const signedUrl = await getSignedReadUrl(objectPath);
        const billing = await getFalBillingColumns(endpoint, result.billableUnits);

        const { error: updateError } = await supabase
          .from('generations')
          .update({
            media_url: gcsRef,
            status: 'completed',
            fal_request_id: requestId,
            parameters: mergeFalBillingParameters(storedParameters, billing),
          })
          .eq('id', existingGeneration.id)
          .eq('user_id', user.id);

        if (updateError) {
          throw new Error(`Could not save completed generation: ${updateError.message}`);
        }

        await persistFalBillingBestEffort(
          billing,
          columns => supabase
            .from('generations')
            .update(columns)
            .eq('id', existingGeneration.id)
            .eq('user_id', user.id),
          `generation ${existingGeneration.id}`,
        );

        return NextResponse.json({
          status: 'completed',
          mediaUrls: [signedUrl],
          generationId: existingGeneration.id,
        });
      }

      const falResult = result.data as { video?: { url: string } };
      const videoUrl = falResult.video?.url;

      if (!videoUrl) {
        return failGeneration(supabase, user.id, requestId, 'FAL returned no video URL in the result.');
      }

      const videoRes = await fetch(videoUrl);
      const videoBuffer = await videoRes.arrayBuffer();
      const genId = existingGeneration?.id ?? crypto.randomUUID();
      const objectPath = `${user.id}/${genId}.mp4`;
      const gcsRef = await uploadMediaToGCS(videoBuffer, objectPath, 'video/mp4');
      const signedUrl = await getSignedReadUrl(objectPath);
      const billing = await getFalBillingColumns(endpoint, result.billableUnits);

      const { error: updateError } = await supabase
        .from('generations')
        .update({
          media_url: gcsRef,
          status: 'completed',
          fal_request_id: requestId,
          parameters: mergeFalBillingParameters(storedParameters, billing),
        })
        .eq('fal_request_id', requestId)
        .eq('user_id', user.id);

      if (updateError) {
        throw new Error(`Could not save completed generation: ${updateError.message}`);
      }

      await persistFalBillingBestEffort(
        billing,
        columns => supabase
          .from('generations')
          .update(columns)
          .eq('fal_request_id', requestId)
          .eq('user_id', user.id),
        `request ${requestId}`,
      );

      const { data: gen } = await supabase
        .from('generations')
        .select('id')
        .eq('fal_request_id', requestId)
        .single();

      return NextResponse.json({
        status: 'completed',
        mediaUrls: [signedUrl],
        generationId: gen?.id,
      });
    }

    const s = status as { status: string; queue_position?: number; error?: string; detail?: string };

    // The queue contract only documents IN_QUEUE/IN_PROGRESS/COMPLETED, but treat
    // any explicit failure status as terminal in case FAL adds one.
    if (s.status === 'FAILED' || s.status === 'ERROR') {
      const message = s.error ?? s.detail ?? 'FAL reported the job failed.';
      return failGeneration(supabase, user.id, requestId, message);
    }

    return NextResponse.json({ status: 'pending', queuePosition: s.queue_position ?? null });
  } catch (err) {
    console.error('Status check error:', err);
    return NextResponse.json({ status: 'error', error: describeFalError(err) }, { status: 500 });
  }
}
