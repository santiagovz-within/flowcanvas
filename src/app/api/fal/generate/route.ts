import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { fal } from '@fal-ai/client';
import { FAL_MODELS } from '@/lib/api/models';
import { getSignedReadUrl } from '@/lib/gcs';
import { uploadMediaToGCS } from '@/lib/mediaDerivatives';
import { getFalStorageHeaders } from '@/lib/falStorage';
import type { GenerateImageRequest } from '@/types';

fal.config({ credentials: process.env.FAL_KEY });

interface GenerateRequestBody extends GenerateImageRequest {
  sourceType: 'canvas' | 'chat';
  sourceId?: string;
  nodeId?: string;
  quality?: string;
  duration?: number;
}

const SEEDREAM_MIN_PIXELS = 1024 * 1024;
const SEEDREAM_MAX_PIXELS = 2048 * 2048;
const IMAGE_SIZE_MULTIPLE = 8;

function getImageSize(aspectRatio: string, resolution: string): { width: number; height: number } {
  const baseSize = resolution === '4K' ? 3840 : resolution === '2K' ? 2048 : 1024;
  const [w, h] = aspectRatio.split(':').map(Number);
  const ratio = w / h;

  if (ratio >= 1) {
    return { width: baseSize, height: Math.round(baseSize / ratio) };
  } else {
    return { width: Math.round(baseSize * ratio), height: baseSize };
  }
}

function getSeedreamImageSize(aspectRatio: string, resolution: string): { width: number; height: number } {
  // Preserve the shared UI tiers while respecting Seedream's 1–4 MP custom-size contract.
  const nominal = getImageSize(aspectRatio, resolution);
  const nominalPixels = nominal.width * nominal.height;
  const targetPixels = Math.min(SEEDREAM_MAX_PIXELS, Math.max(SEEDREAM_MIN_PIXELS, nominalPixels));
  const scale = Math.sqrt(targetPixels / nominalPixels);
  const roundDimension = nominalPixels < SEEDREAM_MIN_PIXELS
    ? Math.ceil
    : nominalPixels > SEEDREAM_MAX_PIXELS
      ? Math.floor
      : Math.round;

  return {
    width: roundDimension((nominal.width * scale) / IMAGE_SIZE_MULTIPLE) * IMAGE_SIZE_MULTIPLE,
    height: roundDimension((nominal.height * scale) / IMAGE_SIZE_MULTIPLE) * IMAGE_SIZE_MULTIPLE,
  };
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body: GenerateRequestBody = await request.json();
    const { model, prompt, aspectRatio = '1:1', resolution = '1K', numImages = 1, referenceImageUrls = [], sourceType, sourceId, nodeId } = body;

    const modelConfig = FAL_MODELS[model as keyof typeof FAL_MODELS];
    if (!modelConfig) return NextResponse.json({ error: 'Unknown model' }, { status: 400 });

    const falHeaders = await getFalStorageHeaders({
      userId: user.id,
      sourceType,
      sourceId,
    });

    if (modelConfig.type === 'video') {
      // Video generation — submit async job
      const startFrameUrl      = (body as GenerateRequestBody & { startFrameUrl?: string }).startFrameUrl;
      const endFrameUrl        = (body as GenerateRequestBody & { endFrameUrl?: string }).endFrameUrl;
      const generateAudio      = (body as GenerateRequestBody & { generateAudio?: boolean }).generateAudio;
      const seedanceResolution = (body as GenerateRequestBody & { seedanceResolution?: string }).seedanceResolution ?? '720p';
      const hasImage = !!startFrameUrl;
      const isSeedance = model === 'seedance-2';
      const isOmni = model === 'google-omni-flash';
      const duration = body.duration ?? 5;

      if (isOmni && !startFrameUrl) {
        return NextResponse.json(
          { error: 'Google Omni Flash requires a start frame.' },
          { status: 400 }
        );
      }

      if (isOmni && !['16:9', '9:16'].includes(aspectRatio)) {
        return NextResponse.json(
          { error: 'Google Omni Flash supports only 16:9 and 9:16 aspect ratios.' },
          { status: 400 }
        );
      }

      if (isOmni && (!Number.isInteger(duration) || duration < 3 || duration > 10)) {
        return NextResponse.json(
          { error: 'Google Omni Flash duration must be an integer from 3 to 10 seconds.' },
          { status: 400 }
        );
      }

      const endpoint = hasImage && 'imageToVideoEndpoint' in modelConfig
        ? modelConfig.imageToVideoEndpoint
        : modelConfig.endpoint;

      const { request_id } = await fal.queue.submit(endpoint as string, {
        input: {
          prompt,
          ...(!hasImage || isOmni ? { aspect_ratio: aspectRatio } : {}),
          duration: isOmni ? duration : String(duration),
          ...(startFrameUrl ? { image_url: startFrameUrl } : {}),
          ...(!isOmni && endFrameUrl ? { end_image_url: endFrameUrl } : {}),
          ...(isSeedance    ? { generate_audio: generateAudio !== false, resolution: seedanceResolution } : {}),
        },
        headers: falHeaders,
      });

      const { data: gen } = await supabase
        .from('generations')
        .insert({
          user_id: user.id,
          source_type: sourceType,
          source_id: sourceId,
          node_id: nodeId,
          model,
          prompt,
          parameters: { aspectRatio, resolution },
          reference_image_urls: referenceImageUrls,
          media_type: 'video',
          media_url: '',
          status: 'processing',
          fal_request_id: request_id,
        })
        .select()
        .single();

      return NextResponse.json({
        generationId: gen?.id,
        requestId: request_id,
        endpoint,
        status: 'pending',
      });
    }

    // Image generation
    const useEditEndpoint = referenceImageUrls.length > 0 && 'editEndpoint' in modelConfig;
    const endpoint = useEditEndpoint ? modelConfig.editEndpoint : modelConfig.endpoint;
    const usesAspectRatio = 'usesAspectRatio' in modelConfig && modelConfig.usesAspectRatio;
    const supportsResolution = 'supportsResolution' in modelConfig && (modelConfig as { supportsResolution: boolean }).supportsResolution;
    const usesImageSize = 'usesImageSize' in modelConfig && modelConfig.usesImageSize;
    const usesQueue = 'usesQueue' in modelConfig && modelConfig.usesQueue;
    const editImageParam = 'editImageParam' in modelConfig ? (modelConfig as { editImageParam: string }).editImageParam : null;
    const hasOwnQuality = 'hasOwnQuality' in modelConfig && (modelConfig as { hasOwnQuality: boolean }).hasOwnQuality;
    const maxReferenceImages = 'maxReferenceImages' in modelConfig
      ? modelConfig.maxReferenceImages
      : undefined;
    const { width, height } = usesImageSize
      ? getSeedreamImageSize(aspectRatio, resolution)
      : getImageSize(aspectRatio, resolution);
    const results: string[] = [];

    console.log('[fal/generate] endpoint:', endpoint, '| refs:', referenceImageUrls.length, '| usesAspectRatio:', usesAspectRatio, '| editImageParam:', editImageParam);

    const baseInput: Record<string, unknown> = {
      prompt,
      ...(usesAspectRatio
        ? { aspect_ratio: aspectRatio, ...(supportsResolution ? { resolution } : {}) }
        : usesImageSize
          ? { image_size: { width, height } }
          : hasOwnQuality
            ? { image_size: { width, height }, quality: body.quality ?? 'high' }
            : { image_size: { width, height }, num_inference_steps: body.quality === 'high' ? 40 : body.quality === 'low' ? 20 : 28 }),
      ...(body.negativePrompt ? { negative_prompt: body.negativePrompt } : {}),
    };

    if (referenceImageUrls[0]) {
      if (editImageParam === 'image_urls') {
        const usableReferenceImageUrls = referenceImageUrls.filter(Boolean);
        baseInput.image_urls = maxReferenceImages === undefined
          ? usableReferenceImageUrls
          : usableReferenceImageUrls.slice(0, maxReferenceImages);
      } else {
        baseInput.image_url = referenceImageUrls[0];
      }
    }

    if (usesQueue) {
      const pendingRequests: Array<{ requestId: string; generationId?: string; endpoint: string }> = [];

      for (let i = 0; i < numImages; i++) {
        console.log(`[fal/generate] queue image ${i + 1}/${numImages} input:`, JSON.stringify(baseInput));
        const { request_id } = await fal.queue.submit(endpoint as string, {
          input: baseInput,
          headers: falHeaders,
        });
        const { data: gen, error: insertError } = await supabase
          .from('generations')
          .insert({
            user_id: user.id,
            source_type: sourceType,
            source_id: sourceId,
            node_id: nodeId,
            model,
            prompt,
            parameters: { aspectRatio, resolution },
            reference_image_urls: referenceImageUrls,
            media_type: 'image',
            media_url: '',
            width,
            height,
            status: 'processing',
            fal_request_id: request_id,
          })
          .select('id')
          .single();

        if (insertError) {
          throw new Error(`Could not save queued generation: ${insertError.message}`);
        }

        pendingRequests.push({
          requestId: request_id,
          generationId: gen?.id,
          endpoint: endpoint as string,
        });
      }

      return NextResponse.json({
        generationId: pendingRequests[0]?.generationId,
        requestId: pendingRequests[0]?.requestId,
        endpoint,
        requests: pendingRequests,
        status: 'pending',
      });
    }

    for (let i = 0; i < numImages; i++) {
      console.log(`[fal/generate] image ${i + 1}/${numImages} input:`, JSON.stringify(baseInput));
      const result = await fal.subscribe(endpoint as string, {
        input: baseInput,
        headers: falHeaders,
      });

      const falResult = result.data as { images?: Array<{ url: string }>; image?: { url: string } };
      const imageUrl = falResult.images?.[0]?.url ?? falResult.image?.url;
      if (!imageUrl) continue;

      const imageRes = await fetch(imageUrl);
      const imageBuffer = await imageRes.arrayBuffer();
      const contentType = imageRes.headers.get('content-type') ?? 'image/webp';
      const ext = contentType.split('/')[1] ?? 'webp';

      const genId = crypto.randomUUID();
      const objectPath = `${user.id}/${genId}.${ext}`;
      const gcsRef = await uploadMediaToGCS(imageBuffer, objectPath, contentType);
      const signedUrl = await getSignedReadUrl(objectPath);

      await supabase
        .from('generations')
        .insert({
          id: genId,
          user_id: user.id,
          source_type: sourceType,
          source_id: sourceId,
          node_id: nodeId,
          model,
          prompt,
          parameters: { aspectRatio, resolution },
          reference_image_urls: referenceImageUrls,
          media_type: 'image',
          media_url: gcsRef,
          width,
          height,
          status: 'completed',
        });

      results.push(signedUrl);
    }

    if (results.length === 0) {
      return NextResponse.json({ error: 'Generation failed' }, { status: 500 });
    }

    const { data: lastGen } = await supabase
      .from('generations')
      .select('id')
      .eq('user_id', user.id)
      .eq('source_type', sourceType)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    return NextResponse.json({ generationId: lastGen?.id, mediaUrls: results, status: 'completed' });
  } catch (err) {
    const details = err instanceof Error
      ? err.message
      : typeof err === 'object' && err !== null
        ? JSON.stringify(err)
        : String(err);
    console.error('Generation error:', details);
    return NextResponse.json({ error: 'Generation failed', details }, { status: 500 });
  }
}
