'use client';

import { Position, type NodeProps } from '@xyflow/react';
import { Film, Play, AlertTriangle, Download, ChevronLeft, ChevronRight, Clock3 } from 'lucide-react';
import { downloadFromUrl } from '@/lib/utils/download';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NodeWrapper } from './NodeWrapper';
import { GenerationFailureOverlay, RegenerateGate } from './GenerationFailure';
import { TypedHandle, PORT_COLORS } from './TypedHandle';
import type { VideoGenNodeData, ImageInputNodeData, ImageGenNodeData } from '@/types';
import { VIDEO_MODELS, FAL_MODELS } from '@/lib/api/models';
import { ModelSelect } from './ModelSelect';
import { NodeSelect } from './NodeSelect';
import { useFlowStore } from '@/lib/stores/flowStore';
import { CanvasVideo } from '@/components/canvas/CanvasMedia';
import { generationJobId, useGenerationStore } from '@/lib/stores/generationStore';
import { startTrackedVideoGeneration } from '@/lib/generationTracker';
import { cn } from '@/lib/utils/cn';
import glassStyles from './ImageGenerationGlass.module.css';
import { AspectRatioGlyph } from './AspectRatioGlyph';

const KLING_ASPECT_RATIOS    = ['16:9', '9:16', '1:1'];
const OMNI_ASPECT_RATIOS     = ['16:9', '9:16'];
const SEEDANCE_ASPECT_RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];
const SEEDANCE_RESOLUTIONS   = ['720p', '1080p', '4k'];
const SEEDANCE_MINI_RESOLUTIONS = ['720p', '480p'];

const DURATION_OPTIONS = ['3s', '5s', '8s', '10s'];
const SEEDANCE_MINI_DURATION_OPTIONS = ['4s', '5s', '8s', '10s'];
const DURATION_MAP: Record<string, number> = { '3s': 3, '5s': 5, '8s': 8, '10s': 10 };
const SEEDANCE_MINI_DURATION_MAP: Record<string, number> = { '4s': 4, '5s': 5, '8s': 8, '10s': 10 };

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function autoResize(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

export function VideoGenNode({ data, selected, id }: NodeProps & { data: VideoGenNodeData }) {
  const currentFlow = useFlowStore((state) => state.currentFlow);
  const activeJobId = currentFlow ? generationJobId(currentFlow.id, id) : '';
  const isGenerating = useGenerationStore((state) => !!state.jobs[activeJobId]);
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
  const isSeedanceFull = data.model === 'seedance-2';
  const isSeedanceMini = data.model === 'seedance-2-mini';
  const isSeedance  = isSeedanceFull || isSeedanceMini;
  const hasImage    = !!data.startFrameUrl;

  const aspectRatios = isSeedance
    ? SEEDANCE_ASPECT_RATIOS
    : isOmni
      ? OMNI_ASPECT_RATIOS
      : KLING_ASPECT_RATIOS;
  const seedanceResolutionOptions = isSeedanceMini
    ? SEEDANCE_MINI_RESOLUTIONS
    : SEEDANCE_RESOLUTIONS;
  const durationOptions = isSeedanceMini
    ? SEEDANCE_MINI_DURATION_OPTIONS
    : DURATION_OPTIONS;
  const durationMap = isSeedanceMini
    ? SEEDANCE_MINI_DURATION_MAP
    : DURATION_MAP;
  const selectedDuration = isSeedanceMini && (data.duration ?? 5) < 4
    ? 5
    : data.duration ?? 5;
  const selectedSeedanceResolution = isSeedanceMini && !SEEDANCE_MINI_RESOLUTIONS.includes(data.seedanceResolution ?? '720p')
    ? '720p'
    : data.seedanceResolution ?? '720p';

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
  }, [data.promptConnected, localPrompt]);

  useLayoutEffect(() => {
    const start = startFrameRowRef.current;
    const end = endFrameRowRef.current;
    if (start) setStartFrameHandleTop(start.offsetTop + start.offsetHeight / 2);
    if (end) setEndFrameHandleTop(end.offsetTop + end.offsetHeight / 2);
  }, [isOmni, data.startFrameUrl, data.endFrameUrl, isSeedance, isSeedanceFull, localPrompt, data.promptConnected]);

  function updateData(updates: Partial<VideoGenNodeData>) {
    document.dispatchEvent(new CustomEvent('node:update', {
      detail: { nodeId: id, data: updates },
    }));
  }

  function handleModelChange(model: string) {
    const modelConfig = VIDEO_MODELS.find(option => option.id === model);
    const supportedAspectRatios = modelConfig?.supportedAspectRatios ?? [];
    const nextIsSeedanceMini = model === 'seedance-2-mini';
    updateData({
      model,
      ...(!supportedAspectRatios.includes(data.aspectRatio) && supportedAspectRatios[0]
        ? { aspectRatio: supportedAspectRatios[0] }
        : {}),
      ...(nextIsSeedanceMini && !SEEDANCE_MINI_RESOLUTIONS.includes(data.seedanceResolution ?? '720p')
        ? { seedanceResolution: '720p' as const }
        : {}),
      ...(nextIsSeedanceMini && (data.duration ?? 5) < 4
        ? { duration: 5 }
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

  function handleGenerate() {
    if (isGenerating || !currentFlow) return;
    if (isOmni && !hasImage) {
      updateData({ status: 'error', errorMessage: 'Google Omni Flash requires a start frame.' });
      return;
    }

    const endpoint = getFalEndpoint();
    useFlowStore.getState().consumeGcsOnlyEligibility();
    void startTrackedVideoGeneration({
      flowId: currentFlow.id,
      flowTitle: currentFlow.title,
      nodeId: id,
      data,
      endpoint,
      payload: {
        model: data.model,
        prompt: data.prompt ?? '',
        aspectRatio: data.aspectRatio,
        duration: selectedDuration,
        startFrameUrl: data.startFrameUrl,
        endFrameUrl: data.endFrameUrl,
        generateAudio: data.generateAudio ?? true,
        seedanceResolution: selectedSeedanceResolution,
        sourceType: 'canvas',
        sourceId: currentFlow.id,
        nodeId: id,
      },
    });
  }

  /** Clears the failure so the Generate button unlocks for the edited inputs. */
  function acknowledgeFailure() {
    updateData({ status: 'idle', errorMessage: undefined, errorRequestId: undefined });
  }

  const displayVideoUrl = videoHistory.length > 0 ? (videoHistory[histIdx] ?? data.videoUrl) : data.videoUrl;
  const hasFailure = data.status === 'error';

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
    <div className={glassStyles.footerStack}>
      <button
        onClick={handleGenerate}
        disabled={isGenerating || hasFailure || (isOmni && !hasImage)}
        title={
          hasFailure
            ? 'Change the prompt or inputs, then confirm below to regenerate'
            : isOmni && !hasImage
              ? 'Connect a start frame to generate with Google Omni Flash'
              : undefined
        }
        className={cn(
          glassStyles.glassSurface,
          glassStyles.button,
          glassStyles.generateButton,
          'transition-opacity disabled:opacity-40 nodrag',
        )}
      >
        <span className={cn(glassStyles.glassContent, glassStyles.buttonContent)}>
          <Play size={12} />
          {isGenerating ? 'Generating…' : 'Generate'}
        </span>
      </button>

      {hasFailure && <RegenerateGate onChangesApplied={acknowledgeFailure} />}

      {displayVideoUrl && (
        <button
          onClick={() => downloadFromUrl(displayVideoUrl)}
          className={cn(
            glassStyles.glassSurface,
            glassStyles.button,
            glassStyles.downloadButton,
            'nodrag transition-opacity hover:opacity-80 active:opacity-60',
          )}
        >
          <span className={cn(glassStyles.glassContent, glassStyles.buttonContent)}>
            <Download size={12} />
            Download
          </span>
        </button>
      )}
    </div>
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
      appearance="imageGenerationGlass"
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
      <div
        ref={promptSectionRef}
        className={cn(glassStyles.glassSurface, glassStyles.promptSection, glassStyles.promptSurface)}
      >
        {data.promptConnected ? (
          <div className={cn(glassStyles.glassContent, glassStyles.connectedPrompt)}>
            Prompt connected
          </div>
        ) : (
          <textarea
            ref={promptTextareaRef}
            className={cn(glassStyles.glassContent, glassStyles.promptContent, 'outline-none nodrag')}
            rows={2}
            placeholder="Write your prompt here…"
            value={localPrompt}
            onFocus={() => { isFocused.current = true; }}
            onBlur={() => { isFocused.current = false; }}
            onChange={(e) => { const v = e.target.value; setLocalPrompt(v); autoResize(e.target); updateData({ prompt: v }); }}
          />
        )}
      </div>

      {/* Model selector */}
      <ModelSelect options={VIDEO_MODELS} value={data.model} onChange={handleModelChange} />

      {isSeedanceFull && (
        <div className={cn(glassStyles.notice, glassStyles.noticeWarning, 'nodrag')}>
          <AlertTriangle size={11} className="shrink-0 mt-0.5" />
          This is a very expensive model to use, please use wisely.
        </div>
      )}

      {isSeedance && (
        <div className={glassStyles.rowBetween}>
          <span className={glassStyles.microLabel}>Generate Audio</span>
          <button
            className={cn(
              glassStyles.glassSurface,
              glassStyles.switch,
              (data.generateAudio ?? true) && glassStyles.switchOn,
              'nodrag',
            )}
            aria-pressed={data.generateAudio ?? true}
            onClick={() => updateData({ generateAudio: !(data.generateAudio ?? true) })}
          >
            <span className={cn(glassStyles.glassContent, glassStyles.switchKnob)} />
          </button>
        </div>
      )}

      <div className={isSeedance ? glassStyles.grid3 : glassStyles.grid2}>
        <div className={glassStyles.field}>
          <NodeSelect
            options={currentAspectOptions}
            value={data.aspectRatio}
            onChange={(v) => updateData({ aspectRatio: v })}
            leadingIcon={<AspectRatioGlyph ratio={data.aspectRatio} />}
            optionIcon={(ratio) => <AspectRatioGlyph ratio={ratio} />}
          />
        </div>
        <div className={glassStyles.field}>
          <NodeSelect
            options={durationOptions}
            value={`${selectedDuration}s`}
            onChange={(v) => updateData({ duration: durationMap[v] ?? 5 })}
            leadingIcon={<Clock3 size={10} />}
            optionIcon={() => <Clock3 size={10} />}
          />
        </div>
        {isSeedance && (
          <div className={glassStyles.field}>
            <span className={glassStyles.microLabel}>Resolution</span>
            <NodeSelect
              options={seedanceResolutionOptions}
              value={selectedSeedanceResolution}
              onChange={(v) => updateData({ seedanceResolution: v as '480p' | '720p' | '1080p' | '4k' })}
            />
          </div>
        )}
      </div>

      {/* Frame reference slots */}
      <div className={glassStyles.referenceSection}>
        <label className={glassStyles.microLabel}>Frame References</label>
        <div className={glassStyles.connectorRows}>
          <div
            ref={startFrameRowRef}
            className={cn(
              glassStyles.glassSurface,
              glassStyles.connector,
              data.startFrameUrl ? glassStyles.connectorActive : glassStyles.connectorInactive,
            )}
          >
            <span className={glassStyles.glassContent}>
              Start Frame{isOmni ? ' (Required)' : ''}
            </span>
          </div>
          {!isOmni && (
            <div
              ref={endFrameRowRef}
              className={cn(
                glassStyles.glassSurface,
                glassStyles.connector,
                data.endFrameUrl ? glassStyles.connectorActive : glassStyles.connectorInactive,
              )}
            >
              <span className={glassStyles.glassContent}>End Frame</span>
            </div>
          )}
        </div>
      </div>

      {/* Video history navigation */}
      {videoHistory.length > 1 && (
        <div className={glassStyles.historyNav}>
          <button
            onClick={() => navigateHistory(Math.max(0, histIdx - 1))}
            disabled={histIdx === 0}
            className="flex items-center p-0.5 rounded transition-opacity disabled:opacity-30 nodrag"
            style={{ color: 'var(--color-white-muted)' }}
          >
            <ChevronLeft size={13} />
          </button>
          <span
            className={glassStyles.microLabel}
            style={{ color: histIdx < videoHistory.length - 1 ? 'var(--color-accent)' : undefined }}
          >
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

      {hasFailure && (
        <div
          className={glassStyles.mediaFrame}
          style={{ aspectRatio: videoAspect, borderColor: 'var(--color-error)' }}
        >
          <GenerationFailureOverlay
            message={data.errorMessage}
            requestId={data.errorRequestId}
          />
        </div>
      )}

      {displayVideoUrl && (
        <div className={glassStyles.mediaFrame}>
          <CanvasVideo
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
