import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getFalEndpointPrices } from '@/lib/falPricingServer';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const falKey = process.env.FAL_KEY;
  if (!falKey) {
    console.error('[fal/pricing] FAL_KEY is not configured');
    return NextResponse.json({ prices: {} }, { status: 503 });
  }

  try {
    const prices = await getFalEndpointPrices();

    return NextResponse.json(
      { prices },
      { headers: { 'Cache-Control': 'private, max-age=300' } },
    );
  } catch (error) {
    console.error('[fal/pricing] Failed to load endpoint pricing:', error);
    return NextResponse.json({ prices: {} }, { status: 502 });
  }
}
