import { db, getSettings, addLeadEntry } from './db.js';
import { accessToken, mailAccounts } from './mail.js';
import { wallClock } from '../leads.js';

/**
 * Two-way email: every connected account that allowed reading mail is checked every couple of
 * minutes. Any email you sent to, or got from, a lead's email address goes on that lead's history,
 * whether you sent it from Gmail, your phone or Closer Desk. Nothing else in the mailbox is kept.
 *
 * The first check looks back 30 days; after that Gmail's history says what's new. Each email is
 * stored once per lead (gmail:<message id>), so emails sent from Closer Desk aren't doubled up.
 */

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const BACKFILL = 'newer_than:30d -in:chats -in:drafts -in:spam -in:trash';

async function gmail(email, path, query = {}) {
  const u = new URL(API + path);
  for (const [k, v] of Object.entries(query)) [].concat(v).forEach((x) => u.searchParams.append(k, String(x)));
  const r = await fetch(u, { headers: { authorization: `Bearer ${await accessToken(email)}` } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(`Gmail: ${j.error?.message || r.status}`);
    e.status = r.status;
    throw e;
  }
  return j;
}

const addrs = (v) => [...String(v || '').matchAll(/[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map((m) => m[0].toLowerCase());
const header = (msg, name) => msg.payload?.headers?.find((h) => h.name.toLowerCase() === name)?.value || '';
const b64 = (s) => Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

/** The readable body: the plain-text part, or the HTML one as text. Quoted earlier emails are cut. */
function bodyOf(msg) {
  let plain = '';
  let html = '';
  const walk = (p) => {
    if (!p) return;
    if (p.mimeType === 'text/plain' && p.body?.data && !plain) plain = b64(p.body.data);
    else if (p.mimeType === 'text/html' && p.body?.data && !html) html = b64(p.body.data);
    (p.parts || []).forEach(walk);
  };
  walk(msg.payload);
  let t =
    plain ||
    html
      .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"');
  t = t.replace(/\r\n/g, '\n');
  // the reply only, not the whole thread quoted underneath
  const cut = t.search(/\n\s*(On .{5,200}wrote:|-{2,}\s*Original Message|From: .+\n(Sent|Date): )/i);
  if (cut > 0) t = t.slice(0, cut);
  t = t
    .split('\n')
    .filter((l) => !/^\s*>/.test(l))
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return t || (msg.snippet || '').trim();
}

export const leadsByEmail = () => {
  const map = new Map();
  for (const l of db.prepare("SELECT id, offer_id, email FROM leads WHERE email IS NOT NULL AND email != ''").all())
    for (const e of addrs(l.email)) map.set(e, [...(map.get(e) || []), l]);
  return map;
};

/** The leads an email was with (by its headers), and whether you sent it. */
function match(account, msg, leads) {
  const labels = msg.labelIds || [];
  if (labels.some((l) => ['DRAFT', 'SPAM', 'TRASH', 'CHAT'].includes(l))) return { hits: [] };
  const me = account.toLowerCase();
  const from = addrs(header(msg, 'from'));
  const sent = labels.includes('SENT') || from.includes(me);
  const others = sent ? [...addrs(header(msg, 'to')), ...addrs(header(msg, 'cc')), ...addrs(header(msg, 'bcc'))] : from;
  return { sent, others, hits: [...new Set(others.filter((e) => e !== me))].flatMap((e) => leads.get(e) || []) };
}

/** Put one Gmail message on the history of every lead it was with. Returns how many it went on. */
export function file(account, msg, leads) {
  const { sent, others, hits } = match(account, msg, leads);
  if (!hits.length) return 0;
  const at = new Date(Number(msg.internalDate) || Date.parse(header(msg, 'date')) || Date.now()).toISOString();
  const { date, time } = wallClock(at, getSettings().timezone);
  const body = bodyOf(msg);
  const note = sent
    ? `${body}\n\nSent from ${account} to ${[...new Set(others)].join(', ')}`
    : `${body}\n\nFrom ${header(msg, 'from')} to ${account}`;
  let n = 0;
  const subject = (header(msg, 'subject') || '(no subject)').replace(/\s+/g, ' ').trim();
  for (const l of hits) {
    // already logged by hand, by Alfred or from a sheet (same subject within 10 minutes): link it, don't double it
    const same = db
      .prepare("SELECT id FROM lead_dials WHERE lead_id = ? AND channel = 'email' AND (ext_id IS NULL OR ext_id = '') AND subject = ? AND abs(julianday(at) - julianday(?)) < 10.0 / 1440 LIMIT 1")
      .get(l.id, subject, at);
    if (same) {
      db.prepare('UPDATE lead_dials SET ext_id = ? WHERE id = ?').run(`gmail:${msg.id}`, same.id);
      continue;
    }
    const r = addLeadEntry(l.offer_id, l.id, { date, time, channel: 'email', outcome: '', subject: header(msg, 'subject') || '(no subject)', note, extId: `gmail:${msg.id}` });
    if (!r || r.duplicateOf) continue;
    n++;
    if (!sent) db.prepare("UPDATE lead_dials SET label = 'Email received' WHERE lead_id = ? AND ext_id = ?").run(l.id, `gmail:${msg.id}`);
  }
  return n;
}

async function fileIds(account, ids, leads) {
  let filed = 0;
  for (const id of ids) {
    // already on a lead (e.g. sent from Closer Desk): skip the fetch
    if (db.prepare('SELECT 1 FROM lead_dials WHERE ext_id = ? LIMIT 1').get(`gmail:${id}`)) continue;
    try {
      // headers first; the whole email only when it's with a lead
      const meta = await gmail(account, `/messages/${id}`, { format: 'metadata', metadataHeaders: ['From', 'To', 'Cc', 'Bcc'] });
      if (!match(account, meta, leads).hits.length) continue;
      filed += file(account, await gmail(account, `/messages/${id}`, { format: 'full' }), leads);
    } catch (e) {
      if (e.status !== 404) throw e;
    }
  }
  return filed;
}

async function syncAccount(acct) {
  const leads = leadsByEmail();
  const row = db.prepare('SELECT history_id FROM mail_accounts WHERE email = ?').get(acct.email);
  let filed = 0;
  let start = row?.history_id || '';
  if (start) {
    try {
      let pageToken;
      const ids = [];
      let latest = start;
      do {
        const j = await gmail(acct.email, '/history', { startHistoryId: start, historyTypes: 'messageAdded', maxResults: 500, ...(pageToken ? { pageToken } : {}) });
        for (const h of j.history || []) for (const m of h.messagesAdded || []) ids.push(m.message.id);
        latest = j.historyId || latest;
        pageToken = j.nextPageToken;
      } while (pageToken);
      filed += await fileIds(acct.email, [...new Set(ids)], leads);
      db.prepare('UPDATE mail_accounts SET history_id = ? WHERE email = ?').run(String(latest), acct.email);
      return filed;
    } catch (e) {
      // too old for Gmail's history: look back again instead
      if (e.status !== 404) throw e;
      start = '';
    }
  }
  const profile = await gmail(acct.email, '/profile');
  let pageToken;
  let seen = 0;
  do {
    const j = await gmail(acct.email, '/messages', { q: BACKFILL, maxResults: 100, ...(pageToken ? { pageToken } : {}) });
    const ids = (j.messages || []).map((m) => m.id);
    seen += ids.length;
    filed += await fileIds(acct.email, ids, leads);
    pageToken = j.nextPageToken;
  } while (pageToken && seen < 1500);
  db.prepare('UPDATE mail_accounts SET history_id = ? WHERE email = ?').run(String(profile.historyId), acct.email);
  return filed;
}

let running = null;
/** Check every account that can be read. Returns { [email]: emails filed } (or the error). */
export function syncMail() {
  if (running) return running;
  running = (async () => {
    const out = {};
    for (const a of mailAccounts().filter((x) => x.canRead)) {
      try {
        out[a.email] = await syncAccount(a);
        db.prepare("UPDATE mail_accounts SET synced_at = ?, sync_error = '' WHERE email = ?").run(new Date().toISOString(), a.email);
      } catch (e) {
        out[a.email] = { error: e.message };
        db.prepare('UPDATE mail_accounts SET sync_error = ? WHERE email = ?').run(String(e.message).slice(0, 300), a.email);
      }
    }
    return out;
  })().finally(() => (running = null));
  return running;
}

let timer = null;
export function startMailSync() {
  if (timer || process.env.NO_SYNC) return;
  const tick = () => syncMail().catch((e) => console.error('[mail sync]', e));
  setTimeout(tick, 8000);
  timer = setInterval(tick, 2 * 60 * 1000);
  process.once('sveltekit:shutdown', () => clearInterval(timer));
}
