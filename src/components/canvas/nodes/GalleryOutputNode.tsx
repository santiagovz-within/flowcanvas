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
      minWidth={320}
      accentColor="#f59e0b"
      titlePosition="outside"
      footer={mediaItems.length > 0 ? (
        <button
          onClick={() => downloadAll(mediaItems)}
          className="w-full flex items-center justify-center gap-1.5 py-3 text-xs font-medium transition-opacity hover:opacity-80 nodrag"
          style={{ background: '#f59e0b', color: '#000', borderRadius: 11 }}
        >
          <Download size={12} />
          Download All
        </button>
      ) : undefined}
    >
      {/* Wide hit-area target handle — accepts any connection type */}
      <TypedHandle
        type="target"
        position={Position.Left}
        id="input"
        portType="neutral"
        icon={<Grid size={15} />}
      />

      {mediaItems.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center gap-2"
          style={{
            height: 120,
            border: '1.5px dashed rgba(245,158,11,0.2)',
            borderRadius: 8,
          }}
        >
          <Grid size={24} style={{ color: '#f59e0b', opacity: 0.3 }} />
          <p className="text-xs text-center" style={{ color: 'var(--color-white-muted)' }}>
            Connect image or video nodes to populate the gallery
          </p>
        </div>
      ) : (
        <>
          <p className="text-xs mb-2" style={{ color: 'var(--color-white-muted)' }}>
            {mediaItems.length} asset{mediaItems.length !== 1 ? 's' : ''}
          </p>

          {/* Grid */}
          <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))' }}>
            {mediaItems.map((item, i) => (
              <div
                key={`${item.sourceNodeId}-${i}`}
                className="relative rounded overflow-hidden cursor-pointer group"
                style={{ aspectRatio: '1 / 1', background: 'var(--color-bg-surface)' }}
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
