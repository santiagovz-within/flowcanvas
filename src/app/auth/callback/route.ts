import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

const ALLOWED_DOMAIN = 'within.co';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=no_code`);
  }

  const supabase = await createClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError) {
    console.error('[auth/callback] exchange error:', exchangeError.message);
    return NextResponse.redirect(`${origin}/login?error=callback`);
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) {
    return NextResponse.redirect(`${origin}/login?error=callback`);
  }

  // ── Domain check ───────────────────────────────────────────────────────────
  if (!user.email.endsWith(`@${ALLOWED_DOMAIN}`)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=domain`);
  }

  // ── Ensure profile row exists and has Google account details ───────────────
  // A database trigger may create the row first. New users remain unapproved
  // until an admin approves them.
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from('profiles')
    .select('id, approved, username, display_name')
    .eq('id', user.id)
    .maybeSingle();

  const username = user.email.split('@')[0].replace(/[^a-z0-9_]/gi, '_').toLowerCase();
  const metadataDisplayName =
    user.user_metadata?.full_name ?? user.user_metadata?.name ?? null;
  const googleDisplayName =
    typeof metadataDisplayName === 'string' &&
    metadataDisplayName.trim() &&
    metadataDisplayName.trim().toLowerCase() !== 'user'
      ? metadataDisplayName.trim()
      : null;

  if (!existing) {
    await admin.from('profiles').insert({
      id:           user.id,
      username,
      display_name: googleDisplayName,
      theme:        'dark',
      is_admin:     false,
      approved:     false,
    });
  } else {
    const updates: { username?: string; display_name?: string | null } = {};

    // A database trigger may create the profile first with this placeholder.
    // Replace only the default so user-chosen usernames remain untouched.
    if (existing.username === 'User') {
      updates.username = username;
    }
    if (existing.display_name === 'User') {
      // Clear the placeholder when Google has no full name so the UI falls
      // back to the corrected email-derived username.
      updates.display_name = googleDisplayName;
    } else if (!existing.display_name && googleDisplayName) {
      updates.display_name = googleDisplayName;
    }

    if (Object.keys(updates).length > 0) {
      await admin
        .from('profiles')
        .update(updates)
        .eq('id', user.id);
    }
  }

  // ── Route based on approval ────────────────────────────────────────────────
  const approved = existing?.approved ?? false;
  if (!approved) {
    return NextResponse.redirect(`${origin}/pending`);
  }

  return NextResponse.redirect(`${origin}/dashboard`);
}
