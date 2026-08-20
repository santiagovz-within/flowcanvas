export interface FalEndpointPrice {
  endpointId: string;
  unitPrice: number;
  unit: string;
  currency: string;
}

export type FalPricingRule =
  | { kind: 'fixed' }
  | { kind: 'image-resolution'; resolutionMultipliers: Record<string, number> }
  | { kind: 'seedream-image' }
  | { kind: 'output-megapixels' }
  | { kind: 'topaz-image' }
  | { kind: 'flux-outpaint' }
  | {
      kind: 'video-seconds';
      resolutionMultipliers?: Record<string, number>;
      audioMultiplier?: number;
    }
  | { kind: 'video-frame-megapixels' }
  | { kind: 'topaz-video' };

export interface FalMediaMetadata {
  width: number;
  height: number;
  duration?: number;
}

export interface FalCostEstimateInput {
  endpoint: string;
  resolution?: string;
  aspectRatio?: string;
  duration?: number;
  generateAudio?: boolean;
  outputCount?: number;
  scaleFactor?: number;
  targetFps?: number | null;
  fps?: number;
  frameCount?: number;
  inputMedia?: FalMediaMetadata;
  outputWidth?: number;
  outputHeight?: number;
}

const SEEDREAM_MIN_PIXELS = 1024 * 1024;
const SEEDREAM_MAX_PIXELS = 2048 * 2048;
const IMAGE_SIZE_MULTIPLE = 8;

function positive(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function parseAspectRatio(aspectRatio = '1:1'): number | null {
  const [width, height] = aspectRatio.split(':').map(Number);
  if (!positive(width) || !positive(height)) return null;
  return width / height;
}

export function getTieredImageSize(
  aspectRatio = '1:1',
  resolution = '1K',
): FalMediaMetadata | null {
  const ratio = parseAspectRatio(aspectRatio);
  if (!ratio) return null;
  const baseSize = resolution.toUpperCase() === '4K'
    ? 3840
    : resolution.toUpperCase() === '2K'
      ? 2048
      : 1024;

  return ratio >= 1
    ? { width: baseSize, height: Math.round(baseSize / ratio) }
    : { width: Math.round(baseSize * ratio), height: baseSize };
}

export function getSeedreamImageSize(
  aspectRatio = '1:1',
  resolution = '1K',
): FalMediaMetadata | null {
  const nominal = getTieredImageSize(aspectRatio, resolution);
  if (!nominal) return null;
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

export function getVideoDimensions(
  aspectRatio = '16:9',
  resolution = '720p',
): FalMediaMetadata | null {
  const ratio = parseAspectRatio(aspectRatio);
  if (!ratio) return null;
  const normalizedResolution = resolution.toLowerCase();
  const baseHeight = normalizedResolution === '1080p'
    ? 1080
    : normalizedResolution === '4k'
      ? 2160
      : normalizedResolution === '2k'
        ? 1440
        : normalizedResolution === '768p'
          ? 768
          : 720;
  return { width: Math.round(baseHeight * ratio), height: baseHeight };
}

function megapixels(width: number, height: number): number {
  return width * height / 1_000_000;
}

function getOutputDimensions(input: FalCostEstimateInput): FalMediaMetadata | null {
  if (positive(input.outputWidth) && positive(input.outputHeight)) {
    return { width: input.outputWidth, height: input.outputHeight };
  }
  if (!input.inputMedia || !positive(input.scaleFactor)) return null;
  return {
    width: input.inputMedia.width * input.scaleFactor,
    height: input.inputMedia.height * input.scaleFactor,
  };
}

function topazImageMultiplier(outputMegapixels: number): number {
  if (outputMegapixels <= 24) return 1;
  if (outputMegapixels <= 48) return 2;
  if (outputMegapixels <= 96) return 4;

  // Fal publishes $0.32 at 96 MP and up to $1.36 at 512 MP. Interpolate
  // between those documented anchors for the non-tier values the UI allows.
  return Math.min(17, 4 + (outputMegapixels - 96) * (13 / (512 - 96)));
}

function topazVideoResolutionMultiplier(width: number, height: number): number {
  const shortEdge = Math.min(width, height);
  if (shortEdge <= 720) return 1;
  if (shortEdge <= 1080) return 2;
  return 8;
}

export function estimateFalCost(
  price: FalEndpointPrice | undefined,
  rule: FalPricingRule | undefined,
  input: FalCostEstimateInput,
): number | null {
  if (!price || !rule || !positive(price.unitPrice)) return null;
  const outputCount = positive(input.outputCount) ? input.outputCount : 1;
  let billableUnits: number | null = null;

  switch (rule.kind) {
    case 'fixed':
      billableUnits = outputCount;
      break;

    case 'image-resolution': {
      const multiplier = rule.resolutionMultipliers[input.resolution ?? ''];
      billableUnits = positive(multiplier) ? outputCount * multiplier : null;
      break;
    }

    case 'seedream-image': {
      const dimensions = getSeedreamImageSize(input.aspectRatio, input.resolution);
      if (!dimensions) break;
      const multiplier = dimensions.width * dimensions.height <= 1536 * 1536 ? 1 : 2;
      billableUnits = outputCount * multiplier;
      break;
    }

    case 'output-megapixels': {
      const dimensions = getOutputDimensions(input);
      if (!dimensions) break;
      billableUnits = outputCount * megapixels(dimensions.width, dimensions.height);
      break;
    }

    case 'topaz-image': {
      const dimensions = getOutputDimensions(input);
      if (!dimensions) break;
      billableUnits = outputCount * topazImageMultiplier(megapixels(dimensions.width, dimensions.height));
      break;
    }

    case 'flux-outpaint': {
      if (!input.inputMedia) break;
      const dimensions = getOutputDimensions(input);
      if (!dimensions) break;
      billableUnits = outputCount * (
        Math.ceil(megapixels(input.inputMedia.width, input.inputMedia.height))
        + Math.ceil(megapixels(dimensions.width, dimensions.height))
      );
      break;
    }

    case 'video-seconds': {
      if (!positive(input.duration)) break;
      const resolutionMultiplier = rule.resolutionMultipliers
        ? rule.resolutionMultipliers[input.resolution ?? '']
        : 1;
      if (!positive(resolutionMultiplier)) break;
      const audioMultiplier = input.generateAudio && rule.audioMultiplier
        ? rule.audioMultiplier
        : 1;
      billableUnits = input.duration * resolutionMultiplier * audioMultiplier * outputCount;
      break;
    }

    case 'video-frame-megapixels': {
      const dimensions = positive(input.outputWidth) && positive(input.outputHeight)
        ? { width: input.outputWidth, height: input.outputHeight }
        : getVideoDimensions(input.aspectRatio, input.resolution);
      const frames = positive(input.frameCount)
        ? input.frameCount
        : positive(input.duration) && positive(input.fps)
          ? Math.round(input.duration * input.fps)
          : null;
      if (!dimensions || !frames) break;
      billableUnits = Math.ceil(megapixels(dimensions.width, dimensions.height) * frames) * outputCount;
      break;
    }

    case 'topaz-video': {
      if (!input.inputMedia || !positive(input.inputMedia.duration) || !positive(input.scaleFactor)) break;
      const outputWidth = input.inputMedia.width * input.scaleFactor;
      const outputHeight = input.inputMedia.height * input.scaleFactor;
      const fpsMultiplier = input.targetFps === 60 ? 2 : 1;
      billableUnits = input.inputMedia.duration
        * topazVideoResolutionMultiplier(outputWidth, outputHeight)
        * fpsMultiplier
        * outputCount;
      break;
    }
  }

  if (!positive(billableUnits)) return null;
  const cost = price.unitPrice * billableUnits;
  return positive(cost) ? cost : null;
}

export function formatFalCostEstimate(cost: number | null): string | null {
  if (!positive(cost)) return null;
  const digits = cost < 0.01 ? 3 : 2;
  return `~$${cost.toFixed(digits)}`;
}
