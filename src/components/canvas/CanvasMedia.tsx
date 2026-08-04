'use client';

import {
  useEffect,
  useContext,
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ImgHTMLAttributes,
  type VideoHTMLAttributes,
} from 'react';
import { useMediaLodStore } from '@/lib/stores/mediaLodStore';
import { CanvasNodeFocusContext } from '@/components/canvas/mediaFocus';
import {
  resolveMediaAsset,
  type ResolvedMediaAsset,
} from '@/lib/utils/mediaUtils';

const DPR_CAP = 2;
const OPTIMIZER_QUALITY = 75;
const MAX_CONCURRENT_UPGRADES = 6;

type TierRank = 0 | 1 | 2 | 3 | 4 | 5;

interface LoadedCandidate {
  version: number;
  rank: TierRank;
  url: string;
  aspectRatio?: number;
}

interface QueueEntry {
  id: number;
  priority: number;
  started: boolean;
  finished: boolean;
  run: (release: () => void) => void;
}

let nextQueueId = 1;
let activeUpgrades = 0;
const upgradeQueue: QueueEntry[] = [];

function pumpUpgradeQueue() {
  upgradeQueue.sort((a, b) => b.priority - a.priority || a.id - b.id);
  while (activeUpgrades < MAX_CONCURRENT_UPGRADES && upgradeQueue.length > 0) {
    const entry = upgradeQueue.shift()!;
    if (entry.finished) continue;
    entry.started = true;
    activeUpgrades++;
    let released = false;
    entry.run(() => {
      if (released) return;
      released = true;
      entry.finished = true;
      activeUpgrades = Math.max(0, activeUpgrades - 1);
      pumpUpgradeQueue();
    });
  }
}

function enqueueUpgrade(
  priority: number,
  run: (release: () => void) => void,
): () => void {
  const entry: QueueEntry = {
    id: nextQueueId++,
    priority,
    started: false,
    finished: false,
    run,
  };
  upgradeQueue.push(entry);
  pumpUpgradeQueue();
  return () => {
    if (entry.started || entry.finished) return;
    entry.finished = true;
    const index = upgradeQueue.indexOf(entry);
    if (index >= 0) upgradeQueue.splice(index, 1);
  };
}

function optimizerUrl(source: string, width: 512 | 1024 | 2048): string {
  return `/_next/image?url=${encodeURIComponent(source)}&w=${width}&q=${OPTIMIZER_QUALITY}`;
}

function targetTier(requiredPixels: number, focused: boolean): TierRank {
  if (focused || requiredPixels > 2048) return 5;
  if (requiredPixels <= 128) return 1;
  if (requiredPixels <= 512) return 2;
  if (requiredPixels <= 1024) return 3;
  return 4;
}

function tierUrl(
  asset: ResolvedMediaAsset,
  rank: TierRank,
  posterOnly: boolean,
): string | undefined {
  const base = posterOnly ? asset.poster : asset.original;
  if (rank === 1) return asset.thumbnail;
  if (!base) return undefined;
  if (rank === 2) return optimizerUrl(base, 512);
  if (rank === 3) return optimizerUrl(base, 1024);
  if (rank === 4) return optimizerUrl(base, 2048);
  if (rank === 5) return base;
  return undefined;
}

function useObservedMedia() {
  const elementRef = useRef<HTMLDivElement>(null);
  const [layoutWidth, setLayoutWidth] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    // ResizeObserver's content box is pre-transform. getBoundingClientRect()
    // already includes React Flow's camera scale and would double-count zoom.
    const observer = new ResizeObserver((entries) => {
      setLayoutWidth(entries[0]?.contentRect.width ?? element.clientWidth);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    if (typeof IntersectionObserver === 'undefined') {
      const timer = setTimeout(() => setVisible(true), 0);
      return () => clearTimeout(timer);
    }
    const observer = new IntersectionObserver(
      entries => setVisible(entries[0]?.isIntersecting ?? false),
      { rootMargin: '200px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { elementRef, layoutWidth, visible };
}

interface LodImageProps {
  source: string;
  kind: 'image' | 'video';
  focused: boolean;
  posterOnly?: boolean;
  className?: string;
  style?: CSSProperties;
  fill?: boolean;
  alt: string;
  draggable?: ImgHTMLAttributes<HTMLImageElement>['draggable'];
  onClick?: ImgHTMLAttributes<HTMLImageElement>['onClick'];
  onDoubleClick?: ImgHTMLAttributes<HTMLImageElement>['onDoubleClick'];
  onLoad?: ImgHTMLAttributes<HTMLImageElement>['onLoad'];
  onAspectRatio?: (ratio: number) => void;
}

function LodImage({
  source,
  kind,
  focused,
  posterOnly = false,
  className,
  style,
  fill = false,
  alt,
  draggable,
  onClick,
  onDoubleClick,
  onLoad,
  onAspectRatio,
}: LodImageProps) {
  const settledZoom = useMediaLodStore(state => state.settledZoom);
  const cameraMoving = useMediaLodStore(state => state.cameraMoving);
  const { elementRef, layoutWidth, visible } = useObservedMedia();
  const [asset, setAsset] = useState<ResolvedMediaAsset | null>(null);
  const [displayedUrl, setDisplayedUrl] = useState<string>();
  const [loadedRank, setLoadedRank] = useState<TierRank>(0);
  const loadedRankRef = useRef<TierRank>(0);
  const [aspectRatio, setAspectRatio] = useState<number>(kind === 'video' ? 16 / 9 : 1);
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const sourceVersion = useRef(0);
  const pendingCandidate = useRef<LoadedCandidate | null>(null);

  const commitCandidate = useCallback((candidate: LoadedCandidate) => {
    if (
      sourceVersion.current !== candidate.version
      || candidate.rank <= loadedRankRef.current
    ) {
      return;
    }
    loadedRankRef.current = candidate.rank;
    if (candidate.aspectRatio) {
      setAspectRatio(candidate.aspectRatio);
      onAspectRatio?.(candidate.aspectRatio);
    }
    setDisplayedUrl(candidate.url);
    setLoadedRank(candidate.rank);
  }, [onAspectRatio]);

  useEffect(() => {
    if (cameraMoving || !pendingCandidate.current) return;
    const candidate = pendingCandidate.current;
    pendingCandidate.current = null;
    commitCandidate(candidate);
  }, [cameraMoving, commitCandidate]);

  const effectiveCssPixels = settledZoom === null ? 0 : layoutWidth * settledZoom;
  const shouldResolve = !cameraMoving && settledZoom !== null && (focused || visible);

  useEffect(() => {
    if (!shouldResolve) return;
    const version = ++sourceVersion.current;
    let cancelled = false;
    void resolveMediaAsset(source, kind).then((resolved) => {
      if (!cancelled && sourceVersion.current === version) setAsset(resolved);
    });
    return () => { cancelled = true; };
  }, [kind, shouldResolve, source]);

  const requiredPixels = effectiveCssPixels * Math.min(
    typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
    DPR_CAP,
  );
  const desiredRank = useMemo<TierRank>(() => {
    if (cameraMoving || !asset || settledZoom === null || (!visible && !focused)) return 0;
    if (posterOnly && !asset.poster) return 0;
    // External/non-GCS images have no deterministic derivative family, so
    // retain their existing direct-load behavior.
    if (!posterOnly && !asset.thumbnail) return 5;
    const desired = targetTier(requiredPixels, focused);
    // A non-focused video is always a static poster. The poster itself is
    // 2048px, so requesting the video original as a fifth visual tier is both
    // wasteful and contrary to the no-background-video rule.
    return posterOnly && desired === 5 ? 4 : desired;
  }, [asset, cameraMoving, focused, posterOnly, requiredPixels, settledZoom, visible]);

  useEffect(() => {
    if (!asset || desiredRank === 0 || desiredRank <= loadedRankRef.current) return;
    const version = sourceVersion.current;

    // Always paint the stored thumbnail first. It is intentionally not placed
    // in the Sharp-transform queue because it is a small, durable GCS object.
    const firstRank: TierRank = loadedRank === 0 && asset.thumbnail && !thumbnailFailed
      ? 1
      : thumbnailFailed && desiredRank === 1
        ? 2
        : desiredRank;
    const requestedRank = firstRank;
    const url = tierUrl(asset, requestedRank, posterOnly);
    if (!url) return;

    const load = (release: () => void) => {
      const preload = new Image();
      preload.decoding = 'async';
      preload.onload = () => {
        const candidate: LoadedCandidate = {
          version,
          rank: requestedRank,
          url,
          ...(preload.naturalWidth && preload.naturalHeight
            ? { aspectRatio: preload.naturalWidth / preload.naturalHeight }
            : {}),
        };
        if (useMediaLodStore.getState().cameraMoving) {
          if (!pendingCandidate.current || pendingCandidate.current.rank < requestedRank) {
            pendingCandidate.current = candidate;
          }
        } else {
          commitCandidate(candidate);
        }
        release();
      };
      preload.onerror = () => {
        if (sourceVersion.current === version && requestedRank === 1) {
          setThumbnailFailed(true);
        }
        release();
      };
      preload.src = url;
    };

    if (requestedRank === 1) {
      load(() => {});
      return;
    }

    return enqueueUpgrade(
      (focused ? 100_000 : 0) + requestedRank * 10_000 + requiredPixels,
      load,
    );
  }, [asset, commitCandidate, desiredRank, focused, loadedRank, posterOnly, requiredPixels, thumbnailFailed]);

  const wrapperStyle: CSSProperties = fill
    ? { position: 'relative', width: '100%', height: '100%', overflow: 'hidden', ...style }
    : {
        position: 'relative',
        display: 'block',
        width: '100%',
        aspectRatio,
        overflow: 'hidden',
        ...style,
        height: style?.height === 'auto' ? undefined : style?.height,
      };

  return (
    <div ref={elementRef} className={className} style={wrapperStyle}>
      {!displayedUrl && (
        <div
          className="absolute inset-0"
          style={{ background: 'var(--color-bg-surface)' }}
          aria-hidden="true"
        />
      )}
      {/* The loaded element remains mounted offscreen; only its paint is hidden. */}
      {displayedUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={displayedUrl}
          alt={alt}
          draggable={draggable}
          onClick={onClick}
          onDoubleClick={onDoubleClick}
          onLoad={onLoad}
          className={className}
          style={{
            ...style,
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: style?.objectFit ?? (fill ? 'cover' : 'contain'),
            visibility: visible ? 'visible' : 'hidden',
          }}
        />
      )}
    </div>
  );
}

export interface CanvasImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  src: string;
  focused?: boolean;
  fill?: boolean;
}

export function CanvasImage({
  src,
  focused: focusedProp,
  fill = false,
  alt = '',
  className,
  style,
  draggable,
  onClick,
  onDoubleClick,
  onLoad,
}: CanvasImageProps) {
  const nodeFocused = useContext(CanvasNodeFocusContext);
  const focused = focusedProp ?? nodeFocused;
  return (
    <LodImage
      key={`image:${src}`}
      source={src}
      kind="image"
      focused={focused}
      fill={fill}
      alt={alt}
      className={className}
      style={style}
      draggable={draggable}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onLoad={onLoad}
    />
  );
}

export interface CanvasVideoProps extends Omit<VideoHTMLAttributes<HTMLVideoElement>, 'src' | 'poster'> {
  src: string;
  focused?: boolean;
  fill?: boolean;
}

export function CanvasVideo({
  src,
  focused: focusedProp,
  fill = false,
  className,
  style,
  autoPlay,
  controls,
  loop,
  muted,
  playsInline,
  onClick,
  onLoadedMetadata,
}: CanvasVideoProps) {
  const nodeFocused = useContext(CanvasNodeFocusContext);
  const [locallyFocused, setLocallyFocused] = useState(false);
  const focused = focusedProp ?? (nodeFocused || locallyFocused);
  const [posterAspectState, setPosterAspectState] = useState<{
    source: string;
    ratio: number;
  } | null>(null);
  const posterAspectRatio = posterAspectState?.source === src
    ? posterAspectState.ratio
    : 16 / 9;
  const updatePosterAspect = useCallback((ratio: number) => {
    setPosterAspectState({ source: src, ratio });
  }, [src]);
  const [assetState, setAssetState] = useState<{
    source: string;
    asset: ResolvedMediaAsset;
  } | null>(null);
  const asset = assetState?.source === src ? assetState.asset : null;
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!locallyFocused || focusedProp !== undefined) return;
    const handleOutsidePointer = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setLocallyFocused(false);
      }
    };
    document.addEventListener('pointerdown', handleOutsidePointer, true);
    return () => document.removeEventListener('pointerdown', handleOutsidePointer, true);
  }, [focusedProp, locallyFocused]);

  useEffect(() => {
    if (!focused) return;
    let current = true;
    void resolveMediaAsset(src, 'video').then((resolved) => {
      if (current) setAssetState({ source: src, asset: resolved });
    });
    return () => { current = false; };
  }, [focused, src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || focused) return;
    video.pause();
    video.removeAttribute('src');
    video.load();
  }, [focused]);

  return (
    <div
      ref={wrapperRef}
      className={className}
      onPointerDown={() => {
        if (focusedProp === undefined) setLocallyFocused(true);
      }}
      style={{
        position: 'relative',
        width: '100%',
        ...(fill ? { height: '100%' } : { aspectRatio: posterAspectRatio }),
        overflow: 'hidden',
        ...style,
        height: !fill && style?.height === 'auto' ? undefined : style?.height,
      }}
    >
      <LodImage
        key={`poster:${src}`}
        source={src}
        kind="video"
        focused={false}
        posterOnly
        fill
        alt="Video preview"
        style={{ objectFit: style?.objectFit ?? 'contain' }}
        onAspectRatio={updatePosterAspect}
      />
      <video
        ref={videoRef}
        src={focused ? asset?.original : undefined}
        preload={focused ? 'metadata' : 'none'}
        autoPlay={focused && autoPlay}
        controls={focused && controls}
        loop={loop}
        muted={muted}
        playsInline={playsInline}
        onClick={onClick}
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          if (video.videoWidth && video.videoHeight) {
            updatePosterAspect(video.videoWidth / video.videoHeight);
          }
          onLoadedMetadata?.(event);
        }}
        className={className}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: style?.objectFit ?? 'contain',
          visibility: focused ? 'visible' : 'hidden',
        }}
      />
    </div>
  );
}
