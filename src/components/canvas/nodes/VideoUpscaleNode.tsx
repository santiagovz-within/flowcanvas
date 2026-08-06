'use client';

import { Position, type NodeProps } from '@xyflow/react';
import { Zap, Play, Download } from 'lucide-react';
import { downloadFromUrl } from '@/lib/utils/download';
import { playSuccessSound } from '@/lib/utils/sound';
import { useState } from 'react';
import { NodeWrapper } from './NodeWrapper';
import { TypedHandle, PORT_COLORS } from './TypedHandle';
import type { VideoUpscaleNodeData, VideoGenNodeData, VideoInputNodeData } from '@/types';
import { useFlowStore } from '@/lib/stores/flowStore';
import { CanvasVideo } from '@/components/canvas/CanvasMedia';
import { cn } from '@/lib/utils/cn';
import glassStyles from './ImageGenerationGlass.module.css';

const SCALE_OPTIONS = [2, 3, 4];

export function VideoUpscaleNode({ data, selected, id }: NodeProps & { data: VideoUpscaleNodeData }) {
  const [isProcessing, setIsProcessing] = useState(false);

  const storeEdges = useFlowStore(state => state.edges);
  const storeNodes = useFlowStore(state => state.nodes);

  const incomingEdge = storeEdges.find(e => e.target === id && e.targetHandle === 'video_in');
  const sourceNode = incomingEdge ? storeNodes.find(n => n.id === incomingEdge.source) : undefined;

  let inputVideoUrl: string | undefined;
  if (sourceNode?.type === 'videoGenNode') {
    inputVideoUrl = (sourceNode.data as VideoGenNodeData).videoUrl;
  } else if (sourceNode?.type === 'videoInputNode') {
    inputVideoUrl = (sourceNode.data as VideoInputNodeData).videoUrl;
  } else if (sourceNode?.type === 'videoUpscaleNode') {
    inputVideoUrl = (sourceNode.data as VideoUpscaleNodeData).videoUrl;
  }

  const upscaleFactor = data.upscaleFactor ?? 2;

  function updateData(updates: Partial<VideoUpscaleNodeData>) {
    document.dispatchEvent(new CustomEvent('node:update', {
      detail: { nodeId: id, data: updates },
    }));
  }

  async function handleUpscale() {
    if (!inputVideoUrl || isProcessing) return;
    setIsProcessing(true);
    updateData({ status: 'processing' });
    useFlowStore.getState().consumeGcsOnlyEligibility();

    try {
      const res = await fetch('/api/fal/video-upscale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUrl: inputVideoUrl,
          upscaleFactor,
          sourceId: useFlowStore.getState().currentFlow?.id,
          nodeId: id,
        }),
      });
      const result = await res.json();

      if (result.mediaUrls?.[0]) {
        updateData({ videoUrl: result.mediaUrls[0], status: 'completed', errorMessage: undefined });
        playSuccessSound();
        document.dispatchEvent(new CustomEvent('node:video-propagate', {
          detail: { sourceNodeId: id, videoUrl: result.mediaUrls[0] },
        }));
        setIsProcessing(false);
      } else if (result.requestId) {
        pollForResult(result.requestId);
      } else {
        updateData({ status: 'error', errorMessage: result.details ?? result.error ?? 'Video upscale failed — no output returned.' });
        setIsProcessing(false);
      }
    } catch (err) {
      updateData({ status: 'error', errorMessage: err instanceof Error ? err.message : 'Network error — check your connection.' });
      setIsProcessing(false);
    }
  }

  async function pollForResult(requestId: string) {
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      if (attempts > 120) {
        clearInterval(interval);
        updateData({ status: 'error', errorMessage: 'Video upscale timed out. The job may still be running — try restarting.' });
        setIsProcessing(false);
        return;
      }
      try {
        const res = await fetch(`/api/fal/video-upscale/status/${requestId}`);
        const result = await res.json();
        if (result.status === 'completed' && result.mediaUrls?.[0]) {
          clearInterval(interval);
          updateData({ videoUrl: result.mediaUrls[0], status: 'completed', errorMessage: undefined });
          playSuccessSound();
          document.dispatchEvent(new CustomEvent('node:video-propagate', {
            detail: { sourceNodeId: id, videoUrl: result.mediaUrls[0] },
          }));
          setIsProcessing(false);
        } else if (result.status === 'failed') {
          clearInterval(interval);
          updateData({ status: 'error', errorMessage: result.error ?? 'Video upscale failed on the server.' });
          setIsProcessing(false);
        }
      } catch { /* keep polling */ }
    }, 5000);
  }

  const footer = (
    <div className={glassStyles.footerStack}>
      <button
        onClick={handleUpscale}
        disabled={isProcessing || !inputVideoUrl}
        className={cn(
          glassStyles.glassSurface,
          glassStyles.button,
          glassStyles.generateButton,
          'transition-opacity disabled:opacity-40 nodrag',
        )}
      >
        <span className={cn(glassStyles.glassContent, glassStyles.buttonContent)}>
          <Play size={12} />
          {isProcessing ? 'Upscaling…' : 'Upscale Video'}
        </span>
      </button>

      {data.videoUrl && data.status === 'completed' && (
        <button
          onClick={() => downloadFromUrl(data.videoUrl!)}
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
      title="Video Upscale"
      icon={<Zap size={14} />}
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
        id="video_in"
        portType="video"
        connected={storeEdges.some(e => e.target === id && e.targetHandle === 'video_in')}
      />

      <div className={glassStyles.field}>
        <span className={glassStyles.microLabel}>Scale Factor</span>
        <div className={glassStyles.chipRow}>
          {SCALE_OPTIONS.map((scale) => (
            <button
              key={scale}
              onClick={() => updateData({ upscaleFactor: scale })}
              className={cn(
                glassStyles.glassSurface,
                glassStyles.chip,
                upscaleFactor === scale && glassStyles.chipActive,
                'nodrag',
              )}
            >
              <span className={cn(glassStyles.glassContent, glassStyles.buttonContent)}>{scale}x</span>
            </button>
          ))}
        </div>
      </div>

      {!inputVideoUrl && (
        <div className={glassStyles.emptyState}>
          Connect a video source
        </div>
      )}

      {inputVideoUrl && (
        <div className={glassStyles.mediaFrame}>
          <CanvasVideo
            src={inputVideoUrl}
            controls
            className="w-full block nodrag"
            style={{ height: 'auto' }}
          />
          <p className={glassStyles.mediaCaption}>Input</p>
        </div>
      )}

      {data.videoUrl && data.status === 'completed' && (
        <div className={glassStyles.mediaFrame}>
          <CanvasVideo
            src={data.videoUrl}
            controls
            className="w-full block nodrag"
            style={{ height: 'auto' }}
          />
          <p className={glassStyles.mediaCaption}>Output ({upscaleFactor}x)</p>
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
