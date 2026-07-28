'use client';

import { Position, type NodeProps } from '@xyflow/react';
import { Zap, Play, Maximize2, Download } from 'lucide-react';
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
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
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
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={beforeUrl}
          alt="Before"
          className="absolute inset-0 w-full h-full block"
          style={{ objectFit: 'cover', clipPath: `inset(0 ${100 - pct}% 0 0)` }}
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
      <div className="flex justify-between px-1 pt-1" style={{ fontSize: 9, color: 'var(--color-white-muted)' }}>
        <span>{dimLabel(beforeDims)}</span>
        <span>{dimLabel(afterDims)}</span>
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
    <>
      <button
        onClick={handleUpscale}
        disabled={isUpscaling || !inputImageUrl}
        className="w-full flex items-center justify-center gap-1.5 py-3 text-xs font-medium transition-opacity disabled:opacity-40 nodrag"
        style={{ background: 'var(--action-btn-bg)', color: 'var(--action-btn-color)', borderRadius: 11 }}
      >
        <Play size={12} />
        {isUpscaling ? 'Upscaling…' : 'Upscale'}
      </button>

      {data.outputImageUrl && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <button
            onClick={() => downloadFromUrl(data.outputImageUrl!)}
            className="flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-medium nodrag transition-opacity hover:opacity-80 active:opacity-60"
            style={{ background: 'var(--color-bg-surface)', color: 'var(--color-white-muted)', borderRadius: 11 }}
          >
            <Download size={12} />
            Download
          </button>
          <SendToFigmaButton imageUrl={data.outputImageUrl} style={{ flex: 1, minWidth: 0 }} />
        </div>
      )}
    </>
  );

  return (
    <NodeWrapper
      title="Upscale"
      icon={<Zap size={14} />}
      status={data.status}
      errorMessage={data.errorMessage}
      selected={selected}
      minWidth={280}
      accentColor={PORT_COLORS.image}
      titlePosition="outside"
      footer={footerButtons}
    >
      <TypedHandle
        type="target"
        position={Position.Left}
        id="image"
        portType="image"
        connected={storeEdges.some(e => e.target === id && e.targetHandle === 'image')}
      />

      <div className="mb-2">
        <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-white-muted)' }}>Model</label>
        <ModelSelect options={UPSCALE_MODELS} value={data.model} onChange={handleModelChange} />
      </div>

      <div className="mb-3">
        <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-white-muted)' }}>Scale</label>
        <div className="flex gap-1.5">
          {scaleOptions.map((scale) => (
            <button
              key={scale}
              onClick={() => updateData({ scaleFactor: scale })}
              className="flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors nodrag"
              style={{
                background: validScaleFactor === scale ? '#fff' : 'var(--color-bg-surface)',
                color: validScaleFactor === scale ? '#000' : 'var(--color-white-muted)',
                border: 'var(--border-default)',
              }}
            >
              {scale}x
            </button>
          ))}
        </div>
      </div>

      {inputImageUrl && data.outputImageUrl ? (
        <div style={{ margin: '0 -18px 12px -18px', overflow: 'hidden' }}>
          <ComparisonSlider beforeUrl={inputImageUrl} afterUrl={data.outputImageUrl} />
        </div>
      ) : inputImageUrl ? (
        <div style={{ margin: '0 -18px 12px -18px', overflow: 'hidden' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={inputImageUrl} alt="Input" className="w-full block" style={{ height: 'auto' }} />
        </div>
      ) : null}

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
