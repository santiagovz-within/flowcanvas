'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ByteDance, Fal, Flux, Google, Kling, NanoBanana, OpenAI, TopazLabs } from '@lobehub/icons';
import { ChevronDown } from 'lucide-react';

interface Option {
  id: string;
  name: string;
}

interface ModelSelectProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
}

function ModelIcon({ modelId, size = 13 }: { modelId: string; size?: number }) {
  switch (modelId) {
    case 'nano-banana-2':
    case 'nano-banana-pro':
      return <NanoBanana.Color size={size} />;
    case 'seedream-5':
      return <ByteDance.Color size={size} />;
    case 'gpt-image-2':
      return <OpenAI size={size} />;
    case 'flux-2-pro':
      return <Flux size={size} />;
    case 'google-omni-flash':
      return <Google.Color size={size} />;
    case 'kling-3-pro':
      return <Kling.Color size={size} />;
    case 'seedance-2':
      return <ByteDance.Color size={size} />;
    case 'seedvr2':
      return <Fal.Color size={size} />;
    case 'topaz':
      return <TopazLabs size={size} />;
    default:
      return null;
  }
}

export function ModelSelect({ options, value, onChange }: ModelSelectProps) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.id === value) ?? options[0];

  function openDropdown(e: React.MouseEvent) {
    e.stopPropagation();
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 3, left: rect.left, width: rect.width });
    setOpen((o) => !o);
  }

  useEffect(() => {
    if (!open) return;
    function onOutsideDown(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onOutsideDown, true);
    return () => document.removeEventListener('mousedown', onOutsideDown, true);
  }, [open]);

  return (
    <div className="nodrag" style={{ position: 'relative' }}>
      <button
        ref={triggerRef}
        className="nodrag w-full flex items-center gap-1.5 px-2 py-1.5 text-xs"
        style={{
          background: 'var(--color-bg-surface)',
          color: 'var(--color-white)',
          border: 'none',
          borderRadius: 11,
          cursor: 'pointer',
          textAlign: 'left',
          outline: 'none',
          lineHeight: 1.4,
        }}
        onClick={openDropdown}
      >
        <span
          className="flex items-center justify-center"
          style={{ width: 13, height: 13, flexShrink: 0, lineHeight: 0 }}
        >
          <ModelIcon modelId={selected?.id ?? ''} />
        </span>
        <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {selected?.name ?? ''}
        </span>
        <ChevronDown
          size={20}
          style={{
            opacity: 0.6,
            flexShrink: 0,
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.15s',
          }}
        />
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={dropdownRef}
          className="nodrag"
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            width: pos.width,
            background: 'var(--color-bg-surface)',
            borderRadius: 11,
            border: '1px solid rgba(255,255,255,0.1)',
            overflow: 'hidden',
            zIndex: 99999,
          }}
        >
          {options.map((opt) => (
            <button
              key={opt.id}
              className="nodrag w-full flex items-center gap-1.5 px-2 py-1.5 text-xs"
              style={{
                color: opt.id === value ? 'var(--color-white)' : 'var(--color-white-muted)',
                background:
                  hovered === opt.id
                    ? 'rgba(255,255,255,0.07)'
                    : opt.id === value
                    ? 'rgba(255,255,255,0.04)'
                    : 'transparent',
                border: 'none',
                cursor: 'pointer',
                textAlign: 'left',
                outline: 'none',
                lineHeight: 1.4,
              }}
              onMouseEnter={() => setHovered(opt.id)}
              onMouseLeave={() => setHovered(null)}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => { onChange(opt.id); setOpen(false); }}
            >
              <span
                className="flex items-center justify-center"
                style={{ width: 13, height: 13, flexShrink: 0, lineHeight: 0 }}
              >
                <ModelIcon modelId={opt.id} />
              </span>
              <span>{opt.name}</span>
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
