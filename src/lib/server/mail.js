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
// what Google allowed when it was connected (send mail, and now calendar events too)
if (!db.prepare('PRAGMA table_info(mail_accounts)').all().some((c) => c.name === 'scopes')) db.exec("ALTER TABLE mail_accounts ADD COLUMN scopes TEXT NOT NULL DEFAULT ''");
const CAL_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
// read-only use: the signature you set in Gmail, so automatic emails can end with it
const SIG_SCOPE = 'https://www.googleapis.com/auth/gmail.settings.basic';
// reading mail, so emails with your leads show on their history (two-way email, mailSync.js)
const READ_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
for (const [col, def] of [['history_id', "''"], ['synced_at', "''"], ['sync_error', "''"]])
  if (!db.prepare('PRAGMA table_info(mail_accounts)').all().some((c) => c.name === col)) db.exec(`ALTER TABLE mail_accounts ADD COLUMN ${col} TEXT NOT NULL DEFAULT ${def}`);
if (!db.prepare('PRAGMA table_info(mail_accounts)').all().some((c) => c.name === 'signature')) db.exec("ALTER TABLE mail_accounts ADD COLUMN signature TEXT NOT NULL DEFAULT ''");

const env = process.env;
const redirect = () => env.GOOGLE_REDIRECT_URI || '';
export const mailReady = () => Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && redirect());

export const mailAccounts = () =>
  db.prepare('SELECT email, name, added_at, scopes, signature, synced_at, sync_error FROM mail_accounts ORDER BY added_at').all().map((r) => ({ email: r.email, name: r.name, addedAt: r.added_at, calendar: r.scopes.includes(CAL_SCOPE), signature: r.signature, canReadSignature: r.scopes.includes(SIG_SCOPE) || r.scopes.includes(READ_SCOPE), canRead: r.scopes.includes(READ_SCOPE), syncedAt: r.synced_at, syncError: r.sync_error }));
/** Accounts that also let Closer Desk put events on their calendar. */
export const calendarAccounts = () => mailAccounts().filter((a) => a.calendar);
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
    scope: `openid email profile https://www.googleapis.com/auth/gmail.send ${READ_SCOPE} ${CAL_SCOPE}`,
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
    `INSERT INTO mail_accounts(email, name, refresh_token, added_at, scopes) VALUES(?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET name = excluded.name, refresh_token = excluded.refresh_token, scopes = excluded.scopes`
  ).run(claims.email, claims.name || '', j.refresh_token, new Date().toISOString(), String(j.scope || ''));
  tokens.delete(claims.email.toLowerCase());
  if (String(j.scope || '').includes(SIG_SCOPE)) await refreshSignature(claims.email).catch((e) => console.error('[mail] signature', e.message));
  return { email: claims.email, name: claims.name || '', calendar: String(j.scope || '').includes(CAL_SCOPE) };
}

const tokens = new Map();
export async function accessToken(email) {
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

/** Copy the account's Gmail signature (HTML) into Closer Desk. Emails sent through the API don't get it otherwise. */
export async function refreshSignature(email) {
  const row = db.prepare('SELECT email, scopes FROM mail_accounts WHERE email = ?').get(email);
  if (!row) throw new Error(`${email} isn't connected`);
  if (!row.scopes.includes(SIG_SCOPE) && !row.scopes.includes(READ_SCOPE)) throw new Error(`Reconnect ${row.email} and allow it to see your Gmail settings, so the signature can be copied`);
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs/${encodeURIComponent(row.email)}`, { headers: { authorization: `Bearer ${await accessToken(row.email)}` } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Gmail: ${j.error?.message || r.status}`);
  const sig = cleanSignature(j.signature || '');
  db.prepare('UPDATE mail_accounts SET signature = ? WHERE email = ?').run(sig, row.email);
  return sig;
}
// ---- your signature, written in Closer Desk (Settings > Email accounts) ----

db.exec(`CREATE TABLE IF NOT EXISTS mail_images (id TEXT PRIMARY KEY, type TEXT NOT NULL, data BLOB NOT NULL, created_at TEXT NOT NULL)`);
const IMG_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
export const IMG_PATH = '/api/mail-images/';
/** Keep an image for signatures; returns the address the editor shows it at. */
export function saveImage(data, type) {
  if (!IMG_TYPES.includes(type)) throw new Error('Use a PNG, JPG, GIF or WebP image');
  if (data.length > 2_000_000) throw new Error('That image is over 2 MB. Use a smaller one.');
  const id = randomBytes(12).toString('hex');
  db.prepare('INSERT INTO mail_images(id, type, data, created_at) VALUES(?, ?, ?, ?)').run(id, type, data, new Date().toISOString());
  return IMG_PATH + id;
}
export const getImage = (id) => db.prepare('SELECT type, data FROM mail_images WHERE id = ?').get(String(id));

/**
 * Tidy a signature you wrote or pasted: no scripts, styles blocks, forms or event handlers; images
 * pasted straight in (data: addresses) are stored and linked so email clients show them.
 */
export function cleanSignature(html) {
  let s = String(html || '').slice(0, 300_000);
  s = s.replace(/<(script|style|iframe|object|embed|form|textarea|select|button|head|title|meta|link|base)\b[\s\S]*?(<\/\1\s*>|$)/gi, '');
  s = s.replace(/<\/?(script|style|iframe|object|embed|form|input|textarea|select|button|meta|link|base|html|body|head)\b[^>]*>/gi, '');
  s = s.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  s = s.replace(/(href|src)\s*=\s*(["']?)\s*(javascript|vbscript):[^"'>\s]*\2/gi, '$1=$2#$2');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/src\s*=\s*(["'])data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=\s]+)\1/gi, (m, q, type, b64) => {
    try {
      return `src=${q}${saveImage(Buffer.from(b64.replace(/\s+/g, ''), 'base64'), type.toLowerCase())}${q}`;
    } catch {
      return 'src=""';
    }
  });
  return s.trim().length > 100_000 ? s.trim().slice(0, 100_000) : s.trim();
}
/** A signature as plain text, for the text copy of an email. */
export const signatureText = (html) =>
  String(html || '')
    .replace(/<br\s*\/?>|<\/(div|p|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
export function setSignature(email, html) {
  const sig = cleanSignature(html);
  const r = db.prepare('UPDATE mail_accounts SET signature = ? WHERE email = ?').run(sig, String(email));
  if (!r.changes) throw new Error(`${email} isn't connected`);
  return sig;
}

export const signatureFor = (email) => db.prepare('SELECT signature FROM mail_accounts WHERE email = ?').get(String(email || ''))?.signature || '';

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
  const rel = `rel_${randomBytes(8).toString('hex')}`;
  // signature images stored here go inside the email (the CRM isn't reachable from the internet)
  const inline = [];
  html = String(html || '').replace(/(["'])(?:https?:\/\/[^"'\/]+)?\/api\/mail-images\/([a-f0-9]{24})\1/g, (m, q, id) => {
    const img = getImage(id);
    if (!img) return `${q}${q}`;
    let item = inline.find((x) => x.id === id);
    if (!item) inline.push((item = { id, cid: `sig-${id}@closerdesk`, ...img }));
    return `${q}cid:${item.cid}${q}`;
  });
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
    `Content-Type: multipart/related; boundary="${rel}"`,
    '',
    `--${rel}`,
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
  for (const im of inline) {
    const ext = im.type.split('/')[1].replace('jpeg', 'jpg');
    parts.push(`--${rel}`, `Content-Type: ${im.type}; name="image-${im.id.slice(0, 6)}.${ext}"`, `Content-ID: <${im.cid}>`, `Content-Disposition: inline; filename="image-${im.id.slice(0, 6)}.${ext}"`, 'Content-Transfer-Encoding: base64', '', b64lines(Buffer.from(im.data)));
  }
  parts.push(`--${rel}--`);
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
