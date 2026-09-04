'use client';

import { Suspense, useState } from 'react';
import NextImage from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

function LoginFormInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const errorParam = searchParams.get('error');
  const justApproved = searchParams.get('approved') === '1';
  // Optional same-origin path to return to after sign-in (e.g. an email approval link).
  const rawNext = searchParams.get('next');
  const nextPath =
    rawNext && rawNext.startsWith('/') && !rawNext.startsWith('//') && !rawNext.includes('\\')
      ? rawNext
      : null;

  const [email,        setEmail]        = useState('');
  const [password,     setPassword]     = useState('');
  const [error,        setError]        = useState<string | null>(null);
  const [loading,      setLoading]      = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);

  const bannerError =
    errorParam === 'domain'   ? 'Only @within.co accounts can access WITHIN Glide.' :
    errorParam === 'callback' ? 'Something went wrong during sign-in. Please try again.' :
    null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });

    if (authError) {
      setError('Invalid credentials. Please try again.');
      setLoading(false);
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from('profiles').select('approved').eq('id', user.id).single();
      if (!profile?.approved) { router.push('/pending'); return; }
    }

    router.push(nextPath ?? '/dashboard');
    router.refresh();
  }

  async function handleGoogleSignIn() {
    setOauthLoading(true);
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: nextPath
          ? `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`
          : `${window.location.origin}/auth/callback`,
      },
    });
  }

  return (
    <div className="w-full max-w-sm space-y-6">
      {/* Logo + heading */}
      <div>
        <div className="inline-flex w-11 h-11 rounded-xl mb-5 overflow-hidden">
          <NextImage src="/logo.png" alt="WITHIN Glide" width={44} height={44} className="w-11 h-11 object-cover" priority />
        </div>
        <h1 className="text-2xl font-semibold mb-1" style={{ color: 'var(--color-white)' }}>
          Login to your account
        </h1>
        <p className="text-sm" style={{ color: 'var(--color-white-muted)' }}>
          Enter your @within.co details to login.
        </p>
      </div>

      {/* Access approved banner (from the approval email link) */}
      {justApproved && !bannerError && (
        <div
          className="flex items-start gap-2 px-3 py-2.5 rounded-lg text-sm"
          style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)', color: '#4ade80' }}
        >
          <CheckCircle2 size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          Your access to Glide has been approved! Sign in with Google to get started.
        </div>
      )}

      {/* Domain / callback error banner */}
      {bannerError && (
        <div
          className="flex items-start gap-2 px-3 py-2.5 rounded-lg text-sm"
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171' }}
        >
          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          {bannerError}
        </div>
      )}

      {/* Google */}
      <button
        onClick={handleGoogleSignIn}
        disabled={oauthLoading || loading}
        className="w-full flex items-center justify-center gap-2.5 py-2.5 rounded-lg text-sm font-medium transition-opacity disabled:opacity-60 hover:opacity-90"
        style={{ background: 'var(--color-bg-elevated)', color: 'var(--color-white)', border: 'var(--border-default)' }}
      >
        <GoogleIcon />
        {oauthLoading ? 'Redirecting…' : 'Continue with Google'}
      </button>

      {/* Divider */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
        <span className="text-xs" style={{ color: 'var(--color-white-muted)' }}>or</span>
        <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
      </div>

      {/* Email + password */}
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-white-muted)' }}>
            Email Address
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@within.co"
            required
            className="w-full px-3 py-2.5 rounded-lg text-sm outline-none transition-all"
            style={{ background: 'var(--color-bg-elevated)', border: 'var(--border-default)', color: 'var(--color-white)' }}
            onFocus={(e) => (e.target.style.borderColor = 'var(--color-accent)')}
            onBlur={(e)  => (e.target.style.borderColor = '')}
          />
        </div>

        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-white-muted)' }}>
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            className="w-full px-3 py-2.5 rounded-lg text-sm outline-none transition-all"
            style={{ background: 'var(--color-bg-elevated)', border: 'var(--border-default)', color: 'var(--color-white)' }}
            onFocus={(e) => (e.target.style.borderColor = 'var(--color-accent)')}
            onBlur={(e)  => (e.target.style.borderColor = '')}
          />
        </div>

        {error && (
          <p className="text-xs" style={{ color: 'var(--color-error)' }}>{error}</p>
        )}

        <button
          type="submit"
          disabled={loading || oauthLoading}
          className="w-full py-2.5 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-60 hover:opacity-90 mt-1"
          style={{ background: '#fff', color: '#000' }}
        >
          {loading ? 'Signing in…' : 'Login'}
        </button>
      </form>
    </div>
  );
}

export function LoginForm() {
  return (
    <Suspense>
      <LoginFormInner />
    </Suspense>
  );
}
