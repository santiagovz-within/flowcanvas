'use client';

import { Position, type NodeProps } from '@xyflow/react';
import { Zap, Play, Maximize2, Download, Film, X, RefreshCw, Check, AlertCircle } from 'lucide-react';
import { SendToFigmaButton } from './SendToFigmaButton';
import { downloadFromUrl } from '@/lib/utils/download';
import { playSuccessSound } from '@/lib/utils/sound';
import { useEffect, useRef, useState } from 'react';
import { NodeWrapper } from './NodeWrapper';
import { TypedHandle, PORT_COLORS } from './TypedHandle';
import type {
  UpscaleMediaNodeData, BulkItemResult,
} from '@/types';
import { UPSCALE_MODELS, FAL_MODELS } from '@/lib/api/models';
import { ModelSelect } from './ModelSelect';
import { useFlowStore } from '@/lib/stores/flowStore';
import { getNodeMediaUrls, getSourceMediaType } from '../mediaOutputs';
import { CanvasImage, CanvasVideo } from '@/components/canvas/CanvasMedia';

type Dims = { w: number; h: number };

const VIDEO_SCALE_OPTIONS = [2, 3, 4];
const VIDEO_FPS_OPTIONS: Array<{ label: string; value: number | null }> = [
  { label: 'Off', value: null },
  { label: '24', value: 24 },
  { label: '30', value: 30 },
  { label: '60', value: 60 },
];

const IMAGE_CONCURRENCY = 6;
const VIDEO_CONCURRENCY = 2;
const IMAGE_CAP = 30;
const VIDEO_CAP = 10;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Comparison slider ─────────────────────────────────────────────────────────

function ComparisonSlider({ beforeUrl, afterUrl }: { beforeUrl: string; afterUrl: string }) {
  const [pct, setPct] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [beforeDims, setBeforeDims] = useState<Dims | null>(null);
  const [afterDims,  setAfterDims]  = useState<Dims | null>(null);

  const move = useRef((clientX: number) => {
    if (!containerRef.current) return;
    const { left, width } = containerRef.current.getBoundingClientRect();
    setPct(Math.max(0, Math.min(100, ((clientX - left) / width) * 100)));
  });

  useEffect(() => {
    const onMove = (e: MouseEvent) => { if (dragging.current) move.current(e.clientX); };
    const onUp   = () => { dragging.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
    };
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
        <CanvasImage
          src={afterUrl} alt="After" className="w-full block" style={{ height: 'auto' }}
          onLoad={(e) => { const img = e.currentTarget; setAfterDims({ w: img.naturalWidth, h: img.naturalHeight }); }}
        />
        <CanvasImage
          src={beforeUrl} alt="Before"
          className="absolute inset-0 w-full h-full block"
          fill
          style={{ position: 'absolute', inset: 0, objectFit: 'cover', clipPath: `inset(0 ${100 - pct}% 0 0)` }}
          onLoad={(e) => { const img = e.currentTarget; setBeforeDims({ w: img.naturalWidth, h: img.naturalHeight }); }}
        />
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
      <div className="flex justify-between px-1 pt-1" style={{ fontSize: 9, color: 'var(--color-white-muted)' }}>
        <span>{dimLabel(beforeDims)}</span>
        <span>{dimLabel(afterDims)}</span>
      </div>
    </>
  );
}

// ── Item status dot ───────────────────────────────────────────────────────────

function StatusDot({ status }: { status: BulkItemResult['status'] }) {
  if (status !== 'completed' && status !== 'failed') return null;
  const styles: Record<string, { bg: string; content: React.ReactNode }> = {
    completed: { bg: 'var(--color-success)', content: <Check size={8} color="#fff" /> },
    failed:    { bg: 'var(--color-error)',   content: <AlertCircle size={8} color="#fff" /> },
  };
  const s = styles[status];
  if (!s) return null;
  return (
    <div
      className="absolute bottom-1 right-1 rounded-full flex items-center justify-center"
      style={{ width: 14, height: 14, background: s.bg }}
    >
      {s.content}
    </div>
  );
}

// ── Thumbnail (input item) ────────────────────────────────────────────────────

function ImageThumb({ url, result }: { url: string | undefined; result: BulkItemResult | undefined }) {
  return (
    <div className="relative flex-shrink-0 rounded overflow-hidden nodrag" style={{ width: 56, height: 56 }}>
      {url ? (
        <CanvasImage src={url} alt="" focused={false} fill className="w-full h-full" style={{ objectFit: 'cover' }} />
      ) : (
        <div className="w-full h-full flex items-center justify-center" style={{ background: 'var(--color-bg-surface)' }}>
          <Zap size={14} style={{ opacity: 0.4 }} />
        </div>
      )}
      {result && <StatusDot status={result.status} />}
    </div>
  );
}

function VideoThumb({
  url, result, onClick,
}: { url: string | undefined; result: BulkItemResult | undefined; onClick: () => void }) {
  return (
    <div
      className="relative flex-shrink-0 rounded overflow-hidden nodrag cursor-pointer"
      style={{ width: 56, height: 56 }}
      onClick={onClick}
    >
      {url ? (
        <CanvasVideo
          src={url}
          focused={false}
          muted
          fill
          className="w-full h-full"
          style={{ objectFit: 'cover', pointerEvents: 'none' }}
        />
      ) : (
        <div className="w-full h-full" style={{ background: 'var(--color-bg-surface)' }} />
      )}
      {/* Film icon overlay */}
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{ background: 'rgba(0,0,0,0.35)' }}
      >
        <Film size={14} color="rgba(255,255,255,0.85)" />
      </div>
      {result && <StatusDot status={result.status} />}
    </div>
  );
}

// ── Result card ───────────────────────────────────────────────────────────────

function ImageResultCard({ result, onRetry }: { result: BulkItemResult; onRetry: () => void }) {
  return (
    <div className="relative rounded overflow-hidden" style={{ aspectRatio: '1', background: 'var(--color-bg-surface)' }}>
      {result.status === 'completed' && result.outputUrl ? (
        <>
          <CanvasImage src={result.outputUrl} alt="" focused={false} fill className="w-full h-full" style={{ objectFit: 'cover' }} />
          <button
            onClick={() => downloadFromUrl(result.outputUrl!)}
            className="absolute bottom-1 right-1 nodrag"
            style={{
              width: 20, height: 20, borderRadius: 6,
              background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Download size={10} color="#fff" />
          </button>
        </>
      ) : result.status === 'failed' ? (
        <div className="w-full h-full flex flex-col items-center justify-center gap-1 p-1">
          <AlertCircle size={14} style={{ color: 'var(--color-error)', flexShrink: 0 }} />
          <button
            onClick={onRetry}
            className="nodrag flex items-center gap-0.5 text-[9px] font-medium px-1.5 py-0.5 rounded"
            style={{ background: 'var(--color-bg-surface-elevated)', color: 'var(--color-white-muted)' }}
          >
            <RefreshCw size={8} />
            Retry
          </button>
        </div>
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <RefreshCw size={16} className="animate-spin" style={{ color: PORT_COLORS.image }} />
        </div>
      )}
    </div>
  );
}

function VideoResultCard({
  result, onRetry, onExpand,
}: { result: BulkItemResult; onRetry: () => void; onExpand: () => void }) {
  return (
    <div className="relative rounded overflow-hidden" style={{ aspectRatio: '1', background: 'var(--color-bg-surface)' }}>
      {result.status === 'completed' && result.outputUrl ? (
        <>
          <div className="w-full h-full cursor-pointer" onClick={onExpand}>
            <CanvasVideo
              src={result.outputUrl}
              focused={false}
              muted
              fill
              className="w-full h-full"
              style={{ objectFit: 'cover', pointerEvents: 'none' }}
            />
            <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.3)' }}>
              <Film size={14} color="rgba(255,255,255,0.85)" />
            </div>
          </div>
          <button
            onClick={() => downloadFromUrl(result.outputUrl!)}
            className="absolute bottom-1 right-1 nodrag"
            style={{
              width: 20, height: 20, borderRadius: 6,
              background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Download size={10} color="#fff" />
          </button>
        </>
      ) : result.status === 'failed' ? (
        <div className="w-full h-full flex flex-col items-center justify-center gap-1 p-1">
          <AlertCircle size={14} style={{ color: 'var(--color-error)', flexShrink: 0 }} />
          <button
            onClick={onRetry}
            className="nodrag flex items-center gap-0.5 text-[9px] font-medium px-1.5 py-0.5 rounded"
            style={{ background: 'var(--color-bg-surface-elevated)', color: 'var(--color-white-muted)' }}
          >
            <RefreshCw size={8} />
            Retry
          </button>
        </div>
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <RefreshCw size={16} className="animate-spin" style={{ color: PORT_COLORS.video }} />
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function UpscaleMediaNode({ data, selected, id }: NodeProps & { data: UpscaleMediaNodeData }) {
  const [isRunning,     setIsRunning]     = useState(false);
  const [doneCount,     setDoneCount]     = useState(0);
  const [expandedUrl,   setExpandedUrl]   = useState<string | null>(null);

  const bulkResultsRef = useRef<BulkItemResult[]>(data.bulkResults ?? []);

  const storeEdges = useFlowStore((state) => state.edges);
  const storeNodes = useFlowStore((state) => state.nodes);

  // ── Derive all inputs from connected edges ──────────────────────────────────

  const incomingEdges = storeEdges.filter((e) => e.target === id && e.targetHandle === 'media');

  const firstIncomingEdge = incomingEdges[0];
  const firstSourceNode = firstIncomingEdge
    ? storeNodes.find((node) => node.id === firstIncomingEdge.source)
    : undefined;
  const inputMediaType = getSourceMediaType(firstSourceNode, firstIncomingEdge?.sourceHandle);

  const inputItems = incomingEdges.map((edge) => {
    const sourceNode = storeNodes.find((n) => n.id === edge.source);
    const url = sourceNode && inputMediaType
      ? getNodeMediaUrls(sourceNode, inputMediaType)[0]
      : undefined;
    return { url, sourceNodeId: edge.source };
  });

  // Single-item paths use the first item's URL directly.
  const isBulk     = incomingEdges.length > 1;
  const itemCount  = incomingEdges.length;
  const cap        = inputMediaType === 'video' ? VIDEO_CAP : IMAGE_CAP;

  const inputImageUrl = !isBulk && inputMediaType === 'image' ? inputItems[0]?.url : undefined;
  const inputVideoUrl = !isBulk && inputMediaType === 'video' ? inputItems[0]?.url : undefined;

  // ── Clear stale output when media type switches ─────────────────────────────

  const prevInputMediaTypeRef = useRef<'image' | 'video' | null>(null);

  useEffect(() => {
    const prev = prevInputMediaTypeRef.current;
    if (prev !== null && prev !== inputMediaType) {
      const oldHandle = prev === 'image' ? 'image' : 'video';
      document.dispatchEvent(new CustomEvent('node:remove-source-edges', {
        detail: { nodeId: id, handleId: oldHandle },
      }));
      document.dispatchEvent(new CustomEvent('node:update', {
        detail: {
          nodeId: id,
          data: prev === 'image'
            ? { outputImageUrl: undefined, status: 'idle', bulkResults: undefined }
            : { outputVideoUrl: undefined, status: 'idle', bulkResults: undefined },
        },
      }));
      bulkResultsRef.current = [];
    }
    prevInputMediaTypeRef.current = inputMediaType;
  }, [inputMediaType, id]);

  // ── Image upscale settings ──────────────────────────────────────────────────

  const falModelConfig  = FAL_MODELS[data.model as keyof typeof FAL_MODELS] as unknown as { scaleOptions?: number[] } | undefined;
  const scaleOptions: number[] = falModelConfig?.scaleOptions ?? [2, 4];
  const validScaleFactor = scaleOptions.includes(data.scaleFactor) ? data.scaleFactor : scaleOptions[scaleOptions.length - 1];

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function dispatchUpdate(updates: Partial<UpscaleMediaNodeData>) {
    document.dispatchEvent(new CustomEvent('node:update', { detail: { nodeId: id, data: updates } }));
  }

  function handleModelChange(model: string) {
    const cfg  = FAL_MODELS[model as keyof typeof FAL_MODELS] as unknown as { scaleOptions?: number[] } | undefined;
    const opts: number[] = cfg?.scaleOptions ?? [2, 4];
    const clampedScale = opts.includes(data.scaleFactor) ? data.scaleFactor : opts[opts.length - 1];
    dispatchUpdate({ model, scaleFactor: clampedScale });
  }

  function updateBulkItem(index: number, patch: Partial<BulkItemResult>) {
    bulkResultsRef.current = bulkResultsRef.current.map((r, i) =>
      i === index ? { ...r, ...patch } : r
    );
    dispatchUpdate({ bulkResults: [...bulkResultsRef.current] });
  }

  // ── Single-item image upscale (unchanged from before) ──────────────────────

  async function handleUpscaleImage() {
    if (!inputImageUrl || isRunning) return;
    setIsRunning(true);
    dispatchUpdate({ status: 'processing' });
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
        dispatchUpdate({ outputImageUrl: result.mediaUrls[0], status: 'completed', errorMessage: undefined });
        playSuccessSound();
        document.dispatchEvent(new CustomEvent('node:image-propagate', {
          detail: { sourceNodeId: id, imageUrl: result.mediaUrls[0] },
        }));
      } else {
        dispatchUpdate({ status: 'error', errorMessage: result.details ?? result.error ?? 'Upscale failed — no output returned.' });
      }
    } catch (err) {
      dispatchUpdate({ status: 'error', errorMessage: err instanceof Error ? err.message : 'Network error — check your connection.' });
    } finally {
      setIsRunning(false);
    }
  }

  // ── Single-item video upscale (unchanged from before) ──────────────────────

  async function handleUpscaleVideo() {
    if (!inputVideoUrl || isRunning) return;
    setIsRunning(true);
    dispatchUpdate({ status: 'processing' });
    useFlowStore.getState().consumeGcsOnlyEligibility();

    try {
      const res = await fetch('/api/fal/video-upscale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUrl: inputVideoUrl,
          upscaleFactor: data.upscaleFactor ?? 2,
          targetFps: data.targetFps ?? null,
          h264Output: data.h264Output ?? false,
          sourceId: useFlowStore.getState().currentFlow?.id,
          nodeId: id,
        }),
      });
      const result = await res.json();
      if (result.mediaUrls?.[0]) {
        dispatchUpdate({ outputVideoUrl: result.mediaUrls[0], status: 'completed', errorMessage: undefined });
        playSuccessSound();
        document.dispatchEvent(new CustomEvent('node:video-propagate', {
          detail: { sourceNodeId: id, videoUrl: result.mediaUrls[0] },
        }));
        setIsRunning(false);
      } else if (result.requestId) {
        pollVideo(result.requestId);
      } else {
        dispatchUpdate({ status: 'error', errorMessage: result.details ?? result.error ?? 'Video upscale failed — no output returned.' });
        setIsRunning(false);
      }
    } catch (err) {
      dispatchUpdate({ status: 'error', errorMessage: err instanceof Error ? err.message : 'Network error — check your connection.' });
      setIsRunning(false);
    }
  }

  function pollVideo(requestId: string) {
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      if (attempts > 120) {
        clearInterval(interval);
        dispatchUpdate({ status: 'error', errorMessage: 'Video upscale timed out. The job may still be running — try restarting.' });
        setIsRunning(false);
        return;
      }
      try {
        const res = await fetch(`/api/fal/video-upscale/status/${requestId}`);
        const result = await res.json();
        if (result.status === 'completed' && result.mediaUrls?.[0]) {
          clearInterval(interval);
          dispatchUpdate({ outputVideoUrl: result.mediaUrls[0], status: 'completed', errorMessage: undefined });
          playSuccessSound();
          document.dispatchEvent(new CustomEvent('node:video-propagate', {
            detail: { sourceNodeId: id, videoUrl: result.mediaUrls[0] },
          }));
          setIsRunning(false);
        } else if (result.status === 'failed') {
          clearInterval(interval);
          dispatchUpdate({ status: 'error', errorMessage: result.error ?? 'Video upscale failed on the server.' });
          setIsRunning(false);
        }
      } catch { /* keep polling */ }
    }, 5000);
  }

  // ── Bulk: shared helpers ────────────────────────────────────────────────────

  async function processImageItem(url: string, index: number): Promise<void> {
    updateBulkItem(index, { status: 'processing' });
    useFlowStore.getState().consumeGcsOnlyEligibility();
    try {
      const res = await fetch('/api/fal/upscale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: data.model,
          imageUrl: url,
          scaleFactor: validScaleFactor,
          sourceType: 'canvas',
          sourceId: useFlowStore.getState().currentFlow?.id,
          nodeId: id,
        }),
      });
      const result = await res.json();
      if (result.mediaUrls?.[0]) {
        updateBulkItem(index, { status: 'completed', outputUrl: result.mediaUrls[0] });
      } else {
        updateBulkItem(index, { status: 'failed', errorMessage: result.details ?? result.error ?? 'Upscale failed.' });
      }
    } catch (err) {
      updateBulkItem(index, { status: 'failed', errorMessage: err instanceof Error ? err.message : 'Network error.' });
    }
  }

  async function processVideoItem(url: string, index: number): Promise<void> {
    updateBulkItem(index, { status: 'processing' });
    useFlowStore.getState().consumeGcsOnlyEligibility();
    try {
      const submitRes = await fetch('/api/fal/video-upscale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUrl: url,
          upscaleFactor: data.upscaleFactor ?? 2,
          targetFps: data.targetFps ?? null,
          h264Output: data.h264Output ?? false,
          sourceId: useFlowStore.getState().currentFlow?.id,
          nodeId: id,
        }),
      });
      const submitResult = await submitRes.json();

      if (submitResult.mediaUrls?.[0]) {
        // Synchronous result (unlikely for video but handle it)
        updateBulkItem(index, { status: 'completed', outputUrl: submitResult.mediaUrls[0] });
        return;
      }

      if (!submitResult.requestId) {
        updateBulkItem(index, { status: 'failed', errorMessage: submitResult.details ?? submitResult.error ?? 'Submit failed.' });
        return;
      }

      const requestId = submitResult.requestId as string;

      // Poll until done or timed out
      for (let attempt = 0; attempt < 120; attempt++) {
        await delay(5000);
        try {
          const statusRes = await fetch(`/api/fal/video-upscale/status/${requestId}`);
          const statusResult = await statusRes.json();
          if (statusResult.status === 'completed' && statusResult.mediaUrls?.[0]) {
            updateBulkItem(index, { status: 'completed', outputUrl: statusResult.mediaUrls[0] });
            return;
          }
          if (statusResult.status === 'failed') {
            updateBulkItem(index, { status: 'failed', errorMessage: statusResult.error ?? 'Video upscale failed.' });
            return;
          }
        } catch { /* keep polling */ }
      }

      updateBulkItem(index, { status: 'failed', errorMessage: 'Video upscale timed out.' });
    } catch (err) {
      updateBulkItem(index, { status: 'failed', errorMessage: err instanceof Error ? err.message : 'Network error.' });
    }
  }

  // ── Bulk: run batch ─────────────────────────────────────────────────────────

  async function handleBulkUpscale() {
    if (isRunning) return;
    const items = inputItems.filter((item) => item.url);
    if (items.length === 0) return;

    const n = items.length;

    // Initialise per-item state and reset results from previous batch
    const initialResults: BulkItemResult[] = items.map((item) => ({
      inputUrl: item.url!,
      status: 'queued',
    }));
    bulkResultsRef.current = initialResults;
    dispatchUpdate({ bulkResults: [...initialResults], status: 'processing', errorMessage: undefined });
    setIsRunning(true);
    setDoneCount(0);

    const concurrency = inputMediaType === 'video' ? VIDEO_CONCURRENCY : IMAGE_CONCURRENCY;
    let nextIndex = 0;

    async function runWorker() {
      while (nextIndex < n) {
        const i = nextIndex++;
        const url = items[i].url!;
        if (inputMediaType === 'image') {
          await processImageItem(url, i);
        } else {
          await processVideoItem(url, i);
        }
        setDoneCount((c) => c + 1);
      }
    }

    await Promise.all(Array.from({ length: concurrency }, runWorker));

    // Determine overall status
    const results = bulkResultsRef.current;
    const anyCompleted = results.some((r) => r.status === 'completed');
    dispatchUpdate({ status: anyCompleted ? 'completed' : 'error' });

    if (anyCompleted) playSuccessSound();
    setIsRunning(false);
    setDoneCount(0);
  }

  // ── Bulk: retry individual failed item ──────────────────────────────────────

  async function retryItem(index: number) {
    if (isRunning) return;
    const result = data.bulkResults?.[index];
    if (!result || result.status !== 'failed') return;

    // Re-sync the ref from persisted data before making changes
    bulkResultsRef.current = [...(data.bulkResults ?? [])];

    setIsRunning(true);
    const url = result.inputUrl;
    if (inputMediaType === 'image') {
      await processImageItem(url, index);
    } else {
      await processVideoItem(url, index);
    }

    // Re-evaluate overall status
    const anyCompleted = bulkResultsRef.current.some((r) => r.status === 'completed');
    const allDone = bulkResultsRef.current.every((r) => r.status === 'completed' || r.status === 'failed');
    if (allDone) {
      dispatchUpdate({ status: anyCompleted ? 'completed' : 'error' });
      if (anyCompleted) playSuccessSound();
    }
    setIsRunning(false);
  }

  // ── Derived display values ──────────────────────────────────────────────────

  const inputPortType  = inputMediaType === 'video' ? 'video' : inputMediaType === 'image' ? 'image' : 'neutral';
  const outputPortType = inputMediaType === 'video' ? 'video' : inputMediaType === 'image' ? 'image' : 'neutral';
  const outputHandleId = inputMediaType === 'video' ? 'video' : inputMediaType === 'image' ? 'image' : 'media';
  const accentColor    = inputMediaType === 'video' ? PORT_COLORS.video : inputMediaType === 'image' ? PORT_COLORS.image : PORT_COLORS.neutral;

  const upscaleFactor  = data.upscaleFactor ?? 2;
  const hasImageOutput = !isBulk && inputMediaType === 'image' && !!data.outputImageUrl;
  const hasVideoOutput = !isBulk && inputMediaType === 'video' && !!data.outputVideoUrl;

  // Progress label while bulk running
  const bulkDoneCount = isRunning ? doneCount : (data.bulkResults?.filter((r) => r.status === 'completed' || r.status === 'failed').length ?? 0);

  // ── Footer ──────────────────────────────────────────────────────────────────

  const footer = (
    <div className="flex flex-col gap-1.5">
      {/* ── Single image ── */}
      {!isBulk && inputMediaType === 'image' && (
        <>
          <button
            onClick={handleUpscaleImage}
            disabled={isRunning || !inputImageUrl}
            className="w-full flex items-center justify-center gap-1.5 py-3 text-xs font-medium transition-opacity disabled:opacity-40 nodrag"
            style={{ background: 'var(--action-btn-bg)', color: 'var(--action-btn-color)', borderRadius: 11 }}
          >
            <Play size={12} />
            {isRunning ? 'Upscaling…' : 'Upscale'}
          </button>
          {hasImageOutput && (
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
      )}

      {/* ── Single video ── */}
      {!isBulk && inputMediaType === 'video' && (
        <>
          <button
            onClick={handleUpscaleVideo}
            disabled={isRunning || !inputVideoUrl}
            className="w-full flex items-center justify-center gap-1.5 py-3 text-xs font-medium transition-opacity disabled:opacity-40 nodrag"
            style={{ background: 'var(--action-btn-bg)', color: 'var(--action-btn-color)', borderRadius: 11 }}
          >
            <Play size={12} />
            {isRunning ? 'Upscaling…' : 'Upscale Video'}
          </button>
          {hasVideoOutput && (
            <button
              onClick={() => downloadFromUrl(data.outputVideoUrl!)}
              className="w-full flex items-center justify-center gap-1.5 py-3 text-xs font-medium nodrag transition-opacity hover:opacity-80 active:opacity-60"
              style={{ background: 'var(--color-bg-surface)', color: 'var(--color-white-muted)', borderRadius: 11 }}
            >
              <Download size={12} />
              Download
            </button>
          )}
        </>
      )}

      {/* ── Bulk run ── */}
      {isBulk && inputMediaType !== null && (
        <button
          onClick={handleBulkUpscale}
          disabled={isRunning || inputItems.every((i) => !i.url)}
          className="w-full flex items-center justify-center gap-1.5 py-3 text-xs font-medium transition-opacity disabled:opacity-40 nodrag"
          style={{ background: 'var(--action-btn-bg)', color: 'var(--action-btn-color)', borderRadius: 11 }}
        >
          <Play size={12} />
          {isRunning
            ? `Upscaling ${bulkDoneCount + 1} of ${itemCount}…`
            : `Upscale all ${itemCount}`}
        </button>
      )}

      {/* ── No input ── */}
      {inputMediaType === null && (
        <button
          disabled
          className="w-full flex items-center justify-center gap-1.5 py-3 text-xs font-medium transition-opacity disabled:opacity-40 nodrag"
          style={{ background: 'var(--action-btn-bg)', color: 'var(--action-btn-color)', borderRadius: 11 }}
        >
          <Play size={12} />
          Upscale
        </button>
      )}
    </div>
  );

  // ── Results grid (bulk) ─────────────────────────────────────────────────────

  const bulkResults = data.bulkResults;
  const hasBulkResults = isBulk && bulkResults && bulkResults.length > 0 &&
    bulkResults.some((r) => r.status === 'completed' || r.status === 'failed' || r.status === 'processing');

  const resultsGrid = hasBulkResults ? (
    <div className="mt-3">
      <p className="text-[10px] mb-2 font-medium" style={{ color: 'var(--color-white-muted)' }}>
        Results — {bulkResults!.filter((r) => r.status === 'completed').length} of {bulkResults!.length} done
      </p>
      <div className="grid gap-1.5 nodrag" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))' }}>
        {bulkResults!.map((result, i) =>
          inputMediaType === 'image' ? (
            <ImageResultCard
              key={i}
              result={result}
              onRetry={() => retryItem(i)}
            />
          ) : (
            <VideoResultCard
              key={i}
              result={result}
              onRetry={() => retryItem(i)}
              onExpand={() => result.outputUrl && setExpandedUrl(result.outputUrl)}
            />
          )
        )}
      </div>
    </div>
  ) : null;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <NodeWrapper
      title="Upscale Media"
      icon={<Zap size={14} />}
      status={data.status}
      errorMessage={data.errorMessage}
      selected={selected}
      minWidth={560}
      preserveWidth
      accentColor={accentColor}
      titlePosition="outside"
      footer={footer}
    >
      <TypedHandle
        type="target"
        position={Position.Left}
        id="media"
        portType={inputPortType}
        connected={incomingEdges.length > 0}
      />

      {/* ── No input ── */}
      {inputMediaType === null && (
        <div
          className="flex items-center justify-center rounded-lg mb-3"
          style={{ height: 52, background: 'var(--color-bg-surface)', border: '1px dashed rgba(255,255,255,0.12)', color: 'var(--color-white-muted)', fontSize: 12 }}
        >
          Connect an image or video to upscale
        </div>
      )}

      {/* ── Image settings ── */}
      {inputMediaType === 'image' && (
        <>
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
                  onClick={() => dispatchUpdate({ scaleFactor: scale })}
                  className="flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors nodrag"
                  style={{
                    background: validScaleFactor === scale ? '#fff' : 'var(--color-bg-surface)',
                    color:      validScaleFactor === scale ? '#000' : 'var(--color-white-muted)',
                    border: 'var(--border-default)',
                  }}
                >
                  {scale}x
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── Video settings ── */}
      {inputMediaType === 'video' && (
        <>
          <div className="mb-3">
            <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-white-muted)' }}>Scale Factor</label>
            <div className="flex gap-1.5">
              {VIDEO_SCALE_OPTIONS.map((scale) => (
                <button
                  key={scale}
                  onClick={() => dispatchUpdate({ upscaleFactor: scale })}
                  className="flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors nodrag"
                  style={{
                    background: upscaleFactor === scale ? '#fff' : 'var(--color-bg-surface)',
                    color:      upscaleFactor === scale ? '#000' : 'var(--color-white-muted)',
                    border: 'var(--border-default)',
                  }}
                >
                  {scale}x
                </button>
              ))}
            </div>
          </div>

          <div className="mb-3">
            <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-white-muted)' }}>Target FPS</label>
            <div className="flex gap-1.5">
              {VIDEO_FPS_OPTIONS.map(({ label, value }) => {
                const isSelected = (data.targetFps ?? null) === value;
                return (
                  <button
                    key={label}
                    onClick={() => dispatchUpdate({ targetFps: value ?? undefined })}
                    className="flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors nodrag"
                    style={{
                      background: isSelected ? '#fff' : 'var(--color-bg-surface)',
                      color:      isSelected ? '#000' : 'var(--color-white-muted)',
                      border: 'var(--border-default)',
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between mb-3 nodrag">
            <label className="text-xs font-medium" style={{ color: 'var(--color-white-muted)' }}>H264 Output</label>
            <button
              onClick={() => dispatchUpdate({ h264Output: !(data.h264Output ?? false) })}
              className="nodrag transition-colors"
              style={{
                width: 36, height: 20, borderRadius: 10,
                background: data.h264Output ? '#fff' : 'var(--color-bg-surface)',
                border: 'var(--border-default)',
                position: 'relative', flexShrink: 0, padding: 0,
              }}
            >
              <span
                style={{
                  position: 'absolute', top: 2,
                  left: data.h264Output ? 18 : 2,
                  width: 16, height: 16, borderRadius: '50%',
                  background: data.h264Output ? '#000' : 'var(--color-white-muted)',
                  transition: 'left 0.15s',
                }}
              />
            </button>
          </div>
        </>
      )}

      {/* ── Bulk: count + note + thumbnail strip ── */}
      {isBulk && inputMediaType !== null && (
        <>
          {/* Count + note */}
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-medium" style={{ color: 'var(--color-white-muted)' }}>
              {itemCount} / {cap} {inputMediaType === 'video' ? 'videos' : 'images'}
            </span>
            <span className="text-[10px]" style={{ color: 'var(--color-white-muted)', opacity: 0.6 }}>
              Settings apply to all
            </span>
          </div>

          {/* Thumbnail strip */}
          <div
            className="flex gap-1.5 mb-3 nodrag"
            style={{ overflowX: 'auto', paddingBottom: 2 }}
          >
            {inputItems.map((item, i) => {
              const result = data.bulkResults?.[i];
              return inputMediaType === 'image' ? (
                <ImageThumb key={i} url={item.url} result={result} />
              ) : (
                <VideoThumb
                  key={i}
                  url={item.url}
                  result={result}
                  onClick={() => item.url && setExpandedUrl(item.url)}
                />
              );
            })}
          </div>
        </>
      )}

      {/* ── Single image: preview ── */}
      {!isBulk && inputMediaType === 'image' && (
        inputImageUrl && data.outputImageUrl ? (
          <div style={{ borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)', overflow: 'hidden' }}>
            <ComparisonSlider beforeUrl={inputImageUrl} afterUrl={data.outputImageUrl} />
          </div>
        ) : inputImageUrl ? (
          <div style={{ borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)', overflow: 'hidden' }}>
            <CanvasImage src={inputImageUrl} alt="Input" className="w-full block" style={{ height: 'auto' }} />
          </div>
        ) : null
      )}

      {/* ── Single video: previews ── */}
      {!isBulk && inputMediaType === 'video' && (
        <div className="flex flex-col gap-3">
          {inputVideoUrl && (
            <div style={{ borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)', overflow: 'hidden' }}>
              <CanvasVideo src={inputVideoUrl} controls className="w-full block nodrag" style={{ height: 'auto' }} />
              <p className="px-3 pt-1 text-center" style={{ fontSize: 9, color: 'var(--color-white-muted)' }}>Input</p>
            </div>
          )}
          {hasVideoOutput && (
            <div style={{ borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)', overflow: 'hidden' }}>
              <CanvasVideo src={data.outputVideoUrl!} controls className="w-full block nodrag" style={{ height: 'auto' }} />
              <p className="px-3 pt-1 text-center" style={{ fontSize: 9, color: 'var(--color-white-muted)' }}>Output ({upscaleFactor}x)</p>
            </div>
          )}
        </div>
      )}

      {/* ── Bulk results grid ── */}
      {resultsGrid}

      {/* ── Expanded video overlay ── */}
      {expandedUrl && (
        <div className="mt-3 relative" style={{ borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)', overflow: 'hidden' }}>
          <button
            onClick={() => setExpandedUrl(null)}
            className="absolute top-1.5 right-1.5 z-10 nodrag flex items-center justify-center rounded-full"
            style={{ width: 22, height: 22, background: 'rgba(0,0,0,0.6)', flexShrink: 0 }}
          >
            <X size={12} color="#fff" />
          </button>
          <CanvasVideo src={expandedUrl} focused controls className="w-full block nodrag" style={{ height: 'auto' }} />
        </div>
      )}

      <TypedHandle
        type="source"
        position={Position.Right}
        id={outputHandleId}
        portType={outputPortType}
        connected={storeEdges.some((e) => e.source === id && e.sourceHandle === outputHandleId)}
      />
    </NodeWrapper>
  );
}
