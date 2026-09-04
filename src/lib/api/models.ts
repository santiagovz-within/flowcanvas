import type { ModelConfig } from '@/types';
import type { FalPricingRule } from '@/lib/falPricing';

// Google Gemini image generation model IDs — keyed by our internal model ID
export const GOOGLE_IMAGE_MODELS: Record<string, string> = {};

export const FAL_MODELS = {
  'nano-banana-2': {
    endpoint: 'fal-ai/nano-banana-2',
    editEndpoint: 'fal-ai/nano-banana-2/edit',
    usesAspectRatio: true,
    supportsResolution: true,
    editImageParam: 'image_urls',
    pricing: { kind: 'image-resolution', resolutionMultipliers: { '1K': 1, '2K': 1.5, '4K': 2 } },
    type: 'image' as const,
  },
  'nano-banana-pro': {
    endpoint: 'fal-ai/nano-banana-pro',
    editEndpoint: 'fal-ai/nano-banana-pro/edit',
    usesAspectRatio: true,
    supportsResolution: true,
    editImageParam: 'image_urls',
    pricing: { kind: 'image-resolution', resolutionMultipliers: { '1K': 1, '2K': 1, '4K': 2 } },
    type: 'image' as const,
  },
  'seedream-5': {
    endpoint: 'bytedance/seedream/v5/pro/text-to-image',
    editEndpoint: 'bytedance/seedream/v5/pro/edit',
    editImageParam: 'image_urls',
    usesImageSize: true,
    maxReferenceImages: 10,
    // Seedream accepts custom sizes from 1 MP to 4 MP and bills 2x above 1536².
    pricing: {
      kind: 'custom-image-size',
      minPixels: 1024 * 1024,
      maxPixels: 2048 * 2048,
      tierThresholdPixels: 1536 * 1536,
      tierMultiplier: 2,
    },
    type: 'image' as const,
  },
  'qwen-image-3': {
    endpoint: 'alibaba/qwen-image-3/text-to-image',
    editEndpoint: 'alibaba/qwen-image-3/edit',
    editImageParam: 'image_urls',
    usesImageSize: true,
    maxReferenceImages: 3,
    // Qwen accepts custom sizes whose total pixels fall between 512² and
    // 2048² (its 2048×2048 ceiling). Fal bills $0.04/image at 1K and
    // $0.075/image at 2K (above 2.25 MP); the pricing API reports the 1K rate.
    pricing: {
      kind: 'custom-image-size',
      minPixels: 512 * 512,
      maxPixels: 2048 * 2048,
      tierThresholdPixels: 1500 * 1500,
      tierMultiplier: 0.075 / 0.04,
    },
    type: 'image' as const,
  },
  'gpt-image-2': {
    endpoint: 'openai/gpt-image-2',
    editEndpoint: 'openai/gpt-image-2/edit',
    editImageParam: 'image_urls',
    hasOwnQuality: true,
    pricing: { kind: 'image-resolution', resolutionMultipliers: { '1K': 1, '2K': 1.53, '4K': 2.77 } },
    type: 'image' as const,
  },
  'krea-2-large': {
    endpoint: 'krea/v2/large/text-to-image',
    usesAspectRatio: true,
    // Krea has no image-to-image mode: a connected image only steers the
    // style through `image_style_references`, so there is no edit endpoint.
    styleReferenceParam: 'image_style_references',
    styleReferenceShape: 'weighted' as const,
    maxReferenceImages: 1,
    // Fal charges $0.060 per image, or $0.065 when a style reference is sent.
    pricing: { kind: 'fixed', referenceMultiplier: 0.065 / 0.06 },
    type: 'image' as const,
  },
  'recraft-v4': {
    endpoint: 'fal-ai/recraft/v4/pro/text-to-image',
    // Recraft has no image-to-image mode either; connected images become
    // style references, which live on a separate endpoint taking plain URLs.
    styleReferenceEndpoint: 'recraft/v4/style/pro/text-to-image',
    styleReferenceParam: 'image_urls',
    styleReferenceShape: 'urls' as const,
    usesImageSize: true,
    maxReferenceImages: 10,
    // Fal charges $0.25/image on the pro endpoint. The style endpoint is
    // $0.10/image plus $0.005 per request to build a style from the references.
    pricing: { kind: 'fixed', referenceMultiplier: 0.105 / 0.1 },
    type: 'image' as const,
  },
  'flux-2-pro': {
    endpoint: 'fal-ai/flux-pro/v1.1-ultra',
    usesAspectRatio: true,
    pricing: { kind: 'fixed' },
    type: 'image' as const,
  },
  'google-omni-flash': {
    endpoint: 'google/gemini-omni-flash/v1.1/text-to-video',
    imageToVideoEndpoint: 'google/gemini-omni-flash/v1.1/image-to-video',
    pricing: { kind: 'video-seconds', resolutionMultipliers: { '360p': 0.3, '720p': 1, '1080p': 1.5, '4k': 3 } },
    type: 'video' as const,
  },
  'kling-3-pro': {
    endpoint: 'fal-ai/kling-video/v3/pro/text-to-video',
    imageToVideoEndpoint: 'fal-ai/kling-video/v3/pro/image-to-video',
    pricing: { kind: 'video-seconds', audioMultiplier: 1.5 },
    type: 'video' as const,
  },
  'flux-3': {
    endpoint: 'blackforestlabs/flux-3/text-to-video',
    imageToVideoEndpoint: 'blackforestlabs/flux-3/image-to-video',
    pricing: { kind: 'video-seconds', resolutionMultipliers: { '720p': 1, '1080p': 29 / 17 } },
    type: 'video' as const,
  },
  'minimax-h3': {
    endpoint: 'minimax/h3/text-to-video',
    imageToVideoEndpoint: 'minimax/h3/image-to-video',
    pricing: { kind: 'video-seconds', resolutionMultipliers: { '768P': 8 / 13, '2K': 1 } },
    type: 'video' as const,
  },
  'minimax-h3-max': {
    endpoint: 'minimax/h3-max/text-to-video',
    imageToVideoEndpoint: 'minimax/h3-max/image-to-video',
    pricing: { kind: 'video-seconds', resolutionMultipliers: { '480P': 5 / 8, '768P': 1 } },
    type: 'video' as const,
  },
  'wan-3-prime': {
    endpoint: 'alibaba/wan-3.0-prime/text-to-video',
    imageToVideoEndpoint: 'alibaba/wan-3.0-prime/image-to-video',
    // Fal charges $0.14/s at 720p and $0.28/s at 1080p; the pricing API is
    // assumed to report the default 1080p rate.
    pricing: { kind: 'video-seconds', resolutionMultipliers: { '720p': 0.14 / 0.28, '1080p': 1 } },
    type: 'video' as const,
  },
  'seedance-2': {
    endpoint: 'bytedance/seedance-2.0/text-to-video',
    imageToVideoEndpoint: 'bytedance/seedance-2.0/image-to-video',
    // Fal bills Seedance per 1000 video tokens ($0.014 at 480p-1080p, $0.008 at 4K).
    pricing: { kind: 'video-tokens', fps: 24, tokensPerUnit: 1000, resolutionRateMultipliers: { '720p': 1, '1080p': 1, '4k': 0.008 / 0.014 } },
    type: 'video' as const,
  },
  'seedance-2-5': {
    endpoint: 'bytedance/seedance-2.5/text-to-video',
    imageToVideoEndpoint: 'bytedance/seedance-2.5/image-to-video',
    // Fal bills Seedance per 1000 video tokens ($0.0214 at 480p/720p, $0.0234 at
    // 1080p). The pricing API only exposes the base rate, so scale 1080p here.
    pricing: { kind: 'video-tokens', fps: 24, tokensPerUnit: 1000, resolutionRateMultipliers: { '720p': 1, '1080p': 0.0234 / 0.0214 } },
    type: 'video' as const,
  },
  'seedance-2-mini': {
    endpoint: 'bytedance/seedance-2.0/mini/text-to-video',
    imageToVideoEndpoint: 'bytedance/seedance-2.0/mini/image-to-video',
    // Fal bills Seedance Mini per 1000 video tokens ($0.007 at 480p/720p).
    pricing: { kind: 'video-tokens', fps: 24, tokensPerUnit: 1000 },
    type: 'video' as const,
  },
  'seedvr2': {
    endpoint: 'fal-ai/seedvr/upscale/image',
    scaleParam: 'upscale_factor',
    scaleOptions: [2, 4, 8, 10],
    pricing: { kind: 'output-megapixels' },
    type: 'upscale' as const,
  },
  'topaz': {
    endpoint: 'fal-ai/topaz/upscale/image',
    scaleParam: 'upscale_factor',
    scaleOptions: [2, 4],
    pricing: { kind: 'topaz-image' },
    type: 'upscale' as const,
  },
  'ideogram-remove-bg': {
    endpoint: 'fal-ai/ideogram/remove-background',
    pricing: { kind: 'fixed' },
    type: 'remove-bg' as const,
  },
} as const;

/** Fal endpoints used by nodes that do not expose a selectable model. */
export const FAL_NODE_ENDPOINTS = {
  imageOutpaint: {
    endpoint: 'fal-ai/flux-2-pro/outpaint',
    pricing: { kind: 'flux-outpaint' },
  },
  videoOutpaint: {
    endpoint: 'fal-ai/ltx-2.3-quality/outpaint',
    pricing: { kind: 'video-frame-megapixels' },
  },
  videoUpscale: {
    endpoint: 'fal-ai/topaz/upscale/video',
    pricing: { kind: 'topaz-video' },
  },
} as const;

export function getFalPricingRule(endpoint: string): FalPricingRule | undefined {
  for (const config of Object.values(FAL_MODELS)) {
    if (
      config.endpoint === endpoint
      || ('editEndpoint' in config && config.editEndpoint === endpoint)
      || ('styleReferenceEndpoint' in config && config.styleReferenceEndpoint === endpoint)
      || ('imageToVideoEndpoint' in config && config.imageToVideoEndpoint === endpoint)
    ) {
      return config.pricing as FalPricingRule;
    }
  }

  return Object.values(FAL_NODE_ENDPOINTS)
    .find(config => config.endpoint === endpoint)?.pricing as FalPricingRule | undefined;
}

export function getFalPricingEndpointIds(): string[] {
  const endpoints = new Set<string>();
  for (const config of Object.values(FAL_MODELS)) {
    endpoints.add(config.endpoint);
    if ('editEndpoint' in config) endpoints.add(config.editEndpoint);
    if ('styleReferenceEndpoint' in config) endpoints.add(config.styleReferenceEndpoint);
    if ('imageToVideoEndpoint' in config) endpoints.add(config.imageToVideoEndpoint);
  }
  for (const config of Object.values(FAL_NODE_ENDPOINTS)) endpoints.add(config.endpoint);
  return [...endpoints];
}

export const MODELS: Record<string, ModelConfig> = {
  'nano-banana-2': {
    id: 'nano-banana-2',
    name: 'Nano Banana 2',
    provider: 'fal',
    type: 'image',
    supportedAspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'],
    supportedResolutions: ['1K', '2K', '4K'],
    maxBatchSize: 1,
    supportsImageInput: true,
    supportsNegativePrompt: false,
    estimatedTimeSeconds: 8,
    maxReferenceImages: 14,
  },
  'nano-banana-pro': {
    id: 'nano-banana-pro',
    name: 'Nano Banana Pro',
    provider: 'fal',
    type: 'image',
    supportedAspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'],
    supportedResolutions: ['1K', '2K', '4K'],
    maxBatchSize: 1,
    supportsImageInput: true,
    supportsNegativePrompt: false,
    estimatedTimeSeconds: 12,
    maxReferenceImages: 14,
  },
  'seedream-5': {
    id: 'seedream-5',
    name: 'Seedream v5',
    provider: 'fal',
    type: 'image',
    supportedAspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '4:5', '21:9'],
    supportedResolutions: ['1K', '2K'],
    maxBatchSize: 1,
    supportsImageInput: true,
    supportsNegativePrompt: false,
    estimatedTimeSeconds: 20,
    maxReferenceImages: 10,
  },
  'qwen-image-3': {
    id: 'qwen-image-3',
    name: 'Qwen Image 3.0',
    provider: 'fal',
    type: 'image',
    supportedAspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '4:5', '21:9'],
    supportedResolutions: ['1K', '2K'],
    maxBatchSize: 1,
    supportsImageInput: true,
    supportsNegativePrompt: true,
    estimatedTimeSeconds: 15,
    maxReferenceImages: 3,
  },
  'gpt-image-2': {
    id: 'gpt-image-2',
    name: 'GPT Image 2',
    provider: 'fal',
    type: 'image',
    supportedAspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'],
    supportedResolutions: ['1K', '2K', '4K'],
    maxBatchSize: 1,
    supportsImageInput: true,
    supportsNegativePrompt: false,
    estimatedTimeSeconds: 15,
    maxReferenceImages: 16,
  },
  'krea-2-large': {
    id: 'krea-2-large',
    name: 'Krea 2 Large',
    provider: 'fal',
    type: 'image',
    supportedAspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:2', '2:3', '4:5', '2.35:1'],
    supportedResolutions: ['1K'],
    maxBatchSize: 1,
    supportsImageInput: true,
    supportsNegativePrompt: false,
    estimatedTimeSeconds: 10,
    maxReferenceImages: 1,
  },
  'recraft-v4': {
    id: 'recraft-v4',
    name: 'Recraft V4',
    provider: 'fal',
    type: 'image',
    supportedAspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '4:5', '21:9'],
    supportedResolutions: ['1K', '2K'],
    maxBatchSize: 1,
    supportsImageInput: true,
    supportsNegativePrompt: false,
    estimatedTimeSeconds: 15,
    maxReferenceImages: 10,
  },
  'flux-2-pro': {
    id: 'flux-2-pro',
    name: 'Flux 2 Pro',
    provider: 'fal',
    type: 'image',
    supportedAspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '4:5', '21:9'],
    supportedResolutions: ['2K'],
    maxBatchSize: 1,
    supportsImageInput: false,
    supportsNegativePrompt: false,
    estimatedTimeSeconds: 15,
  },
  'google-omni-flash': {
    id: 'google-omni-flash',
    name: 'Google Omni Flash 1.1',
    provider: 'fal',
    type: 'video',
    supportedAspectRatios: ['16:9', '9:16'],
    supportedResolutions: ['720p', '1080p', '4k', '360p'],
    maxBatchSize: 1,
    supportsImageInput: true,
    supportsNegativePrompt: false,
    estimatedTimeSeconds: 90,
  },
  'kling-3-pro': {
    id: 'kling-3-pro',
    name: 'Kling 3 Pro',
    provider: 'fal',
    type: 'video',
    supportedAspectRatios: ['1:1', '16:9', '9:16'],
    supportedResolutions: ['1080p'],
    maxBatchSize: 1,
    supportsImageInput: true,
    supportsNegativePrompt: false,
    estimatedTimeSeconds: 120,
  },
  'flux-3': {
    id: 'flux-3',
    name: 'FLUX.3',
    provider: 'fal',
    type: 'video',
    supportedAspectRatios: ['16:9', '21:9', '2:1', '4:3', '1:1', '3:4', '9:16'],
    supportedResolutions: ['720p', '1080p'],
    maxBatchSize: 1,
    supportsImageInput: true,
    supportsNegativePrompt: false,
    estimatedTimeSeconds: 120,
  },
  'minimax-h3': {
    id: 'minimax-h3',
    name: 'MiniMax H3',
    provider: 'fal',
    type: 'video',
    supportedAspectRatios: ['16:9', '21:9', '4:3', '1:1', '3:4', '9:16'],
    supportedResolutions: ['2K', '768P'],
    maxBatchSize: 1,
    supportsImageInput: true,
    supportsNegativePrompt: false,
    estimatedTimeSeconds: 120,
  },
  'minimax-h3-max': {
    id: 'minimax-h3-max',
    name: 'MiniMax H3 Max',
    provider: 'fal',
    type: 'video',
    supportedAspectRatios: ['16:9', '21:9', '4:3', '1:1', '3:4', '9:16'],
    supportedResolutions: ['768P', '480P'],
    maxBatchSize: 1,
    supportsImageInput: true,
    supportsNegativePrompt: false,
    estimatedTimeSeconds: 10,
  },
  'wan-3-prime': {
    id: 'wan-3-prime',
    name: 'Wan 3.0 Prime',
    provider: 'fal',
    type: 'video',
    supportedAspectRatios: ['16:9', '4:3', '1:1', '3:4', '9:16'],
    supportedResolutions: ['720p', '1080p'],
    maxBatchSize: 1,
    supportsImageInput: true,
    supportsNegativePrompt: false,
    estimatedTimeSeconds: 120,
  },
  'seedance-2': {
    id: 'seedance-2',
    name: 'Seedance 2.0',
    provider: 'fal',
    type: 'video',
    supportedAspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
    supportedResolutions: ['720p', '1080p', '4k'],
    maxBatchSize: 1,
    supportsImageInput: true,
    supportsNegativePrompt: false,
    estimatedTimeSeconds: 90,
  },
  'seedance-2-5': {
    id: 'seedance-2-5',
    name: 'Seedance 2.5',
    provider: 'fal',
    type: 'video',
    supportedAspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
    supportedResolutions: ['720p', '1080p'],
    maxBatchSize: 1,
    supportsImageInput: true,
    supportsNegativePrompt: false,
    estimatedTimeSeconds: 90,
  },
  'seedance-2-mini': {
    id: 'seedance-2-mini',
    name: 'Seedance 2.0 Mini',
    provider: 'fal',
    type: 'video',
    supportedAspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
    supportedResolutions: ['720p'],
    maxBatchSize: 1,
    supportsImageInput: true,
    supportsNegativePrompt: false,
    estimatedTimeSeconds: 60,
  },
  'seedvr2': {
    id: 'seedvr2',
    name: 'SeedVR2',
    provider: 'fal',
    type: 'upscale',
    supportedAspectRatios: [],
    supportedResolutions: ['2K', '4K'],
    maxBatchSize: 1,
    supportsImageInput: true,
    supportsNegativePrompt: false,
    estimatedTimeSeconds: 30,
  },
  'topaz': {
    id: 'topaz',
    name: 'Topaz',
    provider: 'fal',
    type: 'upscale',
    supportedAspectRatios: [],
    supportedResolutions: ['2K', '4K'],
    maxBatchSize: 1,
    supportsImageInput: true,
    supportsNegativePrompt: false,
    estimatedTimeSeconds: 20,
  },
};

export const IMAGE_MODELS = [
  MODELS['nano-banana-2'],
  MODELS['seedream-5'],
  MODELS['nano-banana-pro'],
  MODELS['gpt-image-2'],
  MODELS['qwen-image-3'],
  MODELS['recraft-v4'],
  MODELS['krea-2-large'],
  MODELS['flux-2-pro'],
];
export const VIDEO_MODELS = [
  MODELS['seedance-2-5'],
  MODELS['seedance-2'],
  MODELS['google-omni-flash'],
  MODELS['minimax-h3-max'],
  MODELS['flux-3'],
  MODELS['kling-3-pro'],
  MODELS['minimax-h3'],
  MODELS['wan-3-prime'],
  MODELS['seedance-2-mini'],
];
// The new endpoint-specific controls are currently implemented on the canvas node.
export const CHAT_VIDEO_MODELS = VIDEO_MODELS.filter(
  m => !['google-omni-flash', 'flux-3', 'minimax-h3', 'minimax-h3-max', 'seedance-2-5', 'wan-3-prime'].includes(m.id),
);
export const UPSCALE_MODELS = Object.values(MODELS).filter(m => m.type === 'upscale');

/** Models whose connected images steer style only (no image-to-image). */
export function usesStyleReferences(modelId: string): boolean {
  const falConfig = FAL_MODELS[modelId as keyof typeof FAL_MODELS];
  return !!falConfig && 'styleReferenceParam' in falConfig;
}

/** Whether the image node renders per-image `ref_N` slots for this model. */
export function supportsMultipleImageReferences(modelId: string): boolean {
  const model = MODELS[modelId];
  const falConfig = FAL_MODELS[modelId as keyof typeof FAL_MODELS];

  return model?.provider === 'google' || usesStyleReferences(modelId) || (
    !!falConfig &&
    'editImageParam' in falConfig &&
    falConfig.editImageParam === 'image_urls'
  );
}

export function getImageReferenceLimit(modelId: string): number {
  if (!supportsMultipleImageReferences(modelId)) return 1;
  return MODELS[modelId]?.maxReferenceImages ?? 14;
}

export function getModel(id: string): ModelConfig | undefined {
  return MODELS[id];
}

export function getDefaultImageModel(): ModelConfig {
  return MODELS['seedream-5'];
}

export function getDefaultVideoModel(): ModelConfig {
  return MODELS['seedance-2'];
}
