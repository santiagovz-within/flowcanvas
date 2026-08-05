'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ByteDance, Fal, Flux, Gemini, Google, Kling, NanoBanana, OpenAI, TopazLabs } from '@lobehub/icons';
import { Box, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import glassStyles from './ImageGenerationGlass.module.css';

interface Option {
  id: string;
  name: string;
}

interface ModelSelectProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  appearance?: 'default' | 'imageGenerationGlass';
}

const MODEL_SUBTITLES: Record<string, string> = {
  'nano-banana-2': 'BEST MODEL',
  'seedream-5': 'BEST & MORE CREATIVE MODEL',
  'nano-banana-pro': 'BEST OVERALL MODEL (MORE EXPENSIVE)',
  'gpt-image-2': 'GOOD FOR TEXT & POSTER DESIGN',
  'flux-2-pro': 'FOR MOODBOARDS & EXPERIMENTATION',
  'google-omni-flash': 'GOOD & FAST MODEL',
  'seedance-2': 'BEST MODEL',
  'seedance-2-mini': 'GOOD MODEL',
  'kling-3-pro': 'GOOD MODEL',
};

function ModelIcon({
  modelId,
  size = 13,
  appearance = 'default',
}: {
  modelId: string;
  size?: number;
  appearance?: ModelSelectProps['appearance'];
}) {
  switch (modelId) {
    case 'nano-banana-2':
    case 'nano-banana-pro':
      return appearance === 'imageGenerationGlass'
        ? <Gemini.Color size={size} />
        : <NanoBanana.Color size={size} />;
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
    case 'seedance-2-mini':
      return <ByteDance.Color size={size} />;
    case 'seedvr2':
      return <Fal.Color size={size} />;
    case 'topaz':
      return <TopazLabs size={size} />;
    default:
      return null;
  }
}

export function ModelSelect({ options, value, onChange, appearance = 'default' }: ModelSelectProps) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.id === value) ?? options[0];
  const isImageGenerationGlass = appearance === 'imageGenerationGlass';

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
    <div className="nodrag" style={{ position: 'relative', width: isImageGenerationGlass ? '100%' : undefined }}>
      <button
        ref={triggerRef}
        className={cn(
          'nodrag',
          isImageGenerationGlass
            ? [glassStyles.glassSurface, glassStyles.dropdownSurface, glassStyles.modelTrigger]
            : 'w-full flex items-center gap-1.5 px-2 py-1.5 text-xs',
        )}
        style={isImageGenerationGlass ? undefined : {
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
          className={cn(isImageGenerationGlass ? glassStyles.modelIcon : 'flex items-center justify-center')}
          style={isImageGenerationGlass ? undefined : { width: 13, height: 13, flexShrink: 0, lineHeight: 0 }}
        >
          <ModelIcon
            modelId={selected?.id ?? ''}
            size={isImageGenerationGlass ? 15 : 13}
            appearance={appearance}
          />
        </span>
        <span className={cn(isImageGenerationGlass && glassStyles.modelText)} style={isImageGenerationGlass ? undefined : { flex: 1, minWidth: 0 }}>
          <span
            className={cn('block', isImageGenerationGlass && glassStyles.modelName)}
            style={isImageGenerationGlass ? undefined : { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
          >
            {selected?.name ?? ''}
          </span>
          {selected && MODEL_SUBTITLES[selected.id] && (
            <span
              className={cn(!isImageGenerationGlass && 'flex items-center gap-1', isImageGenerationGlass && glassStyles.modelDescription)}
              style={isImageGenerationGlass ? undefined : { color: 'var(--color-white-muted)', fontSize: 9, fontStyle: 'italic', fontWeight: 600, lineHeight: 1.25, opacity: 0.7 }}
            >
              {!isImageGenerationGlass && <Box size={9} aria-hidden />}
              {MODEL_SUBTITLES[selected.id]}
            </span>
          )}
        </span>
        <ChevronDown
          size={isImageGenerationGlass ? 14 : 20}
          className={cn(isImageGenerationGlass && glassStyles.chevron)}
          style={{
            opacity: isImageGenerationGlass ? 1 : 0.6,
            flexShrink: 0,
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.15s',
          }}
        />
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={dropdownRef}
          className={cn(
            'nodrag',
            isImageGenerationGlass && glassStyles.glassSurface,
            isImageGenerationGlass && glassStyles.dropdownSurface,
            isImageGenerationGlass && glassStyles.dropdownMenu,
          )}
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            width: pos.width,
            background: isImageGenerationGlass ? undefined : 'var(--color-bg-surface)',
            borderRadius: 11,
            border: isImageGenerationGlass ? 'none' : '1px solid rgba(255,255,255,0.1)',
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
                style={{ width: isImageGenerationGlass ? 15 : 13, height: isImageGenerationGlass ? 15 : 13, flexShrink: 0, lineHeight: 0 }}
              >
                <ModelIcon modelId={opt.id} size={isImageGenerationGlass ? 15 : 13} appearance={appearance} />
              </span>
              <span style={{ minWidth: 0 }}>
                <span className={cn('block', isImageGenerationGlass && glassStyles.modelName)}>{opt.name}</span>
                {MODEL_SUBTITLES[opt.id] && (
                  <span
                    className={cn(!isImageGenerationGlass && 'flex items-center gap-1', isImageGenerationGlass && glassStyles.modelDescription)}
                    style={isImageGenerationGlass ? undefined : { color: 'var(--color-white-muted)', fontSize: 9, fontStyle: 'italic', fontWeight: 600, lineHeight: 1.25, opacity: 0.7 }}
                  >
                    {!isImageGenerationGlass && <Box size={9} aria-hidden />}
                    {MODEL_SUBTITLES[opt.id]}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
