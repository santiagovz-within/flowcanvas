import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const FAL_BILLING_URL = 'https://api.fal.ai/v1/account/billing?expand=credits';

interface FalBillingResponse {
  credits?: {
    current_balance?: unknown;
    currency?: unknown;
  };
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const falAdminKey = process.env.FAL_ADMIN_KEY ?? process.env.FAL_KEY;
  if (!falAdminKey) {
    console.error('[fal/balance] FAL_ADMIN_KEY is not configured');
    return NextResponse.json({ error: 'Fal balance is unavailable' }, { status: 503 });
  }

  try {
    const response = await fetch(FAL_BILLING_URL, {
      headers: { Authorization: `Key ${falAdminKey}` },
      cache: 'no-store',
    });

    if (!response.ok) {
      console.error(`[fal/balance] Fal billing request failed with status ${response.status}`);
      return NextResponse.json({ error: 'Fal balance is unavailable' }, { status: 502 });
    }

    const payload = await response.json() as FalBillingResponse;
    const balance = payload.credits?.current_balance;
    const currency = payload.credits?.currency;

    if (
      typeof balance !== 'number'
      || !Number.isFinite(balance)
      || typeof currency !== 'string'
      || currency.length !== 3
    ) {
      console.error('[fal/balance] Fal billing response did not include a valid credit balance');
      return NextResponse.json({ error: 'Fal balance is unavailable' }, { status: 502 });
    }

    return NextResponse.json(
      { balance, currency: currency.toUpperCase() },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    console.error('[fal/balance] Failed to load Fal balance:', details);
    return NextResponse.json({ error: 'Fal balance is unavailable' }, { status: 502 });
  }
}
