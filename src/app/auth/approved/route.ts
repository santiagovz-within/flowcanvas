import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Target of the "Sign in to Glide" button in the approval email.
// A user who was approved while still signed in would otherwise be stuck on
// the pending screen, so clear any existing session and send them to login.
export async function GET(request: NextRequest) {
  const { origin } = new URL(request.url);

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) await supabase.auth.signOut();
  } catch (err) {
    console.error('[auth/approved] sign-out failed:', err);
  }

  return NextResponse.redirect(`${origin}/login?approved=1`);
}
