'use client';

import type { CSSProperties } from 'react';
import { CanvasImage } from '@/components/canvas/CanvasMedia';

// 3-up grid so each option is large enough to tell apart, sized to the source
// aspect ratio with a tight radius so the framing stays readable. Unselected
// options are desaturated and dimmed so the active one reads at a glance.

export const THUMBNAIL_GRID_STYLE: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: 6,
  padding: 3,
};

export const THUMBNAIL_RADIUS = 3;

interface SourceThumbnailsProps {
  images: string[];
  selectedIndex: number;
  /** CSS `aspect-ratio` value — see `cssAspectRatio`. */
  aspect: string;
  onSelect: (index: number) => void;
  className?: string;
}

export function SourceThumbnails({ images, selectedIndex, aspect, onSelect, className }: SourceThumbnailsProps) {
  return (
    <div className={`nodrag${className ? ` ${className}` : ''}`} style={THUMBNAIL_GRID_STYLE}>
      {images.map((url, i) => {
        const isSelected = selectedIndex === i;
        return (
          <button
            key={i}
            onClick={() => onSelect(i)}
            className="nodrag"
            style={{
              width: '100%', aspectRatio: aspect, borderRadius: THUMBNAIL_RADIUS, padding: 0,
              overflow: 'hidden', display: 'block', background: 'var(--color-bg-surface)',
              outline: isSelected ? '2px solid #a855f7' : '2px solid transparent',
              outlineOffset: 1,
            }}
          >
            <CanvasImage
              src={url}
              alt=""
              focused={false}
              draggable={false}
              fill
              style={{
                width: '100%', height: '100%', objectFit: 'cover', display: 'block',
                filter: isSelected ? 'none' : 'grayscale(1) brightness(0.55)',
                transition: 'filter 0.15s',
              }}
            />
          </button>
        );
      })}
    </div>
  );
}
