'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { useStoreApi } from '@xyflow/react';
import { ImageIcon } from 'lucide-react';
import { CanvasImage } from '@/components/canvas/CanvasMedia';
import { cn } from '@/lib/utils/cn';
import type { PromptTag } from '@/types';
import {
  activeMentionQuery,
  segmentPrompt,
  syncTagsWithText,
  tagFromInput,
  type TaggableInput,
} from '@/lib/promptTags';
import glassStyles from './ImageGenerationGlass.module.css';

// Prompt textarea with inline "@imageN" chips.
//
// Rendering: the textarea's text is made transparent whenever a live tag exists
// and a mirror <div> with identical typography is painted over it, colouring the
// chips. The mirror ignores pointer events except on chips, which show a
// thumbnail on hover. Typing "@" opens a picker of the connected inputs.

export interface PromptEditorChange {
  prompt: string;
  tags: PromptTag[];
}

interface PromptEditorProps {
  value: string;
  tags: PromptTag[];
  taggable: TaggableInput[];
  onChange: (change: PromptEditorChange) => void;
  onFocusChange?: (focused: boolean) => void;
  placeholder?: string;
  /** Ref to the outer surface (used by callers to position handles). */
  containerRef?: RefObject<HTMLDivElement | null>;
  className?: string;
  /** Custom renderer for plain-text runs (e.g. the Prompt node colours "@colorN"). */
  renderText?: (text: string) => React.ReactNode;
  /** Paint the mirror even without chips (when `renderText` has something to show). */
  alwaysOverlay?: boolean;
  /** Message shown in the picker when there is nothing to tag. */
  emptyHint?: string;
}

interface Anchor {
  top: number;
  left: number;
  width: number;
  scale: number;
}

const CHIP_STYLE: React.CSSProperties = {
  color: 'var(--tag-image-text)',
  background: 'var(--tag-image-bg)',
  borderRadius: 4,
  // Fake vertical padding with offset shadows so the chip doesn't alter text
  // metrics and drift from the invisible text underneath. The spread must not
  // extend horizontally: a single space next to a chip is only ~3px wide and a
  // 2px side spread would paint over it, hiding the word gap.
  boxShadow: '0 2px 0 var(--tag-image-bg), 0 -2px 0 var(--tag-image-bg)',
  pointerEvents: 'auto',
  cursor: 'default',
};

function measure(el: HTMLElement): Anchor {
  const rect = el.getBoundingClientRect();
  const scale = el.offsetWidth > 0 ? rect.width / el.offsetWidth : 1;
  return { top: rect.bottom, left: rect.left, width: el.offsetWidth, scale };
}

function autoResize(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

export function PromptEditor({
  value,
  tags,
  taggable,
  onChange,
  onFocusChange,
  placeholder = 'Write your prompt here…',
  containerRef,
  className,
  renderText,
  alwaysOverlay = false,
  emptyHint = 'Connect an image to this node to tag it.',
}: PromptEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const reactFlowStore = useStoreApi();

  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [pickerAnchor, setPickerAnchor] = useState<Anchor | null>(null);
  const [hoverTag, setHoverTag] = useState<{ tag: PromptTag; rect: DOMRect } | null>(null);

  const segments = useMemo(() => segmentPrompt(value, tags), [value, tags]);
  const hasChips = segments.some((s) => s.kind === 'tag');
  const showOverlay = hasChips || alwaysOverlay;
  const urlByPort = useMemo(
    () => new Map(taggable.map((i) => [i.portIndex, i.url])),
    [taggable],
  );

  const options = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    return taggable.filter((i) => i.label.toLowerCase().startsWith(q) || `@${i.label}`.startsWith(q));
  }, [mention, taggable]);

  useLayoutEffect(() => {
    if (textareaRef.current) autoResize(textareaRef.current);
  }, [value]);

  // Keep the picker glued to the textarea while the canvas pans/zooms.
  useLayoutEffect(() => {
    if (!mention) return;
    let frameId: number | undefined;
    const sync = () => {
      if (textareaRef.current) setPickerAnchor(measure(textareaRef.current));
    };
    sync();
    const schedule = () => {
      if (frameId !== undefined) cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(sync);
    };
    const unsubscribe = reactFlowStore.subscribe(schedule);
    window.addEventListener('resize', schedule);
    return () => {
      unsubscribe();
      window.removeEventListener('resize', schedule);
      if (frameId !== undefined) cancelAnimationFrame(frameId);
    };
  }, [mention, reactFlowStore]);

  useEffect(() => {
    if (!mention) return;
    function onOutsideDown(e: MouseEvent) {
      const target = e.target as Node;
      if (textareaRef.current?.contains(target)) return;
      if (pickerRef.current?.contains(target)) return;
      setMention(null);
    }
    document.addEventListener('mousedown', onOutsideDown, true);
    return () => document.removeEventListener('mousedown', onOutsideDown, true);
  }, [mention]);

  // Clamp at read time rather than in an effect so a shrinking option list
  // never leaves the highlight out of range.
  const activeIndex = Math.min(highlight, Math.max(0, options.length - 1));

  const commit = useCallback(
    (nextText: string) => {
      onChange({ prompt: nextText, tags: syncTagsWithText(nextText, tags, taggable) });
    },
    [onChange, tags, taggable],
  );

  function refreshMention(el: HTMLTextAreaElement) {
    const caret = el.selectionStart ?? el.value.length;
    const next = activeMentionQuery(el.value, caret);
    setMention(next);
    if (next) setHighlight(0);
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    commit(e.target.value);
    refreshMention(e.target);
  }

  function pick(input: TaggableInput) {
    const el = textareaRef.current;
    if (!el || !mention) return;
    const caret = el.selectionStart ?? value.length;
    const insert = `@${input.label} `;
    const nextText = value.slice(0, mention.start) + insert + value.slice(caret);
    const nextTags = syncTagsWithText(
      nextText,
      tags.some((t) => t.label === input.label) ? tags : [...tags, tagFromInput(input)],
      taggable,
    );
    onChange({ prompt: nextText, tags: nextTags });
    setMention(null);
    const nextCaret = mention.start + insert.length;
    requestAnimationFrame(() => {
      const t = textareaRef.current;
      if (!t) return;
      t.focus();
      t.setSelectionRange(nextCaret, nextCaret);
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!mention) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      setMention(null);
      return;
    }
    if (options.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => (h + 1) % options.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => (h - 1 + options.length) % options.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      pick(options[activeIndex] ?? options[0]);
    }
  }

  const hoverUrl = hoverTag ? urlByPort.get(hoverTag.tag.portIndex) ?? '' : '';

  return (
    <div
      ref={containerRef}
      className={cn(glassStyles.glassSurface, glassStyles.promptSection, glassStyles.promptSurface, className)}
    >
      {showOverlay && (
        <div
          aria-hidden="true"
          className={cn(glassStyles.glassContent, glassStyles.promptContent, 'pointer-events-none')}
          // Inline positioning: the CSS module also sets `position`, and the
          // module wins over utility classes — inline keeps the mirror pinned.
          style={{
            position: 'absolute',
            inset: 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            overflow: 'hidden',
            color: '#fff',
          }}
        >
          {segments.map((seg, i) =>
            seg.kind === 'tag' ? (
              <span
                key={i}
                style={CHIP_STYLE}
                onMouseEnter={(e) => setHoverTag({ tag: seg.tag, rect: e.currentTarget.getBoundingClientRect() })}
                onMouseLeave={() => setHoverTag(null)}
                onMouseDown={(e) => {
                  // Let a click on a chip land in the textarea like normal text.
                  e.preventDefault();
                  textareaRef.current?.focus();
                }}
              >
                {seg.text}
              </span>
            ) : (
              <span key={i}>{renderText ? renderText(seg.text) : seg.text}</span>
            ),
          )}
          {value.endsWith('\n') ? '\u200b' : null}
        </div>
      )}

      <textarea
        ref={textareaRef}
        className={cn(glassStyles.glassContent, glassStyles.promptContent, 'outline-none nodrag')}
        rows={2}
        placeholder={placeholder}
        value={value}
        onFocus={() => onFocusChange?.(true)}
        onBlur={() => onFocusChange?.(false)}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onClick={(e) => refreshMention(e.currentTarget)}
        onKeyUp={(e) => {
          if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') refreshMention(e.currentTarget);
        }}
        style={{ color: showOverlay ? 'transparent' : '#fff', caretColor: '#fff' }}
      />

      {/* ── @ picker ─────────────────────────────────────────── */}
      {mention && pickerAnchor && typeof document !== 'undefined' && createPortal(
        <div
          ref={pickerRef}
          className={cn('nodrag nowheel', glassStyles.glassSurface, glassStyles.dropdownMenu)}
          style={{
            position: 'fixed',
            top: pickerAnchor.top + 4 * pickerAnchor.scale,
            left: pickerAnchor.left,
            width: pickerAnchor.width,
            transform: `scale(${pickerAnchor.scale})`,
            transformOrigin: 'top left',
            borderRadius: 11,
            overflow: 'hidden',
            zIndex: 99999,
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className={glassStyles.glassContent} style={{ padding: 4 }}>
            {taggable.length === 0 ? (
              <div className="px-2 py-1.5 text-[10px]" style={{ color: 'var(--color-white-muted)' }}>
                {emptyHint}
              </div>
            ) : options.length === 0 ? (
              <div className="px-2 py-1.5 text-[10px]" style={{ color: 'var(--color-white-muted)' }}>
                No match for “@{mention.query}”.
              </div>
            ) : (
              options.map((input, i) => (
                <button
                  key={input.portIndex}
                  type="button"
                  className="nodrag w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left"
                  style={{
                    background: i === activeIndex ? 'rgba(255,255,255,0.07)' : 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    outline: 'none',
                  }}
                  onMouseEnter={() => setHighlight(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(input)}
                >
                  <Thumb url={input.url} size={22} />
                  <span
                    className="text-[11px] font-semibold"
                    style={{ color: 'var(--tag-image-text)' }}
                  >
                    @{input.label}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>,
        document.body,
      )}

      {/* ── Hover thumbnail ──────────────────────────────────── */}
      {hoverTag && typeof document !== 'undefined' && createPortal(
        <div
          className="pointer-events-none"
          style={{
            position: 'fixed',
            left: hoverTag.rect.left + hoverTag.rect.width / 2,
            top: hoverTag.rect.top - 8,
            transform: 'translate(-50%, -100%)',
            zIndex: 99999,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6,
            padding: 6,
            borderRadius: 12,
            background: 'rgba(20,20,22,0.96)',
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: 'var(--shadow-modal)',
          }}
        >
          <Thumb url={hoverUrl} size={120} radius={8} />
          <span
            className="text-[11px] font-semibold px-1.5 py-0.5 rounded"
            style={{ color: 'var(--tag-image-text)', background: 'var(--tag-image-bg)' }}
          >
            @{hoverTag.tag.label}
          </span>
        </div>,
        document.body,
      )}
    </div>
  );
}

function Thumb({ url, size, radius = 5 }: { url: string; size: number; radius?: number }) {
  return (
    <span
      className="flex items-center justify-center shrink-0 overflow-hidden"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: 'var(--tag-image-bg)',
        color: 'var(--tag-image-text)',
      }}
    >
      {url ? (
        <CanvasImage src={url} alt="" fill className="object-cover" style={{ width: size, height: size }} />
      ) : (
        <ImageIcon size={Math.max(10, Math.round(size * 0.45))} />
      )}
    </span>
  );
}
