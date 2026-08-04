'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { NodeData, NodeType } from '@/types';

export type BackgroundGenerationKind =
  | 'image-generation'
  | 'video-generation';

export interface BackgroundGenerationRequest {
  requestId: string;
  endpoint: string;
  mediaType: 'image' | 'video';
  slotIndex: number;
  status: 'pending' | 'completed' | 'failed';
  mediaUrl?: string;
  errorMessage?: string;
  pollErrorCount?: number;
}

export interface BackgroundGenerationJob {
  id: string;
  flowId: string;
  flowTitle: string;
  nodeId: string;
  nodeType: NodeType;
  kind: BackgroundGenerationKind;
  phase: 'submitting' | 'processing' | 'saving';
  startedAt: number;
  slotCount: number;
  slots: Array<string | null>;
  failedSlots: number[];
  requests: BackgroundGenerationRequest[];
  submissionsComplete: boolean;
  imageHistory: string[][];
  videoHistory: string[];
  finalData?: Partial<NodeData>;
}

interface GenerationStore {
  jobs: Record<string, BackgroundGenerationJob>;
  startJob: (job: BackgroundGenerationJob) => void;
  patchJob: (jobId: string, updates: Partial<BackgroundGenerationJob>) => void;
  addRequest: (jobId: string, request: BackgroundGenerationRequest) => void;
  patchRequest: (
    jobId: string,
    requestId: string,
    updates: Partial<BackgroundGenerationRequest>,
  ) => void;
  removeJob: (jobId: string) => void;
}

export function generationJobId(flowId: string, nodeId: string): string {
  return `${flowId}:${nodeId}`;
}

export const useGenerationStore = create<GenerationStore>()(
  persist(
    (set) => ({
      jobs: {},
      startJob: (job) => set((state) => ({
        jobs: { ...state.jobs, [job.id]: job },
      })),
      patchJob: (jobId, updates) => set((state) => {
        const job = state.jobs[jobId];
        if (!job) return state;
        return {
          jobs: {
            ...state.jobs,
            [jobId]: { ...job, ...updates },
          },
        };
      }),
      addRequest: (jobId, request) => set((state) => {
        const job = state.jobs[jobId];
        if (!job) return state;
        const existingIndex = job.requests.findIndex(
          (candidate) => candidate.requestId === request.requestId,
        );
        const requests = [...job.requests];
        if (existingIndex >= 0) {
          requests[existingIndex] = { ...requests[existingIndex], ...request };
        } else {
          requests.push(request);
        }
        return {
          jobs: {
            ...state.jobs,
            [jobId]: { ...job, requests, phase: 'processing' },
          },
        };
      }),
      patchRequest: (jobId, requestId, updates) => set((state) => {
        const job = state.jobs[jobId];
        if (!job) return state;
        return {
          jobs: {
            ...state.jobs,
            [jobId]: {
              ...job,
              requests: job.requests.map((request) =>
                request.requestId === requestId
                  ? { ...request, ...updates }
                  : request
              ),
            },
          },
        };
      }),
      removeJob: (jobId) => set((state) => {
        if (!state.jobs[jobId]) return state;
        const jobs = { ...state.jobs };
        delete jobs[jobId];
        return { jobs };
      }),
    }),
    {
      name: 'canvas-flow-background-generations',
      storage: createJSONStorage(() => localStorage),
      version: 2,
      migrate: (persistedState, version) => {
        // Version 1 could retain terminal/saving jobs indefinitely. Clear
        // those entries once; genuinely active FAL jobs are recovered from
        // the server immediately after hydration.
        if (version < 2) return { jobs: {} } as GenerationStore;
        return persistedState as GenerationStore;
      },
      skipHydration: true,
    },
  ),
);
