import Link from 'next/link';
import { after } from 'next/server';
import { headers } from 'next/headers';
import { CheckCircle2, ShieldAlert, LogIn, AlertTriangle, UserCheck } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { approveAccessRequest, notifyUserApproved, type ApproveResult } from '@/lib/access-requests';

// Landing page for the "Approve access" button in the admin notification email.
// Requires a signed-in admin; with a valid token it approves the requester.
export const dynamic = 'force-dynamic';

type ViewState =
  | { kind: 'missing' }
  | { kind: 'signed_out'; loginHref: string }
  | { kind: 'not_admin' }
  | { kind: 'error' }
  | { kind: 'result'; result: ApproveResult };

async function getRequestOrigin(): Promise<string | undefined> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  if (!host) return undefined;
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

async function resolveState(token: string | undefined): Promise<ViewState> {
  if (!token) return { kind: 'missing' };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    const next = `/approve-access?token=${encodeURIComponent(token)}`;
    return { kind: 'signed_out', loginHref: `/login?next=${encodeURIComponent(next)}` };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single();

  if (!profile?.is_admin) return { kind: 'not_admin' };

  try {
    const result = await approveAccessRequest(token, user.id);
    if (result.status === 'approved') {
      const requestOrigin = await getRequestOrigin();
      const { email, displayName } = result;
      after(() => notifyUserApproved({ email, displayName, requestOrigin }));
    }
    return { kind: 'result', result };
  } catch (err) {
    console.error('[approve-access] failed:', err);
    return { kind: 'error' };
  }
}

export default async function ApproveAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { token } = await searchParams;
  const state = await resolveState(Array.isArray(token) ? token[0] : token);

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
        <Content state={state} />
      </div>
    </div>
  );
}

// ── Views ────────────────────────────────────────────────────────────────────

function Content({ state }: { state: ViewState }) {
  switch (state.kind) {
    case 'missing':
      return (
        <Panel icon={<AlertTriangle size={26} style={{ color: '#f87171' }} />} tone="error" title="Invalid link">
          <p>This approval link is missing its token. Open the link from the email again.</p>
          <DashboardLinks />
        </Panel>
      );

    case 'signed_out':
      return (
        <Panel icon={<LogIn size={26} style={{ color: '#a78bfa' }} />} tone="accent" title="Sign in to approve">
          <p>Sign in with your admin account and we&rsquo;ll bring you right back to approve this request.</p>
          <Link href={state.loginHref} className="block w-full py-2.5 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90"
            style={{ background: '#fff', color: '#000' }}>
            Continue to sign in
          </Link>
        </Panel>
      );

    case 'not_admin':
      return (
        <Panel icon={<ShieldAlert size={26} style={{ color: '#f87171' }} />} tone="error" title="Admins only">
          <p>Only WITHIN Glide admins can approve access requests.</p>
          <DashboardLinks />
        </Panel>
      );

    case 'error':
      return (
        <Panel icon={<AlertTriangle size={26} style={{ color: '#f87171' }} />} tone="error" title="Something went wrong">
          <p>We couldn&rsquo;t approve this request. Try again or approve the user from User Management.</p>
          <DashboardLinks />
        </Panel>
      );

    case 'result':
      return <ResultView result={state.result} />;
  }
}

function ResultView({ result }: { result: ApproveResult }) {
  switch (result.status) {
    case 'approved':
      return (
        <Panel icon={<CheckCircle2 size={26} style={{ color: '#4ade80' }} />} tone="success" title="Access granted">
          <p>
            <EmailChip email={result.email} /> can now sign in to WITHIN Glide.
          </p>
          <DashboardLinks />
        </Panel>
      );

    case 'already_approved':
      return (
        <Panel icon={<UserCheck size={26} style={{ color: '#4ade80' }} />} tone="success" title="Already approved">
          <p>
            <EmailChip email={result.email} /> already has access. Nothing else to do.
          </p>
          <DashboardLinks />
        </Panel>
      );

    case 'expired':
      return (
        <Panel icon={<AlertTriangle size={26} style={{ color: '#fbbf24' }} />} tone="warning" title="Link expired">
          <p>
            This approval link for <EmailChip email={result.email} /> has expired.
            You can still approve them from User Management.
          </p>
          <DashboardLinks />
        </Panel>
      );

    case 'invalid':
      return (
        <Panel icon={<AlertTriangle size={26} style={{ color: '#f87171' }} />} tone="error" title="Invalid link">
          <p>This approval link isn&rsquo;t valid. The request may have been removed, or the link was altered.</p>
          <DashboardLinks />
        </Panel>
      );
  }
}

// ── Building blocks ──────────────────────────────────────────────────────────

const TONES = {
  accent:  { bg: 'rgba(124,58,237,0.12)', border: 'rgba(124,58,237,0.25)' },
  success: { bg: 'rgba(34,197,94,0.12)',  border: 'rgba(34,197,94,0.25)' },
  warning: { bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.25)' },
  error:   { bg: 'rgba(239,68,68,0.12)',  border: 'rgba(239,68,68,0.25)' },
} as const;

function Panel({
  icon, tone, title, children,
}: {
  icon: React.ReactNode;
  tone: keyof typeof TONES;
  title: string;
  children: React.ReactNode;
}) {
  const t = TONES[tone];
  return (
    <>
      <div className="flex justify-center">
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center"
          style={{ background: t.bg, border: `1px solid ${t.border}` }}
        >
          {icon}
        </div>
      </div>
      <div className="space-y-4">
        <h1 className="text-lg font-semibold" style={{ color: 'var(--color-white)' }}>
          {title}
        </h1>
        <div className="text-sm leading-relaxed space-y-4" style={{ color: 'var(--color-white-muted)' }}>
          {children}
        </div>
      </div>
    </>
  );
}

function EmailChip({ email }: { email: string }) {
  return (
    <span
      className="inline-block px-2 py-0.5 rounded-md text-sm"
      style={{ background: 'var(--color-bg-surface)', border: 'var(--border-default)', color: 'var(--color-white)' }}
    >
      {email}
    </span>
  );
}

function DashboardLinks() {
  return (
    <div className="space-y-2 pt-1">
      <Link
        href="/dashboard/admin/users"
        className="block w-full py-2.5 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90"
        style={{ background: '#fff', color: '#000' }}
      >
        Open User Management
      </Link>
      <Link
        href="/dashboard"
        className="block w-full py-2.5 rounded-lg text-sm font-medium transition-opacity hover:opacity-80"
        style={{ color: 'var(--color-white)', border: 'var(--border-default)' }}
      >
        Go to dashboard
      </Link>
    </div>
  );
}
