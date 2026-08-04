'use client';

import { Position, type NodeProps } from '@xyflow/react';
import { Image, Upload, X, RefreshCw, Layout, AlertTriangle, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { NodeWrapper } from './NodeWrapper';
import { TypedHandle, PORT_COLORS } from './TypedHandle';
import type { ImageInputNodeData } from '@/types';
import { ACCEPTED_IMAGE_TYPES, MAX_UPLOAD_SIZE_BYTES } from '@/lib/utils/constants';
import { createClient } from '@/lib/supabase/client';
import { processImageFile } from '@/lib/utils/imageProcessing';
import type { ProcessStage } from '@/lib/utils/imageProcessing';
import { uploadImageToStorage } from '@/lib/utils/uploadImage';
import { resolveGcsRefs } from '@/lib/utils/mediaUtils';
import { CanvasImage } from '@/components/canvas/CanvasMedia';
import { useFlowStore } from '@/lib/stores/flowStore';

// ── Stage types ──────────────────────────────────────────────────────────────

type LocalStage = ProcessStage | 'error' | null;

// ── GalleryPicker (unchanged) ─────────────────────────────────────────────────

interface GalleryImage {
  id: string;
  media_url: string;
  prompt: string | null;
  model: string;
}

function GalleryPicker({ onSelect, onClose }: { onSelect: (url: string) => void; onClose: () => void }) {
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const { data } = await supabase
        .from('generations')
        .select('id, media_url, prompt, model')
        .eq('user_id', user.id)
        .eq('status', 'completed')
        .eq('media_type', 'image')
        .order('created_at', { ascending: false })
        .limit(60);
      const rows = data ?? [];
      const gcsMap = await resolveGcsRefs(rows.map((g) => g.media_url));
      const resolved = rows.map((g) =>
        gcsMap.has(g.media_url) ? { ...g, media_url: gcsMap.get(g.media_url)! } : g
      );
      setImages(resolved);
      setLoading(false);
    }
    load();
  }, []);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-6"
      style={{ background: 'rgba(0,0,0,0.75)' }}
      onClick={onClose}
    >
      <div
        className="relative rounded-xl overflow-hidden flex flex-col"
        style={{
          width: 560,
          background: 'var(--color-bg-elevated)',
          border: 'var(--border-default)',
          boxShadow: 'var(--shadow-modal)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: 'var(--border-default)' }}>
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-white-muted)' }}>
            Select from Gallery
          </p>
          <button onClick={onClose} className="p-0.5 rounded hover:opacity-60">
            <X size={14} style={{ color: 'var(--color-white-muted)' }} />
          </button>
        </div>

        {/* Grid — fixed height shows 5 rows of 4, scroll for more */}
        <div className="overflow-y-auto p-3" style={{ maxHeight: 696 }}>
          {loading ? (
            <div className="flex items-center justify-center h-40">
              <RefreshCw size={20} className="animate-spin" style={{ color: 'var(--color-white-muted)' }} />
            </div>
          ) : images.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-2">
              <Image size={28} style={{ color: 'var(--color-white-muted)', opacity: 0.4 }} />
              <p className="text-xs" style={{ color: 'var(--color-white-muted)' }}>No images in gallery yet</p>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {images.map((img) => (
                <button
                  key={img.id}
                  className="rounded-lg overflow-hidden transition-all hover:opacity-90 hover:ring-2 nodrag"
                  style={{ aspectRatio: '1', background: 'var(--color-bg-surface)', '--tw-ring-color': 'var(--color-accent)' } as React.CSSProperties}
                  onClick={() => onSelect(img.media_url)}
                  title={img.prompt ?? img.model}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.media_url} alt={img.prompt ?? ''} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── ProgressBar ───────────────────────────────────────────────────────────────

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div className="w-full mt-2">
      <div
        className="w-full rounded-full overflow-hidden"
        style={{ height: 4, background: 'rgba(255,255,255,0.1)' }}
      >
        <div
          className="h-full rounded-full transition-all duration-300 ease-out"
          style={{ width: `${Math.max(2, percent)}%`, background: 'var(--color-accent)' }}
        />
      </div>
      <p className="text-right text-xs mt-1" style={{ color: 'var(--color-white-muted)', fontSize: 10 }}>
        {percent}%
      </p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ImageInputNode({ data, selected, id }: NodeProps & { data: ImageInputNodeData }) {
  const [localStage, setLocalStage] = useState<LocalStage>(null);
  const [localProgress, setLocalProgress] = useState(0);
  const [localError, setLocalError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [showGallery, setShowGallery] = useState(false);

  const storeEdges = useFlowStore(state => state.edges);

  function dispatchNodeUpdate(updates: Partial<ImageInputNodeData>) {
    document.dispatchEvent(new CustomEvent('node:update', { detail: { nodeId: id, data: updates } }));
  }

  // ── Core upload pipeline ────────────────────────────────────────────────────

  const processAndUpload = useCallback(async (file: File) => {
    // Stash the file so the user can retry on network failures
    setPendingFile(file);
    setLocalError(null);

    const preview = URL.createObjectURL(file);
    setPreviewUrl(preview);

    let processed: File;
    try {
      processed = await processImageFile(file, (stage, percent) => {
        setLocalStage(stage);
        if (stage === 'compressing') setLocalProgress(percent ?? 0);
      });
    } catch (err) {
      URL.revokeObjectURL(preview);
      setPreviewUrl(null);
      setLocalStage('error');
      setLocalError(err instanceof Error ? err.message : 'Failed to process image.');
      return;
    }

    setLocalStage('uploading');

    try {
      const url = await uploadImageToStorage(processed);
      dispatchNodeUpdate({ imageUrl: url });
      document.dispatchEvent(new CustomEvent('node:image-propagate', {
        detail: { sourceNodeId: id, imageUrl: url },
      }));
      setLocalStage(null);
      setLocalError(null);
    } catch (err) {
      setLocalStage('error');
      setLocalError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      URL.revokeObjectURL(preview);
      setPreviewUrl(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // ── Dropzone ────────────────────────────────────────────────────────────────

  const onDrop = useCallback((files: File[]) => {
    const file = files[0];
    if (file) processAndUpload(file);
  }, [processAndUpload]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_IMAGE_TYPES,
    maxSize: MAX_UPLOAD_SIZE_BYTES,
    maxFiles: 1,
  });

  // ── Other actions ───────────────────────────────────────────────────────────

  function clearImage() {
    dispatchNodeUpdate({ imageUrl: undefined, naturalWidth: undefined, naturalHeight: undefined });
    document.dispatchEvent(new CustomEvent('node:image-propagate', {
      detail: { sourceNodeId: id, imageUrl: null },
    }));
  }

  function handleImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const { naturalWidth, naturalHeight } = e.currentTarget;
    dispatchNodeUpdate({ naturalWidth, naturalHeight });
  }

  function handleGallerySelect(url: string) {
    setShowGallery(false);
    dispatchNodeUpdate({ imageUrl: url, naturalWidth: undefined, naturalHeight: undefined });
    document.dispatchEvent(new CustomEvent('node:image-propagate', {
      detail: { sourceNodeId: id, imageUrl: url },
    }));
  }

  async function handleRetry() {
    if (pendingFile) {
      // Local error with a file we can retry
      setLocalStage(null);
      setLocalError(null);
      await processAndUpload(pendingFile);
    } else {
      // External error (canvas drop) — clear and let user upload manually
      dispatchNodeUpdate({ uploadStatus: undefined, uploadError: undefined, uploadProgress: undefined });
    }
  }

  // ── Determine effective display state ───────────────────────────────────────
  // Local state takes precedence over data-driven state from canvas drops.

  const activeStage: LocalStage = localStage ?? (data.uploadStatus as LocalStage ?? null);
  const activeProgress = localStage !== null ? localProgress : (data.uploadProgress ?? 0);
  const activeError =
    localStage === 'error'
      ? localError
      : data.uploadStatus === 'error'
        ? (data.uploadError ?? 'An error occurred.')
        : null;

  const isProcessing = activeStage !== null && activeStage !== 'error';

  const stageLabel: Record<ProcessStage, string> = {
    validating: 'Validating image…',
    compressing: 'Compressing image…',
    uploading: 'Uploading…',
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <NodeWrapper title="Image Input" icon={<Image size={14} />} selected={selected} minWidth={280} accentColor={PORT_COLORS.image} titlePosition="outside">

      {/* ── Processing state ───────────────────────────────────────────── */}
      {isProcessing && (
        <div className="relative overflow-hidden" style={{ margin: '-18px', minHeight: 90 }}>
          {/* Blurred preview background (only for local drops that have a preview) */}
          {previewUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
              style={{ filter: 'blur(8px)', transform: 'scale(1.1)' }}
            />
          )}
          <div
            className="relative flex flex-col items-center justify-center gap-2 p-4"
            style={{
              minHeight: 90,
              background: previewUrl ? 'rgba(0,0,0,0.5)' : 'var(--color-bg-surface)',
            }}
          >
            <RefreshCw
              size={18}
              className="animate-spin"
              style={{ color: 'var(--color-accent)' }}
            />
            <p className="text-xs font-medium text-center" style={{ color: '#fff' }}>
              {stageLabel[activeStage as ProcessStage]}
            </p>
            {activeStage === 'compressing' && (
              <div className="w-full px-2">
                <ProgressBar percent={activeProgress} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Error state ────────────────────────────────────────────────── */}
      {!isProcessing && activeError && (
        <div
          className="flex flex-col items-center gap-3"
          style={{ margin: '-18px', padding: 16, borderRadius: '0 0 17px 17px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderTop: 'none' }}
        >
          <AlertTriangle size={20} style={{ color: '#f87171', flexShrink: 0 }} />
          <p className="text-xs text-center leading-relaxed" style={{ color: '#fca5a5' }}>
            {activeError}
          </p>
          <button
            onClick={handleRetry}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium nodrag transition-opacity hover:opacity-80"
            style={{ background: 'rgba(239,68,68,0.2)', color: '#fca5a5' }}
          >
            <RotateCcw size={11} />
            {pendingFile ? 'Try Again' : 'Dismiss'}
          </button>
        </div>
      )}

      {/* ── Image display ──────────────────────────────────────────────── */}
      {!isProcessing && !activeError && data.imageUrl && (
        <div
          className="relative overflow-hidden"
          style={{
            margin: '-18px',
            backgroundImage:
              'conic-gradient(#3a3a3a 90deg, #2a2a2a 90deg 180deg, #3a3a3a 180deg 270deg, #2a2a2a 270deg)',
            backgroundSize: '14px 14px',
          }}
        >
          <CanvasImage
            src={data.imageUrl}
            alt="Input"
            className="w-full block nodrag"
            style={{ height: 'auto' }}
            onLoad={handleImageLoad}
          />
          <button
            className="absolute top-1 right-1 p-0.5 rounded-full nodrag"
            style={{ background: 'rgba(0,0,0,0.6)' }}
            onClick={clearImage}
          >
            <X size={12} style={{ color: 'var(--color-white)' }} />
          </button>
        </div>
      )}

      {/* ── Empty / upload zone ────────────────────────────────────────── */}
      {!isProcessing && !activeError && !data.imageUrl && (
        <>
          <div
            {...getRootProps()}
            className="flex flex-col items-center justify-center gap-2 rounded-lg cursor-pointer transition-colors nodrag"
            style={{
              height: 90,
              border: isDragActive
                ? '1.5px dashed var(--color-accent)'
                : '1.5px dashed rgba(255,255,255,0.2)',
              background: isDragActive ? 'var(--color-accent-glow)' : 'transparent',
            }}
          >
            <input {...getInputProps()} />
            <Upload size={18} style={{ color: 'var(--color-white-muted)' }} />
            <p className="text-xs text-center" style={{ color: 'var(--color-white-muted)' }}>
              {isDragActive ? 'Drop image here' : 'Drop or click to upload'}
            </p>
          </div>

          <button
            onClick={() => setShowGallery(true)}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium mt-2 transition-opacity hover:opacity-80 nodrag"
            style={{
              background: 'var(--color-bg-surface)',
              border: 'var(--border-default)',
              color: 'var(--color-white-muted)',
            }}
          >
            <Layout size={12} />
            Browse Gallery
          </button>
        </>
      )}

      <TypedHandle
        type="source"
        position={Position.Right}
        id="image"
        portType="image"
        connected={storeEdges.some(e => e.source === id && e.sourceHandle === 'image')}
      />

      {showGallery && (
        <GalleryPicker onSelect={handleGallerySelect} onClose={() => setShowGallery(false)} />
      )}
    </NodeWrapper>
  );
}
