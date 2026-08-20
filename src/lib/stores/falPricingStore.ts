'use client';

import { create } from 'zustand';
import type { FalEndpointPrice } from '@/lib/falPricing';

type PricingStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

interface FalPricingStore {
  prices: Record<string, FalEndpointPrice>;
  status: PricingStatus;
  load: () => Promise<void>;
}

export const useFalPricingStore = create<FalPricingStore>((set, get) => ({
  prices: {},
  status: 'idle',
  load: async () => {
    if (get().status !== 'idle') return;
    set({ status: 'loading' });

    try {
      const response = await fetch('/api/fal/pricing');
      if (!response.ok) throw new Error(`Pricing request failed with status ${response.status}`);
      const payload = await response.json() as { prices?: Record<string, FalEndpointPrice> };
      set({ prices: payload.prices ?? {}, status: 'ready' });
    } catch {
      set({ prices: {}, status: 'unavailable' });
    }
  },
}));
