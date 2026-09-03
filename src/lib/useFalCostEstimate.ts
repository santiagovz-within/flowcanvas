'use client';

import { useEffect } from 'react';
import { estimateFalCost, formatFalCostEstimate, type FalCostEstimateInput } from '@/lib/falPricing';
import { getFalPricingRule } from '@/lib/api/models';
import { useFalPricingStore } from '@/lib/stores/falPricingStore';

/** Estimated USD cost of the given Fal job(s), or null while unknown. */
export function useFalCostEstimateValue(
  input: FalCostEstimateInput | FalCostEstimateInput[] | null,
): number | null {
  const prices = useFalPricingStore(state => state.prices);
  const status = useFalPricingStore(state => state.status);
  const load = useFalPricingStore(state => state.load);

  useEffect(() => {
    void load();
  }, [load]);

  if (status !== 'ready' || !input) return null;
  const jobs = Array.isArray(input) ? input : [input];
  if (jobs.length === 0) return null;

  let total = 0;
  for (const job of jobs) {
    const estimate = estimateFalCost(
      prices[job.endpoint],
      getFalPricingRule(job.endpoint),
      job,
    );
    if (estimate === null) return null;
    total += estimate;
  }

  return total;
}

export function useFalCostEstimate(
  input: FalCostEstimateInput | FalCostEstimateInput[] | null,
): string | null {
  return formatFalCostEstimate(useFalCostEstimateValue(input));
}
