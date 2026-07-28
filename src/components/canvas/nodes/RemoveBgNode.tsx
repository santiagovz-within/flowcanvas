'use client';

import { Position, type NodeProps } from '@xyflow/react';
import { Scissors, Play, Download } from 'lucide-react';
import { SendToFigmaButton } from './SendToFigmaButton';
import { useState } from 'react';
import { downloadFromUrl } from '@/lib/utils/download';
import { playSuccessSound } from '@/lib/utils/sound';
import { NodeWrapper } from './NodeWrapper';
import { TypedHandle, PORT_COLORS } from './TypedHandle';
import type { RemoveBgNodeData, ImageInputNodeData, ImageGenNodeData, UpscaleNodeData, SelectNodeData, ModifyNodeData, MediaInputNodeData } from '@/types';
import { useFlowStore } from '@/lib/stores/flowStore';

const CHECKERBOARD: React.CSSProperties = {
  backgroundImage:
    'conic-gradient(#3a3a3a 90deg, #2a2a2a 90deg 180deg, #3a3a3a 180deg 270deg, #2a2a2a 270deg)',
  backgroundSize: '14px 14px',
};

export function RemoveBgNode({ data, selected, id }: NodeProps & { data: RemoveBgNodeData }) {
  const [isProcessing, setIsProcessing] = useState(false);

  const storeEdges = useFlowStore(state => state.edges);
  const storeNodes = useFlowStore(state => state.nodes);

  // Derive input image directly from connected source node (same pattern as UpscaleNode)
  const incomingEdge = storeEdges.find(e => e.target === id && e.targetHandle === 'image');
  const sourceNode = incomingEdge ? storeNodes.find(n => n.id === incomingEdge.source) : undefined;
  let inputImageUrl: string | undefined;
  if (sourceNode?.type === 'imageInputNode')  inputImageUrl = (sourceNode.data as ImageInputNodeData).imageUrl;
  else if (sourceNode?.type === 'imageGenNode')  inputImageUrl = (sourceNode.data as ImageGenNodeData).generatedImages?.[0];
  else if (sourceNode?.type === 'upscaleNode')   inputImageUrl = (sourceNode.data as UpscaleNodeData).outputImageUrl;
  else if (sourceNode?.type === 'modifyNode')    inputImageUrl = (sourceNode.data as ModifyNodeData).outputImageUrl;
  else if (sourceNode?.type === 'selectNode')    inputImageUrl = (sourceNode.data as SelectNodeData).selectedImageUrl;
  else if (sourceNode?.type === 'removeBgNode')  inputImageUrl = (sourceNode.data as RemoveBgNodeData).outputImageUrl;
  else if (sourceNode?.type === 'mediaInputNode') inputImageUrl = (sourceNode.data as MediaInputNodeData).imageUrl;

  function updateData(updates: Partial<RemoveBgNodeData>) {
    document.dispatchEvent(new CustomEvent('node:update', {
      detail: { nodeId: id, data: updates },
    }));
  }

  async function handleRemove() {
    if (!inputImageUrl || isProcessing) return;
    setIsProcessing(true);
    updateData({ status: 'processing' });
    useFlowStore.getState().consumeGcsOnlyEligibility();

    try {
      const res = await fetch('/api/fal/remove-background', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl: inputImageUrl,
          sourceType: 'canvas',
          sourceId: useFlowStore.getState().currentFlow?.id,
          nodeId: id,
        }),
      });
      const result = await res.json();

      if (result.mediaUrls?.[0]) {
        updateData({ outputImageUrl: result.mediaUrls[0], status: 'completed', errorMessage: undefined });
        playSuccessSound();
        document.dispatchEvent(new CustomEvent('node:image-propagate', {
          detail: { sourceNodeId: id, imageUrl: result.mediaUrls[0] },
        }));
      } else {
        updateData({ status: 'error', errorMessage: result.details ?? result.error ?? 'Background removal failed — no output returned.' });
      }
    } catch (err) {
      updateData({ status: 'error', errorMessage: err instanceof Error ? err.message : 'Network error — check your connection.' });
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <NodeWrapper
      title="Remove Background"
      icon={<Scissors size={14} />}
      status={data.status}
      errorMessage={data.errorMessage}
      selected={selected}
      minWidth={280}
      accentColor={PORT_COLORS.image}
      titlePosition="outside"
      footer={
        <>
          <button
            onClick={handleRemove}
            disabled={isProcessing || !inputImageUrl}
            className="w-full flex items-center justify-center gap-1.5 py-3 text-xs font-medium transition-opacity disabled:opacity-40 nodrag"
            style={{ background: 'var(--action-btn-bg)', color: 'var(--action-btn-color)', borderRadius: 11 }}
          >
            <Play size={12} />
            {isProcessing ? 'Processing…' : 'Remove Background'}
          </button>

          {data.outputImageUrl && (
            <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'flex-start' }}>
              <button
                onClick={() => downloadFromUrl(data.outputImageUrl!)}
                className="flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-medium nodrag transition-opacity hover:opacity-80 active:opacity-60"
                style={{ background: 'var(--color-bg-surface)', color: 'var(--color-white-muted)', borderRadius: 11 }}
              >
                <Download size={12} />
                Download PNG
              </button>
              <SendToFigmaButton imageUrl={data.outputImageUrl} style={{ flex: 1, minWidth: 0 }} />
            </div>
          )}
        </>
      }
    >
      <TypedHandle
        type="target"
        position={Position.Left}
        id="image"
        portType="image"
        connected={storeEdges.some(e => e.target === id && e.targetHandle === 'image')}
      />
      <TypedHandle
        type="source"
        position={Position.Right}
        id="image"
        portType="image"
        connected={storeEdges.some(e => e.source === id && e.sourceHandle === 'image')}
      />

      {/* ── Preview ─────────────────────────────────────────────────────── */}
      {data.outputImageUrl ? (
        // Output on checkerboard so transparency is visible
        <div style={{ margin: '-18px', overflow: 'hidden', ...CHECKERBOARD }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={data.outputImageUrl}
            alt="Background removed"
            className="w-full block"
            style={{ height: 'auto' }}
            draggable={false}
          />
        </div>
      ) : inputImageUrl ? (
        <div style={{ margin: '-18px', overflow: 'hidden' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={inputImageUrl}
            alt="Input"
            className="w-full block"
            style={{ height: 'auto' }}
            draggable={false}
          />
        </div>
      ) : (
        <div
          className="flex items-center justify-center rounded-lg mb-3 text-xs"
          style={{
            height: 56,
            border: '1.5px dashed rgba(255,255,255,0.15)',
            color: 'var(--color-white-muted)',
          }}
        >
          Connect an image source
        </div>
      )}
    </NodeWrapper>
  );
}
