'use client';

import { Position, type NodeProps } from '@xyflow/react';
import { Clapperboard, Play, Download, X, Check } from 'lucide-react';

function FigmaIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 38 57" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
      <path d="M19 28.5a9.5 9.5 0 1 1 19 0 9.5 9.5 0 0 1-19 0z" fill="currentColor" opacity="0.9"/>
      <path d="M0 47.5A9.5 9.5 0 0 1 9.5 38H19v9.5a9.5 9.5 0 0 1-19 0z" fill="currentColor" opacity="0.6"/>
      <path d="M19 0v19H9.5a9.5 9.5 0 0 1 0-19H19z" fill="currentColor" opacity="0.7"/>
      <path d="M0 19a9.5 9.5 0 0 1 9.5-9.5H19V28.5H9.5A9.5 9.5 0 0 1 0 19z" fill="currentColor" opacity="0.8"/>
      <path d="M19 0h9.5a9.5 9.5 0 0 1 0 19H19V0z" fill="currentColor"/>
    </svg>
  );
}
import { useEffect, useRef, useState } from 'react';
import { NodeWrapper } from './NodeWrapper';
import { TypedHandle, PORT_COLORS } from './TypedHandle';
import type { VideoToGifNodeData } from '@/types';
import { downloadFromUrl } from '@/lib/utils/download';
import { playSuccessSound } from '@/lib/utils/sound';
import type { FFmpeg } from '@ffmpeg/ffmpeg';
import { useFlowStore } from '@/lib/stores/flowStore';
import { CanvasImage } from '@/components/canvas/CanvasMedia';
import { cn } from '@/lib/utils/cn';
import glassStyles from './ImageGenerationGlass.module.css';

// ── Module-level FFmpeg singleton (lazy, shared across all instances) ─────────

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
      wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
    }).then(() => {});
  }
  await _loadPromise;
  return _ffmpeg!;
}

// ── Dither quality map ────────────────────────────────────────────────────────

const DITHER_LABELS  = ['None', 'Bayer Low', 'Bayer High', 'Floyd-Steinberg', 'Sierra2-4A'];
const DITHER_FILTERS = ['none', 'bayer:bayer_scale=1', 'bayer:bayer_scale=3', 'floyd_steinberg', 'sierra2_4a'];

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SliderRow({
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  display?: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className={glassStyles.sliderRow}>
      <div className={glassStyles.sliderHead}>
        <span className={glassStyles.microLabel}>{label}</span>
        <span className={glassStyles.sliderValue}>{display ?? value}</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        className={cn(glassStyles.sliderInput, 'nodrag')}
        style={{ accentColor: PORT_COLORS.image }}
      />
    </div>
  );
}

function ProgressBar({ percent, label }: { percent: number; label: string }) {
  return (
    <div className={glassStyles.sliderRow}>
      <div className={glassStyles.sliderHead}>
        <span className={glassStyles.microLabel}>{label}</span>
        <span className={glassStyles.sliderValue}>{percent}%</span>
      </div>
      <div className={glassStyles.progressTrack}>
        <div
          className={glassStyles.progressFill}
          style={{ width: `${Math.max(2, percent)}%`, background: PORT_COLORS.image }}
        />
      </div>
    </div>
  );
}

// ── Main node ─────────────────────────────────────────────────────────────────

export function VideoToGifNode({ data, selected, id }: NodeProps & { data: VideoToGifNodeData }) {
  const fps        = data.fps         ?? 12;
  const width      = data.outputWidth ?? 480;
  const startTime  = data.startTime   ?? 0;
  const duration   = data.duration    ?? 10;
  const dither     = data.ditherLevel ?? 4;

  const storeEdges = useFlowStore(state => state.edges);

  const [videoDuration, setVideoDuration] = useState<number | null>(null);
  const [isConverting,  setIsConverting]  = useState(false);
  const [progress,      setProgress]      = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [error,         setError]         = useState<string | null>(null);
  const [gifUrl,     setGifUrl]     = useState<string | null>(null);
  const [gifGcsRef,  setGifGcsRef]  = useState<string | null>(data.gifGcsRef ?? null);
  const [gifSize,    setGifSize]    = useState<number | null>(null);

  type FigmaStatus = 'idle' | 'sending' | 'sent' | 'no_token' | 'error';
  const [figmaStatus,  setFigmaStatus]  = useState<FigmaStatus>('idle');
  const [figmaError,   setFigmaError]   = useState<string | null>(null);

  function updateData(updates: Partial<VideoToGifNodeData>) {
    document.dispatchEvent(new CustomEvent('node:update', {
      detail: { nodeId: id, data: updates },
    }));
  }

  // ── Probe video duration when videoUrl changes ────────────────────────────

  useEffect(() => {
    if (!data.videoUrl || !selected) return;
    const vid = document.createElement('video');
    vid.preload = 'metadata';
    vid.src = data.videoUrl;
    vid.onloadedmetadata = () => {
      const d = isFinite(vid.duration) ? vid.duration : null;
      setVideoDuration(d);
      if (d !== null && duration > d) updateData({ duration: Math.max(0.5, d) });
    };
    vid.onerror = () => setVideoDuration(null);
    return () => { vid.src = ''; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.videoUrl, selected]);

  // ── On mount: restore GIF from GCS if available ───────────────────────────

  useEffect(() => {
    const ref = data.gifGcsRef;
    if (!ref) return;
    fetch(`/api/gif?ref=${encodeURIComponent(ref)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.url) setGifUrl(d.url); })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Send to Figma ─────────────────────────────────────────────────────────

  async function handleSendToFigma() {
    if (!gifUrl || figmaStatus === 'sending') return;

    setFigmaStatus('sending');
    setFigmaError(null);

    try {
      // 1. Verify the user has generated their plugin link token.
      const tokenRes = await fetch('/api/figma/token');
      if (!tokenRes.ok) throw new Error('Could not check Figma token status');
      const { configured } = await tokenRes.json();
      if (!configured) {
        setFigmaStatus('no_token');
        return;
      }

      // 2. Read dimensions from the current gifUrl.
      const { width, height } = await new Promise<{ width: number; height: number }>(
        (resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
          img.onerror = reject;
          img.src = gifUrl!;
        },
      );

      // 3a. GIF already on GCS — create transfer pointing to existing object (no re-upload).
      if (gifGcsRef) {
        const stageRes = await fetch('/api/figma/stage', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ existingGcsRef: gifGcsRef, width, height }),
        });
        if (!stageRes.ok) {
          const e = await stageRes.json().catch(() => ({}));
          throw new Error(e.error ?? 'Stage request failed');
        }
        setFigmaStatus('sent');
        return;
      }

      // 3b. GIF only in memory — upload blob to GCS.
      const blob = await fetch(gifUrl).then(r => r.blob());
      const stageRes = await fetch('/api/figma/stage', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ sizeBytes: blob.size, width, height }),
      });
      if (!stageRes.ok) {
        const e = await stageRes.json().catch(() => ({}));
        throw new Error(e.error ?? 'Stage request failed');
      }
      const { id: transferId, uploadUrl } = await stageRes.json();

      const putRes = await fetch(uploadUrl, {
        method:  'PUT',
        body:    blob,
        headers: { 'Content-Type': 'image/gif' },
      });
      if (!putRes.ok) throw new Error(`GCS upload failed (${putRes.status})`);

      const confirmRes = await fetch(`/api/figma/stage/${transferId}/confirm`, { method: 'POST' });
      if (!confirmRes.ok) {
        const e = await confirmRes.json().catch(() => ({}));
        throw new Error(e.error ?? 'Confirm failed');
      }

      setFigmaStatus('sent');
    } catch (err) {
      setFigmaError(err instanceof Error ? err.message : 'Unknown error');
      setFigmaStatus('error');
    }
  }

  // ── Conversion ────────────────────────────────────────────────────────────

  async function handleConvert() {
    if (!data.videoUrl || isConverting) return;

    // Revoke previous blob URL
    if (gifUrl) URL.revokeObjectURL(gifUrl);
    setGifUrl(null);
    setGifSize(null);
    setError(null);
    setIsConverting(true);
    setProgress(0);

    try {
      setProgressLabel('Loading FFmpeg…');
      const ffmpeg = await getFFmpeg();
      setProgress(5);

      const { fetchFile } = await import('@ffmpeg/util');
      setProgressLabel('Fetching video…');
      await ffmpeg.writeFile('input.mp4', await fetchFile(data.videoUrl));
      setProgress(10);

      const ditherFilter  = DITHER_FILTERS[(dither - 1)] ?? 'floyd_steinberg';
      const scale         = `scale=${width}:-1:flags=lanczos`;
      const fpsFilter     = `fps=${fps}`;
      const vfPalette     = `${fpsFilter},${scale},palettegen=stats_mode=diff`;
      const filterComplex = `[0:v]${fpsFilter},${scale}[x];[x][1:v]paletteuse=dither=${ditherFilter}`;
      const ssArgs        = ['-ss', String(startTime), '-t', String(duration)];

      // ── Pass 1: generate palette ────────────────────────────────────────
      setProgressLabel('Pass 1: generating palette…');
      const onP1 = ({ progress: p }: { progress: number }) =>
        setProgress(10 + Math.round(p * 40));
      ffmpeg.on('progress', onP1);
      await ffmpeg.exec([...ssArgs, '-i', 'input.mp4', '-vf', vfPalette, '-y', 'palette.png']);
      ffmpeg.off('progress', onP1);
      setProgress(50);

      // ── Pass 2: encode GIF ──────────────────────────────────────────────
      setProgressLabel('Pass 2: encoding GIF…');
      const onP2 = ({ progress: p }: { progress: number }) =>
        setProgress(50 + Math.round(p * 49));
      ffmpeg.on('progress', onP2);
      await ffmpeg.exec([
        ...ssArgs,
        '-i', 'input.mp4',
        '-i', 'palette.png',
        '-filter_complex', filterComplex,
        '-y', 'output.gif',
      ]);
      ffmpeg.off('progress', onP2);

      const raw  = await ffmpeg.readFile('output.gif') as Uint8Array;
      // Copy into a plain ArrayBuffer to satisfy Blob constructor types
      const copy = new Uint8Array(raw).buffer as ArrayBuffer;
      const blob = new Blob([copy], { type: 'image/gif' });
      const url  = URL.createObjectURL(blob);

      setGifUrl(url);
      playSuccessSound();
      setGifSize(blob.size);
      setGifGcsRef(null);
      setProgress(100);
      setProgressLabel('Done');
      setFigmaStatus('idle');
      setFigmaError(null);

      updateData({ gifUrl: url, gifGcsRef: undefined });

      // Upload to GCS in the background so the GIF persists across page reloads.
      fetch('/api/gif', { method: 'POST' })
        .then(r => r.ok ? r.json() : null)
        .then(async d => {
          if (!d?.uploadUrl) return;
          const put = await fetch(d.uploadUrl, {
            method: 'PUT', body: blob, headers: { 'Content-Type': 'image/gif' },
          });
          if (put.ok) {
            await fetch('/api/media/derivatives', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ref: d.gcsRef, contentType: 'image/gif' }),
            }).catch(() => null);
            setGifGcsRef(d.gcsRef);
            updateData({ gifGcsRef: d.gcsRef });
          }
        })
        .catch(() => {}); // best-effort — GIF still usable from blob URL this session

      // Propagate to any connected image-type nodes
      document.dispatchEvent(new CustomEvent('node:image-propagate', {
        detail: { sourceNodeId: id, imageUrl: url },
      }));

      // Cleanup virtual FS
      for (const f of ['input.mp4', 'palette.png', 'output.gif']) {
        await ffmpeg.deleteFile(f).catch(() => {});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Conversion failed');
      setProgress(0);
      setProgressLabel('');
    } finally {
      setIsConverting(false);
    }
  }

  // ── Derived slider limits ─────────────────────────────────────────────────

  const dMax = videoDuration ?? 120;
  const sMax = Math.max(0, dMax - 0.5);

  // ── Footer ────────────────────────────────────────────────────────────────

  const footer = (
    <div className={glassStyles.footerStack}>
      {/* Convert button */}
      <button
        onClick={handleConvert}
        disabled={!data.videoUrl || isConverting}
        className={cn(
          glassStyles.glassSurface,
          glassStyles.button,
          glassStyles.generateButton,
          'transition-opacity disabled:opacity-40 nodrag',
        )}
      >
        <span className={cn(glassStyles.glassContent, glassStyles.buttonContent)}>
          <Play size={12} />
          {isConverting ? progressLabel || 'Converting…' : 'Convert to GIF'}
        </span>
      </button>

      {/* Download + Send to Figma */}
      {gifUrl && !isConverting && (
        <>
          <div className={glassStyles.footerSecondary}>
            <button
              onClick={() => downloadFromUrl(gifUrl, `animation-${Date.now()}.gif`)}
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
                Download GIF
              </span>
            </button>

            <button
              onClick={handleSendToFigma}
              disabled={figmaStatus === 'sending'}
              className={cn(
                glassStyles.glassSurface,
                glassStyles.button,
                glassStyles.footerControl,
                glassStyles.footerAction,
                'nodrag transition-opacity hover:opacity-80 active:opacity-60 disabled:opacity-50',
              )}
              style={{
                color: figmaStatus === 'sent'
                  ? 'var(--color-success)'
                  : figmaStatus === 'error' || figmaStatus === 'no_token'
                  ? '#f87171'
                  : undefined,
              }}
            >
              <span className={cn(glassStyles.glassContent, glassStyles.buttonContent)}>
                {figmaStatus === 'sending' ? (
                  <>
                    <div
                      className="animate-spin"
                      style={{ width: 11, height: 11, borderRadius: '50%', border: '1.5px solid rgba(255,255,255,0.2)', borderTopColor: 'rgba(255,255,255,0.6)', flexShrink: 0 }}
                    />
                    Sending…
                  </>
                ) : figmaStatus === 'sent' ? (
                  <>
                    <Check size={12} style={{ color: 'var(--color-success)' }} />
                    Sent to Figma
                  </>
                ) : (
                  <>
                    <FigmaIcon size={12} />
                    Send to Figma
                  </>
                )}
              </span>
            </button>
          </div>

          {/* Inline contextual help / error text */}
          {figmaStatus === 'no_token' && (
            <p className={cn(glassStyles.helperText, 'nodrag')} style={{ color: '#f87171' }}>
              Go to{' '}
              <button
                className="underline"
                style={{ color: '#f87171', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 9 }}
                onClick={() => window.open('/dashboard/settings', '_blank')}
              >
                Settings → Figma Integration
              </button>{' '}
              to generate your link token.
            </p>
          )}

          {figmaStatus === 'error' && figmaError && (
            <p className={cn(glassStyles.helperText, 'nodrag')} style={{ color: '#f87171' }}>
              {figmaError}
            </p>
          )}

          {figmaStatus === 'sent' && (
            <p className={cn(glassStyles.helperText, 'nodrag')}>
              Make sure the Figma plugin is open in your target file — the GIF drops into whatever file is open.
            </p>
          )}

          {figmaStatus === 'idle' && (
            <p className={cn(glassStyles.helperText, 'nodrag')} style={{ opacity: 0.7 }}>
              Make sure the Figma plugin is open in your target file.
            </p>
          )}
        </>
      )}
    </div>
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <NodeWrapper
      title="Video to GIF"
      icon={<Clapperboard size={14} />}
      selected={selected}
      minWidth={300}
      accentColor={PORT_COLORS.image}
      titlePosition="outside"
      appearance="imageGenerationGlass"
      footer={footer}
    >
      <TypedHandle
        type="target"
        position={Position.Left}
        id="video"
        portType="video"
        offset="50%"
        connected={storeEdges.some(e => e.target === id && e.targetHandle === 'video')}
      />
      <TypedHandle
        type="source"
        position={Position.Right}
        id="gif"
        portType="image"
        connected={storeEdges.some(e => e.source === id && e.sourceHandle === 'gif')}
      />

      {/* ── No video connected ─────────────────────────────────────────── */}
      {!data.videoUrl && (
        <div className={glassStyles.emptyState}>
          Connect a video source
        </div>
      )}

      {/* ── Sliders ────────────────────────────────────────────────────── */}
      <SliderRow
        label="Frame Rate"
        value={fps}
        display={`${fps} fps`}
        min={5} max={30} step={1}
        onChange={(v) => updateData({ fps: v })}
        disabled={isConverting}
      />
      <SliderRow
        label="Width"
        value={width}
        display={`${width} px`}
        min={160} max={800} step={10}
        onChange={(v) => updateData({ outputWidth: v })}
        disabled={isConverting}
      />
      <SliderRow
        label="Start Time"
        value={startTime}
        display={`${startTime.toFixed(1)} s`}
        min={0} max={sMax} step={0.1}
        onChange={(v) => updateData({ startTime: v })}
        disabled={isConverting}
      />
      <SliderRow
        label="Duration"
        value={duration}
        display={`${duration.toFixed(1)} s`}
        min={0.5} max={Math.max(0.5, dMax - startTime)} step={0.1}
        onChange={(v) => updateData({ duration: v })}
        disabled={isConverting}
      />
      <SliderRow
        label="Quality"
        value={dither}
        display={DITHER_LABELS[dither - 1]}
        min={1} max={5} step={1}
        onChange={(v) => updateData({ ditherLevel: v })}
        disabled={isConverting}
      />

      {/* ── Progress ───────────────────────────────────────────────────── */}
      {isConverting && (
        <ProgressBar percent={progress} label={progressLabel} />
      )}

      {/* ── Error ──────────────────────────────────────────────────────── */}
      {error && !isConverting && (
        <div className={cn(glassStyles.notice, glassStyles.noticeError)} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="truncate">{error}</span>
          <button onClick={() => setError(null)} className="shrink-0 hover:opacity-60 nodrag">
            <X size={11} />
          </button>
        </div>
      )}

      {/* ── GIF preview ────────────────────────────────────────────────── */}
      {gifUrl && !isConverting && (
        <div className={glassStyles.mediaFrame}>
          <CanvasImage
            src={gifUrl}
            alt="GIF preview"
            className="w-full block nodrag"
            style={{ height: 'auto' }}
            onError={() => { setGifUrl(null); updateData({ gifUrl: undefined }); }}
          />
          {gifSize !== null && (
            <p className={glassStyles.mediaCaption}>
              {formatBytes(gifSize)}
            </p>
          )}
        </div>
      )}
    </NodeWrapper>
  );
}
