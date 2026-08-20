'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Grid, X, Download, Trash2, Play } from 'lucide-react';
import { downloadFromUrl } from '@/lib/utils/download';
import { useGalleryStore } from '@/lib/stores/galleryStore';
import { createClient } from '@/lib/supabase/client';
import type { Generation } from '@/types';
import { formatDate } from '@/lib/utils/date';
import { resolveGcsRefs } from '@/lib/utils/mediaUtils';
import { ProgressiveImage } from '@/components/ui/ProgressiveImage';

const PAGE_SIZE = 42; // 7 rows × 6 columns (xl breakpoint)

function formatFalCostUsd(value: number | null | undefined): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: value < 0.01 ? 4 : 2,
  }).format(value);
}

function getFalCostUsd(generation: Generation): number | null | undefined {
  if (generation.fal_cost_usd !== null && generation.fal_cost_usd !== undefined) {
    return generation.fal_cost_usd;
  }

  const falBilling = generation.parameters?.falBilling;
  if (!falBilling || typeof falBilling !== 'object' || Array.isArray(falBilling)) return null;

  const costUsd = (falBilling as { costUsd?: unknown }).costUsd;
  return typeof costUsd === 'number' ? costUsd : null;
}

export default function GalleryPage() {
  const { generations, setGenerations, removeGeneration, filter, setFilter, sort, setSort, isLoading, setIsLoading } = useGalleryStore();
  const [selectedGen, setSelectedGen] = useState<Generation | null>(null);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const supabase = useRef(createClient()).current;
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadPage() {
      setIsLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) { setIsLoading(false); return; }

      let query = supabase
        .from('generations')
        .select('*', { count: 'exact' })
        .eq('user_id', user.id)
        .eq('status', 'completed')
        .neq('media_type', 'prompt');

      if (filter !== 'all') query = query.eq('media_type', filter);

      const { data, count } = await query
        .order('created_at', { ascending: sort === 'oldest' })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (cancelled) return;

      setTotalCount(count ?? 0);

      const rows = data ?? [];
      const gcsMap = await resolveGcsRefs(rows.map((g) => g.media_url));
      if (cancelled) return;

      setGenerations(
        rows.map((g) => gcsMap.has(g.media_url) ? { ...g, media_url: gcsMap.get(g.media_url)! } : g)
      );
      setIsLoading(false);
    }

    loadPage();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, filter, sort, refreshKey]);

  // Scroll grid to top when page changes
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [page]);

  function handleFilterChange(f: typeof filter) {
    setPage(0);
    setFilter(f);
  }

  function handleSortChange(s: typeof sort) {
    setPage(0);
    setSort(s);
  }

  async function handleDelete(gen: Generation) {
    if (!confirm('Delete this generation?')) return;
    await fetch(`/api/generations/${gen.id}`, { method: 'DELETE' });
    removeGeneration(gen.id);
    if (selectedGen?.id === gen.id) setSelectedGen(null);
    // If we just removed the last item on a non-first page, go back one page
    if (generations.length === 1 && page > 0) {
      setPage(p => p - 1);
    } else {
      setRefreshKey(k => k + 1);
    }
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-5" style={{ borderBottom: 'var(--border-default)' }}>
        <h1 className="text-xl font-semibold" style={{ color: 'var(--color-white)' }}>Gallery</h1>
        <div className="flex items-center gap-3">
          {/* Filter */}
          <div
            className="flex rounded-lg p-0.5 gap-0.5"
            style={{ background: 'var(--color-bg-elevated)', border: 'var(--border-default)' }}
          >
            {(['all', 'image', 'video'] as const).map((f) => (
              <button
                key={f}
                onClick={() => handleFilterChange(f)}
                className="px-3 py-1 rounded-md text-xs font-medium transition-all capitalize"
                style={{
                  background: filter === f ? 'var(--color-bg-hover)' : 'transparent',
                  color: filter === f ? 'var(--color-white)' : 'var(--color-white-muted)',
                }}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Sort */}
          <select
            className="px-3 py-1.5 rounded-lg text-xs outline-none"
            value={sort}
            onChange={(e) => handleSortChange(e.target.value as 'newest' | 'oldest')}
            style={{ background: 'var(--color-bg-elevated)', border: 'var(--border-default)', color: 'var(--color-white)' }}
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
          </select>
        </div>
      </div>

      {/* Grid + pagination */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-8 py-6 flex flex-col">
        {isLoading ? (
          <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="rounded-xl animate-pulse" style={{ aspectRatio: '1', background: 'var(--color-bg-elevated)' }} />
            ))}
          </div>
        ) : generations.length === 0 ? (
          <div className="flex flex-col items-center justify-center flex-1 py-20">
            <Grid size={48} className="mb-4 opacity-20" style={{ color: 'var(--color-white)' }} />
            <p className="text-sm font-medium mb-1" style={{ color: 'var(--color-white)' }}>
              {filter !== 'all' ? `No ${filter}s yet` : 'No generations yet'}
            </p>
            <p className="text-xs" style={{ color: 'var(--color-white-muted)' }}>
              Generate images or videos from Canvas Flow or Image & Video
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
              {generations.map((gen) => (
                <GalleryThumbnail
                  key={gen.id}
                  generation={gen}
                  onClick={() => setSelectedGen(gen)}
                />
              ))}
            </div>

            {/* Pagination controls */}
            {totalPages > 1 && (
              <div
                className="flex items-center justify-center gap-4 mt-6 pt-5 shrink-0"
                style={{ borderTop: 'var(--border-default)' }}
              >
                <button
                  onClick={() => setPage(p => p - 1)}
                  disabled={page === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-opacity disabled:opacity-30 hover:opacity-70"
                  style={{ background: 'var(--color-bg-elevated)', border: 'var(--border-default)', color: 'var(--color-white-muted)' }}
                >
                  <ChevronLeft size={13} />
                  Prev
                </button>

                <span className="text-xs tabular-nums" style={{ color: 'var(--color-white-muted)' }}>
                  Page {page + 1} of {totalPages}
                  <span className="ml-2 opacity-50">({totalCount} total)</span>
                </span>

                <button
                  onClick={() => setPage(p => p + 1)}
                  disabled={page >= totalPages - 1}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-opacity disabled:opacity-30 hover:opacity-70"
                  style={{ background: 'var(--color-bg-elevated)', border: 'var(--border-default)', color: 'var(--color-white-muted)' }}
                >
                  Next
                  <ChevronRight size={13} />
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Detail modal */}
      {selectedGen && (
        <GenerationModal
          generation={selectedGen}
          onClose={() => setSelectedGen(null)}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}

function GalleryThumbnail({ generation, onClick }: { generation: Generation; onClick: () => void }) {
  const isVideo = generation.media_type === 'video';
  return (
    <div
      className="relative group rounded-xl overflow-hidden cursor-pointer"
      style={{ aspectRatio: '1', border: 'var(--border-default)' }}
      onClick={onClick}
    >
      {isVideo ? (
        <video src={generation.media_url} className="w-full h-full object-cover" preload="metadata" />
      ) : (
        <ProgressiveImage
          src={generation.media_url}
          alt={generation.prompt ?? ''}
          className="w-full h-full object-cover"
          fill
        />
      )}

      {isVideo && (
        <div className="absolute inset-0 flex items-center justify-center opacity-60 group-hover:opacity-100">
          <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
            <Play size={12} style={{ color: '#fff' }} />
          </div>
        </div>
      )}

      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2"
        style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 50%)' }}
      >
        <p className="text-xs truncate" style={{ color: '#fff' }}>{generation.model}</p>
        <p className="text-xs opacity-60" style={{ color: '#fff' }}>{formatDate(generation.created_at)}</p>
      </div>
    </div>
  );
}

function GenerationModal({
  generation,
  onClose,
  onDelete,
}: {
  generation: Generation;
  onClose: () => void;
  onDelete: (g: Generation) => void;
}) {
  const isVideo = generation.media_type === 'video';
  const [expanded, setExpanded] = useState(false);

  const PROMPT_LIMIT = 140;
  const fullPrompt = generation.prompt ?? '';
  const isLong = fullPrompt.length > PROMPT_LIMIT;
  const shownPrompt = isLong && !expanded ? fullPrompt.slice(0, PROMPT_LIMIT) + '…' : fullPrompt;
  const falCost = formatFalCostUsd(getFalCostUsd(generation));

  const details = [
    { label: 'Model',  value: generation.model },
    { label: 'Type',   value: generation.media_type },
    { label: 'Date',   value: formatDate(generation.created_at) },
    ...(falCost ? [{ label: 'Final cost', value: falCost, icon: '$' }] : []),
    ...(generation.width && generation.height
      ? [{ label: 'Size', value: `${generation.width} × ${generation.height}` }]
      : []),
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex"
      style={{ background: '#000' }}
      onClick={onClose}
    >
      {/* Left: media */}
      <div
        className="flex-1 flex items-center justify-center min-w-0 p-10"
        onClick={(e) => e.stopPropagation()}
      >
        {isVideo ? (
          <video
            src={generation.media_url}
            controls
            className="max-w-full rounded-xl object-contain"
            style={{ maxHeight: 'calc(100vh - 80px)' }}
          />
        ) : (
          <ProgressiveImage
            src={generation.media_url}
            alt=""
            className="max-w-full rounded-xl object-contain"
            style={{ maxHeight: 'calc(100vh - 80px)' }}
          />
        )}
      </div>

      {/* Right: info panel */}
      <div
        className="w-80 flex-shrink-0 flex flex-col overflow-y-auto"
        style={{ background: 'var(--color-bg-elevated)', borderLeft: '1px solid rgba(255,255,255,0.08)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Panel top bar */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}
        >
          <span
            className="text-xs px-2.5 py-1 rounded-full capitalize font-medium"
            style={{ background: 'rgba(255,255,255,0.07)', color: 'var(--color-white-muted)' }}
          >
            {generation.media_type}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className="p-1.5 rounded-lg transition-opacity hover:opacity-70"
            style={{ background: 'rgba(255,255,255,0.12)', color: '#fff', border: 'none', cursor: 'pointer' }}
            title="Close"
          >
            <X size={15} />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="p-5 flex flex-col gap-5 flex-1">
          {/* Model + date */}
          <div>
            <h2 className="text-lg font-semibold leading-tight" style={{ color: 'var(--color-white)' }}>
              {generation.model}
            </h2>
            <p className="text-sm mt-1" style={{ color: 'var(--color-white-muted)' }}>
              {formatDate(generation.created_at)}
            </p>
          </div>

          {/* Prompt */}
          {fullPrompt && (
            <div>
              <p className="text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.82)' }}>
                {shownPrompt}
              </p>
              {isLong && (
                <button
                  onClick={(e) => { e.stopPropagation(); setExpanded(v => !v); }}
                  className="text-xs mt-1.5 transition-opacity hover:opacity-60"
                  style={{ color: 'var(--color-white-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                >
                  {expanded ? 'less' : 'more'}
                </button>
              )}
            </div>
          )}

          {/* Download — white pill */}
          <button
            onClick={(e) => { e.stopPropagation(); downloadFromUrl(generation.media_url); }}
            className="flex items-center justify-center gap-2 py-2.5 rounded-full text-sm font-semibold transition-opacity hover:opacity-85"
            style={{ background: '#fff', color: '#000', border: 'none', cursor: 'pointer' }}
          >
            <Download size={14} />
            Download
          </button>

          {/* Details list */}
          <div>
            <p
              className="text-xs font-semibold uppercase tracking-wider mb-3"
              style={{ color: 'var(--color-white-muted)' }}
            >
              {String(details.length).padStart(2, '0')} Details
            </p>
            <div className="space-y-3">
              {details.map(({ label, value, icon }) => (
                <div key={label} className="flex items-center gap-3">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-semibold"
                    style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--color-white-muted)' }}
                  >
                    {icon ?? label[0]}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate" style={{ color: 'var(--color-white)' }}>{value}</p>
                    <p className="text-xs" style={{ color: 'var(--color-white-muted)' }}>{label}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Panel bottom bar — delete */}
        <div
          className="px-5 py-4"
          style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}
        >
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(generation); }}
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-full text-sm font-semibold transition-opacity hover:opacity-85"
            style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171', border: 'none', cursor: 'pointer' }}
            title="Delete"
          >
            <Trash2 size={14} />
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
