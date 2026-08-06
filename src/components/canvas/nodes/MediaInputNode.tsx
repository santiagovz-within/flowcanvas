'use client';

import { Position, type NodeProps } from '@xyflow/react';
import { Image, Film, Upload, X, RefreshCw, Layout, AlertTriangle, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { NodeWrapper } from './NodeWrapper';
import { TypedHandle, PORT_COLORS } from './TypedHandle';
import type { MediaInputNodeData } from '@/types';
import { ACCEPTED_IMAGE_TYPES } from '@/lib/utils/constants';
import { consumePendingFile } from '@/lib/utils/pendingFiles';
import { createClient } from '@/lib/supabase/client';
import { processImageFile } from '@/lib/utils/imageProcessing';
import { uploadImageToStorage } from '@/lib/utils/uploadImage';
import { resolveGcsRefs } from '@/lib/utils/mediaUtils';
import { CanvasImage, CanvasVideo } from '@/components/canvas/CanvasMedia';
import { useFlowStore } from '@/lib/stores/flowStore';
import { cn } from '@/lib/utils/cn';
import glassStyles from './ImageGenerationGlass.module.css';
import type { FFmpeg } from '@ffmpeg/ffmpeg';

const MAX_VIDEO_BYTES     = 150 * 1024 * 1024; // 150 MB — hard reject
const COMPRESS_THRESHOLD  =  50 * 1024 * 1024; // 50 MB  — compress above this

const ACCEPTED_VIDEO_TYPES = {
  'video/mp4':       ['.mp4'],
  'video/webm':      ['.webm'],
  'video/quicktime': ['.mov', '.qt'],
  'video/mpeg':      ['.mpeg', '.mpg'],
};

// ── FFmpeg singleton (lazy-loaded) ────────────────────────────────────────────
let _ffmpeg: FFmpeg | null = null;
let _loadPromise: Promise<void> | null = null;

async function getFFmpeg(): Promise<FFmpeg> {
  if (_ffmpeg?.loaded) return _ffmpeg;
  if (!_loadPromise) {
    const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
      import('@ffmpeg/ffmpeg'),
      import('@ffmpeg/util'),
    ]);
    _ffmpeg = new FFmpeg();
    const base = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
    _loadPromise = _ffmpeg.load({
      coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL:  await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
    }).then(() => {});
  }
  await _loadPromise;
  return _ffmpeg!;
}

// ── GalleryPicker (images only) ───────────────────────────────────────────────

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
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: 'var(--border-default)' }}>
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-white-muted)' }}>
            Select from Gallery
          </p>
          <button onClick={onClose} className="p-0.5 rounded hover:opacity-60">
            <X size={14} style={{ color: 'var(--color-white-muted)' }} />
          </button>
        </div>
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

function ProgressBar({ percent, color }: { percent: number; color: string }) {
  return (
    <div className={glassStyles.sliderRow}>
      <div className={glassStyles.progressTrack}>
        <div
          className={glassStyles.progressFill}
          style={{ width: `${Math.max(2, percent)}%`, background: color }}
        />
      </div>
      <span className={glassStyles.helperText} style={{ textAlign: 'right' }}>{percent}%</span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

type UploadStage = 'validating' | 'compressing' | 'uploading' | 'error' | null;

export function MediaInputNode({ data, selected, id }: NodeProps & { data: MediaInputNodeData }) {
  const [stage, setStage]             = useState<UploadStage>(null);
  const [progress, setProgress]       = useState(0);
  const [error, setError]             = useState<string | null>(null);
  const [previewUrl, setPreviewUrl]   = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [showGallery, setShowGallery] = useState(false);

  const storeEdges = useFlowStore(state => state.edges);

  // Keep a ref so async callbacks always see the latest mediaType without needing
  // it as a useCallback dependency (avoids re-creating closures on every render).
  const mediaTypeRef = useRef(data.mediaType);
  useEffect(() => { mediaTypeRef.current = data.mediaType; }, [data.mediaType]);

  function dispatchUpdate(updates: Partial<MediaInputNodeData>) {
    document.dispatchEvent(new CustomEvent('node:update', { detail: { nodeId: id, data: updates } }));
  }

  // Remove edges from the current handle when the media type is about to change.
  function maybeRemoveOldEdges(incoming: 'image' | 'video') {
    if (mediaTypeRef.current && mediaTypeRef.current !== incoming) {
      document.dispatchEvent(new CustomEvent('node:remove-source-edges', {
        detail: { nodeId: id, handleId: mediaTypeRef.current === 'image' ? 'image' : 'video' },
      }));
    }
  }

  // ── Image pipeline ──────────────────────────────────────────────────────────

  const processImage = useCallback(async (file: File) => {
    maybeRemoveOldEdges('image');
    setPendingFile(file);
    setError(null);

    const preview = URL.createObjectURL(file);
    setPreviewUrl(preview);

    let processed: File;
    try {
      processed = await processImageFile(file, (s, percent) => {
        setStage(s as UploadStage);
        if (s === 'compressing') setProgress(percent ?? 0);
      });
    } catch (err) {
      URL.revokeObjectURL(preview);
      setPreviewUrl(null);
      setStage('error');
      setError(err instanceof Error ? err.message : 'Failed to process image.');
      return;
    }

    setStage('uploading');
    try {
      const url = await uploadImageToStorage(processed);
      dispatchUpdate({ mediaType: 'image', imageUrl: url });
      document.dispatchEvent(new CustomEvent('node:image-propagate', {
        detail: { sourceNodeId: id, imageUrl: url },
      }));
      setStage(null);
      setError(null);
    } catch (err) {
      setStage('error');
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      URL.revokeObjectURL(preview);
      setPreviewUrl(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // ── Video pipeline ──────────────────────────────────────────────────────────

  const processVideo = useCallback(async (file: File) => {
    if (file.size > MAX_VIDEO_BYTES) {
      setStage('error');
      setError(`Video is too large (${Math.round(file.size / (1024 * 1024))} MB). Maximum allowed is 150 MB.`);
      return;
    }

    maybeRemoveOldEdges('video');
    setPendingFile(file);
    setError(null);

    let uploadFile: File = file;

    if (file.size > COMPRESS_THRESHOLD) {
      setStage('compressing');
      setProgress(0);
      try {
        const ffmpeg = await getFFmpeg();
        const { fetchFile } = await import('@ffmpeg/util');
        const ext = file.name.split('.').pop()?.toLowerCase() || 'mp4';
        const inputName = `input.${ext}`;
        await ffmpeg.writeFile(inputName, await fetchFile(file));
        ffmpeg.on('progress', ({ progress: p }) => setProgress(Math.max(1, Math.round(p * 100))));
        await ffmpeg.exec([
          '-i', inputName,
          '-c:v', 'libx264', '-crf', '26', '-preset', 'fast',
          '-c:a', 'aac', '-b:a', '128k',
          '-movflags', '+faststart', '-y', 'output.mp4',
        ]);
        const raw = await ffmpeg.readFile('output.mp4') as Uint8Array;
        const buffer = new Uint8Array(raw).buffer as ArrayBuffer;
        uploadFile = new File([buffer], 'video.mp4', { type: 'video/mp4' });
        await ffmpeg.deleteFile(inputName).catch(() => {});
        await ffmpeg.deleteFile('output.mp4').catch(() => {});
      } catch (err) {
        setStage('error');
        setError('Video compression failed. Try a smaller file.');
        console.error('[MediaInputNode] FFmpeg error:', err);
        return;
      }
    }
    // Files ≤ 50 MB are uploaded as-is (no compression needed).

    setStage('uploading');
    setProgress(0);
    try {
      const contentType = uploadFile.type || 'video/mp4';
      const signRes = await fetch('/api/upload/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType }),
      });
      if (!signRes.ok) throw new Error('Failed to get upload URL');
      const { uploadUrl, readUrl, ref } = await signRes.json();
      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        body: uploadFile,
        headers: { 'Content-Type': contentType },
      });
      if (!putRes.ok) throw new Error(`Upload failed: ${putRes.status}`);

      const finalizeRes = await fetch('/api/media/derivatives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref, contentType }),
      });
      if (!finalizeRes.ok) {
        console.warn('[MediaInputNode] Upload succeeded without a generated poster');
      }

      dispatchUpdate({ mediaType: 'video', videoUrl: readUrl });
      document.dispatchEvent(new CustomEvent('node:video-propagate', {
        detail: { sourceNodeId: id, videoUrl: readUrl },
      }));
      setStage(null);
      setError(null);
      setPendingFile(null);
    } catch (err) {
      setStage('error');
      setError(err instanceof Error ? err.message : 'Upload failed.');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // ── File router ─────────────────────────────────────────────────────────────

  const handleFile = useCallback((file: File) => {
    if (file.type.startsWith('image/')) {
      processImage(file);
    } else if (file.type.startsWith('video/')) {
      processVideo(file);
    } else {
      setStage('error');
      setError('Unsupported type. Upload an image (JPEG, PNG, WebP) or video (MP4, WebM, MOV).');
    }
  }, [processImage, processVideo]);

  // Consume any file queued by FlowCanvas before this node mounted.
  // The map write happens synchronously in onDrop; this effect runs after mount,
  // so the file is guaranteed to be present by the time we read it.
  useEffect(() => {
    const file = consumePendingFile(id);
    if (file) handleFile(file);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs only on mount

  // ── Dropzone ────────────────────────────────────────────────────────────────

  const onDrop = useCallback((files: File[]) => {
    if (files[0]) handleFile(files[0]);
  }, [handleFile]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { ...ACCEPTED_IMAGE_TYPES, ...ACCEPTED_VIDEO_TYPES },
    maxFiles: 1,
  });

  // ── Other actions ───────────────────────────────────────────────────────────

  function clearMedia() {
    if (data.mediaType === 'image') {
      dispatchUpdate({ mediaType: undefined, imageUrl: undefined, naturalWidth: undefined, naturalHeight: undefined });
      document.dispatchEvent(new CustomEvent('node:image-propagate', {
        detail: { sourceNodeId: id, imageUrl: null },
      }));
    } else if (data.mediaType === 'video') {
      dispatchUpdate({ mediaType: undefined, videoUrl: undefined });
      document.dispatchEvent(new CustomEvent('node:video-propagate', {
        detail: { sourceNodeId: id, videoUrl: null },
      }));
    }
    setStage(null);
    setError(null);
    setPendingFile(null);
  }

  function handleImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const { naturalWidth, naturalHeight } = e.currentTarget;
    dispatchUpdate({ naturalWidth, naturalHeight });
  }

  function handleGallerySelect(url: string) {
    setShowGallery(false);
    maybeRemoveOldEdges('image');
    dispatchUpdate({ mediaType: 'image', imageUrl: url, naturalWidth: undefined, naturalHeight: undefined });
    document.dispatchEvent(new CustomEvent('node:image-propagate', {
      detail: { sourceNodeId: id, imageUrl: url },
    }));
  }

  async function handleRetry() {
    if (pendingFile) {
      setStage(null);
      setError(null);
      handleFile(pendingFile);
    } else {
      setStage(null);
      setError(null);
    }
  }

  // ── Derived display state ───────────────────────────────────────────────────

  // External status is set by FlowCanvas when a file is drag-dropped directly
  // onto the canvas (creating this node). Local state takes precedence.
  const externalStage  = data.uploadStatus as UploadStage ?? null;
  const activeStage    = stage ?? externalStage;
  const activeProgress = stage !== null ? progress : (data.uploadProgress ?? 0);
  const activeError    =
    stage === 'error'
      ? error
      : data.uploadStatus === 'error'
        ? (data.uploadError ?? 'An error occurred.')
        : null;

  const isProcessing = activeStage !== null && activeStage !== 'error';
  const hasImage     = data.mediaType === 'image' && !!data.imageUrl;
  const hasVideo     = data.mediaType === 'video' && !!data.videoUrl;
  const hasMedia     = hasImage || hasVideo;

  // Output handle type and accent color follow the loaded media type.
  const handlePortType = data.mediaType === 'video' ? 'video' : 'image';
  const handleId       = data.mediaType === 'video' ? 'video' : 'image';
  const accentColor    = data.mediaType === 'video' ? PORT_COLORS.video : PORT_COLORS.image;

  const stageLabel: Record<string, string> = {
    validating:  'Validating…',
    compressing: `Compressing… ${activeProgress}%`,
    uploading:   'Uploading…',
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <NodeWrapper
      title="Media Input"
      icon={data.mediaType === 'video' ? <Film size={14} /> : <Image size={14} />}
      selected={selected}
      minWidth={300}
      accentColor={accentColor}
      titlePosition="outside"
      appearance="imageGenerationGlass"
    >
      {/* Processing */}
      {isProcessing && (
        <div className={glassStyles.mediaFrame}>
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
            <RefreshCw size={18} className="animate-spin" style={{ color: accentColor }} />
            <p className={glassStyles.dropzoneTitle}>
              {stageLabel[activeStage as string] ?? 'Processing…'}
            </p>
            {activeStage === 'compressing' && (
              <ProgressBar percent={activeProgress} color={accentColor} />
            )}
          </div>
        </div>
      )}

      {/* Error */}
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

      {/* Image preview */}
      {!isProcessing && !activeError && hasImage && (
        <div className={cn(glassStyles.mediaFrame, glassStyles.mediaCheckered)}>
          <CanvasImage
            src={data.imageUrl!}
            alt="Input"
            className="w-full block"
            style={{ height: 'auto' }}
            draggable={false}
            onLoad={handleImageLoad}
          />
          <button className={cn(glassStyles.mediaAction, 'nodrag')} onClick={clearMedia} aria-label="Remove media">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Video preview */}
      {!isProcessing && !activeError && hasVideo && (
        <div className={glassStyles.mediaFrame}>
          <CanvasVideo
            src={data.videoUrl!}
            controls
            className="w-full block nodrag"
            style={{ height: 'auto' }}
          />
          <button className={cn(glassStyles.mediaAction, 'nodrag')} onClick={clearMedia} aria-label="Remove media">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Upload zone — shown when idle with no media loaded */}
      {!isProcessing && !activeError && !hasMedia && (
        <>
          <div
            {...getRootProps()}
            className={cn(glassStyles.dropzone, isDragActive && glassStyles.dropzoneActive, 'nodrag')}
          >
            <input {...getInputProps()} />
            <Upload size={18} style={{ color: 'rgba(255,255,255,0.55)' }} />
            <p className={glassStyles.dropzoneTitle}>
              {isDragActive ? 'Drop file here' : 'Drop or click to upload'}
            </p>
            <p className={glassStyles.dropzoneHint}>
              Image (JPEG, PNG, WebP) · Video (MP4, WebM, MOV, max 150 MB)
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
        id={handleId}
        portType={handlePortType}
        connected={storeEdges.some(e => e.source === id && e.sourceHandle === handleId)}
      />

      {showGallery && (
        <GalleryPicker onSelect={handleGallerySelect} onClose={() => setShowGallery(false)} />
      )}
    </NodeWrapper>
  );
}
