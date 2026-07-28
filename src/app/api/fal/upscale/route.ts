import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { fal } from '@fal-ai/client';
import { FAL_MODELS } from '@/lib/api/models';
import { uploadToGCS, getSignedReadUrl } from '@/lib/gcs';
import { getFalStorageHeaders } from '@/lib/falStorage';

fal.config({ credentials: process.env.FAL_KEY });

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { model, imageUrl, scaleFactor = 2, sourceType, sourceId, nodeId } = await request.json();

    const modelConfig = FAL_MODELS[model as keyof typeof FAL_MODELS];
    if (!modelConfig || modelConfig.type !== 'upscale') {
      return NextResponse.json({ error: 'Invalid upscale model' }, { status: 400 });
    }

    const scaleParam = 'scaleParam' in modelConfig ? modelConfig.scaleParam : 'scale';
    const falInput = { image_url: imageUrl, [scaleParam]: scaleFactor };
    const falHeaders = await getFalStorageHeaders({
      userId: user.id,
      sourceType: sourceType ?? 'canvas',
      sourceId,
    });

    console.log('[fal/upscale] endpoint:', modelConfig.endpoint, '| scaleParam:', scaleParam, '| scale:', scaleFactor);
    console.log('[fal/upscale] input:', JSON.stringify(falInput));

    const result = await fal.subscribe(modelConfig.endpoint, {
      input: falInput,
      headers: falHeaders,
    });

    const d = result.data as Record<string, unknown>;
    const outputUrl =
      (d.image as { url: string } | undefined)?.url ??
      ((d.images as Array<{ url: string }> | undefined)?.[0])?.url ??
      (d.output as { url: string } | undefined)?.url ??
      (d.output_image as { url: string } | undefined)?.url ??
      (d.upscaled_image as { url: string } | undefined)?.url;

    console.log('[fal/upscale] response keys:', Object.keys(d), '| outputUrl:', outputUrl);

    if (!outputUrl) {
      console.error('[fal/upscale] no URL found in response:', JSON.stringify(d));
      return NextResponse.json({ error: 'Upscale returned no image' }, { status: 500 });
    }

    const imageRes = await fetch(outputUrl);
    const imageBuffer = await imageRes.arrayBuffer();
    const contentType = imageRes.headers.get('content-type') ?? 'image/webp';
    const ext = contentType.split('/')[1] ?? 'webp';

    const genId = crypto.randomUUID();
    const objectPath = `${user.id}/${genId}.${ext}`;
    const gcsRef = await uploadToGCS(imageBuffer, objectPath, contentType);
    const signedUrl = await getSignedReadUrl(objectPath);

    await supabase.from('generations').insert({
      id: genId,
      user_id: user.id,
      source_type: sourceType ?? 'canvas',
      source_id: sourceId,
      node_id: nodeId,
      model,
      parameters: { scaleFactor },
      media_type: 'image',
      media_url: gcsRef,
      status: 'completed',
    });

    return NextResponse.json({ mediaUrls: [signedUrl], status: 'completed' });
  } catch (err) {
    console.error('Upscale error:', err);
    return NextResponse.json({ error: 'Upscale failed', details: String(err) }, { status: 500 });
  }
}
