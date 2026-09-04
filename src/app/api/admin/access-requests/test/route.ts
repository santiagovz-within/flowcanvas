import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAppUrl, __test__ } from '@/lib/access-requests';
import { sendEmail } from '@/lib/email';

// POST /api/admin/access-requests/test — send a sample admin-notification
// email to the calling admin so the Gmail SMTP setup can be verified in production.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single();
  if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { origin } = new URL(request.url);
  const baseUrl    = getAppUrl(origin);
  const approveUrl = `${baseUrl}/approve-access?token=TEST_TOKEN_NOT_VALID`;
  const usersUrl   = `${baseUrl}/dashboard/admin/users`;
  const requester  = { userId: 'test', email: 'new.person@within.co', displayName: 'New Person (test)' };

  const result = await sendEmail({
    to:      [user.email],
    subject: `[TEST] Access request: ${requester.email}`,
    replyTo: requester.email,
    html:    __test__.renderAccessRequestHtml({ ...requester, approveUrl, usersUrl }),
    text:    __test__.renderAccessRequestText({ ...requester, approveUrl, usersUrl }),
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json({ sent: true, to: user.email, id: result.id });
}
