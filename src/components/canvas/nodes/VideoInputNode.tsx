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
    <NodeWrapper title="Video Input" icon={<Film size={14} />} selected={selected} minWidth={280} accentColor={PORT_COLORS.video} titlePosition="outside">

      {/* Processing */}
      {isProcessing && (
        <div
          className="flex flex-col items-center justify-center gap-2 rounded-lg"
          style={{ minHeight: 90, background: 'var(--color-bg-surface)', padding: 16 }}
        >
          <RefreshCw size={18} className="animate-spin" style={{ color: PORT_COLORS.video }} />
          <p className="text-xs font-medium text-center" style={{ color: 'var(--color-white)' }}>
            {stage === 'compressing' ? `Compressing… ${progress}%` : 'Uploading…'}
          </p>
          {stage === 'compressing' && (
            <div className="w-full" style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
              <div
                style={{ height: '100%', width: `${Math.max(2, progress)}%`, background: PORT_COLORS.video, transition: 'width 0.3s ease-out' }}
              />
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {!isProcessing && error && (
        <div
          className="flex flex-col items-center gap-3 rounded-lg p-4"
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}
        >
          <AlertTriangle size={20} style={{ color: '#f87171' }} />
          <p className="text-xs text-center" style={{ color: '#fca5a5' }}>{error}</p>
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

      {/* Video preview */}
      {!isProcessing && !error && data.videoUrl && (
        <div className="relative" style={{ margin: '-18px' }}>
          <CanvasVideo
            src={data.videoUrl}
            controls
            className="w-full block nodrag"
            style={{ height: 'auto' }}
          />
          <button
            className="absolute top-1 right-1 p-0.5 rounded-full nodrag"
            style={{ background: 'rgba(0,0,0,0.6)' }}
            onClick={clearVideo}
          >
            <X size={12} style={{ color: 'var(--color-white)' }} />
          </button>
        </div>
      )}

      {/* Upload zone */}
      {!isProcessing && !error && !data.videoUrl && (
        <>
          <div
            className="flex flex-col items-center justify-center gap-2 rounded-lg cursor-pointer transition-colors nodrag"
            style={{
              height: 90,
              border: '1.5px dashed rgba(255,255,255,0.2)',
              background: 'transparent',
            }}
            onClick={() => inputRef.current?.click()}
          >
            <Upload size={18} style={{ color: 'var(--color-white-muted)' }} />
            <p className="text-xs text-center" style={{ color: 'var(--color-white-muted)' }}>
              Click to upload video
            </p>
            <p className="text-xs" style={{ color: 'var(--color-white-muted)', fontSize: 10, opacity: 0.6 }}>
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
