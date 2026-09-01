'use client';

import { Position, type NodeProps } from '@xyflow/react';
import { Film, AlertTriangle, Download, ChevronLeft, ChevronRight, Clock3 } from 'lucide-react';
import Image from 'next/image';
import { downloadFromUrl } from '@/lib/utils/download';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NodeWrapper } from './NodeWrapper';
import { GenerationFailureOverlay, RegenerateGate } from './GenerationFailure';
import { TypedHandle, PORT_COLORS } from './TypedHandle';
import type { VideoGenNodeData, ImageInputNodeData, ImageGenNodeData, MediaInputNodeData } from '@/types';
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
import FalCostEstimate from './FalCostEstimate';

type VideoResolution = NonNullable<VideoGenNodeData['videoResolution']>;

const LOCKED_RESOLUTIONS: Partial<Record<string, VideoResolution>> = {
  'seedance-2-mini': '720p',
  'kling-3-pro': '1080p',
};

const DURATION_OPTIONS = ['3s', '5s', '8s', '10s'];
const SEEDANCE_DURATION_OPTIONS = ['4s', '5s', '8s', '10s', '15s'];
const SEEDANCE_2_5_DURATION_OPTIONS = ['4s', '5s', '8s', '10s', '15s', '20s', '25s', '30s'];
const SEEDANCE_MINI_DURATION_OPTIONS = ['4s', '5s', '8s', '10s'];
const FLUX_DURATION_OPTIONS = ['5s', '8s', '10s', '15s', '20s'];
const MINIMAX_DURATION_OPTIONS = ['5s', '8s', '10s', '15s'];

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
  const isSeedanceFull = data.model === 'seedance-2';
  const isSeedance25 = data.model === 'seedance-2-5';
  const isSeedanceMini = data.model === 'seedance-2-mini';
  const isSeedance  = isSeedanceFull || isSeedance25 || isSeedanceMini;
  const isFlux3     = data.model === 'flux-3';
  const isMinimaxH3 = data.model === 'minimax-h3' || data.model === 'minimax-h3-max';
  const hasImage    = !!data.startFrameUrl;
  const modelConfig = VIDEO_MODELS.find(option => option.id === data.model) ?? VIDEO_MODELS[0];

  const aspectRatios = modelConfig.supportedAspectRatios;
  const lockedResolution = LOCKED_RESOLUTIONS[data.model];
  const resolutionOptions = (lockedResolution
    ? [lockedResolution]
    : modelConfig.supportedResolutions) as VideoResolution[];
  const durationOptions = isSeedanceFull
    ? SEEDANCE_DURATION_OPTIONS
    : isSeedance25
      ? SEEDANCE_2_5_DURATION_OPTIONS
      : isSeedanceMini
        ? SEEDANCE_MINI_DURATION_OPTIONS
      : isFlux3
        ? FLUX_DURATION_OPTIONS
        : isMinimaxH3
          ? MINIMAX_DURATION_OPTIONS
          : DURATION_OPTIONS;
  const requestedDuration = `${data.duration ?? 5}s`;
  const selectedDuration = Number.parseInt(
    durationOptions.includes(requestedDuration) ? requestedDuration : durationOptions[0],
    10,
  );
  const storedResolution = data.videoResolution ?? data.seedanceResolution;
  const selectedResolution = lockedResolution
    ?? (storedResolution && resolutionOptions.includes(storedResolution as VideoResolution)
      ? storedResolution as VideoResolution
      : resolutionOptions[0]) ?? '720p';
  const followsInputAspect = hasImage && (isKling || isMinimaxH3);
  const supportsEndFrame = !isFlux3;
  const supportsAudio = isSeedance || isFlux3 || isKling;

  // Read start-frame source node directly from store (reactive, zero-latency)
  const storeEdges = useFlowStore(state => state.edges);
  const storeNodes = useFlowStore(state => state.nodes);
  const startFrameEdge = storeEdges.find(e => e.target === id && e.targetHandle === 'start_frame');
  const startFrameSource = startFrameEdge ? storeNodes.find(n => n.id === startFrameEdge.source) : undefined;

  // Derive aspect ratio from source node data synchronously
  const derivedAspect = (() => {
    if (!followsInputAspect || !startFrameSource) return undefined;
    if (startFrameSource.type === 'imageInputNode' || startFrameSource.type === 'mediaInputNode') {
      const { naturalWidth, naturalHeight } = startFrameSource.data as ImageInputNodeData | MediaInputNodeData;
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

  // Clear an input-derived ratio when the image is disconnected or the model no longer follows it.
  useEffect(() => {
    if (!followsInputAspect && data.imageAspectRatio) {
      updateData({
        imageAspectRatio: undefined,
        ...(!aspectRatios.includes(data.aspectRatio) ? { aspectRatio: aspectRatios[0] } : {}),
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followsInputAspect]);

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
  }, [supportsEndFrame, data.startFrameUrl, data.endFrameUrl, supportsAudio, isSeedanceFull, localPrompt, data.promptConnected]);

  function updateData(updates: Partial<VideoGenNodeData>) {
    document.dispatchEvent(new CustomEvent('node:update', {
      detail: { nodeId: id, data: updates },
    }));
  }

  function handleModelChange(model: string) {
    const modelConfig = VIDEO_MODELS.find(option => option.id === model);
    const supportedAspectRatios = modelConfig?.supportedAspectRatios ?? [];
    const supportedResolutions = modelConfig?.supportedResolutions as VideoResolution[] | undefined;
    const nextDurationOptions = model === 'seedance-2'
      ? SEEDANCE_DURATION_OPTIONS
      : model === 'seedance-2-5'
        ? SEEDANCE_2_5_DURATION_OPTIONS
        : model === 'seedance-2-mini'
          ? SEEDANCE_MINI_DURATION_OPTIONS
        : model === 'flux-3'
          ? FLUX_DURATION_OPTIONS
          : model === 'minimax-h3' || model === 'minimax-h3-max'
            ? MINIMAX_DURATION_OPTIONS
            : DURATION_OPTIONS;
    const nextLockedResolution = LOCKED_RESOLUTIONS[model];
    const nextResolution = nextLockedResolution
      ?? (storedResolution && supportedResolutions?.includes(storedResolution as VideoResolution)
        ? storedResolution as VideoResolution
        : supportedResolutions?.[0]);
    updateData({
      model,
      ...(!supportedAspectRatios.includes(data.aspectRatio) && supportedAspectRatios[0]
        ? { aspectRatio: supportedAspectRatios[0] }
        : {}),
      ...(nextResolution ? { videoResolution: nextResolution } : {}),
      ...(!nextDurationOptions.includes(`${data.duration ?? 5}s`)
        ? { duration: Number.parseInt(nextDurationOptions[0], 10) }
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
        videoResolution: selectedResolution,
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
    ...(followsInputAspect && data.imageAspectRatio && !aspectRatios.includes(data.imageAspectRatio)
      ? [data.imageAspectRatio]
      : []),
    ...aspectRatios,
  ];

  const footer = (
    <div className={glassStyles.footerStack}>
      <button
        onClick={handleGenerate}
        disabled={isGenerating || hasFailure}
        title={
          hasFailure
            ? 'Change the prompt or inputs, then confirm below to regenerate'
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
          <Image src="/node-icons/icon-generate.svg" alt="" width={11} height={11} aria-hidden />
          {isGenerating ? 'Generating…' : 'Generate'}
          <FalCostEstimate input={{
            endpoint: getFalEndpoint(),
            aspectRatio: data.aspectRatio,
            resolution: selectedResolution,
            duration: selectedDuration,
            generateAudio: data.generateAudio ?? true,
          }} />
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
      {supportsEndFrame && (
        <TypedHandle
          type="target"
          position={Position.Left}
          id="end_frame"
          portType="image"
          offset={`${endFrameHandleTop}px`}
          connected={storeEdges.some(e => e.target === id && e.targetHandle === 'end_frame')}
          disabled={!startFrameEdge}
          disabledReason="Connect a Start Frame first — End Frame requires a Start Frame"
        />
      )}

      {/* Prompt */}
      <div
        ref={promptSectionRef}
        className={cn(
          glassStyles.glassSurface,
          glassStyles.promptSection,
          glassStyles.promptSurface,
          data.promptConnected && glassStyles.connectedTextPrompt,
        )}
      >
        {data.promptConnected ? (
          <div className={cn(
            glassStyles.glassContent,
            glassStyles.connectedPrompt,
          )}>
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
          Expensive model, please use carefully.
        </div>
      )}

      {supportsAudio && (
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

      <div className={glassStyles.grid3}>
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
            onChange={(v) => updateData({ duration: Number.parseInt(v, 10) || 5 })}
            leadingIcon={<Clock3 size={10} />}
            optionIcon={() => <Clock3 size={10} />}
          />
        </div>
        <div className={glassStyles.field}>
          <NodeSelect
            options={resolutionOptions}
            value={selectedResolution}
            onChange={(v) => updateData({ videoResolution: v as VideoResolution })}
            leadingIcon={<Image src="/node-icons/icon-resolution.svg" alt="" width={10} height={10} aria-hidden />}
            optionIcon={() => <Image src="/node-icons/icon-resolution.svg" alt="" width={10} height={10} aria-hidden />}
            locked={!!lockedResolution}
          />
        </div>
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
              Start Frame
            </span>
          </div>
          {supportsEndFrame && (
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
