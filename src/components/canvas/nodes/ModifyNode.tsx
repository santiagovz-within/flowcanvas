'use client';

import { Position, type NodeProps } from '@xyflow/react';
import { Sliders, Play, Download, AlertTriangle } from 'lucide-react';
import { SendToFigmaButton } from './SendToFigmaButton';
import { downloadFromUrl } from '@/lib/utils/download';
import { playSuccessSound } from '@/lib/utils/sound';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NodeWrapper } from './NodeWrapper';
import { TypedHandle, PORT_COLORS } from './TypedHandle';
import { ModelSelect } from './ModelSelect';
import { NodeSelect } from './NodeSelect';
import { useFlowStore } from '@/lib/stores/flowStore';
import { ASPECT_RATIOS, RESOLUTIONS } from '@/lib/utils/constants';
import type {
  ModifyNodeData, ImageGenNodeData, ImageInputNodeData, UpscaleNodeData, MediaInputNodeData,
  VideoGenNodeData, VideoInputNodeData, VideoUpscaleNodeData, UpscaleMediaNodeData,
} from '@/types';
import { getSourceMediaType } from '../mediaOutputs';

// ── Constants ──────────────────────────────────────────────────────────────────

const MODIFY_MODELS = [
  { id: 'nano-banana-2',   name: 'Nano Banana 2 Edit' },
  { id: 'nano-banana-pro', name: 'Nano Banana Pro Edit' },
  { id: 'seedream-5',      name: 'Seedream v5 Edit' },
];

const IMAGE_ROW_HEIGHT = 36;
const CANVAS_MAX_W = 232;
const CANVAS_MAX_H = 268;
const HANDLE_ZONE  = 10;

const ASPECT_PRESETS = [
  { label: '1:1',  ratio: 1 },
  { label: '4:3',  ratio: 4 / 3 },
  { label: '16:9', ratio: 16 / 9 },
  { label: '21:9', ratio: 21 / 9 },
  { label: '9:16', ratio: 9 / 16 },
  { label: '3:4',  ratio: 3 / 4 },
];

const OUTPAINT_ASPECT_RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16', '9:21'];

const VIDEO_OUTPAINT_DEFAULT_PROMPT = 'This same scene, extending the environment naturally beyond the original frame.';
const VIDEO_OUTPAINT_DEFAULT_NEGATIVE_PROMPT = 'color distortion, overexposure, static, blurry details, subtitles, style, artwork, painting, frame, still, dim overall tone, worst quality, low quality, JPEG compression artifacts, ugly, mutilated, extra fingers, poorly drawn hands, poorly drawn face, deformed, disfigured, malformed limbs, fused fingers, motionless frame, cluttered background, three legs, crowded background, walking backwards';

type AnchorKey = 'tl' | 't' | 'tr' | 'l' | 'c' | 'r' | 'bl' | 'b' | 'br';
const ANCHOR_GRID: AnchorKey[][] = [
  ['tl', 't', 'tr'],
  ['l',  'c', 'r' ],
  ['bl', 'b', 'br'],
];

// ── Helper functions ───────────────────────────────────────────────────────────

function autoResize(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

// CSS `aspect-ratio` value for an "w:h" label, so source thumbnails match the
// shape of the images they represent instead of being forced into squares.
function cssAspectRatio(label: string): string {
  const [w, h] = label.split(':').map(Number);
  return w > 0 && h > 0 ? `${w} / ${h}` : '1 / 1';
}

function nearestAspectRatio(w: number, h: number): string {
  const ratio = w / h;
  const candidates: [string, number][] = [
    ['1:1', 1], ['16:9', 16/9], ['9:16', 9/16],
    ['4:3', 4/3], ['3:4', 3/4], ['21:9', 21/9],
    ['3:2', 3/2], ['2:3', 2/3],
  ];
  let best = '1:1', bestDiff = Infinity;
  for (const [label, val] of candidates) {
    const diff = Math.abs(ratio - val);
    if (diff < bestDiff) { bestDiff = diff; best = label; }
  }
  return best;
}

function anchorHV(a: AnchorKey): { h: 'left' | 'center' | 'right'; v: 'top' | 'center' | 'bottom' } {
  const map: Record<AnchorKey, { h: 'left' | 'center' | 'right'; v: 'top' | 'center' | 'bottom' }> = {
    tl: { h: 'left',   v: 'top'    }, t:  { h: 'center', v: 'top'    }, tr: { h: 'right',  v: 'top'    },
    l:  { h: 'left',   v: 'center' }, c:  { h: 'center', v: 'center' }, r:  { h: 'right',  v: 'center' },
    bl: { h: 'left',   v: 'bottom' }, b:  { h: 'center', v: 'bottom' }, br: { h: 'right',  v: 'bottom' },
  };
  return map[a];
}

function computeExpansionForAspect(
  imgW: number, imgH: number,
  targetRatio: number,
  anchor: AnchorKey,
): { top: number; right: number; bottom: number; left: number } {
  const { h, v } = anchorHV(anchor);
  const current = imgW / imgH;
  let top = 0, right = 0, bottom = 0, left = 0;

  if (Math.abs(targetRatio - current) < 0.005) return { top, right, bottom, left };

  if (targetRatio > current) {
    const total = Math.round(imgH * targetRatio) - imgW;
    if      (h === 'left')   right = total;
    else if (h === 'right')  left  = total;
    else { left = Math.floor(total / 2); right = total - left; }
  } else {
    const total = Math.round(imgW / targetRatio) - imgH;
    if      (v === 'top')    bottom = total;
    else if (v === 'bottom') top    = total;
    else { top = Math.floor(total / 2); bottom = total - top; }
  }

  return { top, right, bottom, left };
}

// ── Resize plan ───────────────────────────────────────────────────────────────

const MAX_FAL_DIM = 2560;

interface OutpaintResizePlan {
  needsResize: boolean;
  sourceW: number;
  sourceH: number;
  outpaintTop: number;
  outpaintRight: number;
  outpaintBottom: number;
  outpaintLeft: number;
  outputW: number;
  outputH: number;
}

function computeOutpaintResizePlan(
  natW: number, natH: number,
  expTop: number, expRight: number, expBottom: number, expLeft: number,
): OutpaintResizePlan {
  const outputW = natW + expLeft + expRight;
  const outputH = natH + expTop  + expBottom;

  if (outputW <= MAX_FAL_DIM && outputH <= MAX_FAL_DIM) {
    return {
      needsResize: false,
      sourceW: natW, sourceH: natH,
      outpaintTop: expTop, outpaintRight: expRight, outpaintBottom: expBottom, outpaintLeft: expLeft,
      outputW, outputH,
    };
  }

  const s          = Math.min(MAX_FAL_DIM / outputW, MAX_FAL_DIM / outputH);
  const newOutputW = Math.floor(outputW * s);
  const newOutputH = Math.floor(outputH * s);
  const newSrcW    = Math.round(natW * s);
  const newSrcH    = Math.round(natH * s);

  const newTotalW = newOutputW - newSrcW;
  const newTotalH = newOutputH - newSrcH;

  const fracLeft = (expLeft + expRight) > 0 ? expLeft / (expLeft + expRight) : 0.5;
  const fracTop  = (expTop  + expBottom) > 0 ? expTop  / (expTop  + expBottom) : 0.5;

  const newLeft   = Math.round(newTotalW * fracLeft);
  const newRight  = Math.max(0, newTotalW - newLeft);
  const newTop    = Math.round(newTotalH * fracTop);
  const newBottom = Math.max(0, newTotalH - newTop);

  return {
    needsResize: true,
    sourceW: newSrcW, sourceH: newSrcH,
    outpaintTop: Math.max(0, newTop), outpaintRight: Math.max(0, newRight),
    outpaintBottom: Math.max(0, newBottom), outpaintLeft: Math.max(0, newLeft),
    outputW: newOutputW, outputH: newOutputH,
  };
}

// ── ExpandCanvas ───────────────────────────────────────────────────────────────

interface ExpandCanvasProps {
  imageUrl: string;
  expandTop: number;
  expandRight: number;
  expandBottom: number;
  expandLeft: number;
  onChange: (updates: Partial<Record<'top' | 'right' | 'bottom' | 'left', number>>) => void;
  onNaturalSize: (w: number, h: number) => void;
}

function ExpandCanvas({ imageUrl, expandTop, expandRight, expandBottom, expandLeft, onChange, onNaturalSize }: ExpandCanvasProps) {
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);

  const totalW = (naturalSize?.w ?? 1) + expandLeft + expandRight;
  const totalH = (naturalSize?.h ?? 1) + expandTop  + expandBottom;
  const scale  = Math.min(CANVAS_MAX_W / totalW, CANVAS_MAX_H / totalH);

  const dispW   = Math.round(totalW * scale);
  const dispH   = Math.round(totalH * scale);
  const imgW    = Math.round((naturalSize?.w ?? 0) * scale);
  const imgH    = Math.round((naturalSize?.h ?? 0) * scale);
  const imgX    = Math.round(expandLeft * scale);
  const imgY    = Math.round(expandTop  * scale);

  const zoneT = imgY;
  const zoneB = dispH - imgY - imgH;
  const zoneL = imgX;
  const zoneR = dispW - imgX - imgW;

  function startDrag(side: 'top' | 'right' | 'bottom' | 'left', e: React.MouseEvent) {
    const MAX_DIM = 2560;
    const natW = naturalSize?.w ?? 0;
    const natH = naturalSize?.h ?? 0;
    const startExpand = side === 'top' ? expandTop : side === 'right' ? expandRight : side === 'bottom' ? expandBottom : expandLeft;
    const startMouse  = (side === 'left' || side === 'right') ? e.clientX : e.clientY;
    const frozenScale = scale;
    const maxExpand =
      side === 'right'  ? Math.max(0, MAX_DIM - natW - expandLeft) :
      side === 'left'   ? Math.max(0, MAX_DIM - natW - expandRight) :
      side === 'bottom' ? Math.max(0, MAX_DIM - natH - expandTop) :
                          Math.max(0, MAX_DIM - natH - expandBottom);

    function onMove(me: MouseEvent) {
      let newVal: number;
      if      (side === 'right')  newVal = Math.max(0, Math.round(startExpand + (me.clientX - startMouse) / frozenScale));
      else if (side === 'left')   newVal = Math.max(0, Math.round(startExpand - (me.clientX - startMouse) / frozenScale));
      else if (side === 'bottom') newVal = Math.max(0, Math.round(startExpand + (me.clientY - startMouse) / frozenScale));
      else                        newVal = Math.max(0, Math.round(startExpand - (me.clientY - startMouse) / frozenScale));
      onChange({ [side]: Math.min(newVal, maxExpand) });
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
    e.preventDefault();
    e.stopPropagation();
  }

  if (!naturalSize) {
    return (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt="" style={{ display: 'none' }} onLoad={(e) => {
          const img = e.currentTarget;
          const s = { w: img.naturalWidth, h: img.naturalHeight };
          setNaturalSize(s);
          onNaturalSize(s.w, s.h);
        }} />
        <div className="flex items-center justify-center rounded-lg mb-3" style={{ height: 80, background: 'var(--color-bg-surface)', color: 'var(--color-white-muted)', fontSize: 11 }}>
          Loading…
        </div>
      </>
    );
  }

  const STRIPE = 'repeating-linear-gradient(-45deg, rgba(255,255,255,0.03) 0px, rgba(255,255,255,0.03) 3px, transparent 3px, transparent 7px)';
  const hasAny = expandTop > 0 || expandRight > 0 || expandBottom > 0 || expandLeft > 0;

  return (
    <div
      className="nodrag mx-auto mb-3"
      style={{ position: 'relative', width: dispW, height: dispH, flexShrink: 0, userSelect: 'none' }}
    >
      {hasAny && (
        <div style={{ position: 'absolute', inset: 0, background: STRIPE, borderRadius: 6, border: '1px solid rgba(255,255,255,0.08)' }} />
      )}

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageUrl}
        alt="Source"
        style={{
          position: 'absolute',
          left: imgX, top: imgY,
          width: imgW, height: imgH,
          display: 'block',
          pointerEvents: 'none',
          borderRadius: hasAny ? 0 : 5,
        }}
      />

      <div style={{
        position: 'absolute',
        left: imgX, top: imgY, width: imgW, height: imgH,
        pointerEvents: 'none',
        borderTop:    expandTop    > 0 ? '1px dashed rgba(255,255,255,0.3)' : 'none',
        borderRight:  expandRight  > 0 ? '1px dashed rgba(255,255,255,0.3)' : 'none',
        borderBottom: expandBottom > 0 ? '1px dashed rgba(255,255,255,0.3)' : 'none',
        borderLeft:   expandLeft   > 0 ? '1px dashed rgba(255,255,255,0.3)' : 'none',
      }} />

      {expandTop > 0 && zoneT >= 14 && (
        <div style={{ position: 'absolute', top: zoneT / 2 - 5, left: 0, right: 0, textAlign: 'center', fontSize: 9, color: 'rgba(255,255,255,0.45)', pointerEvents: 'none' }}>
          +{expandTop}px
        </div>
      )}
      {expandBottom > 0 && zoneB >= 14 && (
        <div style={{ position: 'absolute', top: imgY + imgH + zoneB / 2 - 5, left: 0, right: 0, textAlign: 'center', fontSize: 9, color: 'rgba(255,255,255,0.45)', pointerEvents: 'none' }}>
          +{expandBottom}px
        </div>
      )}
      {expandLeft > 0 && zoneL >= 22 && (
        <div style={{ position: 'absolute', top: '50%', left: 0, width: zoneL, textAlign: 'center', fontSize: 9, color: 'rgba(255,255,255,0.45)', pointerEvents: 'none', transform: 'translateY(-50%)' }}>
          +{expandLeft}
        </div>
      )}
      {expandRight > 0 && zoneR >= 22 && (
        <div style={{ position: 'absolute', top: '50%', right: 0, width: zoneR, textAlign: 'center', fontSize: 9, color: 'rgba(255,255,255,0.45)', pointerEvents: 'none', transform: 'translateY(-50%)' }}>
          +{expandRight}
        </div>
      )}

      <div
        className="nodrag"
        style={{ position: 'absolute', top: 0, left: HANDLE_ZONE, right: HANDLE_ZONE, height: HANDLE_ZONE, cursor: 'ns-resize', zIndex: 3, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        onMouseDown={(e) => startDrag('top', e)}
      >
        <div style={{ width: 20, height: 2, background: 'rgba(255,255,255,0.45)', borderRadius: 1 }} />
      </div>

      <div
        className="nodrag"
        style={{ position: 'absolute', bottom: 0, left: HANDLE_ZONE, right: HANDLE_ZONE, height: HANDLE_ZONE, cursor: 'ns-resize', zIndex: 3, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        onMouseDown={(e) => startDrag('bottom', e)}
      >
        <div style={{ width: 20, height: 2, background: 'rgba(255,255,255,0.45)', borderRadius: 1 }} />
      </div>

      <div
        className="nodrag"
        style={{ position: 'absolute', left: 0, top: HANDLE_ZONE, bottom: HANDLE_ZONE, width: HANDLE_ZONE, cursor: 'ew-resize', zIndex: 3, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        onMouseDown={(e) => startDrag('left', e)}
      >
        <div style={{ height: 20, width: 2, background: 'rgba(255,255,255,0.45)', borderRadius: 1 }} />
      </div>

      <div
        className="nodrag"
        style={{ position: 'absolute', right: 0, top: HANDLE_ZONE, bottom: HANDLE_ZONE, width: HANDLE_ZONE, cursor: 'ew-resize', zIndex: 3, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        onMouseDown={(e) => startDrag('right', e)}
      >
        <div style={{ height: 20, width: 2, background: 'rgba(255,255,255,0.45)', borderRadius: 1 }} />
      </div>
    </div>
  );
}

// ── SourceThumbnails ───────────────────────────────────────────────────────────
// 3-up grid so each option is large enough to tell apart, sized to the source
// aspect ratio with a tight radius so the framing stays readable.

function SourceThumbnails({ images, selectedIndex, aspect, onSelect }: {
  images: string[];
  selectedIndex: number;
  aspect: string;
  onSelect: (index: number) => void;
}) {
  return (
    <div
      className="mb-3 nodrag"
      style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, padding: 3 }}
    >
      {images.map((url, i) => (
        <button
          key={i}
          onClick={() => onSelect(i)}
          className="nodrag"
          style={{
            width: '100%', aspectRatio: aspect, borderRadius: 3, padding: 0, overflow: 'hidden',
            display: 'block', background: 'var(--color-bg-surface)',
            outline: selectedIndex === i ? '2px solid #a855f7' : '2px solid transparent',
            outlineOffset: 1,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        </button>
      ))}
    </div>
  );
}

// ── AnchorPicker ───────────────────────────────────────────────────────────────

function AnchorPicker({ value, onChange }: { value: AnchorKey; onChange: (v: AnchorKey) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 16px)', gap: 3 }}>
      {ANCHOR_GRID.flat().map((anchor) => (
        <button
          key={anchor}
          className="nodrag"
          style={{
            width: 16, height: 16, borderRadius: 3, padding: 0, cursor: 'pointer', position: 'relative',
            border:      value === anchor ? '1.5px solid rgba(255,255,255,0.75)' : '1px solid rgba(255,255,255,0.15)',
            background:  value === anchor ? 'rgba(255,255,255,0.12)' : 'transparent',
          }}
          onClick={() => onChange(anchor)}
        >
          <div style={{
            position: 'absolute', width: 4, height: 4, borderRadius: '50%',
            background: value === anchor ? '#fff' : 'rgba(255,255,255,0.3)',
            top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          }} />
        </button>
      ))}
    </div>
  );
}

// ── VideoOutpaintCanvas ────────────────────────────────────────────────────────
// Read-only preview: shows the source video framed inside the target aspect ratio.
// Measures actual video dimensions via onLoadedMetadata instead of trusting
// source-node metadata, which is often missing or wrong for video inputs.

function VideoOutpaintCanvas({ videoUrl, tgtAspect }: {
  videoUrl?: string;
  tgtAspect: string;
}) {
  const [videoSize, setVideoSize] = useState<{ w: number; h: number } | null>(null);

  // Reset measured size whenever the source URL changes.
  useEffect(() => { setVideoSize(null); }, [videoUrl]);

  const [tgtW, tgtH] = tgtAspect.split(':').map(Number);
  const tgtRatio = tgtW / tgtH;

  // Use measured dimensions; fall back to filling the whole target while loading.
  const srcRatio = videoSize ? videoSize.w / videoSize.h : tgtRatio;

  // Fit target into CANVAS_MAX_W × CANVAS_MAX_H
  const rawH = CANVAS_MAX_W / tgtRatio;
  const tgtDispW = rawH <= CANVAS_MAX_H ? CANVAS_MAX_W : Math.round(CANVAS_MAX_H * tgtRatio);
  const tgtDispH = rawH <= CANVAS_MAX_H ? Math.round(rawH) : CANVAS_MAX_H;

  // Source inside target (centered)
  let srcDispW: number, srcDispH: number, srcX: number, srcY: number;
  if (tgtRatio >= srcRatio) {
    srcDispH = tgtDispH;
    srcDispW = Math.round(tgtDispH * srcRatio);
    srcX = Math.round((tgtDispW - srcDispW) / 2);
    srcY = 0;
  } else {
    srcDispW = tgtDispW;
    srcDispH = Math.round(tgtDispW / srcRatio);
    srcX = 0;
    srcY = Math.round((tgtDispH - srcDispH) / 2);
  }

  // Only show expansion chrome once we've actually measured the video.
  const hasExpansion = videoSize !== null && Math.abs(tgtRatio - srcRatio) > 0.01;
  const STRIPE = 'repeating-linear-gradient(-45deg, rgba(255,255,255,0.03) 0px, rgba(255,255,255,0.03) 3px, transparent 3px, transparent 7px)';

  return (
    <div
      className="nodrag mx-auto mb-3"
      style={{ position: 'relative', width: tgtDispW, height: tgtDispH, userSelect: 'none', flexShrink: 0 }}
    >
      {/* Hidden video used only to read videoWidth / videoHeight on load */}
      {videoUrl && (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video
          key={videoUrl}
          src={videoUrl}
          muted
          playsInline
          preload="metadata"
          style={{ display: 'none' }}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (v.videoWidth && v.videoHeight) setVideoSize({ w: v.videoWidth, h: v.videoHeight });
          }}
        />
      )}

      {hasExpansion && (
        <div style={{ position: 'absolute', inset: 0, background: STRIPE, borderRadius: 6, border: '1px solid rgba(255,255,255,0.08)' }} />
      )}

      <div style={{
        position: 'absolute', left: srcX, top: srcY, width: srcDispW, height: srcDispH,
        overflow: 'hidden', borderRadius: hasExpansion ? 2 : 5,
        background: 'rgba(255,255,255,0.05)',
      }}>
        {videoUrl && (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            src={videoUrl}
            muted
            playsInline
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' }}
          />
        )}
      </div>

      {hasExpansion && (
        <div style={{
          position: 'absolute', left: srcX, top: srcY, width: srcDispW, height: srcDispH,
          pointerEvents: 'none',
          borderTop:    srcY > 1 ? '1px dashed rgba(255,255,255,0.3)' : 'none',
          borderRight:  (srcX + srcDispW < tgtDispW - 1) ? '1px dashed rgba(255,255,255,0.3)' : 'none',
          borderBottom: (srcY + srcDispH < tgtDispH - 1) ? '1px dashed rgba(255,255,255,0.3)' : 'none',
          borderLeft:   srcX > 1 ? '1px dashed rgba(255,255,255,0.3)' : 'none',
        }} />
      )}
    </div>
  );
}

// ── ModifyNode ─────────────────────────────────────────────────────────────────

export function ModifyNode({ data, selected, id }: NodeProps & { data: ModifyNodeData }) {
  const [isGenerating, setIsGenerating] = useState(false);
  const isGeneratingRef = useRef(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const promptSectionRef = useRef<HTMLDivElement>(null);
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);
  const outpaintPromptRef = useRef<HTMLTextAreaElement>(null);
  const outpaintNegPromptRef = useRef<HTMLTextAreaElement>(null);
  const imageSlotRef = useRef<HTMLDivElement>(null);
  const [promptHandleTop, setPromptHandleTop] = useState(50);
  const [imageHandleTop, setImageHandleTop]   = useState(130);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [videoDuration, setVideoDuration] = useState<number | null>(null);
  const prevInputMediaTypeRef = useRef<'image' | 'video' | null>(null);

  const mode         = (data.mode as 'prompt' | 'expand') ?? 'prompt';
  const expandTop    = (data.expandTop    as number) ?? 0;
  const expandRight  = (data.expandRight  as number) ?? 0;
  const expandBottom = (data.expandBottom as number) ?? 0;
  const expandLeft   = (data.expandLeft   as number) ?? 0;
  const expandAnchor = (data.expandAnchor as AnchorKey) ?? 'c';

  const storeEdges = useFlowStore(state => state.edges);
  const storeNodes = useFlowStore(state => state.nodes);

  const incomingEdge  = storeEdges.find(e => e.target === id && e.targetHandle === 'image');
  const sourceNode    = incomingEdge ? storeNodes.find(n => n.id === incomingEdge.source) : undefined;
  const sourceHandle  = incomingEdge?.sourceHandle ?? null;

  const inputMediaType = getSourceMediaType(sourceNode, sourceHandle);

  // ── Image source resolution ────────────────────────────────────────────────

  let availableImages: string[] = [];
  let sourceAspectRatio = '1:1';
  let sourceResolution  = '1K';

  if (inputMediaType === 'image') {
    if (sourceNode?.type === 'imageGenNode') {
      const nd = sourceNode.data as ImageGenNodeData;
      availableImages   = nd.generatedImages ?? [];
      sourceAspectRatio = nd.aspectRatio ?? '1:1';
      sourceResolution  = nd.resolution  ?? '1K';
    } else if (sourceNode?.type === 'imageInputNode') {
      const nd = sourceNode.data as ImageInputNodeData;
      if (nd.imageUrl) availableImages = [nd.imageUrl];
      if (nd.naturalWidth && nd.naturalHeight) sourceAspectRatio = nearestAspectRatio(nd.naturalWidth, nd.naturalHeight);
    } else if (sourceNode?.type === 'upscaleNode') {
      const nd = sourceNode.data as UpscaleNodeData;
      if (nd.outputImageUrl) availableImages = [nd.outputImageUrl];
    } else if (sourceNode?.type === 'modifyNode') {
      const nd = sourceNode.data as ModifyNodeData;
      if (nd.outputImageUrl) availableImages = [nd.outputImageUrl];
    } else if (sourceNode?.type === 'selectNode') {
      const url = (sourceNode.data as { selectedImageUrl?: string }).selectedImageUrl;
      if (url) availableImages = [url];
    } else if (sourceNode?.type === 'mediaInputNode') {
      const nd = sourceNode.data as MediaInputNodeData;
      if (nd.imageUrl) availableImages = [nd.imageUrl];
      if (nd.naturalWidth && nd.naturalHeight) sourceAspectRatio = nearestAspectRatio(nd.naturalWidth, nd.naturalHeight);
    }
  }

  void sourceAspectRatio;
  void sourceResolution;

  // ── Video source resolution ────────────────────────────────────────────────

  let inputVideoUrl: string | undefined;
  let sourceVideoAspect = '16:9';

  if (inputMediaType === 'video' && sourceNode) {
    switch (sourceNode.type) {
      case 'videoGenNode': {
        const nd = sourceNode.data as VideoGenNodeData;
        inputVideoUrl = nd.videoUrl;
        sourceVideoAspect = nd.aspectRatio ?? '16:9';
        break;
      }
      case 'videoInputNode':
        inputVideoUrl = (sourceNode.data as VideoInputNodeData).videoUrl;
        break;
      case 'mediaInputNode': {
        const nd = sourceNode.data as MediaInputNodeData;
        inputVideoUrl = nd.videoUrl;
        if (nd.naturalWidth && nd.naturalHeight) sourceVideoAspect = nearestAspectRatio(nd.naturalWidth, nd.naturalHeight);
        break;
      }
      case 'upscaleMediaNode':
        inputVideoUrl = (sourceNode.data as UpscaleMediaNodeData).outputVideoUrl;
        break;
      case 'videoUpscaleNode':
        inputVideoUrl = (sourceNode.data as VideoUpscaleNodeData).videoUrl;
        break;
    }
  }

  // ── Clear stale output when media type switches ────────────────────────────

  useEffect(() => {
    const prev = prevInputMediaTypeRef.current;
    if (prev !== null && prev !== inputMediaType) {
      const oldHandle = prev === 'video' ? 'video' : 'image';
      document.dispatchEvent(new CustomEvent('node:remove-source-edges', {
        detail: { nodeId: id, handleId: oldHandle },
      }));
      document.dispatchEvent(new CustomEvent('node:update', {
        detail: {
          nodeId: id,
          data: prev === 'video'
            ? { outputVideoUrl: undefined, status: 'idle' }
            : { outputImageUrl: undefined, status: 'idle' },
        },
      }));
    }
    prevInputMediaTypeRef.current = inputMediaType;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputMediaType, id]);

  // Reset video duration when source changes
  useEffect(() => {
    setVideoDuration(null);
  }, [inputVideoUrl]);

  const safeIndex    = Math.min(selectedIndex, Math.max(availableImages.length - 1, 0));
  const selectedImage = availableImages[safeIndex];
  const hasImage      = !!selectedImage;

  const derivedAspect = (() => {
    if (inputMediaType !== 'image') return undefined;
    if (sourceNode?.type === 'imageGenNode') return (sourceNode.data as ImageGenNodeData).aspectRatio ?? undefined;
    if (sourceNode?.type === 'imageInputNode') {
      const nd = sourceNode.data as ImageInputNodeData;
      if (nd.naturalWidth && nd.naturalHeight) return nearestAspectRatio(nd.naturalWidth, nd.naturalHeight);
    }
    if (sourceNode?.type === 'mediaInputNode') {
      const nd = sourceNode.data as MediaInputNodeData;
      if (nd.naturalWidth && nd.naturalHeight) return nearestAspectRatio(nd.naturalWidth, nd.naturalHeight);
    }
    return undefined;
  })();

  const derivedResolution = (() => {
    if (inputMediaType !== 'image') return undefined;
    if (sourceNode?.type === 'imageGenNode') return (sourceNode.data as ImageGenNodeData).resolution ?? undefined;
    if (sourceNode?.type === 'imageInputNode') {
      const nd = sourceNode.data as ImageInputNodeData;
      if (nd.naturalWidth) return nd.naturalWidth >= 3000 ? '4K' : nd.naturalWidth >= 1800 ? '2K' : '1K';
    }
    if (sourceNode?.type === 'mediaInputNode') {
      const nd = sourceNode.data as MediaInputNodeData;
      if (nd.naturalWidth) return nd.naturalWidth >= 3000 ? '4K' : nd.naturalWidth >= 1800 ? '2K' : '1K';
    }
    return undefined;
  })();

  const thumbnailAspect = cssAspectRatio(derivedAspect ?? data.aspectRatio ?? '1:1');

  useEffect(() => {
    if (derivedAspect && derivedAspect !== data.aspectRatio) updateData({ aspectRatio: derivedAspect });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derivedAspect]);

  useEffect(() => {
    if (derivedResolution && derivedResolution !== data.resolution) updateData({ resolution: derivedResolution });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derivedResolution]);

  useEffect(() => {
    if (availableImages.length === 0) setSelectedIndex(0);
  }, [availableImages.length]);

  useEffect(() => {
    if (promptTextareaRef.current) autoResize(promptTextareaRef.current);
  }, [data.prompt]);

  useLayoutEffect(() => {
    if (outpaintPromptRef.current) autoResize(outpaintPromptRef.current);
    if (outpaintNegPromptRef.current) autoResize(outpaintNegPromptRef.current);
  });

  useLayoutEffect(() => {
    if (promptSectionRef.current) {
      const el = promptSectionRef.current;
      setPromptHandleTop(el.offsetTop + el.offsetHeight / 2);
    }
    if (imageSlotRef.current) {
      setImageHandleTop(imageSlotRef.current.offsetTop + IMAGE_ROW_HEIGHT / 2);
    }
  });

  function updateData(updates: Partial<ModifyNodeData>) {
    document.dispatchEvent(new CustomEvent('node:update', {
      detail: { nodeId: id, data: updates },
    }));
  }

  function handleExpandChange(updates: Partial<Record<'top' | 'right' | 'bottom' | 'left', number>>) {
    const mapped: Partial<ModifyNodeData> = {};
    if (updates.top    !== undefined) mapped.expandTop    = updates.top;
    if (updates.right  !== undefined) mapped.expandRight  = updates.right;
    if (updates.bottom !== undefined) mapped.expandBottom = updates.bottom;
    if (updates.left   !== undefined) mapped.expandLeft   = updates.left;
    updateData(mapped);
  }

  function handleAspectPreset(ratio: number) {
    if (!naturalSize) return;
    const exp = computeExpansionForAspect(naturalSize.w, naturalSize.h, ratio, expandAnchor);
    updateData({ expandTop: exp.top, expandRight: exp.right, expandBottom: exp.bottom, expandLeft: exp.left });
  }

  // ── Image: Prompt generate ─────────────────────────────────────────────────

  function completeModify(imageUrl: string) {
    updateData({
      outputImageUrl: imageUrl,
      status: 'completed',
      errorMessage: undefined,
      pendingRequestId: undefined,
      pendingEndpoint: undefined,
    });
    playSuccessSound();
    document.dispatchEvent(new CustomEvent('node:image-propagate', {
      detail: { sourceNodeId: id, imageUrl },
    }));
  }

  // Queue-backed edit models (Seedream) return a request ID instead of an image.
  async function pollForEditResult(requestId: string, endpoint: string): Promise<string> {
    for (let attempt = 0; attempt < 200; attempt++) {
      let terminalError: string | undefined;
      try {
        const res = await fetch(
          `/api/fal/status/${requestId}?endpoint=${encodeURIComponent(endpoint)}&mediaType=image`
        );
        if (res.ok) {
          const result = await res.json();
          if (result.status === 'completed' && result.mediaUrls?.[0]) return result.mediaUrls[0];
          if (result.status === 'failed') terminalError = result.error ?? 'FAL reported that the edit failed.';
        }
      } catch {
        // Transient status errors are retried until the polling timeout.
      }
      if (terminalError) throw new Error(terminalError);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    throw new Error('Timed out while retrieving the modified image. Use "Check status on FAL" to resume.');
  }

  async function handlePromptGenerate() {
    if (isGenerating || !selectedImage) return;
    setIsGenerating(true);
    updateData({ status: 'processing', errorMessage: undefined, pendingRequestId: undefined, pendingEndpoint: undefined });

    const aspectRatio = data.aspectRatio ?? '1:1';
    const resolution  = data.resolution  ?? '1K';
    useFlowStore.getState().consumeGcsOnlyEligibility();

    try {
      const res    = await fetch('/api/fal/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: data.model, prompt: data.prompt ?? '',
          aspectRatio, resolution, numImages: 1,
          referenceImageUrls: [selectedImage],
          sourceType: 'canvas',
          sourceId: useFlowStore.getState().currentFlow?.id,
          nodeId: id,
        }),
      });
      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.details ?? result.error ?? `Server error ${res.status}`);
      }

      const queued = result.requests?.[0] ?? (result.requestId ? { requestId: result.requestId, endpoint: result.endpoint } : undefined);

      if (result.mediaUrls?.[0]) {
        completeModify(result.mediaUrls[0]);
      } else if (queued?.requestId && queued.endpoint) {
        updateData({ pendingRequestId: queued.requestId, pendingEndpoint: queued.endpoint });
        completeModify(await pollForEditResult(queued.requestId, queued.endpoint));
      } else {
        throw new Error(result.details ?? result.error ?? 'Image generation failed — no output returned.');
      }
    } catch (err) {
      updateData({ status: 'error', errorMessage: err instanceof Error ? err.message : 'Network error — check your connection.' });
    } finally {
      setIsGenerating(false);
    }
  }

  async function resumeEditPolling() {
    const { pendingRequestId, pendingEndpoint } = data;
    if (!pendingRequestId || !pendingEndpoint || isGenerating) return;
    setIsGenerating(true);
    updateData({ status: 'processing', errorMessage: undefined });
    try {
      completeModify(await pollForEditResult(pendingRequestId, pendingEndpoint));
    } catch (err) {
      updateData({ status: 'error', errorMessage: err instanceof Error ? err.message : 'Could not retrieve the modified image.' });
    } finally {
      setIsGenerating(false);
    }
  }

  // ── Image: Expand generate ─────────────────────────────────────────────────

  async function handleExpandGenerate() {
    if (isGenerating || !selectedImage) return;
    if (!expandTop && !expandRight && !expandBottom && !expandLeft) return;
    if (!naturalSize) return;
    setIsGenerating(true);
    updateData({ status: 'processing' });

    const plan = computeOutpaintResizePlan(naturalSize.w, naturalSize.h, expandTop, expandRight, expandBottom, expandLeft);
    useFlowStore.getState().consumeGcsOnlyEligibility();

    try {
      const res    = await fetch('/api/fal/outpaint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl: selectedImage,
          expandTop:    plan.outpaintTop,
          expandRight:  plan.outpaintRight,
          expandBottom: plan.outpaintBottom,
          expandLeft:   plan.outpaintLeft,
          ...(plan.needsResize ? { resizeSourceTo: { width: plan.sourceW, height: plan.sourceH } } : {}),
          sourceType: 'canvas',
          sourceId: useFlowStore.getState().currentFlow?.id,
          nodeId: id,
        }),
      });
      const result = await res.json();
      if (result.mediaUrls?.[0]) {
        updateData({ outputImageUrl: result.mediaUrls[0], status: 'completed', errorMessage: undefined });
        playSuccessSound();
        document.dispatchEvent(new CustomEvent('node:image-propagate', {
          detail: { sourceNodeId: id, imageUrl: result.mediaUrls[0] },
        }));
      } else {
        updateData({ status: 'error', errorMessage: result.details ?? result.error ?? 'Image expand failed — no output returned.' });
      }
    } catch (err) {
      updateData({ status: 'error', errorMessage: err instanceof Error ? err.message : 'Network error — check your connection.' });
    } finally {
      setIsGenerating(false);
    }
  }

  // ── Video: Outpaint generate + poll ────────────────────────────────────────

  function stopGenerating() {
    isGeneratingRef.current = false;
    setIsGenerating(false);
  }

  async function handleVideoOutpaintGenerate() {
    // Synchronous ref guard prevents double-fire before React re-renders the disabled button
    if (isGeneratingRef.current || !inputVideoUrl) return;
    const prompt = data.outpaintPrompt?.trim() || VIDEO_OUTPAINT_DEFAULT_PROMPT;
    if (!prompt) return;

    isGeneratingRef.current = true;
    setIsGenerating(true);
    updateData({ status: 'processing' });

    const aspectRatio = data.outpaintAspectRatio ?? '16:9';
    const resolution  = data.outpaintResolution  ?? '720p';
    const fps         = data.outpaintFps         ?? 24;
    const negativePrompt = data.outpaintNegativePrompt ?? VIDEO_OUTPAINT_DEFAULT_NEGATIVE_PROMPT;
    const numFrames = videoDuration !== null ? Math.max(1, Math.round(videoDuration * fps)) : undefined;
    useFlowStore.getState().consumeGcsOnlyEligibility();

    try {
      const res = await fetch('/api/fal/video-outpaint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUrl: inputVideoUrl,
          aspectRatio, resolution, fps, numFrames,
          prompt, negativePrompt,
          sourceId: useFlowStore.getState().currentFlow?.id,
          nodeId: id,
        }),
      });
      const result = await res.json();
      if (result.requestId) {
        pollVideoOutpaint(result.requestId);
      } else {
        updateData({ status: 'error', errorMessage: result.details ?? result.error ?? 'Video outpaint failed — no request ID returned.' });
        stopGenerating();
      }
    } catch (err) {
      updateData({ status: 'error', errorMessage: err instanceof Error ? err.message : 'Network error — check your connection.' });
      stopGenerating();
    }
  }

  function pollVideoOutpaint(requestId: string) {
    let attempts = 0;
    let consecutiveErrors = 0;
    const interval = setInterval(async () => {
      attempts++;
      if (attempts > 120) {
        clearInterval(interval);
        updateData({ status: 'error', errorMessage: 'Video outpaint timed out. The job may still be running — try restarting.' });
        stopGenerating();
        return;
      }
      try {
        const res = await fetch(`/api/fal/video-outpaint/status/${requestId}`);
        const result = await res.json();
        if (result.status === 'completed' && result.mediaUrls?.[0]) {
          clearInterval(interval);
          updateData({ outputVideoUrl: result.mediaUrls[0], status: 'completed', errorMessage: undefined });
          playSuccessSound();
          document.dispatchEvent(new CustomEvent('node:video-propagate', {
            detail: { sourceNodeId: id, videoUrl: result.mediaUrls[0] },
          }));
          stopGenerating();
        } else if (result.status === 'failed' || result.status === 'error') {
          consecutiveErrors++;
          if (result.status === 'failed' || consecutiveErrors >= 3) {
            clearInterval(interval);
            updateData({ status: 'error', errorMessage: result.error ?? 'Video outpaint failed on the server.' });
            stopGenerating();
          }
        } else {
          consecutiveErrors = 0;
        }
      } catch {
        consecutiveErrors++;
        if (consecutiveErrors >= 3) {
          clearInterval(interval);
          updateData({ status: 'error', errorMessage: 'Lost connection while waiting for video outpaint. Check FAL dashboard.' });
          stopGenerating();
        }
      }
    }, 5000);
  }

  // ── Derived display state ──────────────────────────────────────────────────

  const hasExpansion = expandTop > 0 || expandRight > 0 || expandBottom > 0 || expandLeft > 0;
  const resizePlan = naturalSize && hasExpansion
    ? computeOutpaintResizePlan(naturalSize.w, naturalSize.h, expandTop, expandRight, expandBottom, expandLeft)
    : null;
  const outputDimsLabel = resizePlan
    ? `${resizePlan.outputW} × ${resizePlan.outputH}px${resizePlan.needsResize ? ' (scaled to fit)' : ''}`
    : null;

  const inputPortType  = inputMediaType === 'video' ? 'video' : inputMediaType === 'image' ? 'image' : 'neutral';
  const outputHandleId = inputMediaType === 'video' ? 'video' : 'image';
  const outputPortType = inputMediaType === 'video' ? 'video' : inputMediaType === 'image' ? 'image' : 'neutral';
  const accentColor    = inputMediaType === 'video' ? PORT_COLORS.video : PORT_COLORS.image;

  const outpaintAspect     = data.outpaintAspectRatio ?? '16:9';
  const outpaintResolution = data.outpaintResolution  ?? '720p';
  const outpaintFps        = data.outpaintFps         ?? 24;
  const hasOutpaintPrompt  = !!(data.outpaintPrompt?.trim() ?? VIDEO_OUTPAINT_DEFAULT_PROMPT);
  const hasVideoOutput     = inputMediaType === 'video' && !!data.outputVideoUrl;
  const hasPendingEditRequest = !!data.pendingRequestId && !!data.pendingEndpoint;

  const nodeTitle = inputMediaType === 'video' ? 'Modify (Video Expand)' : 'Modify';

  // ── Footer ────────────────────────────────────────────────────────────────────

  const footer = (
    <div className="flex flex-col gap-1.5">
      {inputMediaType === 'video' ? (
        <>
          <button
            onClick={handleVideoOutpaintGenerate}
            disabled={isGenerating || !inputVideoUrl || !hasOutpaintPrompt}
            className="w-full flex items-center justify-center gap-1.5 py-3 text-xs font-medium transition-opacity disabled:opacity-40 nodrag"
            style={{ background: 'var(--action-btn-bg)', color: 'var(--action-btn-color)', borderRadius: 11 }}
          >
            <Play size={12} />
            {isGenerating ? 'Outpainting…' : 'Outpaint Video'}
          </button>
          {hasVideoOutput && (
            <button
              onClick={() => downloadFromUrl(data.outputVideoUrl!)}
              className="w-full flex items-center justify-center gap-1.5 py-3 text-xs font-medium nodrag transition-opacity hover:opacity-80 active:opacity-60"
              style={{ background: 'var(--color-bg-surface)', color: 'var(--color-white-muted)', borderRadius: 11 }}
            >
              <Download size={12} />
              Download
            </button>
          )}
        </>
      ) : (
        <>
          <button
            onClick={mode === 'prompt' ? handlePromptGenerate : handleExpandGenerate}
            disabled={isGenerating || !hasImage || (mode === 'expand' && !hasExpansion)}
            className="w-full flex items-center justify-center gap-1.5 py-3 text-xs font-medium transition-opacity disabled:opacity-40 nodrag"
            style={{ background: 'var(--action-btn-bg)', color: 'var(--action-btn-color)', borderRadius: 11 }}
          >
            <Play size={12} />
            {mode === 'prompt'
              ? (isGenerating ? 'Modifying…' : 'Modify')
              : (isGenerating ? 'Expanding…' : 'Expand')
            }
          </button>
          {hasPendingEditRequest && !isGenerating && (
            <button
              onClick={resumeEditPolling}
              className="w-full flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium nodrag"
              style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--color-error)', borderRadius: 11, border: '1px solid var(--color-error)' }}
            >
              <AlertTriangle size={12} />
              Check status on FAL
            </button>
          )}
          {data.outputImageUrl && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
              <button
                onClick={() => downloadFromUrl(data.outputImageUrl!)}
                className="flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-medium nodrag transition-opacity hover:opacity-80 active:opacity-60"
                style={{ background: 'var(--color-bg-surface)', color: 'var(--color-white-muted)', borderRadius: 11 }}
              >
                <Download size={12} />
                Download
              </button>
              <SendToFigmaButton imageUrl={data.outputImageUrl} style={{ flex: 1, minWidth: 0 }} />
            </div>
          )}
        </>
      )}
    </div>
  );

  return (
    <NodeWrapper
      title={nodeTitle}
      icon={<Sliders size={14} />}
      status={data.status}
      errorMessage={data.errorMessage}
      selected={selected}
      minWidth={280}
      accentColor={accentColor}
      titlePosition="outside"
      footer={footer}
    >
      {/* Handles */}
      {inputMediaType === 'image' && mode === 'prompt' && (
        <TypedHandle
          type="target"
          position={Position.Left}
          id="prompt"
          portType="text"
          offset={`${promptHandleTop}px`}
          connected={!!data.promptConnected}
        />
      )}
      <TypedHandle
        type="target"
        position={Position.Left}
        id="image"
        portType={inputPortType}
        offset={`${imageHandleTop}px`}
        connected={storeEdges.some(e => e.target === id && e.targetHandle === 'image')}
      />

      {/* Hidden video element to capture duration for num_frames */}
      {inputMediaType === 'video' && inputVideoUrl && (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video
          key={inputVideoUrl}
          src={inputVideoUrl}
          muted
          playsInline
          style={{ display: 'none' }}
          onLoadedMetadata={(e) => setVideoDuration(e.currentTarget.duration)}
        />
      )}

      {/* ── No input ── */}
      {inputMediaType === null && (
        <div
          ref={imageSlotRef}
          className="flex items-center justify-center rounded-lg"
          style={{ height: 52, background: 'var(--color-bg-surface)', border: '1px dashed rgba(255,255,255,0.12)', color: 'var(--color-white-muted)', fontSize: 12 }}
        >
          Connect an image or video
        </div>
      )}

      {/* ── Image mode ── */}
      {inputMediaType === 'image' && (
        <>
          {/* Mode toggle */}
          <div
            className="flex gap-0.5 mb-3 p-0.5 nodrag"
            style={{ background: 'var(--color-bg-surface)', borderRadius: 11 }}
          >
            {(['prompt', 'expand'] as const).map((m) => (
              <button
                key={m}
                className="nodrag flex-1 py-1 text-xs font-medium capitalize transition-colors"
                style={{
                  borderRadius: 9,
                  background: mode === m ? '#fff' : 'transparent',
                  color:       mode === m ? '#000' : 'var(--color-white-muted)',
                  border: 'none', cursor: 'pointer',
                }}
                onClick={() => updateData({ mode: m })}
              >
                {m === 'prompt' ? 'Prompt' : 'Expand'}
              </button>
            ))}
          </div>

          {/* ── Prompt mode ── */}
          {mode === 'prompt' && (
            <>
              <div ref={promptSectionRef} className="mb-3">
                {data.promptConnected ? (
                  <div
                    className="flex items-center gap-2 px-3"
                    style={{ height: 36, background: '#3999F8', color: '#fff', borderRadius: 8 }}
                  >
                    <span style={{ fontSize: 10 }}>T</span>
                    <span className="text-xs font-medium">Prompt connected</span>
                  </div>
                ) : (
                  <textarea
                    ref={promptTextareaRef}
                    className="w-full text-xs outline-none nodrag"
                    rows={2}
                    placeholder="Describe the changes…"
                    value={data.prompt ?? ''}
                    onChange={(e) => { autoResize(e.target); updateData({ prompt: e.target.value }); }}
                    style={{ background: 'transparent', border: 'none', color: 'var(--color-white)', resize: 'none', overflow: 'hidden', minHeight: 40 }}
                  />
                )}
              </div>

              <div
                ref={imageSlotRef}
                className="flex items-center text-xs"
                style={{
                  height: IMAGE_ROW_HEIGHT, paddingLeft: 12, paddingRight: 12,
                  borderRadius: '4px 16px 16px 4px',
                  background: hasImage ? '#a855f7' : 'var(--color-bg-surface)',
                  color: hasImage ? '#fff' : 'var(--color-white-muted)',
                  transition: 'background 0.15s, color 0.15s',
                  marginBottom: availableImages.length > 1 ? 8 : 12,
                }}
              >
                Source Image
              </div>

              {availableImages.length > 1 && (
                <SourceThumbnails
                  images={availableImages}
                  selectedIndex={safeIndex}
                  aspect={thumbnailAspect}
                  onSelect={setSelectedIndex}
                />
              )}

              <div className="mb-3">
                <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-white-muted)' }}>Model</label>
                <ModelSelect options={MODIFY_MODELS} value={data.model} onChange={(v) => updateData({ model: v })} />
              </div>

              <div className="flex gap-2 mb-3">
                <div className="flex-1">
                  <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-white-muted)' }}>Aspect</label>
                  <NodeSelect options={ASPECT_RATIOS.map(r => r.value)} value={data.aspectRatio ?? '1:1'} onChange={(v) => updateData({ aspectRatio: v })} />
                </div>
                <div className="flex-1">
                  <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-white-muted)' }}>Resolution</label>
                  <NodeSelect options={RESOLUTIONS.map(r => r.value)} value={data.resolution ?? '1K'} onChange={(v) => updateData({ resolution: v })} />
                </div>
              </div>

              {data.outputImageUrl && (
                <div style={{ borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={data.outputImageUrl} alt="Modified" className="w-full block nodrag" style={{ height: 'auto' }} />
                </div>
              )}
            </>
          )}

          {/* ── Expand mode ── */}
          {mode === 'expand' && (
            <>
              <div
                ref={imageSlotRef}
                className="flex items-center text-xs mb-3"
                style={{
                  height: IMAGE_ROW_HEIGHT, paddingLeft: 12, paddingRight: 12,
                  borderRadius: '4px 16px 16px 4px',
                  background: hasImage ? '#a855f7' : 'var(--color-bg-surface)',
                  color: hasImage ? '#fff' : 'var(--color-white-muted)',
                  transition: 'background 0.15s, color 0.15s',
                }}
              >
                Source Image
              </div>

              {availableImages.length > 1 && (
                <SourceThumbnails
                  images={availableImages}
                  selectedIndex={safeIndex}
                  aspect={thumbnailAspect}
                  onSelect={setSelectedIndex}
                />
              )}

              <div className="flex items-start gap-3 mb-3">
                <div className="flex-1">
                  <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--color-white-muted)' }}>Preset</label>
                  <div className="flex flex-wrap gap-1">
                    {ASPECT_PRESETS.map(({ label, ratio }) => (
                      <button
                        key={label}
                        className="nodrag text-xs px-2 py-0.5 rounded-md transition-colors"
                        style={{
                          background: 'var(--color-bg-surface)',
                          color: 'var(--color-white-muted)',
                          border: '1px solid rgba(255,255,255,0.1)',
                          cursor: naturalSize ? 'pointer' : 'default',
                          opacity: naturalSize ? 1 : 0.4,
                        }}
                        onClick={() => handleAspectPreset(ratio)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--color-white-muted)' }}>Anchor</label>
                  <AnchorPicker value={expandAnchor} onChange={(v) => updateData({ expandAnchor: v })} />
                </div>
              </div>

              {selectedImage ? (
                <ExpandCanvas
                  imageUrl={selectedImage}
                  expandTop={expandTop}
                  expandRight={expandRight}
                  expandBottom={expandBottom}
                  expandLeft={expandLeft}
                  onChange={handleExpandChange}
                  onNaturalSize={(w, h) => setNaturalSize({ w, h })}
                />
              ) : (
                <div
                  className="flex items-center justify-center rounded-lg mb-3 text-xs"
                  style={{ height: 80, background: 'var(--color-bg-surface)', border: '1px dashed rgba(255,255,255,0.12)', color: 'var(--color-white-muted)' }}
                >
                  Connect a source image
                </div>
              )}

              {outputDimsLabel && (
                <p className="text-center mb-2" style={{ fontSize: 10, color: 'var(--color-white-muted)' }}>
                  Output: {outputDimsLabel}
                </p>
              )}

              {data.outputImageUrl && (
                <div style={{ borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={data.outputImageUrl} alt="Expanded" className="w-full block nodrag" style={{ height: 'auto' }} />
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ── Video outpaint mode ── */}
      {inputMediaType === 'video' && (
        <>
          {/* Source video slot */}
          <div
            ref={imageSlotRef}
            className="flex items-center text-xs mb-3"
            style={{
              height: IMAGE_ROW_HEIGHT, paddingLeft: 12, paddingRight: 12,
              borderRadius: '4px 16px 16px 4px',
              background: inputVideoUrl ? PORT_COLORS.video : 'var(--color-bg-surface)',
              color: inputVideoUrl ? '#fff' : 'var(--color-white-muted)',
              transition: 'background 0.15s, color 0.15s',
            }}
          >
            Source Video
          </div>

          {/* Outpaint canvas preview */}
          <VideoOutpaintCanvas
            videoUrl={inputVideoUrl}
            tgtAspect={outpaintAspect}
          />

          {/* Target aspect ratio */}
          <div className="mb-3">
            <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--color-white-muted)' }}>Target Aspect Ratio</label>
            <div className="flex flex-wrap gap-1">
              {OUTPAINT_ASPECT_RATIOS.map((ratio) => (
                <button
                  key={ratio}
                  className="nodrag text-xs px-2 py-0.5 rounded-md transition-colors"
                  style={{
                    background: outpaintAspect === ratio ? '#fff' : 'var(--color-bg-surface)',
                    color:      outpaintAspect === ratio ? '#000' : 'var(--color-white-muted)',
                    border: '1px solid rgba(255,255,255,0.1)',
                  }}
                  onClick={() => updateData({ outpaintAspectRatio: ratio })}
                >
                  {ratio}
                </button>
              ))}
            </div>
          </div>

          {/* Resolution + FPS */}
          <div className="flex gap-2 mb-3">
            <div className="flex-1">
              <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-white-muted)' }}>Resolution</label>
              <NodeSelect
                options={['720p', '1080p']}
                value={outpaintResolution}
                onChange={(v) => updateData({ outpaintResolution: v as '720p' | '1080p' })}
              />
            </div>
            <div className="flex-1">
              <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-white-muted)' }}>FPS</label>
              <NodeSelect
                options={['24', '30', '60']}
                value={String(outpaintFps)}
                onChange={(v) => updateData({ outpaintFps: Number(v) })}
              />
            </div>
          </div>

          {/* Prompt */}
          <div className="mb-3">
            <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-white-muted)' }}>Prompt</label>
            <textarea
              ref={outpaintPromptRef}
              className="w-full text-xs outline-none nodrag"
              rows={2}
              placeholder="Describe the outpainted surroundings…"
              value={data.outpaintPrompt ?? VIDEO_OUTPAINT_DEFAULT_PROMPT}
              onChange={(e) => { autoResize(e.target); updateData({ outpaintPrompt: e.target.value }); }}
              style={{ background: 'transparent', border: 'none', color: 'var(--color-white)', resize: 'none', overflow: 'hidden', minHeight: 40 }}
            />
          </div>

          {/* Negative prompt */}
          <div className="mb-3">
            <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-white-muted)' }}>Negative Prompt</label>
            <textarea
              ref={outpaintNegPromptRef}
              className="w-full text-xs outline-none nodrag"
              rows={3}
              value={data.outpaintNegativePrompt ?? VIDEO_OUTPAINT_DEFAULT_NEGATIVE_PROMPT}
              onChange={(e) => { autoResize(e.target); updateData({ outpaintNegativePrompt: e.target.value }); }}
              style={{ background: 'transparent', border: 'none', color: 'var(--color-white-muted)', resize: 'none', overflow: 'hidden', minHeight: 40 }}
            />
          </div>

          {/* Output video */}
          {hasVideoOutput && (
            <div style={{ borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)', overflow: 'hidden' }}>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video src={data.outputVideoUrl!} controls className="w-full block nodrag" style={{ height: 'auto' }} />
            </div>
          )}
        </>
      )}

      <TypedHandle
        type="source"
        position={Position.Right}
        id={outputHandleId}
        portType={outputPortType}
        connected={storeEdges.some(e => e.source === id && e.sourceHandle === outputHandleId)}
      />
    </NodeWrapper>
  );
}
