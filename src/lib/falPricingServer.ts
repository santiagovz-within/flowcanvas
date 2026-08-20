import 'server-only';

import { getFalPricingEndpointIds } from '@/lib/api/models';
import type { FalEndpointPrice } from '@/lib/falPricing';

const FAL_PRICING_URL = 'https://api.fal.ai/v1/models/pricing';
const MAX_ENDPOINTS_PER_REQUEST = 50;
const PRICE_REVALIDATE_SECONDS = 15 * 60;

interface FalPricingResponse {
  prices?: Array<{
    endpoint_id?: unknown;
    unit_price?: unknown;
    unit?: unknown;
    currency?: unknown;
  }>;
}

function chunk<T>(values: T[], size: number): T[][] {
  return Array.from(
    { length: Math.ceil(values.length / size) },
    (_, index) => values.slice(index * size, (index + 1) * size),
  );
}

async function fetchPricingBatch(endpointIds: string[], falKey: string): Promise<FalEndpointPrice[]> {
  const url = new URL(FAL_PRICING_URL);
  for (const endpointId of endpointIds) url.searchParams.append('endpoint_id', endpointId);

  const response = await fetch(url, {
    headers: { Authorization: `Key ${falKey}` },
    next: { revalidate: PRICE_REVALIDATE_SECONDS },
  });

  if (!response.ok) {
    throw new Error(`Fal pricing request failed with status ${response.status}`);
  }

  const payload = await response.json() as FalPricingResponse;
  if (!Array.isArray(payload.prices)) return [];

  return payload.prices.flatMap((price) => {
    if (
      typeof price.endpoint_id !== 'string'
      || typeof price.unit_price !== 'number'
      || !Number.isFinite(price.unit_price)
      || price.unit_price <= 0
      || typeof price.unit !== 'string'
      || typeof price.currency !== 'string'
    ) {
      return [];
    }

    return [{
      endpointId: price.endpoint_id,
      unitPrice: price.unit_price,
      unit: price.unit,
      currency: price.currency,
    }];
  });
}

/** Shared server cache used by both estimates and completed-generation billing. */
export async function getFalEndpointPrices(): Promise<Record<string, FalEndpointPrice>> {
  const falKey = process.env.FAL_KEY;
  if (!falKey) throw new Error('FAL_KEY is not configured');

  const batches = chunk(getFalPricingEndpointIds(), MAX_ENDPOINTS_PER_REQUEST);
  const results = await Promise.all(batches.map(batch => fetchPricingBatch(batch, falKey)));
  return Object.fromEntries(results.flat().map(price => [price.endpointId, price]));
}
