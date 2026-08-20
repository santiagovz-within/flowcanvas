import 'server-only';

import { ApiError, ValidationError, fal } from '@fal-ai/client';
import { getFalEndpointPrices } from '@/lib/falPricingServer';

const BILLABLE_UNITS_HEADER = 'x-fal-billable-units';
const REQUEST_ID_HEADER = 'x-fal-request-id';
const REQUEST_TIMEOUT_TYPE_HEADER = 'x-fal-request-timeout-type';
const RESULT_RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

fal.config({ credentials: process.env.FAL_KEY });

export interface FalResultWithBilling<T> {
  data: T;
  requestId: string;
  billableUnits: number | null;
}

export interface FalBillingColumns {
  fal_billable_units?: number;
  fal_unit_price_usd?: number;
  fal_cost_usd?: number;
}

interface FalBillingParameterMetadata {
  billableUnits?: number;
  unitPriceUsd?: number;
  costUsd?: number;
}

interface FalBillingPersistenceResult {
  error: unknown | null;
}

interface FalSubscribeOptions {
  input: Record<string, unknown>;
  headers?: Record<string, string>;
}

function parseBillableUnits(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const units = Number(value);
  return Number.isFinite(units) && units >= 0 ? units : null;
}

function errorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') return fallback;
  const message = (body as { message?: unknown }).message;
  return typeof message === 'string' && message.trim() ? message : fallback;
}

async function responseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) return response.json();
  return response.text();
}

/** Fetches a completed queue result without discarding Fal's billing headers. */
export async function fetchFalQueueResult<T>(
  responseUrl: string,
  fallbackRequestId: string,
): Promise<FalResultWithBilling<T>> {
  const falKey = process.env.FAL_KEY;
  if (!falKey) throw new Error('FAL_KEY is not configured');

  const url = new URL(responseUrl);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.fal.run')) {
    throw new Error('Fal returned an invalid result URL');
  }

  let response: Response | undefined;
  let networkError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      response = await fetch(url, {
        headers: {
          Authorization: `Key ${falKey}`,
          Accept: 'application/json',
        },
        cache: 'no-store',
      });
      networkError = undefined;
    } catch (error) {
      networkError = error;
      response = undefined;
    }

    const shouldRetry = !response || RESULT_RETRY_STATUSES.has(response.status);
    if (!shouldRetry || attempt === 3) break;
    await new Promise(resolve => setTimeout(resolve, 500 * (2 ** attempt)));
  }

  if (!response) throw networkError instanceof Error ? networkError : new Error('Fal result request failed');

  const body = await responseBody(response);
  const requestId = response.headers.get(REQUEST_ID_HEADER) || fallbackRequestId;
  if (!response.ok) {
    const ErrorType = response.status === 422 ? ValidationError : ApiError;
    throw new ErrorType({
      message: errorMessage(body, response.statusText),
      status: response.status,
      body,
      requestId,
      timeoutType: response.headers.get(REQUEST_TIMEOUT_TYPE_HEADER) || undefined,
    });
  }

  return {
    data: body as T,
    requestId,
    billableUnits: parseBillableUnits(response.headers.get(BILLABLE_UNITS_HEADER)),
  };
}

/** Queue-backed replacement for fal.subscribe that retains result headers. */
export async function subscribeToFalWithBilling<T>(
  endpoint: string,
  options: FalSubscribeOptions,
): Promise<FalResultWithBilling<T>> {
  const { request_id: requestId } = await fal.queue.submit(endpoint, options);
  const completed = await fal.queue.subscribeToStatus(endpoint, {
    requestId,
    logs: false,
  });
  return fetchFalQueueResult<T>(completed.response_url, requestId);
}

/** Converts measured billing units to the nullable generation columns. */
export async function getFalBillingColumns(
  endpoint: string,
  billableUnits: number | null,
): Promise<FalBillingColumns> {
  if (billableUnits === null) return {};

  const billing: FalBillingColumns = { fal_billable_units: billableUnits };
  try {
    const price = (await getFalEndpointPrices())[endpoint];
    if (!price || price.currency !== 'USD') return billing;
    billing.fal_unit_price_usd = price.unitPrice;
    billing.fal_cost_usd = billableUnits * price.unitPrice;
  } catch (error) {
    // A pricing outage must never turn a successful generation into a failure.
    console.error(`[fal/billing] Could not price ${endpoint}:`, error);
  }
  return billing;
}

/**
 * Persists optional billing metadata without putting the generation record at
 * risk. In particular, deployments where the billing migration has not run
 * yet must still save completed generations for the Gallery.
 */
export async function persistFalBillingBestEffort(
  billing: FalBillingColumns,
  persist: (columns: FalBillingColumns) => PromiseLike<FalBillingPersistenceResult>,
  context: string,
): Promise<void> {
  if (Object.keys(billing).length === 0) return;

  try {
    const { error } = await persist(billing);
    if (error) {
      console.error(`[fal/billing] Could not persist billing for ${context}:`, error);
    }
  } catch (error) {
    console.error(`[fal/billing] Could not persist billing for ${context}:`, error);
  }
}

/** Keeps measured billing data available even before the optional columns exist. */
export function mergeFalBillingParameters(
  parameters: unknown,
  billing: FalBillingColumns,
): Record<string, unknown> {
  const base = parameters && typeof parameters === 'object' && !Array.isArray(parameters)
    ? { ...parameters as Record<string, unknown> }
    : {};
  const falBilling: FalBillingParameterMetadata = {};

  if (billing.fal_billable_units !== undefined) {
    falBilling.billableUnits = billing.fal_billable_units;
  }
  if (billing.fal_unit_price_usd !== undefined) {
    falBilling.unitPriceUsd = billing.fal_unit_price_usd;
  }
  if (billing.fal_cost_usd !== undefined) {
    falBilling.costUsd = billing.fal_cost_usd;
  }

  return Object.keys(falBilling).length > 0
    ? { ...base, falBilling }
    : base;
}
