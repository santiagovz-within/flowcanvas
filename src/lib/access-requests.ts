// Access-request workflow.
//
// When an unapproved @within.co user signs in, we record an access request
// with a random single-use token and email every admin. The email contains an
// "Approve access" button that opens /approve-access?token=… in the app. That
// page requires a signed-in admin and, given a valid token, flips the
// requester's `profiles.approved` flag.
//
// Only a SHA-256 hash of the token is stored in the database.

import { createHash, randomBytes } from 'crypto';
import { createAdminClient } from '@/lib/supabase/server';
import { escapeHtml, isEmailConfigured, sendEmail } from '@/lib/email';

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

type AdminClient = ReturnType<typeof createAdminClient>;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Base URL used for links in emails. Prefers NEXT_PUBLIC_APP_URL, then the request origin. */
export function getAppUrl(fallbackOrigin?: string): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  return (configured || fallbackOrigin || '').replace(/\/+$/, '');
}

/** Only allow same-origin relative paths like "/approve-access?token=…". */
export function safeNextPath(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null;
  return value;
}

async function getAdminEmails(admin: AdminClient): Promise<string[]> {
  const { data: admins, error } = await admin
    .from('profiles')
    .select('id')
    .eq('is_admin', true);

  if (error) {
    console.error('[access-requests] failed to load admins:', error.message);
    return [];
  }

  const results = await Promise.all(
    (admins ?? []).map((a) => admin.auth.admin.getUserById(a.id))
  );

  return results
    .map((r) => r.data.user?.email)
    .filter((e): e is string => Boolean(e));
}

interface NotifyInput {
  userId: string;
  email: string;
  displayName?: string | null;
  /** Origin of the current request, used when NEXT_PUBLIC_APP_URL is unset. */
  requestOrigin?: string;
}

/**
 * Create an access request for `userId` (if there isn't an open one already)
 * and email every admin an approval link. Never throws.
 */
export async function notifyAdminsOfAccessRequest(input: NotifyInput): Promise<void> {
  try {
    if (!isEmailConfigured()) {
      console.warn('[access-requests] email not configured — admins not notified for', input.email);
      return;
    }

    const admin = createAdminClient();
    const nowIso = new Date().toISOString();

    // Skip if an open, unexpired request already exists — one email per request.
    const { data: open } = await admin
      .from('access_requests')
      .select('id')
      .eq('user_id', input.userId)
      .is('approved_at', null)
      .gt('expires_at', nowIso)
      .limit(1)
      .maybeSingle();
    if (open) return;

    const token     = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();

    const { data: created, error: insertError } = await admin
      .from('access_requests')
      .insert({
        user_id:    input.userId,
        email:      input.email,
        token_hash: hashToken(token),
        expires_at: expiresAt,
      })
      .select('id')
      .single();

    if (insertError || !created) {
      console.error('[access-requests] failed to create request:', insertError?.message);
      return;
    }

    const recipients = await getAdminEmails(admin);
    if (recipients.length === 0) {
      console.warn('[access-requests] no admin emails found — nobody to notify');
    }

    const baseUrl    = getAppUrl(input.requestOrigin);
    const approveUrl = `${baseUrl}/approve-access?token=${encodeURIComponent(token)}`;
    const usersUrl   = `${baseUrl}/dashboard/admin/users`;

    const sent = await sendEmail({
      to:      recipients,
      subject: `Access request: ${input.email}`,
      replyTo: input.email,
      html:    renderAccessRequestHtml({ ...input, approveUrl, usersUrl }),
      text:    renderAccessRequestText({ ...input, approveUrl, usersUrl }),
    });

    if (!sent) {
      // Drop the row so the next sign-in retries instead of waiting for expiry.
      await admin.from('access_requests').delete().eq('id', created.id);
    }
  } catch (err) {
    console.error('[access-requests] notify failed:', err);
  }
}

export type ApproveResult =
  | { status: 'invalid' }
  | { status: 'expired'; email: string }
  | { status: 'already_approved'; email: string }
  | { status: 'approved'; email: string; userId: string; displayName: string | null };

/** Approve the user behind `token`. Caller must have verified the actor is an admin. */
export async function approveAccessRequest(token: string, approverId: string): Promise<ApproveResult> {
  const admin = createAdminClient();

  const { data: request } = await admin
    .from('access_requests')
    .select('id, user_id, email, expires_at, approved_at')
    .eq('token_hash', hashToken(token))
    .maybeSingle();

  if (!request) return { status: 'invalid' };

  const { data: profile } = await admin
    .from('profiles')
    .select('approved, display_name')
    .eq('id', request.user_id)
    .maybeSingle();

  if (!profile) return { status: 'invalid' }; // user deleted
  if (request.approved_at || profile.approved) {
    return { status: 'already_approved', email: request.email };
  }
  if (new Date(request.expires_at).getTime() < Date.now()) {
    return { status: 'expired', email: request.email };
  }

  const { error } = await admin
    .from('profiles')
    .update({ approved: true })
    .eq('id', request.user_id);
  if (error) throw new Error(error.message);

  await resolveAccessRequestsForUser(request.user_id, approverId, admin);

  return {
    status: 'approved',
    email: request.email,
    userId: request.user_id,
    displayName: profile.display_name ?? null,
  };
}

/** Mark every open request for `userId` as approved (used by the admin panel too). */
export async function resolveAccessRequestsForUser(
  userId: string,
  approverId: string,
  client: AdminClient = createAdminClient()
): Promise<void> {
  const { error } = await client
    .from('access_requests')
    .update({ approved_at: new Date().toISOString(), approved_by: approverId })
    .eq('user_id', userId)
    .is('approved_at', null);
  if (error) console.error('[access-requests] failed to resolve requests:', error.message);
}

interface ApprovedInput {
  email: string;
  displayName?: string | null;
  requestOrigin?: string;
}

/**
 * Tell the requester their access was approved. The link goes through
 * /auth/approved, which signs out any stale session so they can log back in
 * with Google and land on the dashboard. Never throws.
 */
export async function notifyUserApproved(input: ApprovedInput): Promise<void> {
  try {
    if (!isEmailConfigured()) {
      console.warn('[access-requests] email not configured — approval email skipped for', input.email);
      return;
    }
    const baseUrl  = getAppUrl(input.requestOrigin);
    const loginUrl = `${baseUrl}/auth/approved`;
    await sendEmail({
      to:      [input.email],
      subject: 'Your access to Glide has been approved!',
      html:    renderApprovedHtml({ ...input, loginUrl }),
      text:    renderApprovedText({ ...input, loginUrl }),
    });
  } catch (err) {
    console.error('[access-requests] approval email failed:', err);
  }
}

// ── Email templates ──────────────────────────────────────────────────────────

interface TemplateInput extends NotifyInput {
  approveUrl: string;
  usersUrl: string;
}

function renderAccessRequestText(t: TemplateInput): string {
  const who = t.displayName ? `${t.displayName} (${t.email})` : t.email;
  return [
    `${who} is requesting access to WITHIN Glide.`,
    '',
    `Approve access: ${t.approveUrl}`,
    '',
    `Or manage users: ${t.usersUrl}`,
    '',
    'You received this because you are an admin of WITHIN Glide.',
  ].join('\n');
}

function renderAccessRequestHtml(t: TemplateInput): string {
  const name  = t.displayName ? escapeHtml(t.displayName) : null;
  const email = escapeHtml(t.email);
  const approveUrl = escapeHtml(t.approveUrl);
  const usersUrl   = escapeHtml(t.usersUrl);

  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#0b0b0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0b0f;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#15151c;border:1px solid #26262f;border-radius:16px;padding:32px;">
            <tr>
              <td style="color:#a78bfa;font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;padding-bottom:12px;">
                WITHIN Glide
              </td>
            </tr>
            <tr>
              <td style="color:#ffffff;font-size:20px;font-weight:600;padding-bottom:12px;">
                New access request
              </td>
            </tr>
            <tr>
              <td style="color:#b3b3c2;font-size:14px;line-height:1.6;padding-bottom:20px;">
                Someone signed in to WITHIN Glide and is waiting for approval.
              </td>
            </tr>
            <tr>
              <td style="padding-bottom:24px;">
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#0f0f14;border:1px solid #26262f;border-radius:10px;">
                  <tr>
                    <td style="padding:14px 16px;">
                      ${name ? `<div style="color:#ffffff;font-size:15px;font-weight:600;padding-bottom:4px;">${name}</div>` : ''}
                      <div style="color:#b3b3c2;font-size:14px;">${email}</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-bottom:20px;">
                <a href="${approveUrl}"
                   style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 28px;border-radius:10px;">
                  Approve access
                </a>
              </td>
            </tr>
            <tr>
              <td style="color:#7c7c8c;font-size:12px;line-height:1.6;">
                You&rsquo;ll be asked to sign in as an admin if you aren&rsquo;t already.
                Prefer to review first? <a href="${usersUrl}" style="color:#a78bfa;text-decoration:none;">Open User Management</a>.
              </td>
            </tr>
          </table>
          <div style="color:#5c5c6c;font-size:11px;padding-top:16px;">
            You received this because you are an admin of WITHIN Glide.
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

interface ApprovedTemplateInput extends ApprovedInput {
  loginUrl: string;
}

function renderApprovedText(t: ApprovedTemplateInput): string {
  const greeting = t.displayName ? `Hi ${t.displayName},` : 'Hi,';
  return [
    greeting,
    '',
    'Your access to WITHIN Glide has been approved!',
    '',
    `Sign in with your Google account to get started: ${t.loginUrl}`,
    '',
    'If you were already signed in, this link will sign you out first so you can log back in.',
  ].join('\n');
}

function renderApprovedHtml(t: ApprovedTemplateInput): string {
  const greeting = t.displayName ? `Hi ${escapeHtml(t.displayName)},` : 'Hi,';
  const loginUrl = escapeHtml(t.loginUrl);

  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#0b0b0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0b0f;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#15151c;border:1px solid #26262f;border-radius:16px;padding:32px;">
            <tr>
              <td style="color:#a78bfa;font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;padding-bottom:12px;">
                WITHIN Glide
              </td>
            </tr>
            <tr>
              <td style="color:#ffffff;font-size:20px;font-weight:600;padding-bottom:12px;">
                Your access to Glide has been approved!
              </td>
            </tr>
            <tr>
              <td style="color:#b3b3c2;font-size:14px;line-height:1.6;padding-bottom:24px;">
                ${greeting}<br><br>
                An admin has approved your account. Sign in with your Google account to start creating.
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-bottom:20px;">
                <a href="${loginUrl}"
                   style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 28px;border-radius:10px;">
                  Sign in to Glide
                </a>
              </td>
            </tr>
            <tr>
              <td style="color:#7c7c8c;font-size:12px;line-height:1.6;">
                If you were already signed in, this link signs you out first so you can log back in with Google.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** Template renderers exposed for scripts/send-test-emails.mts. Not for app code. */
export const __test__ = {
  renderAccessRequestHtml,
  renderAccessRequestText,
  renderApprovedHtml,
  renderApprovedText,
};
