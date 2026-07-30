'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus, Search, MoreHorizontal, Clock, Workflow,
  Edit2, Check, X, Upload, RefreshCw, ArrowUpRight,
  GripVertical, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { Flow } from '@/types';
import { formatDistanceToNow } from '@/lib/utils/date';
import { isGcsRef, isSignedGcsUrl, resolveGcsRefs } from '@/lib/utils/mediaUtils';
import { uploadImageRefToStorage } from '@/lib/utils/uploadImage';
import { MAX_UPLOAD_SIZE_BYTES } from '@/lib/utils/constants';
import { ProgressiveImage } from '@/components/ui/ProgressiveImage';

// Number of base flows shown before the fade + "Explore all flows" button.
const BASE_FLOWS_VISIBLE = 8;

type FlowCardSummary = Pick<
  Flow,
  'id' | 'title' | 'description' | 'thumbnail_url' | 'created_at' | 'updated_at'
> & {
  base_flow_order?: number | null;
  author_username?: string | null;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Splits "🎨 Subtitle text" into { icon, text } */
function parseDescription(raw: string | null): { icon: string | null; text: string | null } {
  if (!raw) return { icon: null, text: null };
  const m = raw.match(/^(\p{Emoji_Presentation}|\p{Extended_Pictographic})\s*/u);
  if (m) return { icon: m[1], text: raw.slice(m[0].length).trim() || null };
  return { icon: null, text: raw };
}

// ── Shared card shell that prevents hover-scale clipping ─────────────────────

function CardShell({
  children,
  onClick,
  revealIndex = 0,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  revealIndex?: number;
}) {
  return (
    <div
      className="flow-card-enter flow-root relative group rounded-xl cursor-pointer transition-all duration-150"
      style={{
        background: 'var(--color-bg-elevated)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
        animationDelay: `${Math.min(revealIndex, 10) * 40}ms`,
      }}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

// ── Inline edit overlay for base flow cards (admins only) ────────────────────

interface EditOverlayProps {
  flow: FlowCardSummary;
  onSave: (updates: { title: string; description: string | null; thumbnail_url: string | null }) => Promise<void>;
  onClose: () => void;
}

function EditOverlay({ flow, onSave, onClose }: EditOverlayProps) {
  const { icon: existingIcon, text: existingText } = parseDescription(flow.description);
  const [title, setTitle] = useState(flow.title);
  const [icon, setIcon] = useState(existingIcon ?? '');
  const [description, setDescription] = useState(existingText ?? '');
  const [thumbnailUrl, setThumbnailUrl] = useState(flow.thumbnail_url ?? '');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleUpload(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      if (file.size > MAX_UPLOAD_SIZE_BYTES) {
        throw new Error('File too large (max 20MB)');
      }

      let uploadFile = file;

      // GIFs must remain in their original format or their animation is lost.
      // Static thumbnails can still use the existing lightweight JPEG compression.
      if (file.type !== 'image/gif') {
        const { default: imageCompression } = await import('browser-image-compression');
        const compressed = await imageCompression(file, {
          maxSizeMB:        0.15,
          maxWidthOrHeight: 640,
          useWebWorker:     true,
          fileType:         'image/jpeg',
        });
        uploadFile = new File([compressed], 'thumbnail.jpg', { type: 'image/jpeg' });
      }

      // Upload directly to GCS so animated GIFs do not hit Vercel's request-size limit.
      setThumbnailUrl(await uploadImageRefToStorage(uploadFile));
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    const combinedDescription = [icon.trim(), description.trim()].filter(Boolean).join(' ');
    await onSave({
      title: title.trim() || flow.title,
      description: combinedDescription || null,
      thumbnail_url: thumbnailUrl.trim() || null,
    });
    setSaving(false);
  }

  const inputStyle: React.CSSProperties = {
    background: 'var(--color-bg-surface)',
    border: 'var(--border-default)',
    color: 'var(--color-white)',
    borderRadius: 6,
    padding: '6px 10px',
    fontSize: 12,
    outline: 'none',
    width: '100%',
  };

  return (
    <div
      className="absolute inset-0 z-20 rounded-xl p-3 flex flex-col gap-2"
      style={{
        background: 'var(--color-bg-elevated)',
        border: '1px solid var(--color-accent)',
        backdropFilter: 'blur(8px)',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-semibold" style={{ color: 'var(--color-white)' }}>Edit Base Flow</p>
        <button onClick={onClose} className="p-0.5 rounded hover:bg-white/10">
          <X size={12} style={{ color: 'var(--color-white-muted)' }} />
        </button>
      </div>

      {/* Icon + Title row */}
      <div className="flex gap-1.5">
        <input
          type="text"
          placeholder="🎨"
          value={icon}
          onChange={(e) => setIcon(e.target.value)}
          maxLength={4}
          style={{ ...inputStyle, width: 40, textAlign: 'center', flexShrink: 0 }}
          title="Emoji icon"
        />
        <input type="text" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle} />
      </div>

      {/* Description */}
      <input type="text" placeholder="Short description" value={description} onChange={(e) => setDescription(e.target.value)} style={inputStyle} />

      {/* Thumbnail */}
      <div className="flex gap-1.5">
        <input
          type="text"
          placeholder="Thumbnail URL"
          value={thumbnailUrl}
          onChange={(e) => setThumbnailUrl(e.target.value)}
          style={{ ...inputStyle, flex: 1 }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="flex items-center justify-center rounded-lg transition-colors hover:bg-white/10 disabled:opacity-40"
          style={{ border: 'var(--border-default)', width: 30, height: 30, flexShrink: 0 }}
          title="Upload PNG, JPEG, WebP, or GIF"
        >
          {uploading ? <RefreshCw size={11} className="animate-spin" style={{ color: 'var(--color-white-muted)' }} /> : <Upload size={11} style={{ color: 'var(--color-white-muted)' }} />}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleUpload(file);
            e.target.value = '';
          }}
        />
      </div>

      {uploadError && (
        <p className="text-[10px] leading-tight" role="alert" style={{ color: 'var(--color-error)' }}>
          {uploadError}
        </p>
      )}

      {/* Save */}
      <button
        onClick={handleSave}
        disabled={saving}
        className="flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-medium transition-opacity hover:opacity-80 disabled:opacity-40"
        style={{ background: '#fff', color: '#000' }}
      >
        {saving ? <RefreshCw size={11} className="animate-spin" /> : <Check size={11} />}
        {saving ? 'Saving…' : 'Save Changes'}
      </button>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CanvasFlowPage() {
  const router = useRouter();
  const [flows, setFlows]         = useState<FlowCardSummary[]>([]);
  const [baseFlows, setBaseFlows] = useState<FlowCardSummary[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading]     = useState(true);
  const [isCreatingFlow, setIsCreatingFlow] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [editingBaseId, setEditingBaseId] = useState<string | null>(null);
  const [openingBaseId, setOpeningBaseId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin]     = useState(false);
  const [isReorderingBaseFlows, setIsReorderingBaseFlows] = useState(false);
  const [draggedBaseId, setDraggedBaseId] = useState<string | null>(null);
  const [savingBaseOrder, setSavingBaseOrder] = useState(false);
  const [baseOrderError, setBaseOrderError] = useState<string | null>(null);
  const [resolvedThumbs, setResolvedThumbs] = useState<Map<string, string>>(new Map());
  const baseOrderBeforeEdit = useRef<FlowCardSummary[] | null>(null);
  const draggedBaseIdRef = useRef<string | null>(null);

  const supabase = useMemo(() => createClient(), []);

  const loadFlows = useCallback(async () => {
    const baseFlowsPromise = fetch('/api/flows/base')
      .then((r) => r.json())
      .catch(() => ({ baseFlows: [] }));
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }

    const userFlowsPromise = supabase
      .from('flows')
      .select('id, title, description, thumbnail_url, created_at, updated_at')
      .eq('user_id', user.id)
      .eq('is_template', false)
      .order('updated_at', { ascending: false });
    const profilePromise = supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single();
    const [userFlowsResult, baseFlowsResult] = await Promise.all([
      userFlowsPromise,
      baseFlowsPromise,
    ]);

    setFlows(userFlowsResult.data ?? []);
    setBaseFlows(baseFlowsResult.baseFlows ?? []);
    setLoading(false);

    const profileResult = await profilePromise;
    setIsAdmin(profileResult.data?.is_admin ?? false);
  }, [supabase]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => { void loadFlows(); }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadFlows]);

  // Batch-resolve all thumbnail URLs (both gcs: refs and old stored signed URLs).
  useEffect(() => {
    const allUrls = [...flows, ...baseFlows]
      .map(f => f.thumbnail_url)
      .filter(Boolean) as string[];
    if (allUrls.length === 0) return;
    let cancelled = false;
    resolveGcsRefs(allUrls).then((resolved) => {
      if (!cancelled) setResolvedThumbs(resolved);
    }).catch((error) => {
      console.error('[CanvasFlow] Failed to resolve thumbnails:', error);
    });
    return () => { cancelled = true; };
  }, [flows, baseFlows]);

  async function createNewFlow(
    title = 'Untitled Flow',
    flowData: Record<string, unknown> = { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
  ) {
    if (isCreatingFlow) return;
    setIsCreatingFlow(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setIsCreatingFlow(false);
        return;
      }
      const { data, error } = await supabase
        .from('flows')
        .insert({ user_id: user.id, title, flow_data: flowData, is_template: false })
        .select()
        .single();

      if (error || !data) {
        console.error('[CanvasFlow] Failed to create flow:', error);
        setIsCreatingFlow(false);
        return;
      }

      router.push(`/dashboard/canvas-flow/${data.id}`);
    } catch (error) {
      console.error('[CanvasFlow] Failed to create flow:', error);
      setIsCreatingFlow(false);
    }
  }

  async function createFlowFromBase(flow: FlowCardSummary) {
    if (openingBaseId) return;
    setOpeningBaseId(flow.id);
    try {
      const response = await fetch(`/api/flows/${flow.id}`);
      if (!response.ok) throw new Error('Unable to load this base flow');
      const result = await response.json() as { data?: { flow_data?: Record<string, unknown> } };
      if (!result.data?.flow_data) throw new Error('This base flow has no flow data');
      await createNewFlow(flow.title, result.data.flow_data);
    } catch (error) {
      console.error('[CanvasFlow] Failed to open base flow:', error);
      alert('Could not open this base flow. Please try again.');
    } finally {
      setOpeningBaseId(null);
    }
  }

  async function renameFlow(id: string, newTitle: string) {
    await supabase.from('flows').update({ title: newTitle, updated_at: new Date().toISOString() }).eq('id', id);
    setFlows(flows.map((f) => (f.id === id ? { ...f, title: newTitle } : f)));
  }

  async function deleteFlow(id: string) {
    await supabase.from('flows').delete().eq('id', id);
    setFlows(flows.filter((f) => f.id !== id));
  }

  async function saveBaseFlowEdits(
    id: string,
    updates: { title: string; description: string | null; thumbnail_url: string | null }
  ) {
    await supabase.from('flows').update({
      title: updates.title,
      description: updates.description,
      thumbnail_url: updates.thumbnail_url,
      updated_at: new Date().toISOString(),
    }).eq('id', id);
    setBaseFlows(baseFlows.map((f) =>
      f.id === id ? { ...f, ...updates } : f
    ));
    setEditingBaseId(null);
  }

  async function deleteBaseFlow(id: string, title: string) {
    if (!confirm(`Delete base flow "${title}"? This cannot be undone.`)) return;
    await supabase.from('flows').delete().eq('id', id);
    setBaseFlows(baseFlows.filter((f) => f.id !== id));
  }

  async function unmarkBaseFlow(id: string) {
    await supabase.from('flows').update({ is_template: false }).eq('id', id);
    setBaseFlows(baseFlows.filter((f) => f.id !== id));
  }

  function startReorderingBaseFlows() {
    baseOrderBeforeEdit.current = baseFlows;
    setMenuOpenId(null);
    setEditingBaseId(null);
    setBaseOrderError(null);
    setIsReorderingBaseFlows(true);
  }

  function cancelReorderingBaseFlows() {
    if (baseOrderBeforeEdit.current) setBaseFlows(baseOrderBeforeEdit.current);
    baseOrderBeforeEdit.current = null;
    draggedBaseIdRef.current = null;
    setDraggedBaseId(null);
    setBaseOrderError(null);
    setIsReorderingBaseFlows(false);
  }

  function moveBaseFlowTo(sourceId: string, targetId: string) {
    if (sourceId === targetId) return;
    setBaseFlows((current) => {
      const sourceIndex = current.findIndex((flow) => flow.id === sourceId);
      const targetIndex = current.findIndex((flow) => flow.id === targetId);
      if (sourceIndex === -1 || targetIndex === -1) return current;

      const next = [...current];
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  }

  function moveBaseFlowBy(id: string, offset: -1 | 1) {
    setBaseFlows((current) => {
      const sourceIndex = current.findIndex((flow) => flow.id === id);
      const targetIndex = sourceIndex + offset;
      if (sourceIndex === -1 || targetIndex < 0 || targetIndex >= current.length) return current;

      const next = [...current];
      [next[sourceIndex], next[targetIndex]] = [next[targetIndex], next[sourceIndex]];
      return next;
    });
  }

  async function saveBaseFlowOrder() {
    setSavingBaseOrder(true);
    setBaseOrderError(null);
    try {
      const response = await fetch('/api/flows/base', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flowIds: baseFlows.map((flow) => flow.id) }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(result?.error ?? 'Could not save the Base Flow order');
      }

      setBaseFlows((current) => current.map((flow, index) => ({
        ...flow,
        base_flow_order: index,
      })));
      baseOrderBeforeEdit.current = null;
      setIsReorderingBaseFlows(false);
    } catch (error) {
      setBaseOrderError(error instanceof Error ? error.message : 'Could not save the Base Flow order');
    } finally {
      setSavingBaseOrder(false);
    }
  }

  const filteredFlows = flows.filter((f) =>
    f.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div
      className="h-full overflow-auto p-8"
      onClick={() => { setMenuOpenId(null); setEditingBaseId(null); }}
    >
      <div className="max-w-[1400px] mx-auto">
      {/* Base Flows */}
      <section className="mb-10">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-white-muted)' }}>
              BASE FLOWS
            </h2>
            {isReorderingBaseFlows && (
              <p className="text-xs mt-1" style={{ color: 'var(--color-white-muted)' }}>
                Drag cards or use the arrow buttons to set their display order.
              </p>
            )}
          </div>
          {isAdmin && baseFlows.length > 1 && (
            isReorderingBaseFlows ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={cancelReorderingBaseFlows}
                  disabled={savingBaseOrder}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors hover:bg-white/5 disabled:opacity-40"
                  style={{ border: 'var(--border-default)', color: 'var(--color-white-muted)' }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => { void saveBaseFlowOrder(); }}
                  disabled={savingBaseOrder}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-opacity hover:opacity-80 disabled:opacity-40"
                  style={{ background: '#fff', color: '#000' }}
                >
                  {savingBaseOrder ? <RefreshCw size={12} className="animate-spin" /> : <Check size={12} />}
                  {savingBaseOrder ? 'Saving…' : 'Save order'}
                </button>
              </div>
            ) : (
              <button
                onClick={startReorderingBaseFlows}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors hover:bg-white/5"
                style={{ border: 'var(--border-default)', color: 'var(--color-white)' }}
              >
                <GripVertical size={13} />
                Reorder cards
              </button>
            )
          )}
        </div>

        {baseOrderError && (
          <p
            role="alert"
            className="text-xs mb-3 px-3 py-2 rounded-lg"
            style={{ color: 'var(--color-error)', background: 'var(--color-bg-elevated)' }}
          >
            {baseOrderError}
          </p>
        )}

        {loading ? (
          <FlowCardSkeletonGrid count={5} />
        ) : baseFlows.length === 0 ? (
          <div
            className="flex items-center gap-3 px-4 py-5 rounded-xl"
            style={{ border: '1.5px dashed rgba(255,255,255,0.1)' }}
          >
            <Workflow size={20} className="opacity-30" style={{ color: 'var(--color-white)' }} />
            <p className="text-sm" style={{ color: 'var(--color-white-muted)' }}>
              No base flows yet — admins can mark any flow as a base from the editor.
            </p>
          </div>
        ) : (
          // 4-column grid so the base-flow thumbnails read larger. Only the first
          // 8 are shown outright; any beyond that peek out from under a gradient.
          <div className="relative">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {(!isReorderingBaseFlows && baseFlows.length > BASE_FLOWS_VISIBLE
              ? baseFlows.slice(0, BASE_FLOWS_VISIBLE + 4)
              : baseFlows
            ).map((bf, index) => {
              const { icon } = parseDescription(bf.description);
              const isEditing = editingBaseId === bf.id;
              const menuOpen  = menuOpenId === bf.id;
              const isOpening = openingBaseId === bf.id;

              return (
                <div
                  key={bf.id}
                  draggable={isReorderingBaseFlows && !savingBaseOrder}
                  onDragStart={(event) => {
                    if (!isReorderingBaseFlows) return;
                    draggedBaseIdRef.current = bf.id;
                    setDraggedBaseId(bf.id);
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', bf.id);
                  }}
                  onDragEnter={(event) => {
                    const sourceId = draggedBaseIdRef.current;
                    if (!isReorderingBaseFlows || !sourceId) return;
                    event.preventDefault();
                    moveBaseFlowTo(sourceId, bf.id);
                  }}
                  onDragOver={(event) => {
                    if (!isReorderingBaseFlows) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                  }}
                  onDrop={(event) => event.preventDefault()}
                  onDragEnd={() => {
                    draggedBaseIdRef.current = null;
                    setDraggedBaseId(null);
                  }}
                  className="rounded-xl transition-opacity"
                  style={{ opacity: draggedBaseId === bf.id ? 0.45 : 1 }}
                >
                  <CardShell
                    revealIndex={index}
                    onClick={() => {
                      if (isReorderingBaseFlows || isEditing || menuOpen || isOpening) return;
                      createFlowFromBase(bf);
                    }}
                  >
                  {/* Thumbnail area */}
                  <div
                    className="m-1 aspect-video flex items-center justify-center rounded-lg overflow-hidden"
                    style={{ background: 'var(--color-bg-surface)' }}
                  >
                    <FlowThumbnail
                      flow={bf}
                      resolvedThumbnailUrl={bf.thumbnail_url ? resolvedThumbs.get(bf.thumbnail_url) : undefined}
                      fallbackIcon={icon}
                    />
                  </div>

                  {/* Footer */}
                  <div className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold leading-tight truncate" style={{ color: 'var(--color-white)' }}>
                          {bf.title}
                        </p>
                        <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--color-white-muted)' }}>
                          By {bf.author_username ?? 'unknown'}
                        </p>
                      </div>
                      {isReorderingBaseFlows ? (
                        <div className="flex items-center gap-0.5" onClick={(event) => event.stopPropagation()}>
                          <button
                            onClick={() => moveBaseFlowBy(bf.id, -1)}
                            disabled={index === 0 || savingBaseOrder}
                            className="p-1 rounded transition-colors hover:bg-white/10 disabled:opacity-20"
                            title={`Move ${bf.title} earlier`}
                            aria-label={`Move ${bf.title} earlier`}
                          >
                            <ChevronLeft size={14} style={{ color: 'var(--color-white-muted)' }} />
                          </button>
                          <GripVertical size={15} style={{ color: 'var(--color-white-muted)' }} aria-hidden="true" />
                          <button
                            onClick={() => moveBaseFlowBy(bf.id, 1)}
                            disabled={index === baseFlows.length - 1 || savingBaseOrder}
                            className="p-1 rounded transition-colors hover:bg-white/10 disabled:opacity-20"
                            title={`Move ${bf.title} later`}
                            aria-label={`Move ${bf.title} later`}
                          >
                            <ChevronRight size={14} style={{ color: 'var(--color-white-muted)' }} />
                          </button>
                        </div>
                      ) : isAdmin && (
                        <button
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded"
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuOpenId(menuOpen ? null : bf.id);
                            setEditingBaseId(null);
                          }}
                        >
                          <MoreHorizontal size={14} style={{ color: 'var(--color-white-muted)' }} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Admin context menu */}
                  {menuOpen && isAdmin && (
                    <div
                      className="absolute right-2 bottom-2 z-10 w-40 rounded-lg overflow-hidden shadow-lg"
                      style={{ background: 'var(--color-bg-surface)', border: 'var(--border-default)' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        className="w-full text-left px-3 py-2 text-xs transition-colors hover:bg-white/5 flex items-center gap-2"
                        style={{ color: 'var(--color-white)' }}
                        onClick={(e) => { e.stopPropagation(); setEditingBaseId(bf.id); setMenuOpenId(null); }}
                      >
                        <Edit2 size={11} /> Edit thumbnail & icon
                      </button>
                      <button
                        className="w-full text-left px-3 py-2 text-xs transition-colors hover:bg-white/5"
                        style={{ color: 'var(--color-white)' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuOpenId(null);
                          router.push(`/dashboard/canvas-flow/${bf.id}`);
                        }}
                      >
                        Open in editor
                      </button>
                      <button
                        className="w-full text-left px-3 py-2 text-xs transition-colors hover:bg-white/5"
                        style={{ color: 'var(--color-white-muted)' }}
                        onClick={(e) => { e.stopPropagation(); setMenuOpenId(null); unmarkBaseFlow(bf.id); }}
                      >
                        Remove from base flows
                      </button>
                      <button
                        className="w-full text-left px-3 py-2 text-xs transition-colors hover:bg-white/5"
                        style={{ color: 'var(--color-error)' }}
                        onClick={(e) => { e.stopPropagation(); setMenuOpenId(null); deleteBaseFlow(bf.id, bf.title); }}
                      >
                        Delete
                      </button>
                    </div>
                  )}

                  {/* Inline edit overlay */}
                  {isEditing && (
                    <EditOverlay
                      flow={bf}
                      onSave={(updates) => saveBaseFlowEdits(bf.id, updates)}
                      onClose={() => setEditingBaseId(null)}
                    />
                  )}

                  {isOpening && (
                    <div
                      className="absolute inset-0 z-20 flex items-center justify-center rounded-xl"
                      style={{ background: 'rgba(15,15,16,0.72)', backdropFilter: 'blur(3px)' }}
                    >
                      <RefreshCw size={18} className="animate-spin" style={{ color: 'var(--color-white)' }} />
                    </div>
                  )}
                  </CardShell>
                </div>
              );
            })}
          </div>

          {/* Fade + "Explore all flows" when there are more than 8 base flows */}
          {!isReorderingBaseFlows && baseFlows.length > BASE_FLOWS_VISIBLE && (
            <div
              className="absolute inset-x-0 bottom-0 flex items-end justify-center pb-6 pointer-events-none"
              style={{
                height: 320,
                background:
                  'linear-gradient(to top, var(--color-bg-darkest) 28%, transparent 100%)',
              }}
            >
              <button
                onClick={(e) => e.stopPropagation()}
                className="pointer-events-auto flex items-center gap-1.5 px-5 py-2.5 rounded-full text-sm font-semibold transition-opacity hover:opacity-90"
                style={{ background: '#c8f24a', color: '#0f0f10', border: 'none', cursor: 'pointer' }}
              >
                Explore all flows
                <ArrowUpRight size={16} />
              </button>
            </div>
          )}
          </div>
        )}
      </section>

      {/* Recent Flows */}
      <section>
        <div className="flex flex-col gap-3 mb-6 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-white-muted)' }}>
            RECENT FLOWS
          </h2>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end">
            <button
              onClick={() => createNewFlow()}
              disabled={isCreatingFlow}
              className="new-flow-button flex h-11 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-bold disabled:cursor-wait disabled:opacity-80"
              style={{ background: '#fff', color: '#000' }}
            >
              <Plus size={14} />
              <span>{isCreatingFlow ? 'Creating...' : 'New Flow'}</span>
            </button>
            <div className="relative sm:w-80">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2"
                style={{ color: 'var(--color-white-muted)' }}
              />
              <input
                type="text"
                placeholder="Search Flow"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-11 w-full pl-9 pr-3 rounded-full text-sm outline-none"
                style={{
                  background: 'var(--color-bg-elevated)',
                  border: '4px solid rgba(255, 255, 255, 0.12)',
                  color: 'var(--color-white)',
                }}
              />
            </div>
          </div>
        </div>

        {/* Grid */}
        {loading ? (
          <FlowCardSkeletonGrid count={5} />
        ) : filteredFlows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Workflow size={48} className="mb-4 opacity-20" style={{ color: 'var(--color-white)' }} />
            <p className="text-sm font-medium mb-1" style={{ color: 'var(--color-white)' }}>
              {searchQuery ? 'No flows match your search' : 'No flows yet'}
            </p>
            <p className="text-xs mb-4" style={{ color: 'var(--color-white-muted)' }}>
              {searchQuery ? 'Try a different search term' : 'Create your first flow to get started'}
            </p>
            {!searchQuery && (
              <button
                onClick={() => createNewFlow()}
                disabled={isCreatingFlow}
                className="new-flow-button flex h-11 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-bold disabled:cursor-wait disabled:opacity-80"
                style={{ background: '#fff', color: '#000' }}
              >
                <Plus size={14} />
                <span>{isCreatingFlow ? 'Creating...' : 'New Flow'}</span>
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {filteredFlows.map((flow, index) => (
              <FlowCard
                key={flow.id}
                flow={flow}
                revealIndex={index}
                resolvedThumbnailUrl={flow.thumbnail_url ? resolvedThumbs.get(flow.thumbnail_url) : undefined}
                menuOpen={menuOpenId === flow.id}
                onMenuToggle={(e) => {
                  e.stopPropagation();
                  setMenuOpenId(menuOpenId === flow.id ? null : flow.id);
                }}
                onOpen={() => router.push(`/dashboard/canvas-flow/${flow.id}`)}
                onRename={() => {
                  const newTitle = prompt('Rename flow:', flow.title);
                  if (newTitle?.trim()) renameFlow(flow.id, newTitle.trim());
                }}
                onDelete={() => {
                  if (confirm(`Delete "${flow.title}"?`)) deleteFlow(flow.id);
                }}
              />
            ))}
          </div>
        )}
      </section>
      </div>
    </div>
  );
}

// ── Recent flow card ──────────────────────────────────────────────────────────

function FlowCardSkeletonGrid({ count }: { count: number }) {
  return (
    <div
      className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4"
      aria-hidden="true"
    >
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className="rounded-xl animate-pulse"
          style={{ background: 'var(--color-bg-elevated)' }}
        >
          <div className="m-1 aspect-video rounded-lg" style={{ background: 'var(--color-bg-surface)' }} />
          <div className="p-3">
            <div className="h-3 w-2/3 rounded" style={{ background: 'var(--color-bg-surface)' }} />
            <div className="h-2 w-1/3 rounded mt-2" style={{ background: 'var(--color-bg-surface)' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function FlowThumbnail({
  flow,
  resolvedThumbnailUrl,
  fallbackIcon,
}: {
  flow: FlowCardSummary;
  resolvedThumbnailUrl?: string;
  fallbackIcon?: string | null;
}) {
  const storedThumbnail = flow.thumbnail_url;
  const needsResolution = isGcsRef(storedThumbnail) || isSignedGcsUrl(storedThumbnail);
  const src = resolvedThumbnailUrl ?? (needsResolution ? undefined : storedThumbnail ?? undefined);

  if (src) {
    return (
      <ProgressiveImage
        src={src}
        alt={flow.title}
        fill
        className="block h-full w-full object-cover"
        loading="lazy"
        decoding="async"
      />
    );
  }

  if (storedThumbnail) {
    return (
      <div className="h-full w-full animate-pulse" style={{ background: 'var(--color-bg-elevated)' }} />
    );
  }

  return fallbackIcon ? (
    <span style={{ fontSize: 36 }}>{fallbackIcon}</span>
  ) : (
    <Workflow size={32} className="opacity-20" style={{ color: 'var(--color-white)' }} />
  );
}

function FlowCard({
  flow,
  revealIndex,
  resolvedThumbnailUrl,
  menuOpen,
  onMenuToggle,
  onOpen,
  onRename,
  onDelete,
}: {
  flow: FlowCardSummary;
  revealIndex: number;
  resolvedThumbnailUrl?: string;
  menuOpen: boolean;
  onMenuToggle: (e: React.MouseEvent) => void;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <CardShell onClick={onOpen} revealIndex={revealIndex}>
      {/* Thumbnail */}
      <div
        className="m-1 aspect-video flex items-center justify-center rounded-lg overflow-hidden"
        style={{ background: 'var(--color-bg-surface)' }}
      >
        <FlowThumbnail flow={flow} resolvedThumbnailUrl={resolvedThumbnailUrl} />
      </div>

      {/* Footer */}
      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium leading-tight truncate flex-1" style={{ color: 'var(--color-white)' }}>
            {flow.title}
          </p>
          <button
            className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded"
            onClick={onMenuToggle}
          >
            <MoreHorizontal size={14} style={{ color: 'var(--color-white-muted)' }} />
          </button>
        </div>
        <div className="flex items-center gap-1 mt-1">
          <Clock size={10} style={{ color: 'var(--color-white-muted)' }} />
          <p className="text-xs" style={{ color: 'var(--color-white-muted)' }}>
            Last edited {formatDistanceToNow(flow.updated_at)}
          </p>
        </div>
      </div>

      {/* Context menu — z-20 so it layers above everything in the card */}
      {menuOpen && (
        <div
          className="absolute right-2 bottom-2 z-20 w-36 rounded-lg overflow-hidden shadow-lg"
          style={{ background: 'var(--color-bg-surface)', border: 'var(--border-default)' }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full text-left px-3 py-2 text-sm transition-colors hover:bg-white/5"
            style={{ color: 'var(--color-white)' }}
            onClick={(e) => { e.stopPropagation(); onRename(); }}
          >
            Rename
          </button>
          <button
            className="w-full text-left px-3 py-2 text-sm transition-colors hover:bg-white/5"
            style={{ color: 'var(--color-error)' }}
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
          >
            Delete
          </button>
        </div>
      )}
    </CardShell>
  );
}
