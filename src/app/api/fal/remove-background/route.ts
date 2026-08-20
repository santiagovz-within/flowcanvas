import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSignedReadUrl } from '@/lib/gcs';
import { uploadMediaToGCS } from '@/lib/mediaDerivatives';
import { getFalStorageHeaders } from '@/lib/falStorage';
import { describeFalError } from '@/lib/falErrors';
import { FAL_MODELS } from '@/lib/api/models';
import { getFalBillingColumns, subscribeToFalWithBilling } from '@/lib/falResult';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { imageUrl, sourceType = 'canvas', sourceId, nodeId } = await request.json();
    if (!imageUrl) return NextResponse.json({ error: 'imageUrl is required' }, { status: 400 });
    const falHeaders = await getFalStorageHeaders({
      userId: user.id,
      sourceType,
      sourceId,
    });

    const endpoint = FAL_MODELS['ideogram-remove-bg'].endpoint;
    const result = await subscribeToFalWithBilling<{ image?: { url: string } }>(
      endpoint,
      {
        input: { image_url: imageUrl },
        headers: falHeaders,
      },
    );

    const falResult = result.data;
    const outputUrl = falResult.image?.url;
    if (!outputUrl) return NextResponse.json({ error: 'No output image returned' }, { status: 500 });

    const imageRes = await fetch(outputUrl);
    const imageBuffer = await imageRes.arrayBuffer();
    const contentType = imageRes.headers.get('content-type') ?? 'image/png';
    const ext = contentType.split('/')[1] ?? 'png';

    const genId = crypto.randomUUID();
    const objectPath = `${user.id}/${genId}.${ext}`;
    const gcsRef = await uploadMediaToGCS(imageBuffer, objectPath, contentType);
    const signedUrl = await getSignedReadUrl(objectPath);
    const billing = await getFalBillingColumns(endpoint, result.billableUnits);

    await supabase.from('generations').insert({
      id: genId,
      user_id: user.id,
      source_type: sourceType,
      source_id: sourceId,
      node_id: nodeId,
      model: 'ideogram-remove-bg',
      parameters: { endpoint },
      media_type: 'image',
      media_url: gcsRef,
      status: 'completed',
      fal_request_id: result.requestId,
      ...billing,
    });

    return NextResponse.json({ mediaUrls: [signedUrl], status: 'completed' });
  } catch (err) {
    console.error('Remove background error:', err);
    return NextResponse.json(
      { error: 'Remove background failed', details: describeFalError(err) },
      { status: 500 },
    );
  }
}
