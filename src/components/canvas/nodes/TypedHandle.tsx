'use client';

import {
  Handle,
  Position,
  useNodeId,
  useUpdateNodeInternals,
  type HandleProps,
} from '@xyflow/react';
import { Image as ImageIcon, Film, Type, Minus } from 'lucide-react';
import { useLayoutEffect, useState } from 'react';
import { cn } from '@/lib/utils/cn';
import glassStyles from './ImageGenerationGlass.module.css';

export type PortType = 'text' | 'image' | 'video' | 'neutral';

export const PORT_COLORS: Record<PortType, string> = {
  text:    '#3b9eff',
  image:   '#a855f7',
  video:   '#34d399',
  neutral: '#6b7280',
};

// Inactive tints and icon colors are now CSS variables so light mode can override them.
// PORT_TINTS kept for reference only — not used in rendering.
export const PORT_TINTS: Record<PortType, string> = {
  text:    'var(--port-tint-text)',
  image:   'var(--port-tint-image)',
  video:   'var(--port-tint-video)',
  neutral: 'var(--port-tint-neutral)',
};

// Registry: `nodeType:handleId:source|target` → PortType
// Used by FlowCanvas.isValidConnection to enforce type safety
export const PORT_TYPE_MAP: Record<string, PortType> = {
  'promptNode:prompt:source':              'text',
  'imageInputNode:image:source':           'image',
  'imageGenNode:prompt:target':            'text',
  'imageGenNode:reference_image:target':   'image',
  'imageGenNode:image:source':             'image',
  // Dynamic multi-image reference handles (up to the largest model limit)
  ...Object.fromEntries(
    Array.from({ length: 16 }, (_, i) => [`imageGenNode:ref_${i}:target`, 'image' as PortType])
  ),
  'videoGenNode:prompt:target':            'text',
  'videoGenNode:start_frame:target':       'image',
  'videoGenNode:end_frame:target':         'image',
  'videoGenNode:video:source':             'video',
  'upscaleNode:image:target':              'image',
  'upscaleNode:image:source':              'image',
  'modifyNode:prompt:target':              'text',
  'modifyNode:image:target':              'image',
  'modifyNode:image:source':              'image',
  'modifyNode:video:source':              'video',
  'imageToPromptNode:image:target':        'image',
  'imageToPromptNode:prompt:source':       'text',
  'selectNode:input:target':              'image',
  'selectNode:image:source':             'image',
  'outputNode:image:target':               'image',
  'outputNode:video:target':               'video',
  'videoToGifNode:video:target':           'video',
  'videoToGifNode:gif:source':             'image',
  'removeBgNode:image:target':             'image',
  'removeBgNode:image:source':             'image',
  'videoInputNode:video:source':           'video',
  'mediaInputNode:image:source':           'image',
  'mediaInputNode:video:source':           'video',
  'upscaleMediaNode:image:source':         'image',
  'upscaleMediaNode:video:source':         'video',
  'videoUpscaleNode:video_in:target':      'video',
  'videoUpscaleNode:video:source':         'video',
  'galleryOutputNode:input:target':        'neutral',
};

function PortIcon({ type, size = 9 }: { type: PortType; size?: number }) {
  if (type === 'image')   return <ImageIcon size={size} />;
  if (type === 'video')   return <Film size={size} />;
  if (type === 'neutral') return <Minus size={size} />;
  return <Type size={size} />;
}

interface TypedHandleProps extends Omit<HandleProps, 'style'> {
  portType: PortType;
  // offset from the edge as a % string or px value, e.g. '35%' or '240px'
  offset?: string;
  // small numeric badge shown above the handle circle (for numbered multi-image slots)
  badge?: number;
  // when true the handle renders in its "lit" state (full colour + white icon) even without hover
  connected?: boolean;
  appearance?: 'default' | 'imageGenerationGlass';
}

export function TypedHandle({
  portType,
  offset,
  position,
  badge,
  connected,
  appearance = 'default',
  ...rest
}: TypedHandleProps) {
  const [hovered, setHovered] = useState(false);
  const nodeId = useNodeId();
  const updateNodeInternals = useUpdateNodeInternals();
  const color = PORT_COLORS[portType];
  const isLeft = position === Position.Left;
  const isRight = position === Position.Right;
  const isActive = hovered || connected;
  const isImageGenerationGlass = appearance === 'imageGenerationGlass';

  // React Flow measures handle bounds separately from node dimensions. Several
  // nodes calculate their handle offsets after layout, so a handle can move
  // without resizing its node. Re-measure when that calculated position changes
  // to keep existing edges attached to the rendered circle.
  useLayoutEffect(() => {
    if (nodeId && offset !== undefined) updateNodeInternals(nodeId);
  }, [nodeId, offset, position, updateNodeInternals]);

  const offsetStyle: React.CSSProperties = {
    ...(offset ? (isLeft || isRight ? { top: offset } : { left: offset }) : {}),
    // Override built-in translateX so only Y-centering remains; circle edge is ~8px outside node border.
    ...(isLeft  ? { left: -44, transform: 'translateY(-50%)' } : {}),
    ...(isRight ? { right: -44, transform: 'translateY(-50%)' } : {}),
  };

  return (
    <Handle
      position={position}
      {...rest}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 36,
        height: 36,
        borderRadius: '50%',
        background: isImageGenerationGlass
          ? 'transparent'
          : isActive ? color : `var(--port-tint-${portType})`,
        border: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: isActive ? '#fff' : `var(--port-icon-inactive-${portType})`,
        pointerEvents: 'all',
        transition: isImageGenerationGlass ? undefined : 'background 0.15s, color 0.15s',
        ...offsetStyle,
      }}
    >
      {isImageGenerationGlass ? (
        <span
          className={cn(
            glassStyles.handleVisual,
            isActive
              ? glassStyles.handleActive
              : [
                  glassStyles.glassSurface,
                  glassStyles.controlSurface,
                  portType === 'text'
                    ? glassStyles.handleIdleText
                    : glassStyles.handleIdleImage,
                ],
          )}
          style={{
            background: isActive ? color : undefined,
            color: isActive ? '#fff' : `var(--port-icon-inactive-${portType})`,
          }}
        >
          <span className={cn(glassStyles.glassContent, glassStyles.handleContent)}>
            <PortIcon type={portType} size={15} />
          </span>
        </span>
      ) : (
        <PortIcon type={portType} size={14} />
      )}
      {badge !== undefined && (
        <span
          style={{
            position: 'absolute',
            top: -8,
            left: '50%',
            transform: 'translateX(-50%)',
            fontSize: 8,
            lineHeight: '10px',
            padding: '0 3px',
            borderRadius: 4,
            background: 'var(--color-bg-darkest)',
            border: `1px solid ${color}`,
            color,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          {badge}
        </span>
      )}
    </Handle>
  );
}
