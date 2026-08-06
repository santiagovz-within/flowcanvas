'use client';

import { useRef, useState, useLayoutEffect } from 'react';
import { Type, Aperture, Film, Zap, Grid, Layers, Sliders, Pointer, Wand2, Clapperboard, Scissors, FileImage } from 'lucide-react';
import type { NodeType } from '@/types';

interface NodeOption {
  type: NodeType;
  label: string;
  icon: React.ReactNode;
  category: string;
}

const NODE_OPTIONS: NodeOption[] = [
  { type: 'promptNode',        label: 'Prompt',           icon: <Type size={14} />,       category: 'Input'    },
  { type: 'mediaInputNode',    label: 'Media Input',      icon: <FileImage size={14} />,  category: 'Input'    },
  { type: 'imageToPromptNode', label: 'Image to Prompt',  icon: <Wand2 size={14} />,      category: 'Input'    },
  { type: 'imageGenNode',      label: 'Image Generation', icon: <Aperture size={14} />,   category: 'Generate' },
  { type: 'videoGenNode',      label: 'Video Generation', icon: <Film size={14} />,       category: 'Generate' },
  { type: 'upscaleMediaNode',  label: 'Upscale Media',    icon: <Zap size={14} />,      category: 'Enhance'  },
  { type: 'modifyNode',        label: 'Modify',           icon: <Sliders size={14} />,  category: 'Enhance'  },
  { type: 'selectNode',        label: 'Select',           icon: <Pointer size={14} />,  category: 'Enhance'  },
  { type: 'removeBgNode',      label: 'Remove Background', icon: <Scissors size={14} />,     category: 'Enhance' },
  { type: 'videoToGifNode',    label: 'Video to GIF',      icon: <Clapperboard size={14} />, category: 'Enhance' },
  { type: 'galleryOutputNode', label: 'Output Gallery',   icon: <Grid size={14} />,     category: 'Output'   },
];

const CATEGORIES = ['Input', 'Generate', 'Enhance', 'Output'];

interface NodeToolbarProps {
  x: number;
  y: number;
  onAdd: (type: NodeType) => void;
  onClose: () => void;
  selectedCount?: number;
  onGroup?: () => void;
  allowedTypes?: NodeType[];
}

const MENU_WIDTH = 200;

export function NodeToolbar({ x, y, onAdd, onClose, selectedCount = 0, onGroup, allowedTypes }: NodeToolbarProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Measure the actual rendered height before the first paint so the flip
  // logic uses a real value instead of a hardcoded constant.
  useLayoutEffect(() => {
    if (!menuRef.current) return;
    const { offsetWidth: w, offsetHeight: h } = menuRef.current;
    setPos({
      left: x + w > window.innerWidth  ? x - w : x,
      top:  y + h > window.innerHeight ? y - h : y,
    });
  }, [x, y]);

  const left = pos?.left ?? x;
  const top  = pos?.top  ?? y;

  const visibleOptions = allowedTypes
    ? NODE_OPTIONS.filter((o) => allowedTypes.includes(o.type))
    : NODE_OPTIONS;

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />

      <div
        ref={menuRef}
        className="fixed z-50 rounded-xl overflow-hidden shadow-xl"
        style={{
          left,
          top,
          width: MENU_WIDTH,
          // Hide until positioned so there's no flash at the wrong location
          visibility: pos ? 'visible' : 'hidden',
          background: 'var(--color-bg-surface)',
          border: 'var(--border-default)',
          boxShadow: 'var(--shadow-modal)',
        }}
      >
        <div className="px-3 py-2" style={{ borderBottom: 'var(--border-default)' }}>
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-white-muted)' }}>
            Add Node
          </p>
        </div>

        {/* Group action — only shown when 2+ nodes selected */}
        {selectedCount >= 2 && onGroup && (
          <>
            <button
              className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors hover:bg-white/5"
              onClick={() => { onGroup(); onClose(); }}
            >
              <Layers size={13} style={{ color: '#f59e0b' }} />
              <p className="text-xs font-medium" style={{ color: 'var(--color-white)' }}>Group Selection</p>
            </button>
            <div style={{ height: 1, background: 'var(--color-white-subtle)', margin: '2px 12px' }} />
          </>
        )}

        {CATEGORIES.map((category) => {
          const options = visibleOptions.filter((o) => o.category === category);
          if (options.length === 0) return null;
          return (
            <div key={category}>
              <p className="px-3 pt-1.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-white-muted)' }}>
                {category}
              </p>
              {options.map((option) => (
                <button
                  key={option.type}
                  className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors hover:bg-white/5"
                  onClick={() => { onAdd(option.type); onClose(); }}
                >
                  <span style={{ color: 'var(--color-white)' }}>{option.icon}</span>
                  <p className="text-xs font-medium" style={{ color: 'var(--color-white)' }}>{option.label}</p>
                </button>
              ))}
            </div>
          );
        })}

        <div className="pb-1" />
      </div>
    </>
  );
}
