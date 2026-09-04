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

export async function sendEmail(input: SendEmailInput): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from   = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    console.warn('[email] RESEND_API_KEY or EMAIL_FROM not set — skipping email:', input.subject);
    return false;
  }
  if (input.to.length === 0) {
    console.warn('[email] no recipients — skipping email:', input.subject);
    return false;
  }

  const res = await fetch('https://api.resend.com/emails', {
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

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`[email] Resend responded ${res.status}:`, body);
    return false;
  }

  return true;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
