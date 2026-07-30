'use client';

import { Position, type NodeProps } from '@xyflow/react';
import { Pointer, Download, Film } from 'lucide-react';
import { SendToFigmaButton } from './SendToFigmaButton';
import { useEffect } from 'react';
import { NodeWrapper } from './NodeWrapper';
import { TypedHandle, PORT_COLORS } from './TypedHandle';
import { SourceThumbnails, THUMBNAIL_GRID_STYLE, THUMBNAIL_RADIUS } from './SourceThumbnails';
import { useFlowStore } from '@/lib/stores/flowStore';
import { downloadFromUrl } from '@/lib/utils/download';
import { cssAspectRatio, nearestAspectRatio } from '@/lib/utils/aspectRatio';
import type {
  SelectNodeData,
  ImageGenNodeData,
  ImageInputNodeData,
  UpscaleNodeData,
  ModifyNodeData,
  VideoGenNodeData,
} from '@/types';

export function SelectNode({ data, selected, id }: NodeProps & { data: SelectNodeData }) {
  const storeEdges = useFlowStore(state => state.edges);
  const storeNodes = useFlowStore(state => state.nodes);

  const incomingEdge = storeEdges.find(e => e.target === id && e.targetHandle === 'input');
  const sourceNode = incomingEdge ? storeNodes.find(n => n.id === incomingEdge.source) : undefined;

  let availableImages: string[] = [];
  let videoUrl: string | undefined;
  let sourceAspect = '1:1';

  if (sourceNode?.type === 'imageGenNode') {
    const nd = sourceNode.data as ImageGenNodeData;
    availableImages = nd.generatedImages ?? [];
    sourceAspect = nd.aspectRatio ?? '1:1';
  } else if (sourceNode?.type === 'imageInputNode') {
    const nd = sourceNode.data as ImageInputNodeData;
    if (nd.imageUrl) availableImages = [nd.imageUrl];
    if (nd.naturalWidth && nd.naturalHeight) sourceAspect = nearestAspectRatio(nd.naturalWidth, nd.naturalHeight);
  } else if (sourceNode?.type === 'upscaleNode') {
    const url = (sourceNode.data as UpscaleNodeData).outputImageUrl;
    if (url) availableImages = [url];
  } else if (sourceNode?.type === 'modifyNode') {
    const nd = sourceNode.data as ModifyNodeData;
    if (nd.outputImageUrl) availableImages = [nd.outputImageUrl];
    sourceAspect = nd.aspectRatio ?? '1:1';
  } else if (sourceNode?.type === 'videoGenNode') {
    const nd = sourceNode.data as VideoGenNodeData;
    videoUrl = nd.videoUrl;
    sourceAspect = nd.aspectRatio ?? '16:9';
  }

  const selectedIndex = Math.min(data.selectedIndex ?? 0, Math.max(availableImages.length - 1, 0));
  const currentUrl = availableImages[selectedIndex] ?? videoUrl;
  const mediaType: 'image' | 'video' = videoUrl ? 'video' : 'image';
  const thumbnailAspect = cssAspectRatio(sourceAspect);

  useEffect(() => {
    if (currentUrl !== data.selectedImageUrl) {
      document.dispatchEvent(new CustomEvent('node:update', {
        detail: { nodeId: id, data: { selectedImageUrl: currentUrl } },
      }));
    }
    document.dispatchEvent(new CustomEvent('node:image-propagate', {
      detail: { sourceNodeId: id, imageUrl: currentUrl ?? null },
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUrl]);

  function selectImage(i: number) {
    document.dispatchEvent(new CustomEvent('node:update', {
      detail: { nodeId: id, data: { selectedIndex: i, selectedImageUrl: availableImages[i] } },
    }));
  }

  // Block 2 (image) + download button — lives in footer so it's visually separated from Block 1
  const footer = currentUrl ? (
    <div className="flex flex-col gap-2">
      {/* Block 2: Selected media — fills all 4 sides of its card */}
      <div
        style={{
          borderRadius: 17,
          overflow: 'hidden',
          background: 'var(--color-bg-elevated)',
          border: selected ? `1px solid ${PORT_COLORS.image}` : 'var(--border-default)',
          boxShadow: 'var(--shadow-node)',
        }}
      >
        {mediaType === 'video' ? (
          <video src={currentUrl} controls className="w-full block" style={{ height: 'auto' }} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={currentUrl} alt="Selected" className="w-full block" draggable={false} style={{ height: 'auto' }} />
        )}
      </div>

      {/* Download + Send to Figma (images only) */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
        <button
          onClick={() => downloadFromUrl(currentUrl)}
          className="flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-medium nodrag transition-opacity hover:opacity-80 active:opacity-60"
          style={{ background: 'var(--color-bg-surface)', color: 'var(--color-white-muted)', borderRadius: 11 }}
        >
          <Download size={12} />
          Download
        </button>
        {mediaType === 'image' && (
          <SendToFigmaButton imageUrl={currentUrl} style={{ flex: 1, minWidth: 0 }} />
        )}
      </div>
    </div>
  ) : undefined;

  return (
    <NodeWrapper
      title="Select"
      icon={<Pointer size={14} />}
      selected={selected}
      minWidth={240}
      accentColor={PORT_COLORS.image}
      titlePosition="outside"
      footer={footer}
    >
      <TypedHandle
        type="target"
        position={Position.Left}
        id="input"
        portType="image"
        connected={storeEdges.some(e => e.target === id && e.targetHandle === 'input')}
      />
      <TypedHandle
        type="source"
        position={Position.Right}
        id="image"
        portType="image"
        connected={storeEdges.some(e => e.source === id && e.sourceHandle === 'image')}
      />

      {currentUrl ? (
        /* Block 1: Thumbnail picker */
        availableImages.length > 0 ? (
          <SourceThumbnails
            images={availableImages}
            selectedIndex={selectedIndex}
            aspect={thumbnailAspect}
            onSelect={selectImage}
          />
        ) : (
          /* Video — show a placeholder tile in the same grid */
          <div className="nodrag" style={THUMBNAIL_GRID_STYLE}>
            <div
              style={{
                width: '100%',
                aspectRatio: thumbnailAspect,
                borderRadius: THUMBNAIL_RADIUS,
                background: 'var(--color-bg-surface)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                outline: '2px solid #34d399',
                outlineOffset: 1,
              }}
            >
              <Film size={16} style={{ color: '#34d399', opacity: 0.7 }} />
            </div>
          </div>
        )
      ) : (
        <div
          className="flex items-center justify-center"
          style={{ height: 80, border: '1.5px dashed rgba(168,85,247,0.2)', borderRadius: 8 }}
        >
          <p className="text-xs text-center" style={{ color: 'var(--color-white-muted)' }}>
            Connect an image or video node
          </p>
        </div>
      )}
    </NodeWrapper>
  );
}
