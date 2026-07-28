import 'server-only';

import { createAdminClient } from '@/lib/supabase/server';

// Fal's "immediate" lifecycle is a 60-second transfer window. The app copies
// completed output to GCS before that temporary Fal CDN object expires.
const IMMEDIATE_EXPIRATION_SECONDS = 60;

const GCS_ONLY_HEADERS = {
  'X-Fal-Object-Lifecycle-Preference': JSON.stringify({
    expiration_duration_seconds: IMMEDIATE_EXPIRATION_SECONDS,
  }),
  'X-Fal-Store-IO': '0',
} as const;

export async function getFalStorageHeaders({
  userId,
  sourceType,
  sourceId,
}: {
  userId: string;
  sourceType?: string;
  sourceId?: string;
}): Promise<Record<string, string> | undefined> {
  if (sourceType !== 'canvas' || !sourceId) return undefined;

  const admin = createAdminClient();

  // Atomically consume the one-time choice when the first Fal generation
  // starts without GCS-only mode. If activation wins the row race first, this
  // update matches nothing and the follow-up read returns the enabled mode.
  const { data: claimedFlow, error: claimError } = await admin
    .from('flows')
    .update({ gcs_only_eligible: false })
    .eq('id', sourceId)
    .eq('user_id', userId)
    .eq('is_gcs_only', false)
    .eq('gcs_only_eligible', true)
    .select('id')
    .maybeSingle();

  if (claimError) {
    console.error('[fal/storage] Could not claim Flow storage mode:', claimError.message);
    return undefined;
  }

  if (claimedFlow) return undefined;

  const { data: flow, error } = await admin
    .from('flows')
    .select('user_id, is_gcs_only')
    .eq('id', sourceId)
    .maybeSingle();

  if (error) {
    console.error('[fal/storage] Could not load Flow storage mode:', error.message);
    return undefined;
  }

  if (!flow || flow.user_id !== userId || !flow.is_gcs_only) return undefined;
  return GCS_ONLY_HEADERS;
}
