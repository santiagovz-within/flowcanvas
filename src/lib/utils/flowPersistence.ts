const NEW_FLOW_DRAFT_KEY_PREFIX = 'canvas-flow:new-draft:';

const CONTENT_FIELDS = new Set([
  'prompt',
  'promptHistory',
  'generatedPrompt',
  'outpaintPrompt',
  'outpaintNegativePrompt',
  'imageUrl',
  'videoUrl',
  'mediaUrl',
  'inputImageUrl',
  'inputImageUrls',
  'startFrameUrl',
  'endFrameUrl',
  'outputImageUrl',
  'outputVideoUrl',
  'selectedImageUrl',
  'generatedImages',
  'generationSlots',
  'generationHistory',
  'videoHistory',
  'gifUrl',
  'gifGcsRef',
  'bulkResults',
]);

interface FlowNodeSnapshot {
  data?: unknown;
}

function hasValue(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(hasValue);
  if (value !== null && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some(hasValue);
  }
  return false;
}

function nodeHasContent(node: FlowNodeSnapshot): boolean {
  if (node.data === null || typeof node.data !== 'object') return false;
  return Object.entries(node.data as Record<string, unknown>).some(
    ([key, value]) => CONTENT_FIELDS.has(key) && hasValue(value),
  );
}

/**
 * A newly-created flow stays disposable while it is empty or contains only one
 * blank node. A payload-bearing node or a second node makes it worth keeping.
 */
export function shouldDiscardAbandonedFlow(nodes: FlowNodeSnapshot[]): boolean {
  return nodes.length <= 1 && !nodes.some(nodeHasContent);
}

export function markNewFlowDraft(flowId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(`${NEW_FLOW_DRAFT_KEY_PREFIX}${flowId}`, '1');
  } catch {
    // Storage can be unavailable in hardened browser contexts.
  }
}

export function isMarkedNewFlowDraft(flowId: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(`${NEW_FLOW_DRAFT_KEY_PREFIX}${flowId}`) === '1';
  } catch {
    return false;
  }
}

export function clearNewFlowDraft(flowId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(`${NEW_FLOW_DRAFT_KEY_PREFIX}${flowId}`);
  } catch {
    // Storage can be unavailable in hardened browser contexts.
  }
}
