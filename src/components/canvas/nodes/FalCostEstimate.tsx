'use client';

import { useFalCostEstimate } from '@/lib/useFalCostEstimate';
import type { FalCostEstimateInput } from '@/lib/falPricing';
import styles from './ImageGenerationGlass.module.css';

interface FalCostEstimateProps {
  input: FalCostEstimateInput | FalCostEstimateInput[] | null;
}

export default function FalCostEstimate({ input }: FalCostEstimateProps) {
  const estimate = useFalCostEstimate(input);
  if (!estimate) return null;
  return <span className={styles.costEstimate}>{estimate}</span>;
}
