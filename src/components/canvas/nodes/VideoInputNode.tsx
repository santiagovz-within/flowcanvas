'use client';

import { Position, type NodeProps } from '@xyflow/react';
import { Film, Upload, X, RefreshCw, AlertTriangle, RotateCcw } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { NodeWrapper } from './NodeWrapper';
import { TypedHandle, PORT_COLORS } from './TypedHandle';
import type { VideoInputNodeData } from '@/types';
import type { FFmpeg } from '@ffmpeg/ffmpeg';
import { useFlowStore } from '@/lib/stores/flowStore';
import { CanvasVideo } from '@/components/canvas/CanvasMedia';
import { cn } from '@/lib/utils/cn';
import glassStyles from './ImageGenerationGlass.module.css';

const COMPRESS_THRESHOLD_BYTES = 50 * 1024 * 1024; // 50 MB
const ACCEPTED_VIDEO_TYPES = 'video/mp4,video/webm,video/quicktime,video/mpeg';

// ── FFmpeg WASM singleton (lazy) ──────────────────────────────────────────────
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

// ── Component ─────────────────────────────────────────────────────────────────

export function VideoInputNode({ data, selected, id }: NodeProps & { data: VideoInputNodeData }) {
  const [stage, setStage]       = useState<'compressing' | 'uploading' | 'error' | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError]       = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const storeEdges = useFlowStore(state => state.edges);

  function dispatchUpdate(updates: Partial<VideoInputNodeData>) {
    document.dispatchEvent(new CustomEvent('node:update', { detail: { nodeId: id, data: updates } }));
  }

  const processAndUpload = useCallback(async (file: File) => {
    setPendingFile(file);
    setError(null);

    let uploadFile: File = file;

    if (file.size > COMPRESS_THRESHOLD_BYTES) {
      setStage('compressing');
      setProgress(0);
      try {
        const ffmpeg = await getFFmpeg();
        const { fetchFile } = await import('@ffmpeg/util');

        const ext = file.name.split('.').pop()?.toLowerCase() || 'mp4';
        const inputName = `input.${ext}`;
        await ffmpeg.writeFile(inputName, await fetchFile(file));

        ffmpeg.on('progress', ({ progress: p }) => {
          setProgress(Math.max(1, Math.round(p * 100)));
        });

        await ffmpeg.exec([
          '-i', inputName,
          '-c:v', 'libx264',
          '-crf', '26',
          '-preset', 'fast',
          '-c:a', 'aac',
          '-b:a', '128k',
          '-movflags', '+faststart',
          '-y',
          'output.mp4',
        ]);

        const raw = await ffmpeg.readFile('output.mp4') as Uint8Array;
        const buffer = new Uint8Array(raw).buffer as ArrayBuffer;
        uploadFile = new File([buffer], 'video.mp4', { type: 'video/mp4' });
        await ffmpeg.deleteFile(inputName).catch(() => {});
        await ffmpeg.deleteFile('output.mp4').catch(() => {});
      } catch (err) {
        setStage('error');
        setError('Compression failed. Try a smaller file.');
        console.error('[VideoInputNode] FFmpeg error:', err);
        return;
      }
    }

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
        console.warn('[VideoInputNode] Upload succeeded without a generated poster');
      }

      dispatchUpdate({ videoUrl: readUrl });
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
  }, [id]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processAndUpload(file);
    e.target.value = '';
  }

  function clearVideo() {
    dispatchUpdate({ videoUrl: undefined });
    document.dispatchEvent(new CustomEvent('node:video-propagate', {
      detail: { sourceNodeId: id, videoUrl: null },
    }));
  }

  async function handleRetry() {
    if (pendingFile) {
      setStage(null);
      setError(null);
      await processAndUpload(pendingFile);
    } else {
      setStage(null);
      setError(null);
    }
  }

  const isProcessing = stage !== null && stage !== 'error';

  return (
    <NodeWrapper
      title="Video Input"
      icon={<Film size={14} />}
      selected={selected}
      minWidth={300}
      accentColor={PORT_COLORS.video}
      titlePosition="outside"
      appearance="imageGenerationGlass"
    >
      {/* Processing */}
      {isProcessing && (
        <div className={glassStyles.statusBlock}>
          <RefreshCw size={18} className="animate-spin" style={{ color: PORT_COLORS.video }} />
          <p className={glassStyles.dropzoneTitle}>
            {stage === 'compressing' ? `Compressing… ${progress}%` : 'Uploading…'}
          </p>
          {stage === 'compressing' && (
            <div className={glassStyles.progressTrack}>
              <div
                className={glassStyles.progressFill}
                style={{ width: `${Math.max(2, progress)}%`, background: PORT_COLORS.video }}
              />
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {!isProcessing && error && (
        <div className={cn(glassStyles.notice, glassStyles.noticeError)} style={{ flexDirection: 'column', alignItems: 'center', gap: 10, padding: 14 }}>
          <AlertTriangle size={20} style={{ color: '#f87171' }} />
          <p className="text-center leading-relaxed">{error}</p>
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

      {/* Video preview */}
      {!isProcessing && !error && data.videoUrl && (
        <div className={glassStyles.mediaFrame}>
          <CanvasVideo
            src={data.videoUrl}
            controls
            className="w-full block nodrag"
            style={{ height: 'auto' }}
          />
          <button className={cn(glassStyles.mediaAction, 'nodrag')} onClick={clearVideo} aria-label="Remove video">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Upload zone */}
      {!isProcessing && !error && !data.videoUrl && (
        <>
          <div
            className={cn(glassStyles.dropzone, 'nodrag')}
            onClick={() => inputRef.current?.click()}
          >
            <Upload size={18} style={{ color: 'rgba(255,255,255,0.55)' }} />
            <p className={glassStyles.dropzoneTitle}>
              Click to upload video
            </p>
            <p className={glassStyles.dropzoneHint}>
              MP4, WebM, MOV · compressed if &gt;50 MB
            </p>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_VIDEO_TYPES}
            className="hidden"
            onChange={handleFileChange}
          />
        </>
      )}

      <TypedHandle type="source" position={Position.Right} id="video" portType="video" connected={storeEdges.some(e => e.source === id && e.sourceHandle === 'video')} />
    </NodeWrapper>
  );
}
