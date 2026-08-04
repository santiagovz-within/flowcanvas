import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { fal } from '@fal-ai/client';
import { getSignedReadUrl, isGcsRef, signGcsRef } from '@/lib/gcs';
import { uploadMediaToGCS } from '@/lib/mediaDerivatives';

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
    const endpoint = request.nextUrl.searchParams.get('endpoint')
      ?? 'fal-ai/kling-video/v3/pro/text-to-video';

    const { data: existingGeneration, error: lookupError } = await supabase
      .from('generations')
      .select('id, media_url, status')
      .eq('fal_request_id', requestId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (lookupError) {
      throw new Error(`Could not load queued generation: ${lookupError.message}`);
    }

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

    const status = await fal.queue.status(endpoint, {
      requestId,
      logs: false,
    });

    if (status.status === 'COMPLETED') {
      const result = await fal.queue.result(endpoint, { requestId });

      if (mediaType === 'image') {
        const falResult = result.data as { images?: Array<{ url: string }> };
        const imageUrl = falResult.images?.[0]?.url;

        if (!imageUrl) {
          return NextResponse.json({ status: 'failed', error: 'FAL returned no image URL in the result.' });
        }
        if (!existingGeneration) {
          return NextResponse.json({ status: 'failed', error: 'Queued generation record was not found.' });
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

        const { error: updateError } = await supabase
          .from('generations')
          .update({
            media_url: gcsRef,
            status: 'completed',
            fal_request_id: requestId,
          })
          .eq('id', existingGeneration.id)
          .eq('user_id', user.id);

        if (updateError) {
          throw new Error(`Could not save completed generation: ${updateError.message}`);
        }

        return NextResponse.json({
          status: 'completed',
          mediaUrls: [signedUrl],
          generationId: existingGeneration.id,
        });
      }

      const falResult = result.data as { video?: { url: string } };
      const videoUrl = falResult.video?.url;

      if (!videoUrl) {
        return NextResponse.json({ status: 'failed', error: 'FAL returned no video URL in the result.' });
      }

      const videoRes = await fetch(videoUrl);
      const videoBuffer = await videoRes.arrayBuffer();
      const genId = existingGeneration?.id ?? crypto.randomUUID();
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

    const s = status as { status: string; queue_position?: number; error?: string };

    if (s.status === 'FAILED') {
      await supabase
        .from('generations')
        .update({ status: 'failed' })
        .eq('fal_request_id', requestId)
        .eq('user_id', user.id);
      return NextResponse.json({ status: 'failed', error: s.error ?? 'FAL reported the job failed.' });
    }

    return NextResponse.json({ status: 'pending', queuePosition: s.queue_position ?? null });
  } catch (err) {
    console.error('Status check error:', err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ status: 'error', error: detail }, { status: 500 });
  }
}
