// Minimal transactional email sender backed by the Resend HTTP API.
// Uses fetch directly so no SDK dependency is needed.
//
// Required env:
//   RESEND_API_KEY  — API key from https://resend.com
//   EMAIL_FROM      — verified sender, e.g. "WITHIN Glide <glide@within.co>"
//
// When RESEND_API_KEY is missing, sendEmail() logs and returns false instead
// of throwing, so features that send email never break core flows like login.

export interface SendEmailInput {
  to: string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export type SendEmailResult = { ok: true; id: string | null } | { ok: false; error: string };

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from   = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    console.warn('[email] RESEND_API_KEY or EMAIL_FROM not set — skipping email:', input.subject);
    return { ok: false, error: 'RESEND_API_KEY or EMAIL_FROM is not set' };
  }
  if (input.to.length === 0) {
    console.warn('[email] no recipients — skipping email:', input.subject);
    return { ok: false, error: 'No recipients' };
  }

  let res: Response;
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[email] Resend request failed:', msg);
    return { ok: false, error: `Network error reaching Resend: ${msg}` };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`[email] Resend responded ${res.status}:`, body);
    let detail = body;
    try { detail = (JSON.parse(body) as { message?: string }).message ?? body; } catch { /* keep raw */ }
    return { ok: false, error: `Resend ${res.status}: ${detail}` };
  }

  const data = await res.json().catch(() => null) as { id?: string } | null;
  return { ok: true, id: data?.id ?? null };
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
