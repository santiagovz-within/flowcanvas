'use client';

import { Position, type NodeProps } from '@xyflow/react';
import { Wand2, RefreshCw, Copy, Check, AlertTriangle, ChevronLeft, ChevronRight, Layout, AlignLeft } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NodeWrapper } from './NodeWrapper';
import { TypedHandle, PORT_COLORS } from './TypedHandle';
import { NodeSelect } from './NodeSelect';
import type { ImageToPromptNodeData } from '@/types';
import { useFlowStore } from '@/lib/stores/flowStore';
import { CanvasImage } from '@/components/canvas/CanvasMedia';
import { cn } from '@/lib/utils/cn';
import glassStyles from './ImageGenerationGlass.module.css';
import { GalleryPicker } from './MediaInputNode';

function autoResize(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

const LENGTH_OPTIONS = [
  { id: 'auto',   label: 'Auto' },
  { id: 'short',  label: 'Short' },
  { id: 'medium', label: 'Medium' },
  { id: 'long',   label: 'Long' },
];

export function ImageToPromptNode({ data, selected, id }: NodeProps & { data: ImageToPromptNodeData }) {
  const [copied, setCopied] = useState(false);
  const [length, setLength] = useState('auto');
  const [showGallery, setShowGallery] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isFocused = useRef(false);

  const storeEdges = useFlowStore(state => state.edges);

  const [localPrompt, setLocalPrompt] = useState(data.generatedPrompt ?? '');

  // Sync from external data (history navigation, new generation) when not focused
  useEffect(() => {
    if (!isFocused.current) setLocalPrompt(data.generatedPrompt ?? '');
  }, [data.generatedPrompt]);

  const promptHistory: string[] = data.promptHistory ?? [];
  const [historyIdx, setHistoryIdx] = useState(() => Math.max(0, promptHistory.length - 1));
  const isViewingHistory = promptHistory.length > 1 && historyIdx < promptHistory.length - 1;

  // Stay at latest when a new result is appended
  const prevLen = useRef(promptHistory.length);
  useEffect(() => {
    if (promptHistory.length > prevLen.current) setHistoryIdx(promptHistory.length - 1);
    prevLen.current = promptHistory.length;
  }, [promptHistory.length]);

  useLayoutEffect(() => {
    if (textareaRef.current) autoResize(textareaRef.current);
  }, [localPrompt, historyIdx]);

  function updateData(updates: Partial<ImageToPromptNodeData>) {
    document.dispatchEvent(new CustomEvent('node:update', { detail: { nodeId: id, data: updates } }));
  }

  function propagate(prompt: string) {
    document.dispatchEvent(new CustomEvent('node:prompt-propagate', {
      detail: { sourceNodeId: id, prompt },
    }));
  }

  async function handleAnalyze() {
    if (!data.inputImageUrl || data.status === 'processing') return;
    updateData({ status: 'processing', generatedPrompt: undefined });

    try {
      const res = await fetch('/api/google/image-to-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: data.inputImageUrl, length }),
      });
      const result = await res.json();
      if (result.prompt) {
        const history = data.promptHistory ?? [];
        const newHistory = [...history, result.prompt];
        updateData({ status: 'completed', generatedPrompt: result.prompt, promptHistory: newHistory });
        propagate(result.prompt);
      } else {
        updateData({ status: 'error' });
      }
    } catch {
      updateData({ status: 'error' });
    }
  }

  function navigateHistory(idx: number) {
    setHistoryIdx(idx);
    const entry = promptHistory[idx] ?? '';
    updateData({ generatedPrompt: entry });
    propagate(entry);
  }

  function handleCopy() {
    if (!localPrompt) return;
    navigator.clipboard.writeText(localPrompt);
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 2000);
  }

  function handleGallerySelect(url: string) {
    setShowGallery(false);
    updateData({ inputImageUrl: url });
  }

  useEffect(() => () => { if (copiedTimer.current) clearTimeout(copiedTimer.current); }, []);

  const isProcessing = data.status === 'processing';
  const hasPrompt = !!data.generatedPrompt;
  const hasImage = !!data.inputImageUrl;

  return (
    <NodeWrapper
      title="Image to Prompt"
      icon={<Wand2 size={14} />}
      status={data.status}
      selected={selected}
      minWidth={300}
      accentColor={PORT_COLORS.text}
      titlePosition="outside"
      appearance="imageGenerationGlass"
      footer={
        <div className={glassStyles.footerStack}>
          <button
            onClick={handleAnalyze}
            disabled={!hasImage || isProcessing}
            className={cn(
              glassStyles.glassSurface,
              glassStyles.button,
              glassStyles.generateButton,
              'transition-opacity disabled:opacity-40 nodrag',
            )}
          >
            <span className={cn(glassStyles.glassContent, glassStyles.buttonContent)}>
              {isProcessing ? (
                <><RefreshCw size={11} className="animate-spin" /> Analyzing…</>
              ) : (
                <><Wand2 size={11} /> Analyze Image</>
              )}
            </span>
          </button>
        </div>
      }
    >
      <TypedHandle
        type="target"
        position={Position.Left}
        id="image"
        portType="image"
        connected={storeEdges.some(e => e.target === id && e.targetHandle === 'image')}
      />
      <TypedHandle
        type="source"
        position={Position.Right}
        id="prompt"
        portType="text"
        connected={storeEdges.some(e => e.source === id && e.sourceHandle === 'prompt')}
      />

      {/* Version history navigation */}
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

      {/* Image preview */}
      {hasImage ? (
        <div className={glassStyles.mediaFrame}>
          <CanvasImage
            src={data.inputImageUrl!}
            alt="Input"
            className="w-full block"
            draggable={false}
          />
        </div>
      ) : (
        <div className={glassStyles.emptyState}>
          Connect an image to analyze
        </div>
      )}

      {!hasImage && (
        <button
          onClick={() => setShowGallery(true)}
          className={cn(
            glassStyles.glassSurface,
            glassStyles.button,
            glassStyles.footerControl,
            glassStyles.buttonSmall,
            'transition-opacity hover:opacity-80 nodrag',
          )}
        >
          <span className={cn(glassStyles.glassContent, glassStyles.buttonContent)}>
            <Layout size={12} />
            Browse Gallery
          </span>
        </button>
      )}

      {/* Length */}
      <div className={glassStyles.field}>
        <span className={glassStyles.microLabel}>Prompt Length</span>
        <NodeSelect
          options={LENGTH_OPTIONS.map(o => o.label)}
          value={LENGTH_OPTIONS.find(o => o.id === length)?.label ?? 'Auto'}
          onChange={(label) => { const o = LENGTH_OPTIONS.find(o => o.label === label); if (o) setLength(o.id); }}
          leadingIcon={<AlignLeft size={10} />}
        />
      </div>

      {/* Error state */}
      {data.status === 'error' && !hasPrompt && (
        <div className={cn(glassStyles.notice, glassStyles.noticeError)}>
          <AlertTriangle size={12} style={{ flexShrink: 0 }} />
          Analysis failed. Try again.
        </div>
      )}

      {/* Generated prompt — editable */}
      {hasPrompt && (
        <div className={cn(glassStyles.glassSurface, glassStyles.promptSection, glassStyles.promptSurface)}>
          <textarea
            ref={textareaRef}
            value={localPrompt}
            rows={1}
            className={cn(glassStyles.glassContent, glassStyles.promptContent, 'outline-none nodrag')}
            style={{ paddingRight: 32 }}
            onFocus={() => { isFocused.current = true; }}
            onBlur={() => { isFocused.current = false; }}
            onChange={(e) => {
              const v = e.target.value;
              setLocalPrompt(v);
              autoResize(e.target);
              updateData({ generatedPrompt: v });
              propagate(v);
            }}
          />
          <button
            onClick={handleCopy}
            className="p-1 rounded nodrag transition-opacity hover:opacity-80"
            style={{ position: 'absolute', top: 6, right: 6, zIndex: 2, color: 'rgba(255,255,255,0.6)' }}
            title="Copy prompt"
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
          </button>
        </div>
      )}

      {showGallery && (
        <GalleryPicker onSelect={handleGallerySelect} onClose={() => setShowGallery(false)} />
      )}
    </NodeWrapper>
  );
}
