'use client';

import { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ReactFlowProvider } from '@xyflow/react';
import { FlowCanvas } from '@/components/canvas/FlowCanvas';
import { TopBar } from '@/components/layout/TopBar';
import { useFlowStore } from '@/lib/stores/flowStore';
import { createClient } from '@/lib/supabase/client';
import { AUTOSAVE_DEBOUNCE_MS } from '@/lib/utils/constants';
import { createFlowThumbnail, extractFlowThumbnailSource } from '@/lib/utils/flowThumbnail';
import {
  clearNewFlowDraft,
  isMarkedNewFlowDraft,
  shouldDiscardAbandonedFlow,
} from '@/lib/utils/flowPersistence';

export default function FlowEditorPage() {
  const params = useParams<{ flowId: string }>();
  const { flowId } = params;
  const router = useRouter();
  const {
    setCurrentFlow, nodes, edges,
    isDirty, isSaving, setDirty, setSaving, setLastSaved, currentFlow,
  } = useFlowStore();
  const supabase = useMemo(() => createClient(), []);
  const thumbnailAttempts = useRef({ sourceUrl: null as string | null, failures: 0 });
  const previousThumbnailSource = useRef<string | null | undefined>(undefined);
  const isNewFlowDraft = useRef(false);
  const hasLoadedFlow = useRef(false);
  const discardRequested = useRef(false);
  const latestNodes = useRef(nodes);
  const [isTestUser, setIsTestUser] = useState(false);
  const [isOwner, setIsOwner] = useState(true);
  const [isShared, setIsShared] = useState(false);
  const [isForking, setIsForking] = useState(false);

  const loadFlow = useCallback(async () => {
    const res = await fetch(`/api/flows/${flowId}`);
    if (!res.ok) {
      router.replace('/dashboard/canvas-flow');
      return;
    }
    const { data, isOwner: owner } = await res.json();
    if (data) {
      hasLoadedFlow.current = true;
      setCurrentFlow(data);
      setIsOwner(owner ?? true);
      setIsShared(data.is_shared ?? false);
      const loadedNodes = data.flow_data?.nodes ?? [];
      if ((owner ?? true) && !data.thumbnail_url && extractFlowThumbnailSource(loadedNodes)) {
        useFlowStore.getState().setDirty(true);
      }
    }
  }, [flowId, router, setCurrentFlow]);

  async function handleToggleShare() {
    const next = !isShared;
    setIsShared(next);
    await fetch(`/api/flows/${flowId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_shared: next }),
    });
  }

  async function handleFork() {
    setIsForking(true);
    try {
      const res = await fetch(`/api/flows/${flowId}/fork`, { method: 'POST' });
      if (!res.ok) return;
      const { flowId: forkedId } = await res.json();
      router.push(`/dashboard/canvas-flow/${forkedId}`);
    } finally {
      setIsForking(false);
    }
  }

  useEffect(() => {
    async function checkTestUser() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase
        .from('profiles')
        .select('is_test_user')
        .eq('id', user.id)
        .single();
      if (profile?.is_test_user) setIsTestUser(true);
    }
    checkTestUser();
  }, [supabase]);

  useEffect(() => {
    isNewFlowDraft.current = isMarkedNewFlowDraft(flowId);
    hasLoadedFlow.current = false;
    discardRequested.current = false;
  }, [flowId]);

  useEffect(() => {
    latestNodes.current = nodes;
  }, [nodes]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => { void loadFlow(); }, 0);
    return () => {
      window.clearTimeout(timeoutId);
      setCurrentFlow(null);
    };
  }, [loadFlow, setCurrentFlow]);

  const saveFlow = useCallback(async (): Promise<boolean> => {
    const snapshot = useFlowStore.getState();
    if (!snapshot.currentFlow || !snapshot.isDirty || snapshot.isSaving || !isOwner) return false;

    const snapshotNodes = snapshot.nodes;
    const snapshotEdges = snapshot.edges;
    const thumbnailSource = extractFlowThumbnailSource(snapshotNodes);
    if (thumbnailAttempts.current.sourceUrl !== thumbnailSource) {
      thumbnailAttempts.current = { sourceUrl: thumbnailSource, failures: 0 };
    }

    setSaving(true);
    let thumbnailRef: string | null = null;
    try {
      if (thumbnailSource) {
        try {
          thumbnailRef = await createFlowThumbnail(snapshotNodes, flowId);
          thumbnailAttempts.current.failures = 0;
        } catch (error) {
          thumbnailAttempts.current.failures += 1;
          console.error('[CanvasFlow] Thumbnail generation failed:', error);
        }
      }

      const { error } = await supabase
        .from('flows')
        .update({
          flow_data: {
            nodes: snapshotNodes.map((node) => ({
              id: node.id,
              type: node.type,
              position: node.position,
              data: node.data,
              parentId: node.parentId,
              style: node.style,
            })),
            edges: snapshotEdges,
            viewport: { x: 0, y: 0, zoom: 1 },
          },
          ...(!thumbnailSource
            ? { thumbnail_url: null }
            : thumbnailRef
              ? { thumbnail_url: thumbnailRef }
              : {}),
          updated_at: new Date().toISOString(),
        })
        .eq('id', flowId);
      if (error) throw error;

      if (thumbnailRef || !thumbnailSource) {
        useFlowStore.setState((state) => ({
          currentFlow: state.currentFlow
            ? { ...state.currentFlow, thumbnail_url: thumbnailRef ?? null }
            : null,
        }));
      }

      if (
        isNewFlowDraft.current
        && !shouldDiscardAbandonedFlow(snapshotNodes)
      ) {
        clearNewFlowDraft(flowId);
        isNewFlowDraft.current = false;
      }

      const latest = useFlowStore.getState();
      const snapshotIsCurrent = latest.nodes === snapshotNodes && latest.edges === snapshotEdges;
      const shouldRetryThumbnail = !!thumbnailSource
        && !thumbnailRef
        && thumbnailAttempts.current.failures < 3;
      if (snapshotIsCurrent && !shouldRetryThumbnail) setDirty(false);
      setLastSaved(new Date());
      return snapshotIsCurrent && !shouldRetryThumbnail;
    } catch (error) {
      console.error('[CanvasFlow] Save failed:', error);
      return false;
    } finally {
      setSaving(false);
    }
  }, [flowId, isOwner, setDirty, setLastSaved, setSaving, supabase]);

  // Promote a draft as soon as it gains real content or a second node. The
  // marker is cleared by saveFlow only after that content reaches the database.
  useEffect(() => {
    if (
      !currentFlow
      || !hasLoadedFlow.current
      || !isNewFlowDraft.current
      || shouldDiscardAbandonedFlow(nodes)
      || !isDirty
      || isSaving
    ) {
      return;
    }

    const timer = window.setTimeout(() => { void saveFlow(); }, 0);
    return () => window.clearTimeout(timer);
  }, [currentFlow, isDirty, isSaving, nodes, saveFlow]);

  const discardAbandonedFlow = useCallback(async (
    keepalive = false,
  ): Promise<'discarded' | 'keep' | 'failed'> => {
    if (
      !hasLoadedFlow.current
      || !isNewFlowDraft.current
      || !isMarkedNewFlowDraft(flowId)
      || !shouldDiscardAbandonedFlow(latestNodes.current)
    ) {
      return 'keep';
    }
    if (discardRequested.current) return 'failed';

    discardRequested.current = true;
    try {
      const response = await fetch(`/api/flows/${flowId}`, {
        method: 'DELETE',
        keepalive,
      });

      if (response.ok || response.status === 404) {
        clearNewFlowDraft(flowId);
        isNewFlowDraft.current = false;
        return 'discarded';
      }

      // The server is the final guard against a stale client deleting content.
      if (response.status === 409) {
        clearNewFlowDraft(flowId);
        isNewFlowDraft.current = false;
        return 'keep';
      }

      console.error(`[CanvasFlow] Failed to discard abandoned flow (${response.status})`);
      discardRequested.current = false;
      return 'failed';
    } catch (error) {
      console.error('[CanvasFlow] Failed to discard abandoned flow:', error);
      discardRequested.current = false;
      return 'failed';
    }
  }, [flowId]);

  const prepareToExit = useCallback(async (): Promise<boolean> => {
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

    const discardResult = await discardAbandonedFlow();
    if (discardResult === 'discarded') return true;
    if (discardResult === 'failed') return false;

    const snapshot = useFlowStore.getState();
    if (snapshot.isDirty && !(await saveFlow())) return false;
    return !useFlowStore.getState().isDirty;
  }, [discardAbandonedFlow, saveFlow]);

  // Cover browser back/refresh, closing the tab, and navigation through the
  // surrounding dashboard rather than the editor breadcrumb.
  useEffect(() => {
    const handlePageHide = () => {
      void discardAbandonedFlow(true);
    };

    window.addEventListener('pagehide', handlePageHide);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      void discardAbandonedFlow(true);
    };
  }, [discardAbandonedFlow]);

  const thumbnailSource = extractFlowThumbnailSource(nodes);

  // Persist new image outputs immediately so route changes cannot cancel the debounce.
  useEffect(() => {
    if (!currentFlow) return;
    const sourceChanged = previousThumbnailSource.current !== undefined
      && previousThumbnailSource.current !== thumbnailSource;
    const needsRepair = !currentFlow.thumbnail_url && !!thumbnailSource;

    // Keep the previous source while a save is active so a newer output is
    // detected and persisted as soon as that older save finishes.
    if (isSaving) return;
    previousThumbnailSource.current = thumbnailSource;
    if (!isDirty || (!sourceChanged && !needsRepair)) return;
    const timer = window.setTimeout(() => { void saveFlow(); }, 0);
    return () => window.clearTimeout(timer);
  }, [currentFlow, isDirty, isSaving, saveFlow, thumbnailSource]);

  // Auto-save debounced — also extracts and saves thumbnail.
  useEffect(() => {
    if (!isDirty || !currentFlow || !isOwner || isSaving) return;
    const timer = window.setTimeout(() => { void saveFlow(); }, AUTOSAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [currentFlow, edges, isDirty, isOwner, isSaving, nodes, saveFlow]);

  // Ctrl+S
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (isDirty) void saveFlow();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isDirty, saveFlow]);

  return (
    <ReactFlowProvider>
      <div className="relative w-full h-full">
        <TopBar
          flowId={flowId}
          isOwner={isOwner}
          isShared={isShared}
          onToggleShare={handleToggleShare}
          onSave={saveFlow}
          onExit={prepareToExit}
        />

        {/* Banner shown to non-owners viewing a shared flow */}
        {!isOwner && (
          <div
            className="absolute top-20 left-1/2 -translate-x-1/2 z-10 flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm pointer-events-auto"
            style={{
              background: 'var(--color-bg-elevated)',
              border: 'var(--border-default)',
              boxShadow: 'var(--shadow-node)',
            }}
          >
            <span style={{ color: 'var(--color-white-muted)' }}>
              Viewing <span style={{ color: 'var(--color-white)' }}>{currentFlow?.title ?? 'this flow'}</span>
            </span>
            <div className="w-px h-4" style={{ background: 'var(--color-white-subtle)' }} />
            <button
              onClick={handleFork}
              disabled={isForking}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-all disabled:opacity-50"
              style={{ background: 'var(--color-accent)', color: '#fff' }}
            >
              {isForking ? 'Forking...' : 'Fork to my workspace'}
            </button>
          </div>
        )}

        <FlowCanvas isTestUser={isTestUser} readOnly={!isOwner} />
      </div>
    </ReactFlowProvider>
  );
}
