'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { Clock, LogOut, Mail } from 'lucide-react';

export default function PendingPage() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { router.replace('/login'); return; }
      setEmail(user.email ?? null);

      // If an admin approved this account while the user was parked here,
      // clear the stale session and send them to log back in with Google.
      const { data: profile } = await supabase
        .from('profiles').select('approved').eq('id', user.id).maybeSingle();
      if (profile?.approved) {
        await supabase.auth.signOut();
        router.replace('/login?approved=1');
        return;
      }

      // Make sure admins were emailed. Safe to call on every visit: the server
      // sends at most one email per open request.
      try {
        const res = await fetch('/api/access-requests/notify', { method: 'POST' });
        const data = await res.json().catch(() => ({})) as { status?: string };
        setNotice(
          data.status === 'sent' || data.status === 'already_open'
            ? 'The admins have been notified by email.'
            : 'We couldn\u2019t email the admins automatically. Please reach out to one directly.'
        );
      } catch {
        setNotice(null);
      }
    });
  }, [router]);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: 'var(--color-bg-darkest)' }}
    >
      <div
        className="w-full max-w-sm p-8 rounded-2xl text-center space-y-6"
        style={{
          background: 'var(--color-bg-elevated)',
          border: 'var(--border-default)',
          boxShadow: 'var(--shadow-modal)',
        }}
      >
        {/* Icon */}
        <div className="flex justify-center">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.25)' }}
          >
            <Clock size={26} style={{ color: '#a78bfa' }} />
          </div>
        </div>

        {/* Message */}
        <div className="space-y-2">
          <h1 className="text-lg font-semibold" style={{ color: 'var(--color-white)' }}>
            Pending approval
          </h1>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--color-white-muted)' }}>
            Your account is waiting for an admin to approve access to WITHIN Glide.
            You&rsquo;ll be able to sign in once approved.
          </p>
          {notice && (
            <p className="text-xs" style={{ color: 'var(--color-white-subtle)' }}>{notice}</p>
          )}
        </div>

        {/* Email chip */}
        {email && (
          <div
            className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg"
            style={{ background: 'var(--color-bg-surface)', border: 'var(--border-default)' }}
          >
            <Mail size={13} style={{ color: 'var(--color-white-muted)', flexShrink: 0 }} />
            <span className="text-sm truncate" style={{ color: 'var(--color-white)' }}>
              {email}
            </span>
          </div>
        )}

        {/* Sign out */}
        <button
          onClick={handleSignOut}
          className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg text-sm font-medium transition-opacity hover:opacity-80"
          style={{ color: 'var(--color-error)', border: '1px solid var(--color-error)' }}
        >
          <LogOut size={15} />
          Sign Out
        </button>
      </div>
    </div>
  );
}
