'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import glassStyles from './ImageGenerationGlass.module.css';

interface NodeSelectProps {
  options: string[];
  value: string;
  onChange: (value: string) => void;
  leadingIcon?: React.ReactNode;
  appearance?: 'default' | 'imageGenerationGlass';
}

export function NodeSelect({
  options,
  value,
  onChange,
  leadingIcon,
  appearance = 'default',
}: NodeSelectProps) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
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

  const triggerContent = (
    <>
      <span
        className={cn(isImageGenerationGlass && glassStyles.selectContent)}
        style={isImageGenerationGlass ? undefined : { display: 'flex', flex: 1, minWidth: 0 }}
      >
        {leadingIcon}
        <span
          className={cn(isImageGenerationGlass && glassStyles.selectValue)}
          style={isImageGenerationGlass ? undefined : { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
        >
          {value}
        </span>
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
      key={opt}
      className="nodrag w-full flex items-center px-2 py-1.5 text-xs"
      style={{
        color: opt === value ? 'var(--color-white)' : 'var(--color-white-muted)',
        background:
          hovered === opt
            ? 'rgba(255,255,255,0.07)'
            : opt === value
            ? 'rgba(255,255,255,0.04)'
            : 'transparent',
        border: 'none',
        cursor: 'pointer',
        textAlign: 'left',
        outline: 'none',
        lineHeight: 1.4,
      }}
      onMouseEnter={() => setHovered(opt)}
      onMouseLeave={() => setHovered(null)}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={() => { onChange(opt); setOpen(false); }}
    >
      {opt}
    </button>
  ));

  return (
    <div className="nodrag" style={{ position: 'relative' }}>
      <button
        ref={triggerRef}
        className={cn(
          'nodrag',
          isImageGenerationGlass
            ? [glassStyles.glassSurface, glassStyles.dropdownSurface, glassStyles.selectTrigger]
            : 'w-full h-full flex items-center gap-1.5 px-2 py-1.5 text-xs',
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
          <span className={cn(glassStyles.glassContent, glassStyles.selectTriggerContent)}>
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
          {isImageGenerationGlass ? (
            <div className={glassStyles.glassContent}>{dropdownOptions}</div>
          ) : dropdownOptions}
        </div>,
        document.body
      )}
    </div>
  );
}
