import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { notifyAdminsOfAccessRequest } from '@/lib/access-requests';

// POST /api/access-requests/notify — called by the pending page for the
// signed-in, not-yet-approved user. Safety net for the auth-callback trigger:
// de-duplicated per open request, so repeat visits don't spam admins.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('approved, display_name')
    .eq('id', user.id)
    .maybeSingle();

  if (profile?.approved) return NextResponse.json({ status: 'already_approved' });

  const { origin } = new URL(request.url);
  const result = await notifyAdminsOfAccessRequest({
    userId:        user.id,
    email:         user.email,
    displayName:   profile?.display_name ?? null,
    requestOrigin: origin,
  });

  // Don't leak admin addresses or internal error details to non-admins.
  const safe = result.status === 'sent' ? { status: 'sent' } : { status: result.status };
  return NextResponse.json(safe);
}
