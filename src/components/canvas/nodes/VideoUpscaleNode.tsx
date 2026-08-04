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
    <>
      <button
        onClick={handleUpscale}
        disabled={isProcessing || !inputVideoUrl}
        className="w-full flex items-center justify-center gap-1.5 py-3 text-xs font-medium transition-opacity disabled:opacity-40 nodrag"
        style={{ background: 'var(--action-btn-bg)', color: 'var(--action-btn-color)', borderRadius: 11 }}
      >
        <Play size={12} />
        {isProcessing ? 'Upscaling…' : 'Upscale Video'}
      </button>

      {data.videoUrl && data.status === 'completed' && (
        <button
          onClick={() => downloadFromUrl(data.videoUrl!)}
          className="w-full flex items-center justify-center gap-1.5 py-3 text-xs font-medium nodrag transition-opacity hover:opacity-80 active:opacity-60"
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
      title="Video Upscale"
      icon={<Zap size={14} />}
      status={data.status}
      errorMessage={data.errorMessage}
      selected={selected}
      minWidth={280}
      accentColor={PORT_COLORS.video}
      titlePosition="outside"
      footer={footer}
    >
      <TypedHandle
        type="target"
        position={Position.Left}
        id="video_in"
        portType="video"
        connected={storeEdges.some(e => e.target === id && e.targetHandle === 'video_in')}
      />

      <div className="mb-3">
        <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-white-muted)' }}>Scale Factor</label>
        <div className="flex gap-1.5">
          {SCALE_OPTIONS.map((scale) => (
            <button
              key={scale}
              onClick={() => updateData({ upscaleFactor: scale })}
              className="flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors nodrag"
              style={{
                background: upscaleFactor === scale ? '#fff' : 'var(--color-bg-surface)',
                color: upscaleFactor === scale ? '#000' : 'var(--color-white-muted)',
                border: 'var(--border-default)',
              }}
            >
              {scale}x
            </button>
          ))}
        </div>
      </div>

      {inputVideoUrl && (
        <div style={{ margin: '0 -18px 12px -18px', overflow: 'hidden' }}>
          <CanvasVideo
            src={inputVideoUrl}
            controls
            className="w-full block nodrag"
            style={{ height: 'auto' }}
          />
          <p className="px-3 pt-1 text-center" style={{ fontSize: 9, color: 'var(--color-white-muted)' }}>Input</p>
        </div>
      )}

      {data.videoUrl && data.status === 'completed' && (
        <div style={{ margin: '0 -18px 12px -18px', overflow: 'hidden' }}>
          <CanvasVideo
            src={data.videoUrl}
            controls
            className="w-full block nodrag"
            style={{ height: 'auto' }}
          />
          <p className="px-3 pt-1 text-center" style={{ fontSize: 9, color: 'var(--color-white-muted)' }}>Output ({upscaleFactor}x)</p>
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
