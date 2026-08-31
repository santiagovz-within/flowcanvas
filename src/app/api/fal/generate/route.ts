import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { fal } from '@fal-ai/client';
import { FAL_MODELS } from '@/lib/api/models';
import { getFalStorageHeaders } from '@/lib/falStorage';
import { describeFalError } from '@/lib/falErrors';
import type { GenerateImageRequest } from '@/types';

fal.config({ credentials: process.env.FAL_KEY });

interface GenerateRequestBody extends GenerateImageRequest {
  sourceType: 'canvas' | 'chat';
  sourceId?: string;
  nodeId?: string;
  quality?: string;
  duration?: number;
  videoResolution?: string;
  /** Compatibility with canvas nodes saved before videoResolution was introduced. */
  seedanceResolution?: string;
  generateAudio?: boolean;
  startFrameUrl?: string;
  endFrameUrl?: string;
  slotIndex?: number;
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
      const { startFrameUrl, endFrameUrl, generateAudio } = body;
      const hasImage = !!startFrameUrl;
      const isSeedance25 = model === 'seedance-2-5';
      const isSeedanceMini = model === 'seedance-2-mini';
      const isSeedance = model === 'seedance-2' || isSeedance25 || isSeedanceMini;
      const isOmni = model === 'google-omni-flash';
      const isKling = model === 'kling-3-pro';
      const isFlux3 = model === 'flux-3';
      const isMinimaxH3 = model === 'minimax-h3';
      const defaultVideoResolution = isMinimaxH3 ? '2K' : isKling ? '1080p' : '720p';
      const requestedVideoResolution = body.videoResolution
        ?? body.seedanceResolution
        ?? defaultVideoResolution;
      const videoResolution = isSeedanceMini && requestedVideoResolution !== '720p'
        ? '720p'
        : requestedVideoResolution;
      const requestedDuration = body.duration ?? 5;
      const duration = isSeedance
        ? Math.min(isSeedance25 ? 30 : 15, requestedDuration < 4 ? 5 : requestedDuration)
        : requestedDuration;

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

      if (isFlux3 && (!Number.isInteger(duration) || duration < 5 || duration > 20)) {
        return NextResponse.json(
          { error: 'FLUX.3 duration must be an integer from 5 to 20 seconds.' },
          { status: 400 }
        );
      }

      if (isMinimaxH3 && (!Number.isInteger(duration) || duration < 5 || duration > 15)) {
        return NextResponse.json(
          { error: 'MiniMax H3 duration must be an integer from 5 to 15 seconds.' },
          { status: 400 }
        );
      }

      const allowedResolutions = isFlux3
        ? ['720p', '1080p']
        : isMinimaxH3
          ? ['768P', '2K']
          : isSeedance25
            ? ['720p', '1080p']
            : isSeedanceMini
              ? ['720p']
            : isSeedance
              ? ['720p', '1080p', '4k']
              : isKling
                ? ['1080p']
                : ['720p'];
      if (!allowedResolutions.includes(videoResolution)) {
        return NextResponse.json(
          { error: `${modelConfig.type === 'video' ? model : 'Video model'} does not support ${videoResolution} resolution.` },
          { status: 400 }
        );
      }

      const fluxAspectRatios = ['21:9', '2:1', '16:9', '4:3', '1:1', '3:4', '9:16'];
      if (isFlux3 && !fluxAspectRatios.includes(aspectRatio)) {
        return NextResponse.json(
          { error: `FLUX.3 does not support the ${aspectRatio} aspect ratio.` },
          { status: 400 }
        );
      }

      const minimaxAspectRatios = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];
      if (isMinimaxH3 && !hasImage && !minimaxAspectRatios.includes(aspectRatio)) {
        return NextResponse.json(
          { error: `MiniMax H3 does not support the ${aspectRatio} aspect ratio.` },
          { status: 400 }
        );
      }

      const endpoint = hasImage && 'imageToVideoEndpoint' in modelConfig
        ? modelConfig.imageToVideoEndpoint
        : modelConfig.endpoint;

      const videoInput: Record<string, unknown> = { prompt };
      if (isOmni) {
        Object.assign(videoInput, {
          aspect_ratio: aspectRatio,
          duration,
          image_url: startFrameUrl,
        });
      } else if (isKling) {
        Object.assign(videoInput, {
          ...(!hasImage ? { aspect_ratio: aspectRatio } : {}),
          duration: String(duration),
          generate_audio: generateAudio !== false,
          ...(startFrameUrl ? { start_image_url: startFrameUrl } : {}),
          ...(endFrameUrl ? { end_image_url: endFrameUrl } : {}),
        });
      } else if (isSeedance) {
        Object.assign(videoInput, {
          ...(!hasImage ? { aspect_ratio: aspectRatio } : {}),
          duration: String(duration),
          ...(startFrameUrl ? { image_url: startFrameUrl } : {}),
          ...(endFrameUrl ? { end_image_url: endFrameUrl } : {}),
          generate_audio: generateAudio !== false,
          resolution: videoResolution,
        });
      } else if (isFlux3) {
        Object.assign(videoInput, {
          aspect_ratio: aspectRatio,
          duration,
          resolution: videoResolution,
          generate_audio: generateAudio !== false,
          ...(startFrameUrl ? { image_url: startFrameUrl } : {}),
        });
      } else if (isMinimaxH3) {
        Object.assign(videoInput, {
          ...(!hasImage ? { aspect_ratio: aspectRatio } : {}),
          duration,
          resolution: videoResolution,
          ...(startFrameUrl ? { image_url: startFrameUrl } : {}),
          ...(endFrameUrl ? { end_image_url: endFrameUrl } : {}),
        });
      }

      const { request_id } = await fal.queue.submit(endpoint as string, {
        input: videoInput,
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
          parameters: { aspectRatio, resolution: videoResolution, duration, endpoint },
          reference_image_urls: referenceImageUrls,
          media_type: 'video',
          media_url: '',
          status: 'processing',
          fal_request_id: request_id,
        })
        .select()
        .single();

      if (insertError) {
        throw new Error(`Could not save queued generation: ${insertError.message}`);
      }

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
    const editImageParam = 'editImageParam' in modelConfig ? (modelConfig as { editImageParam: string }).editImageParam : null;
    const hasOwnQuality = 'hasOwnQuality' in modelConfig && (modelConfig as { hasOwnQuality: boolean }).hasOwnQuality;
    const maxReferenceImages = 'maxReferenceImages' in modelConfig
      ? modelConfig.maxReferenceImages
      : undefined;
    const { width, height } = usesImageSize
      ? getSeedreamImageSize(aspectRatio, resolution)
      : getImageSize(aspectRatio, resolution);

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

    // Always submit image work asynchronously. Keeping this route open until
    // Fal finishes lets the deployment or browser time out even though the
    // queued job is still healthy (and may later complete successfully).
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
          parameters: { aspectRatio, resolution, endpoint, slotIndex: body.slotIndex },
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
  } catch (err) {
    const details = describeFalError(err);
    console.error('Generation error:', details);
    return NextResponse.json({ error: 'Generation failed', details }, { status: 500 });
  }
}
