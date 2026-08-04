'use client';

import { useEffect } from 'react';
import { useFlowStore } from '@/lib/stores/flowStore';
import { useGenerationStore } from '@/lib/stores/generationStore';
import {
  progressBackgroundGenerations,
  recoverBackgroundGenerations,
  syncJobToCurrentFlow,
} from '@/lib/generationTracker';

const POLL_INTERVAL_MS = 3_000;
const RECOVERY_INTERVAL_MS = 15_000;

export function BackgroundGenerationManager() {
  const jobs = useGenerationStore((state) => state.jobs);
  const currentFlowId = useFlowStore((state) => state.currentFlow?.id);
  const nodeCount = useFlowStore((state) => state.nodes.length);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve(useGenerationStore.persist.rehydrate()).then(() => {
      if (cancelled) return;
      void recoverBackgroundGenerations();
      void progressBackgroundGenerations();
    });

    const pollTimer = window.setInterval(() => {
      void progressBackgroundGenerations();
    }, POLL_INTERVAL_MS);
    const recoveryTimer = window.setInterval(() => {
      void recoverBackgroundGenerations();
    }, RECOVERY_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      void recoverBackgroundGenerations();
      void progressBackgroundGenerations();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      cancelled = true;
      window.clearInterval(pollTimer);
      window.clearInterval(recoveryTimer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (!currentFlowId || nodeCount === 0) return;
    Object.values(jobs)
      .filter((job) => job.flowId === currentFlowId)
      .forEach(syncJobToCurrentFlow);
  }, [currentFlowId, jobs, nodeCount]);

  return null;
}
