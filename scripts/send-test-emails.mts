// Renders both access-request emails and either sends them to a recipient
// (when GMAIL_USER + GMAIL_APP_PASSWORD are set) or writes HTML previews to
// .context/email-previews/ for review in a browser.
//
// Usage:
//   npx tsx scripts/send-test-emails.mts you@within.co [https://app-url]
//   GMAIL_USER=you@within.co GMAIL_APP_PASSWORD=xxxxxxxxxxxxxxxx \
//     npx tsx scripts/send-test-emails.mts you@within.co
//
// Does not touch the database: it uses a fake token and fake requester.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isEmailConfigured, sendEmail } from '../src/lib/email';
import { __test__ } from '../src/lib/access-requests';

const [to, baseUrlArg] = process.argv.slice(2);
if (!to) {
  console.error('Usage: npx tsx scripts/send-test-emails.mts <recipient> [baseUrl]');
  process.exit(1);
}

const baseUrl = (baseUrlArg ?? process.env.NEXT_PUBLIC_APP_URL ?? 'https://glide.within.co').replace(/\/+$/, '');
const approveUrl = `${baseUrl}/approve-access?token=TEST_TOKEN_NOT_VALID`;
const usersUrl   = `${baseUrl}/dashboard/admin/users`;
const loginUrl   = `${baseUrl}/auth/approved`;

const requester = { userId: 'test', email: 'new.person@within.co', displayName: 'New Person' };
const approved  = { email: to, displayName: 'Santiago' };

const emails = [
  {
    file:    'admin-access-request.html',
    subject: `[TEST] Access request: ${requester.email}`,
    replyTo: requester.email,
    html:    __test__.renderAccessRequestHtml({ ...requester, approveUrl, usersUrl }),
    text:    __test__.renderAccessRequestText({ ...requester, approveUrl, usersUrl }),
  },
  {
    file:    'user-access-approved.html',
    subject: '[TEST] Your access to Glide has been approved!',
    html:    __test__.renderApprovedHtml({ ...approved, loginUrl }),
    text:    __test__.renderApprovedText({ ...approved, loginUrl }),
  },
];

if (isEmailConfigured()) {
  for (const e of emails) {
    const r = await sendEmail({ to: [to], subject: e.subject, html: e.html, text: e.text, replyTo: e.replyTo });
    console.log(r.ok ? `sent    ${e.subject}  -> ${to}` : `FAILED  ${e.subject}: ${r.error}`);
  }
} else {
  const dir = resolve(process.cwd(), '.context/email-previews');
  mkdirSync(dir, { recursive: true });
  for (const e of emails) {
    const path = resolve(dir, e.file);
    writeFileSync(path, e.html);
    console.log(`preview  ${e.subject}\n         ${path}`);
  }
  console.log('\nGMAIL_USER / GMAIL_APP_PASSWORD not set — wrote previews instead of sending.');
}
