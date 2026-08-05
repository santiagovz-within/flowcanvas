import { NextResponse } from 'next/server';
import type { createClient } from '@/lib/supabase/server';

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Marks a queued generation as failed and answers the poller with FAL's reason.
 *
 * Persisting matters as much as the response: a row left at `processing` keeps
 * coming back from /api/generations/pending, so recovery resurrects the request
 * every 15s and the node flips between "Generating" and "Failed" for two hours.
 */
export async function failGeneration(
  supabase: SupabaseServerClient,
  userId: string,
  requestId: string,
  message: string,
) {
  await supabase
    .from('generations')
    .update({ status: 'failed', error_message: message })
    .eq('fal_request_id', requestId)
    .eq('user_id', userId);
  return NextResponse.json({ status: 'failed', error: message, requestId });
}
