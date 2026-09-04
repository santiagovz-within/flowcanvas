import { NextRequest, NextResponse, after } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { notifyUserApproved, resolveAccessRequestsForUser } from '@/lib/access-requests';

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

// PATCH /api/admin/users/[id] — update user (toggle admin, change display_name)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  const body = await request.json();
  const supabase = createAdminClient();

  const updates: Record<string, unknown> = {};
  if (typeof body.is_admin     === 'boolean') updates.is_admin     = body.is_admin;
  if (typeof body.is_test_user === 'boolean') updates.is_test_user = body.is_test_user;
  if (typeof body.approved     === 'boolean') updates.approved     = body.approved;
  if (typeof body.display_name === 'string')  updates.display_name = body.display_name;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  // Snapshot the previous approval state so we only email on a real transition.
  let wasApproved: boolean | null = null;
  if (updates.approved === true) {
    const { data: before } = await supabase
      .from('profiles').select('approved, display_name').eq('id', id).maybeSingle();
    wasApproved = before?.approved ?? null;
  }

  const { error } = await supabase.from('profiles').update(updates).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Approving from the panel also closes any pending email approval links and
  // tells the user they can sign in.
  if (updates.approved === true) {
    await resolveAccessRequestsForUser(id, admin.id, supabase);

    if (wasApproved === false) {
      const { origin } = new URL(request.url);
      after(async () => {
        const [{ data: authUser }, { data: profile }] = await Promise.all([
          supabase.auth.admin.getUserById(id),
          supabase.from('profiles').select('display_name').eq('id', id).maybeSingle(),
        ]);
        const email = authUser.user?.email;
        if (!email) return;
        await notifyUserApproved({ email, displayName: profile?.display_name ?? null, requestOrigin: origin });
      });
    }
  }

  return NextResponse.json({ success: true });
}

// DELETE /api/admin/users/[id] — delete user
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  if (id === admin.id) {
    return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { error } = await supabase.auth.admin.deleteUser(id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
