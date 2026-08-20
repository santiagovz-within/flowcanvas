import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { uploadToGCS, getSignedReadUrl } from '@/lib/gcs';
import { uploadMediaToGCS } from '@/lib/mediaDerivatives';
import { getFalStorageHeaders } from '@/lib/falStorage';
import { describeFalError } from '@/lib/falErrors';
import { FAL_NODE_ENDPOINTS } from '@/lib/api/models';
import { getFalBillingColumns, subscribeToFalWithBilling } from '@/lib/falResult';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const {
      imageUrl,
      expandTop    = 0,
      expandRight  = 0,
      expandBottom = 0,
      expandLeft   = 0,
      resizeSourceTo,
      sourceType   = 'canvas',
      sourceId,
      nodeId,
    } = await request.json();

    if (!imageUrl) return NextResponse.json({ error: 'imageUrl required' }, { status: 400 });
    if (!expandTop && !expandRight && !expandBottom && !expandLeft) {
      return NextResponse.json({ error: 'No expansion specified' }, { status: 400 });
    }
    const falHeaders = await getFalStorageHeaders({
      userId: user.id,
      sourceType,
      sourceId,
    });

    console.log('[fal/outpaint] input:', { imageUrl, expandTop, expandRight, expandBottom, expandLeft, resizeSourceTo });

    // Optionally resize the source image before outpainting (needed when target ratio exceeds 2560px)
    let falImageUrl = imageUrl;
    if (resizeSourceTo) {
      const { width: targetW, height: targetH } = resizeSourceTo as { width: number; height: number };
      const imgRes   = await fetch(imageUrl);
      const imgBuf   = Buffer.from(await imgRes.arrayBuffer());
      const sharp    = (await import('sharp')).default;
      const resized  = await sharp(imgBuf).resize(targetW, targetH, { fit: 'fill' }).toFormat('webp').toBuffer();
      const resPath  = `${user.id}/outpaint-src-${crypto.randomUUID()}.webp`;
      await uploadToGCS(resized, resPath, 'image/webp');
      falImageUrl = await getSignedReadUrl(resPath);
      console.log('[fal/outpaint] resized source:', targetW, 'x', targetH);
    }

    const result = await subscribeToFalWithBilling<Record<string, unknown>>(
      FAL_NODE_ENDPOINTS.imageOutpaint.endpoint,
      {
        input: {
          image_url:        falImageUrl,
          ...(expandTop    > 0 ? { expand_top:    expandTop    } : {}),
          ...(expandRight  > 0 ? { expand_right:  expandRight  } : {}),
          ...(expandBottom > 0 ? { expand_bottom: expandBottom } : {}),
          ...(expandLeft   > 0 ? { expand_left:   expandLeft   } : {}),
        },
        headers: falHeaders,
      },
    );

    const d = result.data;
    console.log('[fal/outpaint] response keys:', Object.keys(d));

    const outputUrl =
      (d.images as Array<{ url: string }> | undefined)?.[0]?.url ??
      (d.image  as { url: string } | undefined)?.url;

    if (!outputUrl) {
      console.error('[fal/outpaint] no URL in response:', JSON.stringify(d));
      return NextResponse.json({ error: 'No image in response' }, { status: 500 });
    }

    const imageRes    = await fetch(outputUrl);
    const imageBuffer = await imageRes.arrayBuffer();
    const contentType = imageRes.headers.get('content-type') ?? 'image/webp';
    const ext         = contentType.split('/')[1] ?? 'webp';

    const genId      = crypto.randomUUID();
    const objectPath = `${user.id}/${genId}.${ext}`;
    const gcsRef     = await uploadMediaToGCS(imageBuffer, objectPath, contentType);
    const signedUrl  = await getSignedReadUrl(objectPath);
    const billing = await getFalBillingColumns(
      FAL_NODE_ENDPOINTS.imageOutpaint.endpoint,
      result.billableUnits,
    );

    await supabase.from('generations').insert({
      id:          genId,
      user_id:     user.id,
      source_type: sourceType,
      source_id:   sourceId,
      node_id:     nodeId,
      model:       'flux-2-pro-outpaint',
      parameters:  {
        expandTop,
        expandRight,
        expandBottom,
        expandLeft,
        endpoint: FAL_NODE_ENDPOINTS.imageOutpaint.endpoint,
      },
      media_type:  'image',
      media_url:   gcsRef,
      status:      'completed',
      fal_request_id: result.requestId,
      ...billing,
    });

    return NextResponse.json({ mediaUrls: [signedUrl], status: 'completed' });
  } catch (err) {
    const details = describeFalError(err);
    console.error('[fal/outpaint] error:', details);
    return NextResponse.json({ error: 'Outpaint failed', details }, { status: 500 });
  }
}
