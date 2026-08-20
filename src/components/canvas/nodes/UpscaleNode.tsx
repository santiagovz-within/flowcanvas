'use client';

import { Position, type NodeProps } from '@xyflow/react';
import { Zap, Maximize2, Download } from 'lucide-react';
import Image from 'next/image';
import { downloadFromUrl } from '@/lib/utils/download';
import { playSuccessSound } from '@/lib/utils/sound';
import { useEffect, useRef, useState } from 'react';
import { NodeWrapper } from './NodeWrapper';
import { TypedHandle, PORT_COLORS } from './TypedHandle';
import { SendToFigmaButton } from './SendToFigmaButton';
import type { UpscaleNodeData, ImageInputNodeData, ImageGenNodeData, SelectNodeData } from '@/types';
import { UPSCALE_MODELS, FAL_MODELS } from '@/lib/api/models';
import { ModelSelect } from './ModelSelect';
import { useFlowStore } from '@/lib/stores/flowStore';
import { CanvasImage } from '@/components/canvas/CanvasMedia';
import { cn } from '@/lib/utils/cn';
import glassStyles from './ImageGenerationGlass.module.css';
import { useMediaMetadata } from '@/lib/useMediaMetadata';
import FalCostEstimate from './FalCostEstimate';

type Dims = { w: number; h: number };

function ComparisonSlider({ beforeUrl, afterUrl }: { beforeUrl: string; afterUrl: string }) {
  const [pct, setPct] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [beforeDims, setBeforeDims] = useState<Dims | null>(null);
  const [afterDims, setAfterDims] = useState<Dims | null>(null);

  const move = useRef((clientX: number) => {
    if (!containerRef.current) return;
    const { left, width } = containerRef.current.getBoundingClientRect();
    setPct(Math.max(0, Math.min(100, ((clientX - left) / width) * 100)));
  });

  useEffect(() => {
    const onMove = (e: MouseEvent) => { if (dragging.current) move.current(e.clientX); };
    const onUp   = () => { dragging.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  const dimLabel = (d: Dims | null) => d ? `${d.w}×${d.h}` : '';

  return (
    <>
      <div
        ref={containerRef}
        className="relative overflow-hidden select-none nodrag"
        style={{ cursor: 'col-resize' }}
        onMouseDown={(e) => { dragging.current = true; move.current(e.clientX); e.preventDefault(); }}
      >
        {/* After image — sets the container height */}
        <CanvasImage
          src={afterUrl}
          alt="After"
          className="w-full block"
          style={{ height: 'auto' }}
          onLoad={(e) => {
            const img = e.currentTarget;
            setAfterDims({ w: img.naturalWidth, h: img.naturalHeight });
          }}
        />

        {/* Before image — absolutely overlaid, clipped via clipPath (no size distortion) */}
        <CanvasImage
          src={beforeUrl}
          alt="Before"
          className="absolute inset-0 w-full h-full block"
          fill
          style={{ position: 'absolute', inset: 0, objectFit: 'cover', clipPath: `inset(0 ${100 - pct}% 0 0)` }}
          onLoad={(e) => {
            const img = e.currentTarget;
            setBeforeDims({ w: img.naturalWidth, h: img.naturalHeight });
          }}
        />

        {/* Divider line + handle */}
        <div
          className="absolute top-0 bottom-0 w-0.5"
          style={{ left: `${pct}%`, background: 'rgba(255,255,255,0.9)', transform: 'translateX(-50%)', pointerEvents: 'none' }}
        >
          <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full flex items-center justify-center"
            style={{ width: 22, height: 22, background: 'var(--color-white)', color: 'var(--color-bg-darkest)' }}
          >
            <Maximize2 size={12} />
          </div>
        </div>

        <span className="absolute top-1.5 left-2 text-[10px] font-semibold" style={{ color: 'rgba(255,255,255,0.9)', textShadow: '0 1px 4px rgba(0,0,0,0.9)' }}>Before</span>
        <span className="absolute top-1.5 right-2 text-[10px] font-semibold" style={{ color: 'rgba(255,255,255,0.9)', textShadow: '0 1px 4px rgba(0,0,0,0.9)' }}>After</span>
      </div>

      {/* Resolution row */}
      <div className={glassStyles.rowBetween} style={{ padding: '4px 8px 6px' }}>
        <span className={glassStyles.mediaCaption} style={{ padding: 0 }}>{dimLabel(beforeDims)}</span>
        <span className={glassStyles.mediaCaption} style={{ padding: 0 }}>{dimLabel(afterDims)}</span>
      </div>
    </>
  );
}

export function UpscaleNode({ data, selected, id }: NodeProps & { data: UpscaleNodeData }) {
  const [isUpscaling, setIsUpscaling] = useState(false);
  const storeEdges = useFlowStore(state => state.edges);
  const storeNodes = useFlowStore(state => state.nodes);

  // Derive input image directly from connected source node
  const incomingEdge = storeEdges.find(e => e.target === id && e.targetHandle === 'image');
  const sourceNode = incomingEdge ? storeNodes.find(n => n.id === incomingEdge.source) : undefined;
  let inputImageUrl: string | undefined;
  if (sourceNode?.type === 'imageInputNode') {
    inputImageUrl = (sourceNode.data as ImageInputNodeData).imageUrl;
  } else if (sourceNode?.type === 'imageGenNode') {
    inputImageUrl = (sourceNode.data as ImageGenNodeData).generatedImages?.[0];
  } else if (sourceNode?.type === 'upscaleNode') {
    inputImageUrl = (sourceNode.data as UpscaleNodeData).outputImageUrl;
  } else if (sourceNode?.type === 'selectNode') {
    inputImageUrl = (sourceNode.data as SelectNodeData).selectedImageUrl;
  }

  // Scale options per model
  const falModelConfig = FAL_MODELS[data.model as keyof typeof FAL_MODELS] as unknown as { scaleOptions?: number[] } | undefined;
  const scaleOptions: number[] = falModelConfig?.scaleOptions ?? [2, 4];

  // If current scaleFactor is not valid for new model, clamp to max available
  const validScaleFactor = scaleOptions.includes(data.scaleFactor)
    ? data.scaleFactor
    : scaleOptions[scaleOptions.length - 1];
  const inputMetadata = useMediaMetadata(inputImageUrl ? [inputImageUrl] : [], 'image').get(inputImageUrl ?? '');

  function updateData(updates: Partial<UpscaleNodeData>) {
    document.dispatchEvent(new CustomEvent('node:update', {
      detail: { nodeId: id, data: updates },
    }));
  }

  function handleModelChange(model: string) {
    const newFalConfig = FAL_MODELS[model as keyof typeof FAL_MODELS] as unknown as { scaleOptions?: number[] } | undefined;
    const newOptions: number[] = newFalConfig?.scaleOptions ?? [2, 4];
    const clampedScale = newOptions.includes(data.scaleFactor)
      ? data.scaleFactor
      : newOptions[newOptions.length - 1];
    updateData({ model, scaleFactor: clampedScale });
  }

  async function handleUpscale() {
    if (!inputImageUrl || isUpscaling) return;
    setIsUpscaling(true);
    updateData({ status: 'processing' });
    useFlowStore.getState().consumeGcsOnlyEligibility();

    try {
      const res = await fetch('/api/fal/upscale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: data.model,
          imageUrl: inputImageUrl,
          scaleFactor: validScaleFactor,
          sourceType: 'canvas',
          sourceId: useFlowStore.getState().currentFlow?.id,
          nodeId: id,
        }),
      });
      const result = await res.json();

      if (result.mediaUrls?.[0]) {
        updateData({ outputImageUrl: result.mediaUrls[0], status: 'completed', errorMessage: undefined });
        playSuccessSound();
        document.dispatchEvent(new CustomEvent('node:image-propagate', {
          detail: { sourceNodeId: id, imageUrl: result.mediaUrls[0] },
        }));
      } else {
        updateData({ status: 'error', errorMessage: result.details ?? result.error ?? 'Upscale failed — no output returned.' });
      }
    } catch (err) {
      updateData({ status: 'error', errorMessage: err instanceof Error ? err.message : 'Network error — check your connection.' });
    } finally {
      setIsUpscaling(false);
    }
  }

  const footerButtons = (
    <div className={glassStyles.footerStack}>
      <button
        onClick={handleUpscale}
        disabled={isUpscaling || !inputImageUrl}
        className={cn(
          glassStyles.glassSurface,
          glassStyles.button,
          glassStyles.generateButton,
          'transition-opacity disabled:opacity-40 nodrag',
        )}
      >
        <span className={cn(glassStyles.glassContent, glassStyles.buttonContent)}>
          <Image src="/node-icons/icon-generate.svg" alt="" width={11} height={11} aria-hidden />
          {isUpscaling ? 'Upscaling…' : 'Upscale'}
          <FalCostEstimate input={inputImageUrl && inputMetadata && falModelConfig ? {
            endpoint: (falModelConfig as { endpoint: string }).endpoint,
            inputMedia: inputMetadata,
            scaleFactor: validScaleFactor,
          } : null} />
        </span>
      </button>

      {data.outputImageUrl && (
        <div className={glassStyles.footerSecondary}>
          <button
            onClick={() => downloadFromUrl(data.outputImageUrl!)}
            className={cn(
              glassStyles.glassSurface,
              glassStyles.button,
              glassStyles.downloadButton,
              glassStyles.footerAction,
              'nodrag transition-opacity hover:opacity-80 active:opacity-60',
            )}
          >
            <span className={cn(glassStyles.glassContent, glassStyles.buttonContent)}>
              <Download size={12} />
              Download
            </span>
          </button>
          <SendToFigmaButton imageUrl={data.outputImageUrl} style={{ flex: '1 1 0', minWidth: 0 }} />
        </div>
      )}
    </div>
  );

  return (
    <NodeWrapper
      title="Upscale"
      icon={<Zap size={14} />}
      status={data.status}
      errorMessage={data.errorMessage}
      selected={selected}
      minWidth={300}
      accentColor={PORT_COLORS.image}
      titlePosition="outside"
      appearance="imageGenerationGlass"
      footer={footerButtons}
    >
      <TypedHandle
        type="target"
        position={Position.Left}
        id="image"
        portType="image"
        connected={storeEdges.some(e => e.target === id && e.targetHandle === 'image')}
      />

      <ModelSelect options={UPSCALE_MODELS} value={data.model} onChange={handleModelChange} />

      <div className={glassStyles.field}>
        <span className={glassStyles.microLabel}>Scale</span>
        <div className={glassStyles.chipRow}>
          {scaleOptions.map((scale) => (
            <button
              key={scale}
              onClick={() => updateData({ scaleFactor: scale })}
              className={cn(
                glassStyles.glassSurface,
                glassStyles.chip,
                validScaleFactor === scale && glassStyles.chipActive,
                'nodrag',
              )}
            >
              <span className={cn(glassStyles.glassContent, glassStyles.buttonContent)}>{scale}x</span>
            </button>
          ))}
        </div>
      </div>

      {inputImageUrl && data.outputImageUrl ? (
        <div className={glassStyles.mediaFrame}>
          <ComparisonSlider beforeUrl={inputImageUrl} afterUrl={data.outputImageUrl} />
        </div>
      ) : inputImageUrl ? (
        <div className={glassStyles.mediaFrame}>
          <CanvasImage src={inputImageUrl} alt="Input" className="w-full block" style={{ height: 'auto' }} />
        </div>
      ) : (
        <div className={glassStyles.emptyState}>
          Connect an image source
        </div>
      )}

      <TypedHandle
        type="source"
        position={Position.Right}
        id="image"
        portType="image"
        connected={storeEdges.some(e => e.source === id && e.sourceHandle === 'image')}
      />
    </NodeWrapper>
  );
}
