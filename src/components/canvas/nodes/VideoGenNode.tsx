'use client';

import { Position, type NodeProps } from '@xyflow/react';
import { Film, Play, AlertTriangle, Download, ChevronLeft, ChevronRight } from 'lucide-react';
import { downloadFromUrl } from '@/lib/utils/download';
import { playSuccessSound } from '@/lib/utils/sound';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NodeWrapper } from './NodeWrapper';
import { TypedHandle, PORT_COLORS } from './TypedHandle';
import type { VideoGenNodeData, ImageInputNodeData, ImageGenNodeData } from '@/types';
import { VIDEO_MODELS, FAL_MODELS } from '@/lib/api/models';
import { ModelSelect } from './ModelSelect';
import { NodeSelect } from './NodeSelect';
import { useFlowStore } from '@/lib/stores/flowStore';

const FRAME_ROW_HEIGHT = 36;
const FRAME_ROW_GAP = 25;

const KLING_ASPECT_RATIOS    = ['16:9', '9:16', '1:1'];
const OMNI_ASPECT_RATIOS     = ['16:9', '9:16'];
const SEEDANCE_ASPECT_RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];
const SEEDANCE_RESOLUTIONS   = ['720p', '1080p', '4k'];

const DURATION_OPTIONS = ['3s', '5s', '8s', '10s'];
const DURATION_MAP: Record<string, number> = { '3s': 3, '5s': 5, '8s': 8, '10s': 10 };

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function autoResize(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

export function VideoGenNode({ data, selected, id }: NodeProps & { data: VideoGenNodeData }) {
  const [isGenerating, setIsGenerating] = useState(false);
  const videoHistory = data.videoHistory ?? [];
  const [histIdx, setHistIdx] = useState(() => Math.max(0, videoHistory.length - 1));
  const prevHistLen = useRef(videoHistory.length);

  useEffect(() => {
    if (videoHistory.length > prevHistLen.current) setHistIdx(videoHistory.length - 1);
    prevHistLen.current = videoHistory.length;
  }, [videoHistory.length]);
  const promptSectionRef = useRef<HTMLDivElement>(null);
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);
  const startFrameRowRef = useRef<HTMLDivElement>(null);
  const endFrameRowRef = useRef<HTMLDivElement>(null);
  const [promptHandleTop, setPromptHandleTop] = useState(50);
  const [startFrameHandleTop, setStartFrameHandleTop] = useState(200);
  const [endFrameHandleTop, setEndFrameHandleTop] = useState(261);

  const [localPrompt, setLocalPrompt] = useState(() => data.prompt ?? '');
  const isFocused = useRef(false);
  useEffect(() => {
    if (!isFocused.current) setLocalPrompt(data.prompt ?? '');
  }, [data.prompt]);

  useEffect(() => {
    if (promptTextareaRef.current) autoResize(promptTextareaRef.current);
  }, [localPrompt]);

  const isKling     = data.model === 'kling-3-pro';
  const isOmni      = data.model === 'google-omni-flash';
  const isSeedance  = data.model === 'seedance-2';
  const hasImage    = !!data.startFrameUrl;

  const aspectRatios = isSeedance
    ? SEEDANCE_ASPECT_RATIOS
    : isOmni
      ? OMNI_ASPECT_RATIOS
      : KLING_ASPECT_RATIOS;

  // Read start-frame source node directly from store (reactive, zero-latency)
  const storeEdges = useFlowStore(state => state.edges);
  const storeNodes = useFlowStore(state => state.nodes);
  const startFrameEdge = storeEdges.find(e => e.target === id && e.targetHandle === 'start_frame');
  const startFrameSource = startFrameEdge ? storeNodes.find(n => n.id === startFrameEdge.source) : undefined;

  // Derive aspect ratio from source node data synchronously
  const derivedAspect = (() => {
    if (!isKling || !startFrameSource) return undefined;
    if (startFrameSource.type === 'imageInputNode') {
      const { naturalWidth, naturalHeight } = startFrameSource.data as ImageInputNodeData;
      if (naturalWidth && naturalHeight) {
        const g = gcd(naturalWidth, naturalHeight);
        return `${naturalWidth / g}:${naturalHeight / g}`;
      }
    }
    if (startFrameSource.type === 'imageGenNode') {
      return (startFrameSource.data as ImageGenNodeData).aspectRatio;
    }
    return undefined;
  })();

  // Persist derived ratio to node data whenever it changes
  useEffect(() => {
    if (derivedAspect && derivedAspect !== data.imageAspectRatio) {
      updateData({ imageAspectRatio: derivedAspect, aspectRatio: derivedAspect });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derivedAspect]);

  // Clear stored ratio when image is disconnected or model changes away from Kling
  useEffect(() => {
    if ((!isKling || !hasImage) && data.imageAspectRatio) {
      updateData({ imageAspectRatio: undefined });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isKling, hasImage]);

  useLayoutEffect(() => {
    if (!promptSectionRef.current) return;
    const el = promptSectionRef.current;
    setPromptHandleTop(el.offsetTop + el.offsetHeight / 2);
  });

  useLayoutEffect(() => {
    if (startFrameRowRef.current) {
      setStartFrameHandleTop(startFrameRowRef.current.offsetTop + FRAME_ROW_HEIGHT / 2);
    }
    if (endFrameRowRef.current) {
      setEndFrameHandleTop(endFrameRowRef.current.offsetTop + FRAME_ROW_HEIGHT / 2);
    }
  });

  function updateData(updates: Partial<VideoGenNodeData>) {
    document.dispatchEvent(new CustomEvent('node:update', {
      detail: { nodeId: id, data: updates },
    }));
  }

  function handleModelChange(model: string) {
    const modelConfig = VIDEO_MODELS.find(option => option.id === model);
    const supportedAspectRatios = modelConfig?.supportedAspectRatios ?? [];
    updateData({
      model,
      ...(!supportedAspectRatios.includes(data.aspectRatio) && supportedAspectRatios[0]
        ? { aspectRatio: supportedAspectRatios[0] }
        : {}),
    });
  }

  function navigateHistory(idx: number) {
    setHistIdx(idx);
    const url = videoHistory[idx];
    if (url) {
      // Update store directly so downstream nodes re-render before propagation fires.
      useFlowStore.getState().updateNodeData(id, { videoUrl: url });
      document.dispatchEvent(new CustomEvent('node:video-propagate', {
        detail: { sourceNodeId: id, videoUrl: url },
      }));
    }
  }

  // Derive the FAL endpoint for the current model/mode so the status poller uses the right one.
  function getFalEndpoint(): string {
    const modelConfig = FAL_MODELS[data.model as keyof typeof FAL_MODELS];
    if (!modelConfig) return 'fal-ai/kling-video/v3/pro/text-to-video';
    if (hasImage && 'imageToVideoEndpoint' in modelConfig) {
      return (modelConfig as { imageToVideoEndpoint: string }).imageToVideoEndpoint;
    }
    return (modelConfig as { endpoint: string }).endpoint;
  }

  async function handleGenerate() {
    if (isGenerating) return;
    if (isOmni && !hasImage) {
      updateData({ status: 'error', errorMessage: 'Google Omni Flash requires a start frame.' });
      return;
    }
    setIsGenerating(true);
    updateData({ status: 'processing', errorMessage: undefined, pendingRequestId: undefined, pendingEndpoint: undefined });

    const endpoint = getFalEndpoint();
    useFlowStore.getState().consumeGcsOnlyEligibility();

    try {
      const res = await fetch('/api/fal/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: data.model,
          prompt: data.prompt ?? '',
          aspectRatio: data.aspectRatio,
          duration: data.duration,
          startFrameUrl: data.startFrameUrl,
          endFrameUrl: data.endFrameUrl,
          generateAudio: data.generateAudio ?? true,
          seedanceResolution: data.seedanceResolution ?? '720p',
          sourceType: 'canvas',
          sourceId: useFlowStore.getState().currentFlow?.id,
          nodeId: id,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string; details?: string };
        updateData({ status: 'error', errorMessage: err.details ?? err.error ?? `Server error ${res.status}` });
        setIsGenerating(false);
        return;
      }

      const result = await res.json() as { mediaUrls?: string[]; requestId?: string; error?: string; details?: string };

      if (result.mediaUrls?.[0]) {
        const newHistory = [...(data.videoHistory ?? []), result.mediaUrls[0]];
        updateData({ videoUrl: result.mediaUrls[0], videoHistory: newHistory, status: 'completed' });
        playSuccessSound();
        document.dispatchEvent(new CustomEvent('node:video-propagate', {
          detail: { sourceNodeId: id, videoUrl: result.mediaUrls[0] },
        }));
      } else if (result.requestId) {
        updateData({ pendingRequestId: result.requestId, pendingEndpoint: endpoint });
        pollForResult(result.requestId, endpoint);
      } else {
        updateData({ status: 'error', errorMessage: result.details ?? result.error ?? 'Generation failed — no request ID returned.' });
        setIsGenerating(false);
      }
    } catch (err) {
      updateData({ status: 'error', errorMessage: err instanceof Error ? err.message : 'Network error — check your connection and try again.' });
      setIsGenerating(false);
    }
  }

  function pollForResult(requestId: string, endpoint: string) {
    let attempts = 0;
    const MAX_ATTEMPTS = 200; // ~16 min at 5s intervals
    const interval = setInterval(async () => {
      attempts++;
      if (attempts > MAX_ATTEMPTS) {
        clearInterval(interval);
        updateData({
          status: 'error',
          errorMessage: `Timed out after ~${Math.round(MAX_ATTEMPTS * 5 / 60)} minutes. The video may still be generating on FAL's servers — click "Check status on FAL" below to resume.`,
          pendingRequestId: requestId,
          pendingEndpoint: endpoint,
        });
        setIsGenerating(false);
        return;
      }
      try {
        const res = await fetch(`/api/fal/status/${requestId}?endpoint=${encodeURIComponent(endpoint)}`);
        const result = await res.json() as { status: string; mediaUrls?: string[]; error?: string };
        if (result.status === 'completed' && result.mediaUrls?.[0]) {
          clearInterval(interval);
          const currentNodes = useFlowStore.getState().nodes;
          const currentData = currentNodes.find(n => n.id === id)?.data as VideoGenNodeData | undefined;
          const newHistory = [...(currentData?.videoHistory ?? []), result.mediaUrls[0]];
          updateData({
            videoUrl: result.mediaUrls[0],
            videoHistory: newHistory,
            status: 'completed',
            pendingRequestId: undefined,
            pendingEndpoint: undefined,
            errorMessage: undefined,
          });
          playSuccessSound();
          document.dispatchEvent(new CustomEvent('node:video-propagate', {
            detail: { sourceNodeId: id, videoUrl: result.mediaUrls[0] },
          }));
          setIsGenerating(false);
        } else if (result.status === 'failed') {
          clearInterval(interval);
          updateData({
            status: 'error',
            errorMessage: result.error ?? 'FAL reported that the generation failed. This may be due to an invalid input or a server issue.',
            pendingRequestId: requestId,
            pendingEndpoint: endpoint,
          });
          setIsGenerating(false);
        }
        // 'pending' or transient 'error' — keep polling
      } catch { /* keep polling on network hiccups */ }
    }, 5000);
  }

  function resumePolling() {
    if (!data.pendingRequestId || !data.pendingEndpoint) return;
    setIsGenerating(true);
    updateData({ status: 'processing', errorMessage: undefined });
    pollForResult(data.pendingRequestId, data.pendingEndpoint);
  }

  const displayVideoUrl = videoHistory.length > 0 ? (videoHistory[histIdx] ?? data.videoUrl) : data.videoUrl;

  const videoAspect = (() => {
    const parts = data.aspectRatio.split(':');
    if (parts.length === 2 && !isNaN(Number(parts[0])) && !isNaN(Number(parts[1]))) {
      return `${parts[0]}/${parts[1]}`;
    }
    return '16/9';
  })();

  const currentAspectOptions = [
    ...(isKling && hasImage && data.imageAspectRatio && !aspectRatios.includes(data.imageAspectRatio)
      ? [data.imageAspectRatio]
      : []),
    ...aspectRatios,
  ];

  const footer = (
    <>
      <button
        onClick={handleGenerate}
        disabled={isGenerating || (isOmni && !hasImage)}
        title={isOmni && !hasImage ? 'Connect a start frame to generate with Google Omni Flash' : undefined}
        className="w-full flex items-center justify-center gap-1.5 py-3 text-xs font-medium transition-opacity disabled:opacity-40 nodrag"
        style={{ background: 'var(--action-btn-bg)', color: 'var(--action-btn-color)', borderRadius: 11 }}
      >
        <Play size={12} />
        {isGenerating ? 'Generating…' : 'Generate'}
      </button>

      {/* Recovery button — shown when polling timed out but the job may have finished on FAL */}
      {data.status === 'error' && data.pendingRequestId && !isGenerating && (
        <button
          onClick={resumePolling}
          className="w-full flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium mt-1.5 nodrag"
          style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--color-error)', borderRadius: 11, border: '1px solid var(--color-error)' }}
        >
          <AlertTriangle size={12} />
          Check status on FAL
        </button>
      )}

      {displayVideoUrl && (
        <button
          onClick={() => downloadFromUrl(displayVideoUrl)}
          className="w-full flex items-center justify-center gap-1.5 py-3 text-xs font-medium mt-1.5 nodrag transition-opacity hover:opacity-80 active:opacity-60"
          style={{ background: 'var(--color-bg-surface)', color: 'var(--color-white-muted)', borderRadius: 11 }}
        >
          <Download size={12} />
          Download
        </button>
      )}
    </>
  );

  return (
    <NodeWrapper
      title="Video Generation"
      icon={<Film size={14} />}
      status={data.status}
      errorMessage={data.errorMessage}
      selected={selected}
      minWidth={300}
      accentColor={PORT_COLORS.video}
      titlePosition="outside"
      footer={footer}
    >
      <TypedHandle
        type="target"
        position={Position.Left}
        id="prompt"
        portType="text"
        offset={`${promptHandleTop}px`}
        connected={!!data.promptConnected}
      />
      <TypedHandle
        type="target"
        position={Position.Left}
        id="start_frame"
        portType="image"
        offset={`${startFrameHandleTop}px`}
        connected={storeEdges.some(e => e.target === id && e.targetHandle === 'start_frame')}
      />
      {!isOmni && (
        <TypedHandle
          type="target"
          position={Position.Left}
          id="end_frame"
          portType="image"
          offset={`${endFrameHandleTop}px`}
          connected={storeEdges.some(e => e.target === id && e.targetHandle === 'end_frame')}
        />
      )}

      {/* Prompt */}
      <div ref={promptSectionRef} className="mb-3">
        {data.promptConnected ? (
          <div
            className="flex items-center gap-2 px-3 rounded-lg text-xs font-medium"
            style={{ height: 36, background: '#3999F8', color: '#fff' }}
          >
            <span style={{ fontSize: 10 }}>T</span>
            Prompt connected
          </div>
        ) : (
          <textarea
            ref={promptTextareaRef}
            className="w-full text-xs outline-none nodrag"
            rows={2}
            placeholder="Write your prompt here…"
            value={localPrompt}
            onFocus={() => { isFocused.current = true; }}
            onBlur={() => { isFocused.current = false; }}
            onChange={(e) => { const v = e.target.value; setLocalPrompt(v); autoResize(e.target); updateData({ prompt: v }); }}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--color-white)',
              resize: 'none',
              overflow: 'hidden',
              minHeight: 40,
            }}
          />
        )}
      </div>

      {/* Model selector */}
      <div className="mb-2">
        <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-white-muted)' }}>Model</label>
        <ModelSelect options={VIDEO_MODELS} value={data.model} onChange={handleModelChange} />
      </div>

      {isSeedance && (
        <>
          <div
            className="flex items-start gap-1.5 px-2 py-1.5 rounded-lg mb-2 text-xs nodrag"
            style={{ background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.3)', color: '#eab308' }}
          >
            <AlertTriangle size={11} className="shrink-0 mt-0.5" />
            This is a very expensive model to use, please use wisely.
          </div>

          {/* Generate Audio toggle */}
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs" style={{ color: 'var(--color-white-muted)' }}>Generate Audio</span>
            <button
              className="nodrag relative inline-flex items-center rounded-full transition-colors"
              style={{
                width: 32,
                height: 18,
                background: (data.generateAudio ?? true) ? 'var(--color-accent)' : 'var(--color-bg-surface)',
                border: '1px solid rgba(255,255,255,0.1)',
                flexShrink: 0,
              }}
              onClick={() => updateData({ generateAudio: !(data.generateAudio ?? true) })}
            >
              <span
                className="absolute rounded-full transition-transform"
                style={{
                  width: 12,
                  height: 12,
                  background: 'var(--color-white)',
                  left: 2,
                  transform: (data.generateAudio ?? true) ? 'translateX(14px)' : 'translateX(0)',
                  transition: 'transform 0.15s ease',
                }}
              />
            </button>
          </div>
        </>
      )}

      <div className={`grid gap-2 mb-3 ${isSeedance ? 'grid-cols-3' : 'grid-cols-2'}`}>
        <div>
          <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-white-muted)' }}>Aspect</label>
          <NodeSelect
            options={currentAspectOptions}
            value={data.aspectRatio}
            onChange={(v) => updateData({ aspectRatio: v })}
          />
        </div>
        <div>
          <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-white-muted)' }}>Duration</label>
          <NodeSelect
            options={DURATION_OPTIONS}
            value={`${data.duration ?? 5}s`}
            onChange={(v) => updateData({ duration: DURATION_MAP[v] ?? 5 })}
          />
        </div>
        {isSeedance && (
          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-white-muted)' }}>Resolution</label>
            <NodeSelect
              options={SEEDANCE_RESOLUTIONS}
              value={data.seedanceResolution ?? '720p'}
              onChange={(v) => updateData({ seedanceResolution: v as '720p' | '1080p' | '4k' })}
            />
          </div>
        )}
      </div>

      {/* Frame reference slots */}
      <div className="mb-3">
        <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-white-muted)' }}>Frame References</label>
        <div
          ref={startFrameRowRef}
          className="flex items-center text-xs"
          style={{
            height: FRAME_ROW_HEIGHT,
            paddingLeft: 12,
            paddingRight: 12,
            borderRadius: '4px 16px 16px 4px',
            background: data.startFrameUrl ? '#a855f7' : 'var(--color-bg-surface)',
            color: data.startFrameUrl ? '#fff' : 'var(--color-white-muted)',
            marginBottom: isOmni ? 0 : FRAME_ROW_GAP,
            transition: 'background 0.15s, color 0.15s',
          }}
        >
          Start Frame{isOmni ? ' (Required)' : ''}
        </div>
        {!isOmni && (
          <div
            ref={endFrameRowRef}
            className="flex items-center text-xs"
            style={{
              height: FRAME_ROW_HEIGHT,
              paddingLeft: 12,
              paddingRight: 12,
              borderRadius: '4px 16px 16px 4px',
              background: data.endFrameUrl ? '#a855f7' : 'var(--color-bg-surface)',
              color: data.endFrameUrl ? '#fff' : 'var(--color-white-muted)',
              transition: 'background 0.15s, color 0.15s',
            }}
          >
            End Frame
          </div>
        )}
      </div>

      {/* Video history navigation */}
      {videoHistory.length > 1 && (
        <div className="flex items-center justify-between my-1.5">
          <button
            onClick={() => navigateHistory(Math.max(0, histIdx - 1))}
            disabled={histIdx === 0}
            className="flex items-center p-0.5 rounded transition-opacity disabled:opacity-30 nodrag"
            style={{ color: 'var(--color-white-muted)' }}
          >
            <ChevronLeft size={13} />
          </button>
          <span className="text-xs" style={{ color: histIdx < videoHistory.length - 1 ? 'var(--color-accent)' : 'var(--color-white-muted)', fontSize: 10 }}>
            {`VERSION ${histIdx + 1}`}
          </span>
          <button
            onClick={() => navigateHistory(Math.min(videoHistory.length - 1, histIdx + 1))}
            disabled={histIdx === videoHistory.length - 1}
            className="flex items-center p-0.5 rounded transition-opacity disabled:opacity-30 nodrag"
            style={{ color: 'var(--color-white-muted)' }}
          >
            <ChevronRight size={13} />
          </button>
        </div>
      )}

      {displayVideoUrl && (
        <div style={{ borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)', overflow: 'hidden' }}>
          <video
            src={displayVideoUrl}
            controls
            className="w-full block nodrag"
            style={{ aspectRatio: videoAspect }}
          />
        </div>
      )}

      <TypedHandle
        type="source"
        position={Position.Right}
        id="video"
        portType="video"
        connected={storeEdges.some(e => e.source === id && e.sourceHandle === 'video')}
      />
    </NodeWrapper>
  );
}
