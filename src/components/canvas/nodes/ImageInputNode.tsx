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
import { cn } from '@/lib/utils/cn';
import glassStyles from './ImageGenerationGlass.module.css';

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
    <div className={glassStyles.sliderRow}>
      <div className={glassStyles.progressTrack}>
        <div
          className={glassStyles.progressFill}
          style={{ width: `${Math.max(2, percent)}%`, background: 'var(--color-accent)' }}
        />
      </div>
      <span className={glassStyles.helperText} style={{ textAlign: 'right' }}>{percent}%</span>
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
    <NodeWrapper
      title="Image Input"
      icon={<Image size={14} />}
      selected={selected}
      minWidth={300}
      accentColor={PORT_COLORS.image}
      titlePosition="outside"
      appearance="imageGenerationGlass"
    >
      {/* ── Processing state ───────────────────────────────────────────── */}
      {isProcessing && (
        <div className={glassStyles.mediaFrame}>
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
            style={{ minHeight: 96, background: previewUrl ? 'rgba(0,0,0,0.5)' : 'transparent' }}
          >
            <RefreshCw
              size={18}
              className="animate-spin"
              style={{ color: 'var(--color-accent)' }}
            />
            <p className={glassStyles.dropzoneTitle}>
              {stageLabel[activeStage as ProcessStage]}
            </p>
            {activeStage === 'compressing' && <ProgressBar percent={activeProgress} />}
          </div>
        </div>
      )}

      {/* ── Error state ────────────────────────────────────────────────── */}
      {!isProcessing && activeError && (
        <div className={cn(glassStyles.notice, glassStyles.noticeError)} style={{ flexDirection: 'column', alignItems: 'center', gap: 10, padding: 14 }}>
          <AlertTriangle size={20} style={{ color: '#f87171', flexShrink: 0 }} />
          <p className="text-center leading-relaxed">{activeError}</p>
          <button
            onClick={handleRetry}
            className={cn(glassStyles.glassSurface, glassStyles.chip, glassStyles.chipAuto, 'nodrag transition-opacity hover:opacity-80')}
            style={{ color: '#fca5a5' }}
          >
            <span className={cn(glassStyles.glassContent, glassStyles.buttonContent)}>
              <RotateCcw size={11} />
              {pendingFile ? 'Try Again' : 'Dismiss'}
            </span>
          </button>
        </div>
      )}

      {/* ── Image display ──────────────────────────────────────────────── */}
      {!isProcessing && !activeError && data.imageUrl && (
        <div className={cn(glassStyles.mediaFrame, glassStyles.mediaCheckered)}>
          <CanvasImage
            src={data.imageUrl}
            alt="Input"
            className="w-full block nodrag"
            style={{ height: 'auto' }}
            onLoad={handleImageLoad}
          />
          <button className={cn(glassStyles.mediaAction, 'nodrag')} onClick={clearImage} aria-label="Remove image">
            <X size={12} />
          </button>
        </div>
      )}

      {/* ── Empty / upload zone ────────────────────────────────────────── */}
      {!isProcessing && !activeError && !data.imageUrl && (
        <>
          <div
            {...getRootProps()}
            className={cn(glassStyles.dropzone, isDragActive && glassStyles.dropzoneActive, 'nodrag')}
          >
            <input {...getInputProps()} />
            <Upload size={18} style={{ color: 'rgba(255,255,255,0.55)' }} />
            <p className={glassStyles.dropzoneTitle}>
              {isDragActive ? 'Drop image here' : 'Drop or click to upload'}
            </p>
          </div>

          <button
            onClick={() => setShowGallery(true)}
            className={cn(
              glassStyles.glassSurface,
              glassStyles.button,
              glassStyles.footerControl,
              glassStyles.buttonSmall,
              'transition-opacity hover:opacity-80 nodrag',
            )}
          >
            <span className={cn(glassStyles.glassContent, glassStyles.buttonContent)}>
              <Layout size={12} />
              Browse Gallery
            </span>
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
