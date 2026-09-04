'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStoreApi } from '@xyflow/react';
import { Alibaba, Bfl, ByteDance, Fal, Flux, Gemini, Google, Kling, Krea, Minimax, NanoBanana, OpenAI, Qwen, Recraft, TopazLabs } from '@lobehub/icons';
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

interface DropdownPosition {
  top: number;
  left: number;
  width: number;
  scale: number;
}

function measureDropdown(trigger: HTMLButtonElement): DropdownPosition {
  const rect = trigger.getBoundingClientRect();
  const scale = trigger.offsetWidth > 0 ? rect.width / trigger.offsetWidth : 1;
  return {
    top: rect.bottom + 3 * scale,
    left: rect.left,
    width: trigger.offsetWidth,
    scale,
  };
}

const MODEL_SUBTITLES: Record<string, string> = {
  'seedream-5': 'BEST & MOST CREATIVE MODEL',
  'nano-banana-2': 'EXCELLENT ALL-AROUND MODEL',
  'nano-banana-pro': 'VERY GOOD ALL-AROUND MODEL',
  'gpt-image-2': 'GOOD FOR TEXT & BRANDING DESIGN',
  'qwen-image-3': 'GREAT TEXT RENDERING & GOOD IMAGE QUALITY',
  'krea-2-large': 'MOST AESTHETIC, STYLE REF. ONLY, NO EDITING',
  'recraft-v4': 'DESIGN GRADE & BRAND AESTHETIC. STYLE REFERENCE ONLY',
  'flux-2-pro': 'DRAFT QUALITY',
  'seedance-2': 'THE BEST VIDEO MODEL',
  'seedance-2-5': 'NEW BEST VIDEO MODEL (UP TO 1080p)',
  'minimax-h3-max': 'ULTRA FAST (VIDEOS IN AS LITTLE AS 3s)',
  'flux-3': 'EXCELLENT ALL-AROUND VIDEO MODEL',
  'kling-3-pro': 'VERY GOOD & FAST VIDEO MODEL',
  'minimax-h3': 'HIGH QUALITY AND FAST',
  'wan-3-prime': 'HIGH QUALITY WITH AUDIO (UP TO 1080p)',
  'google-omni-flash': 'EXCELLENT & FASTEST (UP TO 4K)',
  'seedance-2-mini': 'DRAFT QUALITY (720p)',
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
    case 'qwen-image-3':
      return <Qwen.Color size={size} />;
    case 'krea-2-large':
      return <Krea size={size} />;
    case 'recraft-v4':
      return <Recraft size={size} />;
    case 'flux-2-pro':
      return <Flux size={size} />;
    case 'google-omni-flash':
      return <Google.Color size={size} />;
    case 'kling-3-pro':
      return <Kling.Color size={size} />;
    case 'flux-3':
      return <Bfl size={size} />;
    case 'minimax-h3':
    case 'minimax-h3-max':
      return <Minimax.Color size={size} />;
    case 'wan-3-prime':
      return <Alibaba.Color size={size} />;
    case 'seedance-2':
    case 'seedance-2-5':
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

export function ModelSelect({ options, value, onChange, appearance = 'imageGenerationGlass' }: ModelSelectProps) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [pos, setPos] = useState<DropdownPosition>({ top: 0, left: 0, width: 0, scale: 1 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const reactFlowStore = useStoreApi();
  const selected = options.find((o) => o.id === value) ?? options[0];
  const isImageGenerationGlass = appearance === 'imageGenerationGlass';

  function openDropdown(e: React.MouseEvent) {
    e.stopPropagation();
    if (!triggerRef.current) return;
    setPos(measureDropdown(triggerRef.current));
    setOpen((o) => !o);
  }

  useLayoutEffect(() => {
    if (!open) return;
    let frameId: number | undefined;
    const syncPosition = () => {
      if (triggerRef.current) setPos(measureDropdown(triggerRef.current));
    };
    const scheduleSync = () => {
      if (frameId !== undefined) cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(syncPosition);
    };
    const unsubscribe = reactFlowStore.subscribe(scheduleSync);
    window.addEventListener('resize', scheduleSync);
    return () => {
      unsubscribe();
      window.removeEventListener('resize', scheduleSync);
      if (frameId !== undefined) cancelAnimationFrame(frameId);
    };
  }, [open, reactFlowStore]);

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

  const triggerContent = (
    <>
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
    </>
  );

  const dropdownOptions = options.map((opt) => (
    <button
      key={opt.id}
      className={cn(
        'nodrag w-full flex items-center gap-1.5 px-2 py-1.5 text-xs',
        isImageGenerationGlass && glassStyles.dropdownOption,
      )}
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
  ));

  return (
    <div className="nodrag" style={{ position: 'relative', width: isImageGenerationGlass ? '100%' : undefined }}>
      <button
        ref={triggerRef}
        className={cn(
          'nodrag',
          isImageGenerationGlass
            ? [glassStyles.glassSurface, glassStyles.modelTrigger]
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
        {isImageGenerationGlass ? (
          <span className={cn(glassStyles.glassContent, glassStyles.modelTriggerContent)}>
            {triggerContent}
          </span>
        ) : triggerContent}
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={dropdownRef}
          className={cn(
            'nodrag',
            isImageGenerationGlass && glassStyles.glassSurface,
            isImageGenerationGlass && glassStyles.dropdownMenu,
          )}
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            width: pos.width,
            transform: `scale(${pos.scale})`,
            transformOrigin: 'top left',
            background: isImageGenerationGlass ? undefined : 'var(--color-bg-surface)',
            borderRadius: 11,
            border: isImageGenerationGlass ? 'none' : '1px solid rgba(255,255,255,0.1)',
            overflow: 'hidden',
            zIndex: 99999,
          }}
        >
          {isImageGenerationGlass ? (
            <div className={glassStyles.glassContent}>{dropdownOptions}</div>
          ) : dropdownOptions}
        </div>,
        document.body
      )}
    </div>
  );
}
