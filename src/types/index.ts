// ============================================================
// DATABASE TYPES
// ============================================================

export interface Profile {
  id: string;
  username: string;
  display_name: string | null;
  theme: 'dark' | 'light';
  is_admin: boolean;
  is_test_user: boolean;
  created_at: string;
  updated_at: string;
}

export interface Flow {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  flow_data: FlowData;
  is_template: boolean;
  base_flow_order: number | null;
  is_shared: boolean;
  is_gcs_only: boolean;
  gcs_only_eligible: boolean;
  lifecycle_state: 'draft' | 'active';
  created_at: string;
  updated_at: string;
}

export interface Generation {
  id: string;
  user_id: string;
  source_type: 'canvas' | 'chat';
  source_id: string | null;
  node_id: string | null;
  model: string;
  prompt: string | null;
  negative_prompt: string | null;
  parameters: Record<string, unknown>;
  reference_image_urls: string[] | null;
  media_type: 'image' | 'video' | 'prompt';
  media_url: string;
  thumbnail_url: string | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error_message: string | null;
  fal_request_id: string | null;
  fal_billable_units: number | null;
  fal_unit_price_usd: number | null;
  fal_cost_usd: number | null;
  created_at: string;
  expires_at: string;
}

export interface ChatSession {
  id: string;
  user_id: string;
  title: string;
  thumbnail_url?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  user_id: string;
  role: 'user' | 'system';
  content: string | null;
  generation_ids: string[] | null;
  reference_image_urls?: string[] | null;
  created_at: string;
}

// ============================================================
// REACT FLOW TYPES
// ============================================================

export type NodeType =
  | 'promptNode'
  | 'imageInputNode'
  | 'imageToPromptNode'
  | 'imageGenNode'
  | 'videoGenNode'
  | 'videoInputNode'
  | 'videoUpscaleNode'
  | 'upscaleNode'
  | 'modifyNode'
  | 'selectNode'
  | 'outputNode'
  | 'galleryOutputNode'
  | 'videoToGifNode'
  | 'removeBgNode'
  | 'groupNode'
  | 'mediaInputNode'
  | 'upscaleMediaNode';

export interface FlowViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface FlowData {
  nodes: FlowNode[];
  edges: FlowEdge[];
  viewport: FlowViewport;
}

export interface FlowNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  data: NodeData;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  animated?: boolean;
}

export interface PaletteColor {
  name: string;
  hex: string;
}

// Node-specific data types — all extend Record<string, unknown> for React Flow compatibility
export interface PromptNodeData extends Record<string, unknown> {
  prompt: string;
  label?: string;
  paletteEnabled?: boolean;
  palette?: PaletteColor[];
  promptHistory?: string[];
}

export interface ImageInputNodeData extends Record<string, unknown> {
  imageUrl?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  label?: string;
  // Set by FlowCanvas during canvas-drag uploads to drive status display in the node
  uploadStatus?: 'validating' | 'compressing' | 'uploading' | 'error';
  uploadProgress?: number;
  uploadError?: string;
}

/** Why FAL rejected one generation, shown inside the thumbnail that failed. */
export interface GenerationFailure {
  message: string;
  requestId?: string;
}

export interface ImageGenNodeData extends Record<string, unknown> {
  model: string;
  aspectRatio: string;
  resolution: string;
  numImages: number;
  prompt?: string;
  promptConnected?: boolean;
  inputImageUrls?: string[];
  imagePortCount?: number;
  generatedImages?: string[];
  generationSlots?: Array<string | null>;
  generationHistory?: string[][];
  /** Parallel to `generationSlots`: the failure for each slot that has one. */
  generationErrors?: Array<GenerationFailure | null>;
  status: NodeStatus;
  errorMessage?: string;
  pendingRequests?: Array<{ requestId: string; endpoint: string; slotIndex?: number }>;
  label?: string;
}

export interface VideoGenNodeData extends Record<string, unknown> {
  model: string;
  aspectRatio: string;
  imageAspectRatio?: string;
  duration?: number;
  generateAudio?: boolean;
  videoResolution?: '720p' | '1080p' | '4k' | '480P' | '768P' | '2K';
  /** @deprecated Read only as a fallback for videos saved before videoResolution was introduced. */
  seedanceResolution?: '480p' | '720p' | '1080p' | '4k';
  prompt?: string;
  promptConnected?: boolean;
  startFrameUrl?: string;
  endFrameUrl?: string;
  videoUrl?: string;
  videoHistory?: string[];
  status: NodeStatus;
  errorMessage?: string;
  /** FAL request that produced `errorMessage`, so the failure can be traced in FAL. */
  errorRequestId?: string;
  pendingRequestId?: string;
  pendingEndpoint?: string;
  label?: string;
}

export interface UpscaleNodeData extends Record<string, unknown> {
  model: string;
  scaleFactor: number;
  inputImageUrl?: string;
  outputImageUrl?: string;
  status: NodeStatus;
  errorMessage?: string;
  label?: string;
}

export interface SelectNodeData extends Record<string, unknown> {
  selectedIndex?: number;
  selectedImageUrl?: string;
  label?: string;
}

export interface OutputNodeData extends Record<string, unknown> {
  mediaUrl?: string;
  mediaType?: 'image' | 'video';
  label?: string;
}

export interface GalleryOutputNodeData extends Record<string, unknown> {
  label?: string;
}

export interface GroupNodeData extends Record<string, unknown> {
  label?: string;
  color?: string;
}

export interface ImageToPromptNodeData extends Record<string, unknown> {
  inputImageUrl?: string;
  generatedPrompt?: string;
  promptHistory?: string[];
  status: NodeStatus;
  label?: string;
}

export interface RemoveBgNodeData extends Record<string, unknown> {
  inputImageUrl?: string;
  outputImageUrl?: string;
  status: NodeStatus;
  errorMessage?: string;
  label?: string;
}

export interface VideoToGifNodeData extends Record<string, unknown> {
  videoUrl?: string;
  fps?: number;
  outputWidth?: number;
  startTime?: number;
  duration?: number;
  ditherLevel?: number;
  gifUrl?: string;
  gifGcsRef?: string;
  label?: string;
}

export interface ModifyNodeData extends Record<string, unknown> {
  model: string;
  mode?: 'prompt' | 'expand';
  prompt?: string;
  promptConnected?: boolean;
  inputImageUrl?: string;
  outputImageUrl?: string;
  aspectRatio?: string;
  resolution?: string;
  status: NodeStatus;
  errorMessage?: string;
  label?: string;
  expandTop?: number;
  expandRight?: number;
  expandBottom?: number;
  expandLeft?: number;
  expandAnchor?: string;
  // Video outpaint fields (active when a video source is connected)
  outpaintAspectRatio?: string;
  outpaintResolution?: '720p' | '1080p';
  outpaintFps?: number;
  outpaintPrompt?: string;
  outpaintNegativePrompt?: string;
  outputVideoUrl?: string;
  // Queue-backed edit models (Seedream) resolve asynchronously
  pendingRequestId?: string;
  pendingEndpoint?: string;
}

export interface VideoInputNodeData extends Record<string, unknown> {
  videoUrl?: string;
  label?: string;
  uploadStatus?: 'compressing' | 'uploading' | 'error';
  uploadProgress?: number;
  uploadError?: string;
}

export interface BulkItemResult {
  inputUrl: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  outputUrl?: string;
  errorMessage?: string;
}

export interface UpscaleMediaNodeData extends Record<string, unknown> {
  model: string;
  scaleFactor: number;
  upscaleFactor: number;
  targetFps?: number;
  h264Output?: boolean;
  outputImageUrl?: string;
  outputVideoUrl?: string;
  status: NodeStatus;
  errorMessage?: string;
  label?: string;
  bulkResults?: BulkItemResult[];
}

export interface MediaInputNodeData extends Record<string, unknown> {
  mediaType?: 'image' | 'video';
  imageUrl?: string;
  videoUrl?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  label?: string;
  uploadStatus?: 'validating' | 'compressing' | 'uploading' | 'error';
  uploadProgress?: number;
  uploadError?: string;
  /** Transient local preview shown while a canvas-dropped image uploads. */
  uploadPreviewUrl?: string;
}

export interface VideoUpscaleNodeData extends Record<string, unknown> {
  videoUrl?: string;
  upscaleFactor?: number;
  status: NodeStatus;
  errorMessage?: string;
  label?: string;
}

export type NodeData =
  | PromptNodeData
  | ImageInputNodeData
  | ImageToPromptNodeData
  | ImageGenNodeData
  | VideoGenNodeData
  | VideoInputNodeData
  | VideoUpscaleNodeData
  | UpscaleNodeData
  | ModifyNodeData
  | SelectNodeData
  | OutputNodeData
  | GalleryOutputNodeData
  | VideoToGifNodeData
  | RemoveBgNodeData
  | GroupNodeData
  | MediaInputNodeData
  | UpscaleMediaNodeData;

export type NodeStatus = 'idle' | 'processing' | 'completed' | 'error';

// ============================================================
// API TYPES
// ============================================================

export type MediaType = 'image' | 'video';
export type Provider = 'fal' | 'google';

export interface ModelConfig {
  id: string;
  name: string;
  provider: Provider;
  type: 'image' | 'video' | 'upscale' | 'prompt';
  supportedAspectRatios: string[];
  supportedResolutions: string[];
  maxBatchSize: number;
  supportsImageInput: boolean;
  supportsNegativePrompt: boolean;
  estimatedTimeSeconds: number;
  maxReferenceImages?: number;
}

export interface GenerateImageRequest {
  model: string;
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: string;
  resolution?: string;
  numImages?: number;
  referenceImageUrls?: string[];
  seed?: number;
}

export interface GenerateVideoRequest {
  model: string;
  prompt: string;
  aspectRatio?: string;
  duration?: number;
  videoResolution?: VideoGenNodeData['videoResolution'];
  generateAudio?: boolean;
  startFrameUrl?: string;
  endFrameUrl?: string;
}

export interface GenerateResponse {
  generationId: string;
  mediaUrls: string[];
  requestId?: string;
  status: 'completed' | 'pending';
}

export interface UpscaleRequest {
  model: string;
  imageUrl: string;
  scaleFactor?: number;
}

export interface EnhancePromptRequest {
  prompt: string;
  mediaType: 'image' | 'video';
  modelName: string;
}

// ============================================================
// UI STATE TYPES
// ============================================================

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
  duration?: number;
}

export interface ModalState {
  isOpen: boolean;
  type?: 'generation-detail' | 'confirm-delete' | 'rename';
  data?: unknown;
}

export type Theme = 'dark' | 'light';

// ============================================================
// BUG REPORT TYPES
// ============================================================

export interface BugReport {
  id: string;
  user_id: string;
  title: string;
  description: string;
  image_url?: string | null;
  status: 'open' | 'resolved';
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  author_username?: string;
  author_display_name?: string | null;
  comment_count?: number;
}

export interface BugReportComment {
  id: string;
  bug_report_id: string;
  user_id: string;
  content: string;
  created_at: string;
  author_username?: string;
  author_display_name?: string | null;
}

export interface BugReportDetail extends BugReport {
  comments: BugReportComment[];
}

// ============================================================
// CHAT TYPES
// ============================================================

export type ChatMode = 'image' | 'video';

export interface ChatSettings {
  model: string;
  aspectRatio: string;
  resolution: string;
  quality: string;
  numGenerations: number;
  duration: number;
}

export interface ChatMessageWithGenerations extends ChatMessage {
  generations?: Generation[];
}
