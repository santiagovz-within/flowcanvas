'use client';

import { Position, type NodeProps } from '@xyflow/react';
import { Scissors, Download } from 'lucide-react';
import Image from 'next/image';
import { SendToFigmaButton } from './SendToFigmaButton';
import { useState } from 'react';
import { downloadFromUrl } from '@/lib/utils/download';
import { playSuccessSound } from '@/lib/utils/sound';
import { NodeWrapper } from './NodeWrapper';
import { TypedHandle, PORT_COLORS } from './TypedHandle';
import type { RemoveBgNodeData, ImageInputNodeData, ImageGenNodeData, UpscaleNodeData, SelectNodeData, ModifyNodeData, MediaInputNodeData } from '@/types';
import { useFlowStore } from '@/lib/stores/flowStore';
import { CanvasImage } from '@/components/canvas/CanvasMedia';
import { cn } from '@/lib/utils/cn';
import glassStyles from './ImageGenerationGlass.module.css';

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
      minWidth={300}
      accentColor={PORT_COLORS.image}
      titlePosition="outside"
      appearance="imageGenerationGlass"
      footer={
        <div className={glassStyles.footerStack}>
          <button
            onClick={handleRemove}
            disabled={isProcessing || !inputImageUrl}
            className={cn(
              glassStyles.glassSurface,
              glassStyles.button,
              glassStyles.generateButton,
              'transition-opacity disabled:opacity-40 nodrag',
            )}
          >
            <span className={cn(glassStyles.glassContent, glassStyles.buttonContent)}>
              <Image src="/node-icons/icon-generate.svg" alt="" width={11} height={11} aria-hidden />
              {isProcessing ? 'Processing…' : 'Remove Background'}
            </span>
          </button>

          {data.outputImageUrl && (
            <div className={glassStyles.footerSecondary}>
              <button
                onClick={() => downloadFromUrl(data.outputImageUrl!)}
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
                  Download PNG
                </span>
              </button>
              <SendToFigmaButton imageUrl={data.outputImageUrl} style={{ flex: '1 1 0', minWidth: 0 }} />
            </div>
          )}
        </div>
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
        <div className={cn(glassStyles.mediaFrame, glassStyles.mediaCheckered)}>
          <CanvasImage
            src={data.outputImageUrl}
            alt="Background removed"
            className="w-full block"
            style={{ height: 'auto' }}
            draggable={false}
          />
        </div>
      ) : inputImageUrl ? (
        <div className={glassStyles.mediaFrame}>
          <CanvasImage
            src={inputImageUrl}
            alt="Input"
            className="w-full block"
            style={{ height: 'auto' }}
            draggable={false}
          />
        </div>
      ) : (
        <div className={glassStyles.emptyState}>
          Connect an image source
        </div>
      )}
    </NodeWrapper>
  );
}
