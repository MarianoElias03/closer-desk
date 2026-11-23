import { randomBytes } from 'node:crypto';
import { db } from './db.js';

/**
 * Email accounts Closer Desk can send from (e.g. a work address separate from your calendar account).
 * Each is connected by signing in to Google once with permission to send mail only (gmail.send). The
 * refresh token stays in the database; nothing else about the mailbox is read.
 *
 * Connecting: Settings gives you a Google sign-in link. Google then sends you to the OAuth client's
 * registered return address, and you paste that address (it carries a one-time code) back into
 * Settings. GOOGLE_REDIRECT_URI must be a return address registered on the client.
 */

db.exec(`
CREATE TABLE IF NOT EXISTS mail_accounts (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  name TEXT NOT NULL DEFAULT '',
  refresh_token TEXT NOT NULL,
  added_at TEXT NOT NULL
);
`);

const env = process.env;
const redirect = () => env.GOOGLE_REDIRECT_URI || '';
export const mailReady = () => Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && redirect());

export const mailAccounts = () => db.prepare('SELECT email, name, added_at FROM mail_accounts ORDER BY added_at').all().map((r) => ({ email: r.email, name: r.name, addedAt: r.added_at }));
export const removeMailAccount = (email) => db.prepare('DELETE FROM mail_accounts WHERE email = ?').run(String(email)).changes;

// one-time "state" values so a pasted code is one we asked for (kept in memory for 15 minutes)
const states = new Map();

export function connectUrl(hint = '') {
  if (!mailReady()) throw new Error('Sending email needs GOOGLE_REDIRECT_URI on the server (the return address registered on your Google OAuth client)');
  const state = randomBytes(12).toString('hex');
  states.set(state, Date.now());
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirect(),
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'false',
    scope: 'openid email profile https://www.googleapis.com/auth/gmail.send',
    state,
    ...(hint ? { login_hint: hint } : {})
  });
  return u.toString();
}

/** Finish connecting: the pasted return address (or just the code). */
export async function finishConnect(pasted) {
  const raw = String(pasted || '').trim();
  let code = raw;
  let state = null;
  if (/^https?:\/\//.test(raw)) {
    const u = new URL(raw);
    code = u.searchParams.get('code') || '';
    state = u.searchParams.get('state');
    if (u.searchParams.get('error')) throw new Error(`Google said: ${u.searchParams.get('error')}`);
  }
  if (!code) throw new Error('Paste the whole address Google sent you to (it has code= in it)');
  if (state) {
    const at = states.get(state);
    if (!at || Date.now() - at > 15 * 60_000) throw new Error('That sign-in has expired. Start again.');
    states.delete(state);
  }
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, code, grant_type: 'authorization_code', redirect_uri: redirect() })
  });
  const j = await r.json().catch(() => ({}));
  if (!j.refresh_token) throw new Error(`Google didn't give access: ${j.error_description || j.error || 'no refresh token'}. Start again.`);
  if (!String(j.scope || '').includes('gmail.send')) throw new Error('Tick the "Send email on your behalf" box on the Google screen, then try again');
  const claims = JSON.parse(Buffer.from(String(j.id_token || '').split('.')[1] || '', 'base64url').toString() || '{}');
  if (!claims.email) throw new Error("Couldn't tell which account that was. Start again.");
  db.prepare(
    `INSERT INTO mail_accounts(email, name, refresh_token, added_at) VALUES(?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET name = excluded.name, refresh_token = excluded.refresh_token`
  ).run(claims.email, claims.name || '', j.refresh_token, new Date().toISOString());
  tokens.delete(claims.email.toLowerCase());
  return { email: claims.email, name: claims.name || '' };
}

const tokens = new Map();
async function accessToken(email) {
  const key = String(email).toLowerCase();
  const t = tokens.get(key);
  if (t && Date.now() < t.exp - 60_000) return t.value;
  const row = db.prepare('SELECT refresh_token FROM mail_accounts WHERE email = ?').get(email);
  if (!row) throw new Error(`${email} isn't connected. Connect it in Settings > Email accounts.`);
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: row.refresh_token, grant_type: 'refresh_token' })
  });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) throw new Error(`${email} needs connecting again (${j.error_description || j.error || r.status})`);
  tokens.set(key, { value: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 });
  return j.access_token;
}

// ---- building the message (MIME) ----

const crlf = (s) => s.replace(/\r?\n/g, '\r\n');
const b64lines = (buf) => buf.toString('base64').replace(/.{76}/g, '$&\r\n');
/** Header words with non-ASCII (names, em dashes) encoded so every mail client shows them. */
const word = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`);
const addr = (a) => (typeof a === 'string' ? a : a.name ? `${word(`"${a.name.replace(/"/g, '')}"`)} <${a.email}>` : a.email);

/**
 * Send an email from a connected account. to/cc: emails or { name, email }. html and text bodies;
 * attachments: [{ filename, type, data: Buffer }]. Returns Gmail's message id.
 */
export async function sendMail({ from, to, cc = [], subject, html, text, attachments = [] }) {
  const acct = db.prepare('SELECT email, name FROM mail_accounts WHERE email = ?').get(from);
  if (!acct) throw new Error(`${from} isn't connected. Connect it in Settings > Email accounts.`);
  const toList = [].concat(to).filter(Boolean);
  if (!toList.length) throw new Error('Add who it goes to');
  const mixed = `mix_${randomBytes(8).toString('hex')}`;
  const alt = `alt_${randomBytes(8).toString('hex')}`;
  const head = [
    `From: ${addr({ name: acct.name, email: acct.email })}`,
    `To: ${toList.map(addr).join(', ')}`,
    ...(cc.length ? [`Cc: ${cc.map(addr).join(', ')}`] : []),
    `Subject: ${word(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${mixed}"`
  ];
  const parts = [
    `--${mixed}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    '',
    `--${alt}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64lines(Buffer.from(crlf(text || ''))),
    `--${alt}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64lines(Buffer.from(html || '')),
    `--${alt}--`
  ];
  for (const a of attachments) {
    parts.push(
      `--${mixed}`,
      `Content-Type: ${a.type}; name="${a.filename}"`,
      `Content-Disposition: attachment; filename="${a.filename}"`,
      'Content-Transfer-Encoding: base64',
      '',
      b64lines(a.data)
    );
  }
  parts.push(`--${mixed}--`, '');
  const raw = Buffer.from([...head, '', ...parts].join('\r\n')).toString('base64url');
  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { authorization: `Bearer ${await accessToken(acct.email)}`, 'content-type': 'application/json' },
    body: JSON.stringify({ raw })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Gmail didn't send it: ${j.error?.message || r.status}`);
  return j.id;
}
