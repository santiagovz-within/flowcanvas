'use client';

import { Position, type Node, type NodeProps } from '@xyflow/react';
import { Grid, Download, Film, Image as ImageIcon } from 'lucide-react';
import { useFlowStore } from '@/lib/stores/flowStore';
import { NodeWrapper } from './NodeWrapper';
import { TypedHandle } from './TypedHandle';
import { downloadFromUrl } from '@/lib/utils/download';
import { CanvasImage, CanvasVideo } from '@/components/canvas/CanvasMedia';
import { getNodeMediaUrls, getSourceMediaType } from '../mediaOutputs';
import type { GalleryOutputNodeData, NodeData } from '@/types';
import { cn } from '@/lib/utils/cn';
import glassStyles from './ImageGenerationGlass.module.css';

interface MediaItem {
  url: string;
  type: 'image' | 'video';
  extension: 'jpg' | 'mp4' | 'gif';
  sourceNodeId: string;
}

async function downloadAll(items: MediaItem[]) {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    await downloadFromUrl(item.url, `gallery-${i + 1}.${item.extension}`);
    // small delay to avoid browser blocking multiple downloads
    await new Promise((r) => setTimeout(r, 300));
  }
}

export function GalleryOutputNode({ selected, id }: NodeProps & { data: GalleryOutputNodeData }) {
  const storeEdges = useFlowStore((state) => state.edges);
  const storeNodes = useFlowStore((state) => state.nodes);

  const incomingEdges = storeEdges.filter((e) => e.target === id);
  const mediaItems: MediaItem[] = incomingEdges.flatMap((edge) => {
    const sourceNode = storeNodes.find((n) => n.id === edge.source);
    if (!sourceNode) return [];
    const mediaType = getSourceMediaType(sourceNode, edge.sourceHandle);
    if (!mediaType) return [];
    const extension = sourceNode.type === 'videoToGifNode'
      ? 'gif'
      : mediaType === 'video' ? 'mp4' : 'jpg';
    return getNodeMediaUrls(sourceNode as Node<NodeData>, mediaType).map((url) => ({
      url,
      type: mediaType,
      extension,
      sourceNodeId: edge.source,
    }));
  });

  return (
    <NodeWrapper
      title="Output Gallery"
      icon={<Grid size={14} />}
      selected={selected}
      minWidth={300}
      accentColor="#f59e0b"
      titlePosition="outside"
      appearance="imageGenerationGlass"
      footer={mediaItems.length > 0 ? (
        <div className={glassStyles.footerStack}>
          <button
            onClick={() => downloadAll(mediaItems)}
            className={cn(
              glassStyles.glassSurface,
              glassStyles.button,
              glassStyles.generateButton,
              'transition-opacity hover:opacity-80 nodrag',
            )}
            style={{ '--glass-fill': '#f59e0b' } as React.CSSProperties}
          >
            <span className={cn(glassStyles.glassContent, glassStyles.buttonContent)}>
              <Download size={12} />
              Download All
            </span>
          </button>
        </div>
      ) : undefined}
    >
      {/* Wide hit-area target handle — accepts any connection type */}
      <TypedHandle
        type="target"
        position={Position.Left}
        id="input"
        portType="neutral"
        icon={<Grid size={16} />}
        connected={mediaItems.length > 0}
      />

      {mediaItems.length === 0 ? (
        <div className={glassStyles.emptyState} style={{ minHeight: 120 }}>
          <Grid size={24} style={{ color: '#f59e0b', opacity: 0.3 }} />
          Connect image or video nodes to populate the gallery
        </div>
      ) : (
        <>
          <span className={glassStyles.microLabel}>
            {mediaItems.length} asset{mediaItems.length !== 1 ? 's' : ''}
          </span>

          {/* Grid */}
          <div className={glassStyles.thumbGrid}>
            {mediaItems.map((item, i) => (
              <div
                key={`${item.sourceNodeId}-${i}`}
                className="relative overflow-hidden cursor-pointer group"
                style={{ aspectRatio: '1 / 1', borderRadius: 6, background: 'rgba(255,255,255,0.06)' }}
                onClick={() => downloadFromUrl(item.url, `gallery-${i + 1}.${item.extension}`)}
                title="Click to download"
              >
                {item.type === 'video' ? (
                  <CanvasVideo
                    src={item.url}
                    focused={false}
                    className="w-full h-full"
                    style={{ objectFit: 'cover' }}
                    fill
                  />
                ) : (
                  <CanvasImage
                    src={item.url}
                    alt={`Gallery ${i + 1}`}
                    focused={false}
                    className="w-full h-full object-cover"
                    draggable={false}
                    fill
                  />
                )}
                {/* Hover overlay */}
                <div
                  className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ background: 'rgba(0,0,0,0.5)' }}
                >
                  {item.type === 'video'
                    ? <Film size={14} style={{ color: '#fff' }} />
                    : <ImageIcon size={14} style={{ color: '#fff' }} />
                  }
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </NodeWrapper>
  );
}
