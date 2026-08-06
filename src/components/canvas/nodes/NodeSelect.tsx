'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStoreApi } from '@xyflow/react';
import { ChevronDown, Lock } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import glassStyles from './ImageGenerationGlass.module.css';

interface NodeSelectProps {
  options: string[];
  value: string;
  onChange: (value: string) => void;
  leadingIcon?: React.ReactNode;
  optionIcon?: (option: string) => React.ReactNode;
  appearance?: 'default' | 'imageGenerationGlass';
  locked?: boolean;
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

export function NodeSelect({
  options,
  value,
  onChange,
  leadingIcon,
  optionIcon,
  appearance = 'imageGenerationGlass',
  locked = false,
}: NodeSelectProps) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [pos, setPos] = useState<DropdownPosition>({ top: 0, left: 0, width: 0, scale: 1 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const reactFlowStore = useStoreApi();
  const isImageGenerationGlass = appearance === 'imageGenerationGlass';

  function openDropdown(e: React.MouseEvent) {
    e.stopPropagation();
    if (locked) return;
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
      {locked ? (
        <Lock
          size={isImageGenerationGlass ? 12 : 18}
          className={cn(isImageGenerationGlass && glassStyles.lockIcon)}
          aria-hidden
        />
      ) : (
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
      )}
    </>
  );

  const dropdownOptions = options.map((opt) => (
    <button
      key={opt}
      className={cn(
        'nodrag w-full flex items-center gap-1.5 px-2 py-1.5 text-xs',
        isImageGenerationGlass && glassStyles.dropdownOption,
      )}
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
      {optionIcon?.(opt)}
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
            ? [glassStyles.glassSurface, glassStyles.selectTrigger, locked && glassStyles.selectTriggerLocked]
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
        disabled={locked}
        aria-label={locked ? `${value}, locked` : undefined}
        onClick={openDropdown}
      >
        {isImageGenerationGlass ? (
          <span className={cn(glassStyles.glassContent, glassStyles.selectTriggerContent)}>
            {triggerContent}
          </span>
        ) : triggerContent}
      </button>

      {open && !locked && typeof document !== 'undefined' && createPortal(
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
