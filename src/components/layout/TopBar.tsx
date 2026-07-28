'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ChevronRight,
  Cloud,
  UploadCloud,
  RotateCcw,
  RotateCw,
  Share2,
  Check,
  BookOpen,
  HardDrive,
  Loader2,
  Lock,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useFlowStore } from '@/lib/stores/flowStore';
import { createClient } from '@/lib/supabase/client';

interface TopBarProps {
  flowId: string;
  isOwner?: boolean;
  isShared?: boolean;
  onToggleShare?: () => void;
  onSave: () => Promise<boolean>;
}

export function TopBar({ flowId, isOwner = true, isShared = false, onToggleShare, onSave }: TopBarProps) {
  const router = useRouter();
  const { currentFlow, isDirty, isSaving } = useFlowStore();
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [savingBase, setSavingBase] = useState(false);
  const [savingGcsOnly, setSavingGcsOnly] = useState(false);
  const [gcsOnlyError, setGcsOnlyError] = useState<string | null>(null);
  const [showGcsOnlyConfirm, setShowGcsOnlyConfirm] = useState(false);
  const [copied, setCopied] = useState(false);
  const isBaseFlow = currentFlow?.is_template ?? false;
  const isGcsOnly = currentFlow?.is_gcs_only ?? false;
  const canEnableGcsOnly = currentFlow?.gcs_only_eligible ?? false;

  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    async function checkAdmin() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', user.id)
        .single();
      setIsAdmin(profile?.is_admin ?? false);
    }
    checkAdmin();
  }, [supabase]);

  function startEditTitle() {
    setTitleValue(currentFlow?.title ?? '');
    setEditingTitle(true);
  }

  async function saveTitle() {
    if (!currentFlow || !titleValue.trim()) {
      setEditingTitle(false);
      return;
    }
    await supabase
      .from('flows')
      .update({ title: titleValue.trim(), updated_at: new Date().toISOString() })
      .eq('id', flowId);
    useFlowStore.setState({ currentFlow: { ...currentFlow, title: titleValue.trim() } });
    setEditingTitle(false);
  }

  async function handleSave() {
    if (!currentFlow || isSaving) return;
    await onSave();
  }

  async function handleSaveAsBaseFlow() {
    if (!currentFlow || savingBase) return;
    const confirmMsg = isBaseFlow
      ? 'Remove this flow from Base Flows? Users will no longer see it as a template.'
      : 'Save this flow as a Base Flow? All users will be able to use it as a starting template.';
    if (!confirm(confirmMsg)) return;
    setSavingBase(true);
    try {
      if (isDirty && !(await onSave())) return;
      await supabase.from('flows').update({
        is_template: !isBaseFlow,
        updated_at: new Date().toISOString(),
      }).eq('id', flowId);
      useFlowStore.setState((state) => ({
        currentFlow: state.currentFlow
          ? { ...state.currentFlow, is_template: !isBaseFlow }
          : null,
      }));
    } finally {
      setSavingBase(false);
    }
  }

  async function handleToggleGcsOnly() {
    if (!currentFlow || savingGcsOnly || isGcsOnly || !canEnableGcsOnly) return;

    setSavingGcsOnly(true);
    setGcsOnlyError(null);
    try {
      const response = await fetch(`/api/flows/${flowId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_gcs_only: true }),
      });
      const result = await response.json().catch(() => ({})) as {
        error?: string;
        is_gcs_only?: boolean;
      };
      if (!response.ok) {
        throw new Error(result.error ?? 'Could not update GCS-only mode');
      }

      useFlowStore.setState((state) => ({
        currentFlow: state.currentFlow
          ? {
              ...state.currentFlow,
              is_gcs_only: result.is_gcs_only ?? true,
              gcs_only_eligible: false,
            }
          : null,
      }));
      setShowGcsOnlyConfirm(false);
    } catch (error) {
      setGcsOnlyError(error instanceof Error ? error.message : 'Could not update GCS-only mode');
    } finally {
      setSavingGcsOnly(false);
    }
  }

  async function handleFlowsNavigation(event: React.MouseEvent<HTMLAnchorElement>) {
    if (!isDirty && !isSaving) return;
    event.preventDefault();
    if (useFlowStore.getState().isSaving) {
      await new Promise<void>((resolve) => {
        let unsubscribe = () => {};
        const timeoutId = window.setTimeout(() => {
          unsubscribe();
          resolve();
        }, 30_000);
        unsubscribe = useFlowStore.subscribe((state) => {
          if (state.isSaving) return;
          window.clearTimeout(timeoutId);
          unsubscribe();
          resolve();
        });
      });
    }

    if (useFlowStore.getState().isDirty && !(await onSave())) return;
    if (!useFlowStore.getState().isDirty) router.push('/dashboard/canvas-flow');
  }

  function handleShare() {
    if (!isShared && onToggleShare) onToggleShare();
    navigator.clipboard.writeText(window.location.href).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <div
        className="absolute top-4 left-4 right-4 z-10 flex items-center justify-between px-4 py-2.5 rounded-xl pointer-events-none"
        style={{
          background: 'var(--topbar-bg)',
          backdropFilter: 'blur(12px)',
          border: 'var(--border-default)',
          boxShadow: 'var(--shadow-node)',
        }}
      >
      {/* Left: breadcrumb */}
      <div className="flex items-center gap-2 pointer-events-auto">
        <Link
          href="/dashboard/canvas-flow"
          onClick={handleFlowsNavigation}
          className="flex items-center gap-1 text-sm transition-opacity hover:opacity-80"
          style={{ color: 'var(--color-white-muted)' }}
        >
          <span className="text-xs">⊞</span>
          Flows
        </Link>
        <ChevronRight size={12} style={{ color: 'var(--color-white-muted)' }} />
        {editingTitle ? (
          <input
            autoFocus
            value={titleValue}
            onChange={(e) => setTitleValue(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveTitle();
              if (e.key === 'Escape') setEditingTitle(false);
            }}
            className="text-sm font-medium bg-transparent outline-none border-b"
            style={{ color: 'var(--color-white)', borderColor: 'var(--color-accent)', minWidth: '120px' }}
          />
        ) : (
          <button
            onClick={startEditTitle}
            className="text-sm font-medium transition-opacity hover:opacity-80"
            style={{ color: 'var(--color-white)' }}
          >
            {currentFlow?.title ?? 'Untitled Flow'}
          </button>
        )}
        {isBaseFlow && (
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium"
            style={{ background: 'rgba(59,158,255,0.15)', color: 'var(--color-accent)' }}
          >
            <BookOpen size={9} />
            Base Flow
          </span>
        )}
        {isDirty && (
          <span className="text-xs" style={{ color: 'var(--color-white-muted)' }}>•</span>
        )}
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-2 pointer-events-auto">
        {isOwner && (
          <>
            <button className="p-1.5 rounded-lg transition-colors hover:bg-white/10 disabled:opacity-40" title="Undo" disabled>
              <RotateCcw size={14} style={{ color: 'var(--color-white-muted)' }} />
            </button>
            <button className="p-1.5 rounded-lg transition-colors hover:bg-white/10 disabled:opacity-40" title="Redo" disabled>
              <RotateCw size={14} style={{ color: 'var(--color-white-muted)' }} />
            </button>

            <div className="w-px h-4" style={{ background: 'var(--color-white-subtle)' }} />

            {isAdmin && isGcsOnly && (
              <div
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
                style={{
                  background: 'rgba(34,197,94,0.16)',
                  color: '#4ade80',
                  border: '1px solid rgba(74,222,128,0.35)',
                }}
                title="GCS-only mode is permanently enabled for this Flow"
              >
                <Lock size={12} />
                GCS only
              </div>
            )}

            {isAdmin && !isGcsOnly && canEnableGcsOnly && (
              <button
                type="button"
                onClick={() => {
                  setGcsOnlyError(null);
                  setShowGcsOnlyConfirm(true);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                style={{
                  color: 'var(--color-white-muted)',
                  border: 'var(--border-default)',
                }}
                title="Permanently keep this new Flow's Fal generations in Glide storage only"
              >
                <HardDrive size={12} />
                Enable GCS only
              </button>
            )}

            {/* Admin: Save as Base Flow toggle */}
            {isAdmin && (
              <button
                onClick={handleSaveAsBaseFlow}
                disabled={savingBase || isSaving}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-40"
                style={{
                  background: isBaseFlow ? 'rgba(59,158,255,0.2)' : 'transparent',
                  color: isBaseFlow ? 'var(--color-accent)' : 'var(--color-white-muted)',
                  border: 'var(--border-default)',
                }}
                title={isBaseFlow ? 'Remove from Base Flows' : 'Save as Base Flow (visible to all users)'}
              >
                <BookOpen size={12} />
                {isBaseFlow ? 'Base Flow ✓' : 'Make Base Flow'}
              </button>
            )}

            <button
              onClick={handleSave}
              disabled={!isDirty || isSaving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-40"
              style={{
                background: isDirty ? '#fff' : 'transparent',
                color: isDirty ? '#000' : 'var(--color-white-muted)',
                border: isDirty ? 'none' : 'var(--border-default)',
              }}
            >
              {isSaving ? <Cloud size={12} className="animate-pulse" /> : <UploadCloud size={12} />}
              {isSaving ? 'Saving...' : 'Save'}
            </button>
          </>
        )}

        <button
          onClick={handleShare}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
          style={{
            background: (isShared || copied) ? 'rgba(59,158,255,0.15)' : 'transparent',
            color: (isShared || copied) ? 'var(--color-accent)' : 'var(--color-white-muted)',
            border: 'var(--border-default)',
          }}
          title={isShared ? 'Link copied to clipboard' : 'Share this flow'}
        >
          {copied ? <Check size={12} /> : <Share2 size={12} />}
          {copied ? 'Copied!' : isShared ? 'Shared' : 'Share'}
        </button>
      </div>
      </div>

      {showGcsOnlyConfirm && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center p-4 pointer-events-auto"
          style={{ background: 'rgba(0,0,0,0.68)', backdropFilter: 'blur(4px)' }}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !savingGcsOnly) {
              setShowGcsOnlyConfirm(false);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="gcs-only-title"
            className="w-full max-w-md rounded-2xl p-5"
            style={{
              background: 'var(--color-bg-elevated)',
              border: 'var(--border-default)',
              boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
            }}
          >
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center mb-4"
              style={{ background: 'rgba(34,197,94,0.16)', color: '#4ade80' }}
            >
              <HardDrive size={19} />
            </div>
            <h2
              id="gcs-only-title"
              className="text-base font-semibold"
              style={{ color: 'var(--color-white)' }}
            >
              Enable GCS-only storage?
            </h2>
            <p
              className="mt-2 text-sm leading-6"
              style={{ color: 'var(--color-white-muted)' }}
            >
              Generations in this Flow will be stored only in Glide&apos;s cloud storage.
              Fal uses a temporary 60-second transfer URL, then removes the media from
              its CDN. This choice is permanent and cannot be changed later.
            </p>
            <p
              className="mt-3 text-xs leading-5"
              style={{ color: 'var(--color-white-muted)' }}
            >
              This must be enabled before the first Fal generation in this Flow.
            </p>

            {gcsOnlyError && (
              <p
                className="mt-3 text-xs"
                role="alert"
                style={{ color: 'var(--color-error)' }}
              >
                {gcsOnlyError}
              </p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowGcsOnlyConfirm(false)}
                disabled={savingGcsOnly}
                className="px-4 py-2 rounded-lg text-xs font-medium transition-opacity disabled:opacity-40"
                style={{
                  color: 'var(--color-white-muted)',
                  border: 'var(--border-default)',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleToggleGcsOnly}
                disabled={savingGcsOnly}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-opacity disabled:opacity-40"
                style={{ background: '#fff', color: '#000' }}
              >
                {savingGcsOnly && <Loader2 size={12} className="animate-spin" />}
                {savingGcsOnly ? 'Enabling…' : 'Accept and enable'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
