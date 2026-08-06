'use client';

import { Position, type NodeProps } from '@xyflow/react';
import { Monitor, Image, Download } from 'lucide-react';
import { NodeWrapper } from './NodeWrapper';
import { TypedHandle, PORT_COLORS } from './TypedHandle';
import type { OutputNodeData, ImageInputNodeData, ImageGenNodeData, UpscaleNodeData, VideoGenNodeData, ModifyNodeData, SelectNodeData } from '@/types';
import { downloadFromUrl } from '@/lib/utils/download';
import { useFlowStore } from '@/lib/stores/flowStore';
import { CanvasImage, CanvasVideo } from '@/components/canvas/CanvasMedia';
import { cn } from '@/lib/utils/cn';
import glassStyles from './ImageGenerationGlass.module.css';

export function OutputNode({ data, selected, id }: NodeProps & { data: OutputNodeData }) {
  const storeEdges = useFlowStore(state => state.edges);
  const storeNodes = useFlowStore(state => state.nodes);

  const imageEdge = storeEdges.find(e => e.target === id && e.targetHandle === 'image');
  const videoEdge = storeEdges.find(e => e.target === id && e.targetHandle === 'video');
  const imgSource = imageEdge ? storeNodes.find(n => n.id === imageEdge.source) : undefined;
  const vidSource = videoEdge ? storeNodes.find(n => n.id === videoEdge.source) : undefined;

  function getImageUrl(node: typeof imgSource): string | undefined {
    if (!node) return undefined;
    if (node.type === 'imageInputNode') return (node.data as ImageInputNodeData).imageUrl;
    if (node.type === 'imageGenNode') return (node.data as ImageGenNodeData).generatedImages?.[0];
    if (node.type === 'upscaleNode') return (node.data as UpscaleNodeData).outputImageUrl;
    if (node.type === 'modifyNode') return (node.data as ModifyNodeData).outputImageUrl;
    if (node.type === 'selectNode') return (node.data as SelectNodeData).selectedImageUrl;
    return undefined;
  }

  const videoUrl = vidSource ? (vidSource.data as VideoGenNodeData).videoUrl : undefined;
  const imageUrl = getImageUrl(imgSource);
  const mediaUrl = videoUrl ?? imageUrl ?? data.mediaUrl;
  const mediaType: 'image' | 'video' | undefined = videoUrl ? 'video' : imageUrl ? 'image' : data.mediaType;

  return (
    <NodeWrapper
      title="Output"
      icon={<Monitor size={14} />}
      selected={selected}
      minWidth={300}
      accentColor="var(--color-white)"
      titlePosition="outside"
      appearance="imageGenerationGlass"
      footer={mediaUrl ? (
        <div className={glassStyles.footerStack}>
          <button
            onClick={() => downloadFromUrl(mediaUrl)}
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
        </div>
      ) : undefined}
    >
      <TypedHandle
        type="target"
        position={Position.Left}
        id="image"
        portType="image"
        offset="40%"
        connected={storeEdges.some(e => e.target === id && e.targetHandle === 'image')}
      />
      <TypedHandle
        type="target"
        position={Position.Left}
        id="video"
        portType="video"
        offset="65%"
        connected={storeEdges.some(e => e.target === id && e.targetHandle === 'video')}
      />

      {mediaUrl ? (
        <div className={glassStyles.mediaFrame}>
          {mediaType === 'video' ? (
            <CanvasVideo
              src={mediaUrl}
              controls
              className="w-full block"
              style={{ height: 'auto' }}
            />
          ) : (
            <CanvasImage
              src={mediaUrl}
              alt="Output"
              className="w-full block"
              draggable={false}
              style={{ height: 'auto' }}
            />
          )}
        </div>
      ) : (
        <div className={glassStyles.emptyState} style={{ minHeight: 120 }}>
          <Image size={24} className="opacity-20" style={{ color: '#fff' }} />
          Connect a node to preview output
        </div>
      )}
    </NodeWrapper>
  );
}
