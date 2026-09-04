'use client';

import { Position, type NodeProps } from '@xyflow/react';
import { Type, Sunrise, Droplet, Plus, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { NodeWrapper } from './NodeWrapper';
import { TypedHandle, PORT_COLORS } from './TypedHandle';
import { NodeSelect } from './NodeSelect';
import type { PromptNodeData, PaletteColor } from '@/types';
import { useFlowStore } from '@/lib/stores/flowStore';
import { cn } from '@/lib/utils/cn';
import glassStyles from './ImageGenerationGlass.module.css';
import { PromptEditor } from './PromptEditor';
import { getDownstreamTaggableInputs, syncTagsWithText } from '@/lib/promptTags';
import type { PromptTag } from '@/types';

const GEMINI_MODELS = [
  { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite' },
];

const LENGTH_OPTIONS = [
  { id: 'auto',   label: 'Auto' },
  { id: 'short',  label: 'Short' },
  { id: 'medium', label: 'Medium' },
  { id: 'long',   label: 'Long' },
];

const MAX_PALETTE_COLORS = 5;

function hexToColorName(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) || 0;
  const g = parseInt(hex.slice(3, 5), 16) || 0;
  const b = parseInt(hex.slice(5, 7), 16) || 0;
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) {
    if (l < 0.12) return 'Black';
    if (l > 0.88) return 'White';
    return l < 0.4 ? 'Dark Gray' : l > 0.6 ? 'Light Gray' : 'Gray';
  }
  const d = max - min;
  let h = 0;
  if (max === rn)      h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else                 h = ((rn - gn) / d + 4) / 6;
  h = Math.round(h * 360);
  const shade = l < 0.28 ? 'Dark ' : l > 0.72 ? 'Light ' : '';
  if (h < 15 || h >= 345) return `${shade}Red`;
  if (h < 40)  return `${shade}Orange`;
  if (h < 65)  return `${shade}Yellow`;
  if (h < 80)  return `${shade}Yellow-Green`;
  if (h < 150) return `${shade}Green`;
  if (h < 175) return `${shade}Teal`;
  if (h < 200) return `${shade}Cyan`;
  if (h < 245) return `${shade}Blue`;
  if (h < 265) return `${shade}Indigo`;
  if (h < 290) return `${shade}Purple`;
  if (h < 325) return `${shade}Magenta`;
  return `${shade}Pink`;
}

function buildEnrichedPrompt(rawPrompt: string, palette: PaletteColor[]): string {
  const active = palette.filter(c => c.hex);
  if (!active.length) return rawPrompt;

  let enriched = rawPrompt;
  const untagged: PaletteColor[] = [];

  active.forEach((c, i) => {
    const ref = `@color${i + 1}`;
    if (rawPrompt.includes(ref)) {
      enriched = enriched.replaceAll(ref, `${hexToColorName(c.hex)} (Hex: ${c.hex})`);
    } else {
      untagged.push(c);
    }
  });

  if (untagged.length > 0) {
    const pool = untagged.map(c => `${hexToColorName(c.hex)} (Hex: ${c.hex})`).join(', ');
    enriched += `\n\nColor palette for background/secondary elements: ${pool}`;
  }

  return enriched;
}

function ColorTextOverlay({ text, palette }: { text: string; palette: PaletteColor[] }) {
  const refs = palette.map((_, i) => `@color${i + 1}`);
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    let firstIdx = -1, firstRef = '', firstColorIdx = 0;
    for (let ci = 0; ci < refs.length; ci++) {
      const idx = remaining.indexOf(refs[ci]);
      if (idx >= 0 && (firstIdx === -1 || idx < firstIdx)) {
        firstIdx = idx; firstRef = refs[ci]; firstColorIdx = ci;
      }
    }

    if (firstIdx === -1) {
      parts.push(<span key={key++} style={{ color: '#fff' }}>{remaining}</span>);
      break;
    }
    if (firstIdx > 0) {
      parts.push(<span key={key++} style={{ color: '#fff' }}>{remaining.slice(0, firstIdx)}</span>);
    }

    const c = palette[firstColorIdx];
    parts.push(
      <span key={key++} style={{ color: c?.hex ?? '#fff' }}>
        {firstRef}
      </span>
    );
    remaining = remaining.slice(firstIdx + firstRef.length);
  }

  return <>{parts}</>;
}

export function PromptNode({ data, selected, id }: NodeProps & { data: PromptNodeData }) {
  const storeEdges = useFlowStore(state => state.edges);
  const storeNodes = useFlowStore(state => state.nodes);
  const [enhancing, setEnhancing] = useState(false);
  const [geminiModel, setGeminiModel] = useState('gemini-3.7-flash');
  const [length, setLength] = useState('auto');
  const paletteEnabled = data.paletteEnabled ?? false;
  const palette: PaletteColor[] = data.palette ?? [];
  const promptHistory: string[] = data.promptHistory ?? [];

  const [localPrompt, setLocalPrompt] = useState(() => data.prompt ?? '');
  const isFocused = useRef(false);
  const focusedValue = useRef('');
  // Which history entry is currently being viewed (0-indexed, last = latest)
  const [historyIdx, setHistoryIdx] = useState(() => Math.max(0, promptHistory.length - 1));
  const isViewingHistory = promptHistory.length > 1 && historyIdx < promptHistory.length - 1;

  // Stay at latest when history grows (new entries appended)
  const prevHistoryLen = useRef(promptHistory.length);
  useEffect(() => {
    if (promptHistory.length > prevHistoryLen.current) {
      setHistoryIdx(promptHistory.length - 1);
    }
    prevHistoryLen.current = promptHistory.length;
  }, [promptHistory.length]);

  // "@imageN" tags are positional here: port N on every Image Generation node
  // this prompt feeds. The picker lists the union of those nodes' inputs.
  const promptTags: PromptTag[] = data.promptTags ?? [];
  const taggableInputs = getDownstreamTaggableInputs(id, storeNodes, storeEdges);
  const promptTagCount = promptTags.length;
  const lastTagCount = useRef(promptTagCount);

  // Sync localPrompt from Zustand when not focused (external changes). An
  // untag (target disconnected) rewrites the text and must win even while
  // typing; it also has to reach the targets, so re-propagate.
  useEffect(() => {
    const tagsChanged = lastTagCount.current !== promptTagCount;
    lastTagCount.current = promptTagCount;
    if (!isFocused.current || tagsChanged) setLocalPrompt(data.prompt ?? '');
    if (tagsChanged) propagatePrompt(data.prompt ?? '', data.promptTags ?? []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.prompt, promptTagCount]);

  const hasColorRefs = paletteEnabled && palette.some((_, i) => localPrompt.includes(`@color${i + 1}`));

  function dispatchUpdate(updates: Partial<PromptNodeData>) {
    document.dispatchEvent(new CustomEvent('node:update', { detail: { nodeId: id, data: updates } }));
  }

  function propagatePrompt(rawPrompt: string, tags: PromptTag[] = promptTags) {
    const enriched = paletteEnabled && palette.length
      ? buildEnrichedPrompt(rawPrompt, palette)
      : rawPrompt;
    document.dispatchEvent(new CustomEvent('node:prompt-propagate', {
      detail: { sourceNodeId: id, prompt: enriched, promptTags: tags },
    }));
  }

  /** Apply new prompt text that may have gained or lost "@imageN" chips. */
  function applyPrompt(nextPrompt: string, nextTags: PromptTag[] = syncTagsWithText(nextPrompt, promptTags, taggableInputs)) {
    setLocalPrompt(nextPrompt);
    dispatchUpdate(nextTags === promptTags ? { prompt: nextPrompt } : { prompt: nextPrompt, promptTags: nextTags });
    propagatePrompt(nextPrompt, nextTags);
  }

  function addToHistory(value: string) {
    const history = data.promptHistory ?? [];
    if (history[history.length - 1] === value) return;
    dispatchUpdate({ promptHistory: [...history, value] });
  }

  function handleFocus() {
    isFocused.current = true;
    focusedValue.current = localPrompt;
  }

  function handleBlur() {
    isFocused.current = false;
    if (localPrompt !== focusedValue.current || (data.promptHistory ?? []).length === 0) {
      addToHistory(localPrompt);
    }
  }

  useEffect(() => {
    if (data.prompt) {
      const enriched = data.paletteEnabled && (data.palette ?? []).length
        ? buildEnrichedPrompt(data.prompt, data.palette ?? [])
        : data.prompt;
      document.dispatchEvent(new CustomEvent('node:prompt-propagate', {
        detail: { sourceNodeId: id, prompt: enriched, promptTags: data.promptTags ?? [] },
      }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.paletteEnabled, data.palette]);

  async function handleEnhance() {
    if (!data.prompt?.trim() || enhancing) return;
    setEnhancing(true);
    try {
      const res = await fetch('/api/google/enhance-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: data.prompt, geminiModel, length }),
      });
      const { enhancedPrompt } = await res.json();
      if (enhancedPrompt) {
        applyPrompt(enhancedPrompt);
        addToHistory(enhancedPrompt);
      }
    } finally {
      setEnhancing(false);
    }
  }

  function navigateHistory(idx: number) {
    setHistoryIdx(idx);
    const entry = promptHistory[idx] ?? '';
    // Restore this version as the active prompt
    applyPrompt(entry);
  }

  function addColor() {
    if (palette.length >= MAX_PALETTE_COLORS) return;
    dispatchUpdate({ palette: [...palette, { name: '', hex: '#3b9eff' }] });
  }

  function removeColor(i: number) {
    const ref = `@color${i + 1}`;
    const newPalette = palette.filter((_, idx) => idx !== i);
    const newPrompt = localPrompt.replaceAll(ref, '').replace(/  +/g, ' ').trim();
    const newTags = syncTagsWithText(newPrompt, promptTags, taggableInputs);
    setLocalPrompt(newPrompt);
    dispatchUpdate({ palette: newPalette, prompt: newPrompt, promptTags: newTags });
    propagatePrompt(newPrompt, newTags);
  }

  function updateColorHex(i: number, hex: string) {
    const newPalette = [...palette];
    newPalette[i] = { ...newPalette[i], hex };
    dispatchUpdate({ palette: newPalette });
  }

  return (
    <NodeWrapper
      title="Prompt"
      icon={<Type size={14} />}
      selected={selected}
      minWidth={300}
      accentColor={PORT_COLORS.text}
      titlePosition="outside"
      appearance="imageGenerationGlass"
      footer={
        <div className={glassStyles.footerStack}>
          <button
            onClick={handleEnhance}
            disabled={enhancing || !data.prompt?.trim()}
            className={cn(
              glassStyles.glassSurface,
              glassStyles.button,
              glassStyles.generateButton,
              'transition-opacity disabled:opacity-40 nodrag',
            )}
          >
            <span className={cn(glassStyles.glassContent, glassStyles.buttonContent)}>
              <Sunrise size={11} className={enhancing ? 'animate-pulse' : ''} />
              {enhancing ? 'Enhancing…' : 'Enhance'}
            </span>
          </button>
        </div>
      }
    >
      {/* History navigation */}
      {promptHistory.length > 1 && (
        <div className={glassStyles.historyNav}>
          <button
            onClick={() => navigateHistory(Math.max(0, historyIdx - 1))}
            disabled={historyIdx === 0}
            className="flex items-center p-0.5 rounded transition-opacity disabled:opacity-30 nodrag"
            style={{ color: 'var(--color-white-muted)' }}
          >
            <ChevronLeft size={13} />
          </button>
          <span
            className={glassStyles.microLabel}
            style={{ color: isViewingHistory ? 'var(--color-accent)' : undefined }}
          >
            {`VERSION ${historyIdx + 1}`}
          </span>
          <button
            onClick={() => navigateHistory(Math.min(promptHistory.length - 1, historyIdx + 1))}
            disabled={historyIdx === promptHistory.length - 1}
            className="flex items-center p-0.5 rounded transition-opacity disabled:opacity-30 nodrag"
            style={{ color: 'var(--color-white-muted)' }}
          >
            <ChevronRight size={13} />
          </button>
        </div>
      )}

      {/* Prompt area */}
      <PromptEditor
        value={localPrompt}
        tags={promptTags}
        taggable={taggableInputs}
        onChange={({ prompt, tags }) => applyPrompt(prompt, tags)}
        onFocusChange={(focused) => (focused ? handleFocus() : handleBlur())}
        alwaysOverlay={hasColorRefs}
        renderText={hasColorRefs ? (text) => <ColorTextOverlay text={text} palette={palette} /> : undefined}
        emptyHint="Connect this prompt to an Image Generation node with images to tag them."
      />

      {/* Model + length selectors */}
      <div className={glassStyles.selectRow}>
        <NodeSelect
          options={GEMINI_MODELS.map(m => m.label)}
          value={GEMINI_MODELS.find(m => m.id === geminiModel)?.label ?? GEMINI_MODELS[0].label}
          onChange={(label) => { const m = GEMINI_MODELS.find(m => m.label === label); if (m) setGeminiModel(m.id); }}
        />
        <NodeSelect
          options={LENGTH_OPTIONS.map(o => o.label)}
          value={LENGTH_OPTIONS.find(o => o.id === length)?.label ?? 'Auto'}
          onChange={(label) => { const o = LENGTH_OPTIONS.find(o => o.label === label); if (o) setLength(o.id); }}
        />
      </div>

      {/* Palette toggle */}
      <div className={glassStyles.chipRow}>
        <button
          onClick={() => dispatchUpdate({ paletteEnabled: !paletteEnabled })}
          className={cn(
            glassStyles.glassSurface,
            glassStyles.chip,
            paletteEnabled && glassStyles.chipActive,
            'nodrag',
          )}
        >
          <span className={cn(glassStyles.glassContent, glassStyles.buttonContent)}>
            <Droplet size={11} />
            {paletteEnabled ? 'Palette' : 'Add Palette'}
          </span>
        </button>
      </div>

      {/* Color palette section */}
      {paletteEnabled && (
        <div className={glassStyles.field}>
          <span className={glassStyles.microLabel}>Color Palette</span>
          {palette.map((color, i) => (
            <div key={i} className="flex items-center gap-2">
              <label
                className="nodrag shrink-0 cursor-pointer"
                style={{ display: 'block', width: 20, height: 20, borderRadius: 5, background: color.hex, overflow: 'hidden', position: 'relative' }}
              >
                <input
                  type="color"
                  value={color.hex}
                  onChange={(e) => updateColorHex(i, e.target.value)}
                  className="nodrag"
                  style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer', padding: 0, border: 'none' }}
                />
              </label>
              <span className="flex-1" style={{ color: 'rgba(255,255,255,0.6)', fontFamily: 'monospace', fontSize: 11 }}>
                @color{i + 1}
              </span>
              <button onClick={() => removeColor(i)} className="nodrag shrink-0" style={{ color: 'rgba(255,255,255,0.35)' }}>
                <X size={11} />
              </button>
            </div>
          ))}
          {palette.length < MAX_PALETTE_COLORS && (
            <button
              onClick={addColor}
              className="flex items-center gap-1 nodrag"
              style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11 }}
            >
              <Plus size={11} />
              Add color
            </button>
          )}
        </div>
      )}

      <TypedHandle
        type="source"
        position={Position.Right}
        id="prompt"
        portType="text"
        connected={storeEdges.some(e => e.source === id && e.sourceHandle === 'prompt')}
      />
    </NodeWrapper>
  );
}
