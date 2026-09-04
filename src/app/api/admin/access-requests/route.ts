import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { getAdminEmails, getAppUrl } from '@/lib/access-requests';
import { isEmailConfigured } from '@/lib/email';

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single();
  return profile?.is_admin ? user : null;
}

// GET /api/admin/access-requests — diagnostics for the access-request emails
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const supabase = createAdminClient();

  const { data: requests, error: tableError } = await supabase
    .from('access_requests')
    .select('id, email, created_at, expires_at, approved_at')
    .order('created_at', { ascending: false })
    .limit(20);

  const recipients = await getAdminEmails(supabase);

  return NextResponse.json({
    email: {
      configured:  isEmailConfigured(),
      hasApiKey:   Boolean(process.env.RESEND_API_KEY),
      from:        process.env.EMAIL_FROM ?? null,
      appUrl:      getAppUrl() || null,
    },
    table: {
      ok:    !tableError,
      error: tableError?.message ?? null,
    },
    recipients,
    requests: requests ?? [],
  });
}
