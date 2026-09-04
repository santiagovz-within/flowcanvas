// Transactional email via Gmail SMTP using a Google Workspace account and an
// app password. No third-party email provider involved: mail goes out through
// Google exactly as if sent from that mailbox.
//
// Required env:
//   GMAIL_USER          — the Google account that sends, e.g. santiago.vazquez@within.co
//   GMAIL_APP_PASSWORD  — 16-char app password for that account (needs 2-Step Verification)
// Optional:
//   EMAIL_FROM_NAME     — display name shown to recipients (default "WITHIN Glide")
//
// When credentials are missing, sendEmail() logs and returns an error result
// instead of throwing, so features that send email never break core flows.

import nodemailer from 'nodemailer';

export interface SendEmailInput {
  to: string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}

export type SendEmailResult = { ok: true; id: string | null } | { ok: false; error: string };

export function isEmailConfigured(): boolean {
  return Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

/** The From header recipients will see, e.g. "WITHIN Glide <santiago.vazquez@within.co>". */
export function getEmailFrom(): string | null {
  const user = process.env.GMAIL_USER;
  if (!user) return null;
  const name = process.env.EMAIL_FROM_NAME?.trim() || 'WITHIN Glide';
  return `${name} <${user}>`;
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;

  if (!user || !pass) {
    console.warn('[email] GMAIL_USER or GMAIL_APP_PASSWORD not set — skipping email:', input.subject);
    return { ok: false, error: 'GMAIL_USER or GMAIL_APP_PASSWORD is not set' };
  }
  if (input.to.length === 0) {
    console.warn('[email] no recipients — skipping email:', input.subject);
    return { ok: false, error: 'No recipients' };
  }

  const transport = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user, pass },
  });

  try {
    const info = await transport.sendMail({
      from: getEmailFrom() ?? user,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    });
    return { ok: true, id: info.messageId ?? null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[email] Gmail SMTP send failed:', msg);
    return { ok: false, error: `Gmail SMTP: ${msg}` };
  }
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
