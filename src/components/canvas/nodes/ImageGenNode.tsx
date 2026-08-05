'use client';

import { Position, type NodeProps } from '@xyflow/react';
import { Aperture, Download, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { SendToFigmaButton } from './SendToFigmaButton';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { downloadAllFromUrls, downloadFromUrl } from '@/lib/utils/download';
import { CanvasImage } from '@/components/canvas/CanvasMedia';
import { NodeWrapper } from './NodeWrapper';
import { GenerationFailureOverlay, RegenerateGate } from './GenerationFailure';
import { TypedHandle, PORT_COLORS } from './TypedHandle';
import type { ImageGenNodeData } from '@/types';
import {
  IMAGE_MODELS,
  FAL_MODELS,
  getImageReferenceLimit,
  supportsMultipleImageReferences,
} from '@/lib/api/models';
import { ModelSelect } from './ModelSelect';
import { NodeSelect } from './NodeSelect';
import { ASPECT_RATIOS } from '@/lib/utils/constants';
import { useFlowStore } from '@/lib/stores/flowStore';
import { generationJobId, useGenerationStore } from '@/lib/stores/generationStore';
import { startTrackedImageGeneration } from '@/lib/generationTracker';
import { cn } from '@/lib/utils/cn';
import glassStyles from './ImageGenerationGlass.module.css';

const RESOLUTIONS = ['1K', '2K', '4K'];
const REF_ROW_HEIGHT = 29;
const ROW_GAP = 10;
const GLASS_PERFORMANCE_NODE_THRESHOLD = 20;

function autoResize(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

function AspectRatioGlyph({ ratio }: { ratio: string }) {
  const [width, height] = ratio.split(':').map(Number);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return <span className={glassStyles.aspectGlyphBox} aria-hidden />;
  }

  const scale = Math.min(width, height) / Math.max(width, height);
  const glyphWidth = width >= height ? 10 : 10 * scale;
  const glyphHeight = height >= width ? 10 : 10 * scale;

  return (
    <span className={glassStyles.aspectGlyphBox} aria-hidden>
      <span
        className={glassStyles.aspectGlyph}
        style={{ width: glyphWidth, height: glyphHeight }}
      />
    </span>
  );
}

export function ImageGenNode({ data, selected, id }: NodeProps & { data: ImageGenNodeData }) {
  const currentFlow = useFlowStore((state) => state.currentFlow);
  const usePerformanceGlass = useFlowStore(
    (state) => state.nodes.length > GLASS_PERFORMANCE_NODE_THRESHOLD
  );
  const activeJobId = currentFlow ? generationJobId(currentFlow.id, id) : '';
  const isGenerating = useGenerationStore((state) => !!state.jobs[activeJobId]);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadingImageIndex, setDownloadingImageIndex] = useState<number | null>(null);
  const storeEdges = useFlowStore((state) => state.edges);
  const isOutputConnected = storeEdges.some((edge) => edge.source === id && edge.sourceHandle === 'image');
  const genHistory = data.generationHistory ?? [];
  const [histIdx, setHistIdx] = useState(() => Math.max(0, genHistory.length - 1));
  const prevHistLen = useRef(genHistory.length);

  useEffect(() => {
    if (genHistory.length > prevHistLen.current) setHistIdx(genHistory.length - 1);
    prevHistLen.current = genHistory.length;
  }, [genHistory.length]);
  const promptSectionRef = useRef<HTMLDivElement>(null);
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);
  const rowsListRef = useRef<HTMLDivElement>(null);
  const [promptHandleTop, setPromptHandleTop] = useState(50);
  const [rowsStartTop, setRowsStartTop] = useState(220);

  const [localPrompt, setLocalPrompt] = useState(() => data.prompt ?? '');
  const isFocused = useRef(false);
  useEffect(() => {
    if (!isFocused.current) setLocalPrompt(data.prompt ?? '');
  }, [data.prompt]);

  useEffect(() => {
    if (promptTextareaRef.current) autoResize(promptTextareaRef.current);
  }, [localPrompt]);

  const modelConfig = IMAGE_MODELS.find((m) => m.id === data.model);
  const falConfig = FAL_MODELS[data.model as keyof typeof FAL_MODELS];
  const isMultiImageModel = supportsMultipleImageReferences(data.model);
  const maxReferenceImages = getImageReferenceLimit(data.model);
  const portCount = isMultiImageModel
    ? Math.min(Math.max(data.imagePortCount ?? 1, 1), maxReferenceImages)
    : 0;
  const connectedReferenceHandles = new Set(
    storeEdges
      .filter((edge) => edge.target === id && edge.targetHandle?.startsWith('ref_'))
      .map((edge) => edge.targetHandle)
  );
  const connectedCount = connectedReferenceHandles.size;

  const hasEditVariant = !!falConfig && 'editEndpoint' in falConfig;
  const hasImageInput = (data.inputImageUrls ?? []).some(Boolean);
  const isEditMode = hasEditVariant && hasImageInput;

  useLayoutEffect(() => {
    if (!promptSectionRef.current) return;
    const el = promptSectionRef.current;
    setPromptHandleTop(el.offsetTop + el.offsetHeight / 2);
  }, [data.promptConnected, localPrompt]);

  useLayoutEffect(() => {
    if (!isMultiImageModel || !rowsListRef.current) return;
    setRowsStartTop(rowsListRef.current.offsetTop);
  }, [isMultiImageModel, portCount, data.generatedImages?.length, data.status]);

  function updateData(updates: Partial<ImageGenNodeData>) {
    document.dispatchEvent(new CustomEvent('node:update', {
      detail: { nodeId: id, data: updates },
    }));
  }

  function navigateHistory(idx: number) {
    setHistIdx(idx);
    const images = genHistory[idx] ?? [];
    useFlowStore.getState().updateNodeData(id, { generatedImages: images });
    if (images[0]) {
      document.dispatchEvent(new CustomEvent('node:image-propagate', {
        detail: { sourceNodeId: id, imageUrl: images[0] },
      }));
    }
  }

  function handleModelChange(newModel: string) {
    const nowMulti = supportsMultipleImageReferences(newModel);
    const newLimit = getImageReferenceLimit(newModel);
    const freshEdges = useFlowStore.getState().edges;
    const keptEdges = freshEdges.filter((edge) => {
      if (edge.target !== id) return true;
      if (edge.targetHandle === 'reference_image') return !nowMulti;
      if (!edge.targetHandle?.startsWith('ref_')) return true;
      const index = Number(edge.targetHandle.slice(4));
      return nowMulti && Number.isInteger(index) && index < newLimit;
    });
    if (keptEdges.length !== freshEdges.length) {
      useFlowStore.getState().setEdges(keptEdges);
    }

    if (!nowMulti || isMultiImageModel !== nowMulti) {
      updateData({ model: newModel, inputImageUrls: [], imagePortCount: nowMulti ? 1 : 0 });
      return;
    }

    const urls = (data.inputImageUrls ?? []).slice(0, newLimit);
    const occupiedIndexes = keptEdges
      .filter((edge) => edge.target === id && edge.targetHandle?.startsWith('ref_'))
      .map((edge) => Number(edge.targetHandle?.slice(4)))
      .filter(Number.isInteger);
    const highestOccupied = occupiedIndexes.length > 0 ? Math.max(...occupiedIndexes) : -1;
    const nextPortCount = Math.min(
      Math.max(highestOccupied + 2, urls.filter(Boolean).length + 1, 1),
      newLimit
    );
    updateData({ model: newModel, inputImageUrls: urls, imagePortCount: nextPortCount });
  }

  function handleGenerate() {
    if (isGenerating || !currentFlow) return;
    const slotCount = Math.min(4, Math.max(1, Math.round(data.numImages)));
    const endpoint = modelConfig?.provider === 'google' ? '/api/google/generate' : '/api/fal/generate';
    const inputImageUrls = (data.inputImageUrls ?? []).filter(Boolean);
    if (endpoint === '/api/fal/generate') {
      useFlowStore.getState().consumeGcsOnlyEligibility();
    }

    const payload = {
      model: data.model,
      prompt: data.prompt ?? '',
      aspectRatio: data.aspectRatio,
      resolution: data.resolution,
      referenceImageUrls: inputImageUrls,
      sourceType: 'canvas',
      sourceId: useFlowStore.getState().currentFlow?.id,
      nodeId: id,
      numImages: 1,
    };
    void startTrackedImageGeneration({
      flowId: currentFlow.id,
      flowTitle: currentFlow.title,
      nodeId: id,
      data,
      endpoint,
      payload,
      slotCount,
    });
  }

  const displayImages = genHistory.length > 0 ? (genHistory[histIdx] ?? []) : (data.generatedImages ?? []);

  async function handleDownload() {
    if (isDownloading || downloadableImages.length === 0) return;
    setIsDownloading(true);
    try {
      await downloadAllFromUrls(downloadableImages, `image-generation-v${displayVersion}`);
    } catch (error) {
      console.error('[ImageGenNode] Batch download failed', error);
      window.alert('Could not download this image batch. Please try again.');
    } finally {
      setIsDownloading(false);
    }
  }

  async function handleImageDownload(url: string, imageIndex: number) {
    if (downloadingImageIndex !== null) return;
    setDownloadingImageIndex(imageIndex);
    try {
      await downloadFromUrl(url, `image-generation-v${displayVersion}-${imageIndex + 1}`);
    } finally {
      setDownloadingImageIndex(null);
    }
  }

  /** Clears the failure so the Generate button unlocks for the edited inputs. */
  function acknowledgeFailure() {
    updateData({
      status: 'idle',
      errorMessage: undefined,
      generationErrors: undefined,
      generationSlots: undefined,
    });
  }

  const sliderPct = ((data.numImages - 1) / 3) * 100;
  const hasPendingRequests = !!data.pendingRequests?.length;
  const generationSlots = data.generationSlots ?? [];
  const isShowingActiveGeneration = generationSlots.length > 0
    && (isGenerating || data.status === 'processing' || data.status === 'error' || hasPendingRequests);
  const hasActiveSlotRequests = isGenerating || data.status === 'processing' || hasPendingRequests;
  const previewSlots: Array<string | null> = isShowingActiveGeneration
    ? generationSlots
    : displayImages;
  const downloadableImages = previewSlots.filter((url): url is string => !!url);
  const hasFailure = data.status === 'error';
  const displayVersion = isShowingActiveGeneration ? genHistory.length + 1 : histIdx + 1;
  const previewAspectRatio = data.aspectRatio.replace(':', ' / ');

  const footer = (
    <div className={glassStyles.footerStack}>
      <button
        onClick={handleGenerate}
        disabled={isGenerating || hasFailure || (data.status === 'processing' && hasPendingRequests)}
        title={hasFailure ? 'Change the prompt or inputs, then confirm below to regenerate' : undefined}
        className={cn(
          glassStyles.glassSurface,
          glassStyles.controlSurface,
          glassStyles.button,
          glassStyles.generateButton,
          'transition-opacity disabled:opacity-40 nodrag',
        )}
      >
        <Image src="/node-icons/icon-generate.svg" alt="" width={11} height={11} aria-hidden />
        {isGenerating ? 'Generating…' : 'Generate'}
      </button>
      {hasFailure && <RegenerateGate onChangesApplied={acknowledgeFailure} />}
      {downloadableImages.length > 0 && (
        <div key={downloadableImages[0]} className={glassStyles.footerSecondary}>
          <button
            onClick={handleDownload}
            disabled={isDownloading}
            className={cn(
              glassStyles.glassSurface,
              glassStyles.controlSurface,
              glassStyles.button,
              glassStyles.downloadButton,
              'nodrag transition-opacity hover:opacity-80 active:opacity-60 disabled:opacity-50',
            )}
            aria-label={downloadableImages.length > 1 ? `Download all ${downloadableImages.length} images` : 'Download image'}
          >
            {isDownloading && <RefreshCw size={12} className="animate-spin" />}
            {isDownloading ? 'Downloading…' : 'Download'}
          </button>
          <SendToFigmaButton imageUrl={downloadableImages[0]} style={{ width: '100%', minWidth: 0 }} />
        </div>
      )}
    </div>
  );

  return (
    <NodeWrapper
      title="Image Generation"
      icon={<Aperture size={14} />}
      status={data.status}
      errorMessage={data.errorMessage}
      selected={selected}
      minWidth={300}
      accentColor={PORT_COLORS.image}
      titlePosition="outside"
      footer={footer}
      appearance="imageGenerationGlass"
      glassPerformanceMode={usePerformanceGlass}
    >
      {/* ── Handles ─────────────────────────────────────────── */}
      <TypedHandle
        type="target"
        position={Position.Left}
        id="prompt"
        portType="text"
        offset={`${promptHandleTop}px`}
        connected={!!data.promptConnected}
        appearance="imageGenerationGlass"
      />

      {!isMultiImageModel && (
        <TypedHandle
          type="target"
          position={Position.Left}
          id="reference_image"
          portType="image"
          offset="55%"
          connected={!!(data.inputImageUrls?.[0])}
          appearance="imageGenerationGlass"
        />
      )}

      {isMultiImageModel && Array.from({ length: portCount }, (_, i) => (
        <TypedHandle
          key={`ref_${i}`}
          type="target"
          position={Position.Left}
          id={`ref_${i}`}
          portType="image"
          offset={`${rowsStartTop + REF_ROW_HEIGHT / 2 + i * (REF_ROW_HEIGHT + ROW_GAP)}px`}
          badge={i + 1}
          connected={connectedReferenceHandles.has(`ref_${i}`) || !!(data.inputImageUrls?.[i])}
          appearance="imageGenerationGlass"
        />
      ))}

      {/* ── Inline prompt ────────────────────────────────────── */}
      <div ref={promptSectionRef} className={glassStyles.promptSection}>
        {data.promptConnected ? (
          <div
            className={cn(
              glassStyles.glassSurface,
              glassStyles.controlSurface,
              glassStyles.promptSurface,
              glassStyles.connectedPrompt,
            )}
          >
            Prompt connected
          </div>
        ) : (
          <textarea
            ref={promptTextareaRef}
            className={cn(
              glassStyles.glassSurface,
              glassStyles.controlSurface,
              glassStyles.promptSurface,
              'outline-none nodrag',
            )}
            rows={2}
            placeholder="Write your prompt here…"
            value={localPrompt}
            onFocus={() => { isFocused.current = true; }}
            onBlur={() => { isFocused.current = false; }}
            onChange={(e) => { const v = e.target.value; setLocalPrompt(v); autoResize(e.target); updateData({ prompt: v }); }}
          />
        )}
      </div>

      {/* ── Model selector ───────────────────────────────────── */}
      <ModelSelect
        options={IMAGE_MODELS}
        value={data.model}
        onChange={handleModelChange}
        appearance="imageGenerationGlass"
      />

      {/* ── Image-to-image / Text-to-image badge ─────────────── */}
      {hasEditVariant && (
        <span
          className={cn(
            glassStyles.glassSurface,
            glassStyles.controlSurface,
            glassStyles.modePill,
          )}
        >
          {isEditMode ? 'Image-to-image' : 'Text-to-image'}
        </span>
      )}

      {/* ── Aspect ratio + resolution ─────────────────────────── */}
      <div className={glassStyles.selectRow}>
        <NodeSelect
          options={ASPECT_RATIOS.map((r) => r.value)}
          value={data.aspectRatio}
          onChange={(v) => updateData({ aspectRatio: v })}
          leadingIcon={<AspectRatioGlyph ratio={data.aspectRatio} />}
          appearance="imageGenerationGlass"
        />
        <NodeSelect
          options={RESOLUTIONS}
          value={data.resolution}
          onChange={(v) => updateData({ resolution: v })}
          leadingIcon={<Image src="/node-icons/icon-resolution.svg" alt="" width={10} height={10} aria-hidden />}
          appearance="imageGenerationGlass"
        />
      </div>

      {/* ── Images to generate slider ─────────────────────────── */}
      <div className={glassStyles.sliderSection}>
        <label className={glassStyles.microLabel}>
          Images to generate: {data.numImages}
        </label>
        {/* Custom slider: track + ticks + thumb, native input on top for interaction */}
        <div className="relative nodrag" style={{ height: 24 }}>
          {/* Track */}
          <div
            style={{
              position: 'absolute',
              left: 0, right: 0,
              top: '50%',
              height: 4,
              transform: 'translateY(-50%)',
              borderRadius: 2,
              background: `linear-gradient(to right, #b36af7 ${sliderPct}%, #4a4a4a ${sliderPct}%)`,
            }}
          >
            {/* Tick marks at each step value */}
            {[0, 1, 2, 3].map((i) => {
              const tickPct = (i / 3) * 100;
              const isThumb = i === data.numImages - 1;
              return (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: i < data.numImages ? '#b36af7' : '#4a4a4a',
                    top: '50%',
                    left: `${tickPct}%`,
                    transform: 'translate(-50%, -50%)',
                    opacity: isThumb ? 0 : 1,
                  }}
                />
              );
            })}
          </div>
          {/* Thumb */}
          <div
            style={{
              position: 'absolute',
              width: 18,
              height: 18,
              borderRadius: '50%',
              background: '#b36af7',
              top: '50%',
              left: `${sliderPct}%`,
              transform: 'translate(-50%, -50%)',
              pointerEvents: 'none',
            }}
          />
          {/* Invisible native input for interaction */}
          <input
            type="range" min={1} max={4} step={1} value={data.numImages}
            onChange={(e) => updateData({ numImages: Number(e.target.value) })}
            className="absolute inset-0 w-full opacity-0 cursor-pointer nodrag"
            style={{ height: '100%', margin: 0 }}
          />
        </div>
      </div>

      {/* ── Reference image rows (multi-image models) ──────────── */}
      {isMultiImageModel && (
        <div className={glassStyles.referenceSection}>
          <label className={glassStyles.microLabel}>
            Reference Images{connectedCount > 0 ? ` ( ${connectedCount} / ${maxReferenceImages} )` : ''}
          </label>
          <div ref={rowsListRef} className={glassStyles.connectorRows}>
            {Array.from({ length: portCount }, (_, i) => {
              const hasImage = !!(data.inputImageUrls?.[i]);
              const isConnected = connectedReferenceHandles.has(`ref_${i}`) || hasImage;
              return (
                <div
                  key={i}
                  className={cn(
                    glassStyles.glassSurface,
                    glassStyles.controlSurface,
                    glassStyles.connector,
                    isConnected ? glassStyles.connectorActive : glassStyles.connectorInactive,
                  )}
                >
                  Image {i + 1}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Generation history navigation ─────────────────────── */}
      {genHistory.length > 1 && (
        <div className={glassStyles.historyNav}>
          <button
            onClick={() => navigateHistory(Math.max(0, histIdx - 1))}
            disabled={histIdx === 0}
            className="flex items-center p-0.5 rounded transition-opacity disabled:opacity-30 nodrag"
            style={{ color: 'var(--color-white-muted)' }}
          >
            <ChevronLeft size={13} />
          </button>
          <span
            className={glassStyles.microLabel}
            style={{ color: histIdx < genHistory.length - 1 ? 'var(--color-accent)' : undefined }}
          >
            {`VERSION ${histIdx + 1}`}
          </span>
          <button
            onClick={() => navigateHistory(Math.min(genHistory.length - 1, histIdx + 1))}
            disabled={histIdx === genHistory.length - 1}
            className="flex items-center p-0.5 rounded transition-opacity disabled:opacity-30 nodrag"
            style={{ color: 'var(--color-white-muted)' }}
          >
            <ChevronRight size={13} />
          </button>
        </div>
      )}

      {/* A failure before any slot existed still has to show its reason. */}
      {hasFailure && !previewSlots.some((url) => !url) && (
        <div
          className={cn('relative', glassStyles.preview)}
          style={{
            aspectRatio: previewAspectRatio,
            borderRadius: 8,
            border: '1px solid var(--color-error)',
            overflow: 'hidden',
            background: 'var(--color-bg-surface)',
            marginBottom: previewSlots.length > 0 ? 8 : 0,
          }}
        >
          <GenerationFailureOverlay message={data.errorMessage} />
        </div>
      )}

      {/* ── Generated previews ───────────────────────────────── */}
      {previewSlots.length > 0 && (
        <div className={glassStyles.previewList}>
          {previewSlots.map((url, i) => (
            <div
              key={`${isShowingActiveGeneration ? 'active' : `history-${histIdx}`}-${i}`}
              className="relative"
              style={{
                aspectRatio: previewAspectRatio,
                borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.08)',
                overflow: 'hidden',
                background: 'var(--color-bg-surface)',
              }}
            >
              {url ? (
                <>
                  <CanvasImage
                    src={url}
                    alt={`Generated ${i + 1}`}
                    className="w-full h-full object-cover nodrag"
                    fill
                  />
                  <button
                    type="button"
                    onClick={() => handleImageDownload(url, i)}
                    disabled={downloadingImageIndex !== null}
                    className="absolute bottom-2 right-2 flex items-center justify-center nodrag transition-opacity hover:opacity-80 active:opacity-60 disabled:opacity-50"
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 6,
                      background: '#fff',
                      color: '#111',
                      boxShadow: '0 2px 10px rgba(0,0,0,0.28)',
                    }}
                    title={`Download image ${i + 1}`}
                    aria-label={`Download image ${i + 1}`}
                  >
                    {downloadingImageIndex === i
                      ? <RefreshCw size={13} className="animate-spin" />
                      : <Download size={13} />}
                  </button>
                </>
              ) : hasActiveSlotRequests ? (
                <div className="relative flex h-full w-full items-center justify-center">
                  <div
                    className="absolute inset-0 animate-pulse"
                    style={{ background: 'rgba(255,255,255,0.09)' }}
                  />
                  <span
                    className="relative text-xs font-medium"
                    style={{ color: 'var(--color-white-muted)' }}
                  >
                    Generating
                  </span>
                </div>
              ) : (
                <GenerationFailureOverlay
                  message={data.generationErrors?.[i]?.message ?? data.errorMessage}
                  requestId={data.generationErrors?.[i]?.requestId}
                />
              )}
            </div>
          ))}
        </div>
      )}

      <TypedHandle
        type="source"
        position={Position.Right}
        id="image"
        portType="image"
        connected={isOutputConnected}
        appearance="imageGenerationGlass"
      />
    </NodeWrapper>
  );
}
