import { db, getSettings, getOffer, logActivity, actor } from './db.js';
import { sendMail, signatureFor, signatureText } from './mail.js';

/**
 * Automations: when something happens to a lead (an outcome is logged, a call is booked, a call is
 * coming up, a call gets an outcome, a lead is added), wait, then send them an email from one of the
 * connected accounts. SMS is a channel in the data model but has no sender yet: it needs a phone
 * integration, and until then SMS automations can't be switched on.
 *
 * How it stays safe:
 * - Triggers are found by scanning the tables every minute (so changes made by Alfred over MCP, the
 *   Android app or the browser all count). Each automation keeps cursors (the last dial, lead and
 *   call it has looked at), set to "now" when it's switched on, so switching one on never emails
 *   anyone for things that happened before.
 * - Every send is a row in automation_runs, unique per automation and event, so nothing is queued
 *   twice. A run is claimed (queued -> sending) before the email goes, so it can only go once. A run
 *   still "sending" after a restart is marked failed and never retried, since it may have gone.
 * - Everything is checked again when the run is due: still switched on, lead still there, not opted
 *   out of email, still has an email, the trigger still holds (dial not undone, call not cancelled
 *   or moved), conditions still pass.
 */

db.exec(`
CREATE TABLE IF NOT EXISTS automations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offer_id INTEGER REFERENCES offers(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 0,
  channel TEXT NOT NULL DEFAULT 'email',
  trigger TEXT NOT NULL,
  trigger_value TEXT NOT NULL DEFAULT '',
  wait_minutes INTEGER NOT NULL DEFAULT 0,
  conditions TEXT NOT NULL DEFAULT '{}',
  from_email TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  dial_cursor INTEGER NOT NULL DEFAULT 0,
  lead_cursor INTEGER NOT NULL DEFAULT 0,
  call_cursor INTEGER NOT NULL DEFAULT 0,
  since_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS automation_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  automation_id INTEGER NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  event_key TEXT NOT NULL,
  lead_id INTEGER,
  call_id TEXT,
  dial_id INTEGER,
  call_start TEXT,
  due_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  reason TEXT NOT NULL DEFAULT '',
  to_email TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  message_id TEXT,
  created_at TEXT NOT NULL,
  done_at TEXT,
  UNIQUE(automation_id, event_key)
);
CREATE INDEX IF NOT EXISTS automation_runs_due ON automation_runs(status, due_at);
`);

export const CHANNELS = [
  { key: 'email', label: 'Email', ready: true },
  { key: 'sms', label: 'SMS', ready: false, note: 'Needs a phone integration' }
];

export const TRIGGERS = [
  { key: 'outcome', label: 'A lead outcome is logged', values: [['no_answer', 'No answer'], ['not_interested', 'Not interested'], ['callback', 'Callback'], ['booked', 'Booked'], ['wrong_no', 'Wrong number'], ['contacted', 'Contacted (DM)'], ['converted', 'Converted (DM)'], ['not_converted', 'Not converted (DM)']] },
  { key: 'call_booked', label: 'A call is booked' },
  { key: 'before_call', label: 'Before a booked call' },
  { key: 'call_outcome', label: 'A booked call gets an outcome', values: [['no_show', 'No show'], ['closed', 'Closed'], ['not_interested', 'Not interested'], ['callback', 'Callback'], ['unqualified', 'Unqualified']] },
  { key: 'lead_added', label: 'A lead is added' }
];
const TRIGGER_KEYS = TRIGGERS.map((t) => t.key);
const valueLabel = (trigger, v) => TRIGGERS.find((t) => t.key === trigger)?.values?.find(([k]) => k === v)?.[1] || v;

export const PLACEHOLDERS = [
  ['{firstName}', "First name (or \"there\")"],
  ['{contact}', 'Full name (or the business)'],
  ['{business}', 'Business (or the name)'],
  ['{callTime}', 'Booked call time'],
  ['{joinLink}', 'Link to join the call'],
  ['{offer}', 'Offer name'],
  ['{myName}', 'Name on the sending account'],
  ['{signature}', 'Your signature for the sending account (Settings > Email accounts)']
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const nowIso = () => new Date().toISOString();
const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));

// ---------- reading and saving ----------

function shape(r) {
  if (!r) return null;
  let conditions = {};
  try {
    conditions = JSON.parse(r.conditions || '{}');
  } catch {}
  return {
    id: r.id,
    offerId: r.offer_id,
    name: r.name,
    enabled: !!r.enabled,
    channel: r.channel,
    trigger: r.trigger,
    triggerValue: r.trigger_value,
    waitMinutes: r.wait_minutes,
    conditions,
    fromEmail: r.from_email,
    subject: r.subject,
    body: r.body,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

export const getAutomation = (id) => shape(db.prepare('SELECT * FROM automations WHERE id = ?').get(Number(id)));

const shapeRun = (r) => ({ id: r.id, leadId: r.lead_id, callId: r.call_id, dueAt: r.due_at, status: r.status, reason: r.reason, to: r.to_email, subject: r.subject, createdAt: r.created_at, doneAt: r.done_at, who: r.who || '' });

export function listAutomations() {
  const rows = db.prepare('SELECT * FROM automations ORDER BY id').all().map(shape);
  const runs = db.prepare(
    `SELECT r.*, COALESCE(NULLIF(l.contact, ''), NULLIF(l.business, ''), c.prospect, '') AS who
     FROM automation_runs r LEFT JOIN leads l ON l.id = r.lead_id LEFT JOIN calls c ON c.id = r.call_id
     WHERE r.automation_id = ? ORDER BY CASE r.status WHEN 'queued' THEN 0 WHEN 'sending' THEN 0 ELSE 1 END, COALESCE(r.done_at, r.due_at) DESC LIMIT 25`
  );
  const counts = db.prepare('SELECT status, COUNT(*) n FROM automation_runs WHERE automation_id = ? GROUP BY status');
  return rows.map((a) => ({ ...a, runs: runs.all(a.id).map(shapeRun), counts: Object.fromEntries(counts.all(a.id).map((c) => [c.status, c.n])) }));
}

function clean(o) {
  const trigger = TRIGGER_KEYS.includes(o.trigger) ? o.trigger : null;
  if (!trigger) throw new Error('Pick what starts it');
  const t = TRIGGERS.find((x) => x.key === trigger);
  const triggerValue = t.values ? String(o.triggerValue || '') : '';
  if (t.values && !t.values.some(([k]) => k === triggerValue)) throw new Error('Pick which outcome starts it');
  const channel = CHANNELS.some((c) => c.key === o.channel) ? o.channel : 'email';
  const offerId = o.offerId == null || o.offerId === '' ? null : Number(o.offerId);
  if (offerId != null && !getOffer(offerId)) throw new Error('That offer is gone');
  const c = o.conditions || {};
  const conditions = {
    stopOnNewer: c.stopOnNewer !== false,
    category: String(c.category || '').trim().slice(0, 80),
    reason: String(c.reason || '').trim().slice(0, 80)
  };
  return {
    offer_id: offerId,
    name: String(o.name || '').trim().slice(0, 120),
    channel,
    trigger,
    trigger_value: triggerValue,
    // before a call: up to 14 days; after: up to 60 days
    wait_minutes: clampInt(o.waitMinutes, 0, trigger === 'before_call' ? 14 * 1440 : 60 * 1440),
    conditions: JSON.stringify(conditions),
    from_email: String(o.fromEmail || '').trim().slice(0, 160),
    subject: String(o.subject || '').replace(/\s+/g, ' ').trim().slice(0, 300),
    body: String(o.body || '').replace(/\r\n/g, '\n').slice(0, 20000)
  };
}

function canEnable(f) {
  const ch = CHANNELS.find((c) => c.key === f.channel);
  if (!ch.ready) return `${ch.label} automations need a phone integration first`;
  if (!f.from_email) return 'Pick the account it sends from';
  if (!db.prepare('SELECT 1 FROM mail_accounts WHERE email = ?').get(f.from_email)) return `${f.from_email} isn't connected any more. Connect it in Settings.`;
  if (!f.subject) return 'Add a subject';
  if (!f.body.trim()) return 'Write the email';
  return null;
}

/** Cursors at "now": from here on, only new dials, leads and calls count. */
function armSql() {
  return {
    dial_cursor: db.prepare('SELECT COALESCE(MAX(id), 0) n FROM lead_dials').get().n,
    lead_cursor: db.prepare('SELECT COALESCE(MAX(id), 0) n FROM leads').get().n,
    call_cursor: db.prepare('SELECT COALESCE(MAX(rowid), 0) n FROM calls').get().n,
    since_at: nowIso()
  };
}

export function saveAutomation(o) {
  const f = clean(o);
  const wantOn = !!o.enabled;
  if (wantOn) {
    const why = canEnable(f);
    if (why) throw new Error(why);
  }
  const now = nowIso();
  return db.transaction(() => {
    if (o.id) {
      const cur = db.prepare('SELECT * FROM automations WHERE id = ?').get(Number(o.id));
      if (!cur) throw new Error('That automation is gone');
      // a different trigger starts from now, so it never picks up older events
      const rearm = (wantOn && !cur.enabled) || (wantOn && (cur.trigger !== f.trigger || cur.trigger_value !== f.trigger_value || cur.offer_id !== f.offer_id)) ? armSql() : {};
      const sets = { ...f, ...rearm, enabled: wantOn ? 1 : 0, updated_at: now };
      db.prepare(`UPDATE automations SET ${Object.keys(sets).map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...sets, id: cur.id });
      if (!wantOn && cur.enabled) skipQueued(cur.id, 'Switched off before it was due');
      else if (rearm.since_at && cur.enabled) skipQueued(cur.id, 'The trigger changed before it was due');
      return getAutomation(cur.id);
    }
    const row = { ...f, ...armSql(), enabled: wantOn ? 1 : 0, created_at: now, updated_at: now };
    const id = db.prepare(`INSERT INTO automations(${Object.keys(row).join(', ')}) VALUES(${Object.keys(row).map((k) => '@' + k).join(', ')})`).run(row).lastInsertRowid;
    return getAutomation(id);
  })();
}

export function setEnabled(id, on) {
  const cur = getAutomation(id);
  if (!cur) throw new Error('That automation is gone');
  return saveAutomation({ ...cur, enabled: on });
}

export function deleteAutomation(id) {
  return db.prepare('DELETE FROM automations WHERE id = ?').run(Number(id)).changes;
}

function skipQueued(automationId, reason) {
  db.prepare("UPDATE automation_runs SET status = 'skipped', reason = ?, done_at = ? WHERE automation_id = ? AND status = 'queued'").run(reason, nowIso(), automationId);
}

export function cancelRun(runId) {
  return db.prepare("UPDATE automation_runs SET status = 'skipped', reason = 'Cancelled by you', done_at = ? WHERE id = ? AND status = 'queued'").run(nowIso(), Number(runId)).changes;
}

// ---------- the people it goes to ----------

function leadRow(id) {
  return id ? db.prepare('SELECT * FROM leads WHERE id = ?').get(Number(id)) : null;
}
function callRow(id) {
  return id ? db.prepare('SELECT * FROM calls WHERE id = ?').get(String(id)) : null;
}
const optedOut = (lead) => String(lead?.dnc || '').split(',').map((s) => s.trim()).includes('email');
/** A call with no lead: if any lead with that email opted out of email, it counts for this person too. */
const emailOptedOut = (email) =>
  !!email && db.prepare("SELECT 1 FROM leads WHERE email = ? COLLATE NOCASE AND (',' || dnc || ',') LIKE '%,email,%' LIMIT 1").get(email);

function callWhen(iso) {
  return new Intl.DateTimeFormat('en-AU', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', timeZone: getSettings().timezone }).format(new Date(iso));
}

/** Everything the placeholders can say about this person. */
function context(a, { lead, call }) {
  const c = call || (lead?.call_id ? callRow(lead.call_id) : null);
  const liveCall = c && c.status !== 'cancelled' ? c : null;
  const contact = (lead?.contact || c?.prospect || '').trim();
  const business = (lead?.business || '').trim();
  const acct = a.fromEmail ? db.prepare('SELECT name FROM mail_accounts WHERE email = ?').get(a.fromEmail) : null;
  const offerId = lead?.offer_id ?? c?.offer_id ?? a.offerId;
  return {
    to: (lead?.email || '').trim() || (c?.email || '').trim(),
    values: {
      firstName: contact.split(/\s+/)[0] || 'there',
      contact: contact || business || 'there',
      business: business || contact || 'your business',
      callTime: liveCall ? `${callWhen(liveCall.start)} (${getSettings().timezone.split('/').pop().replace(/_/g, ' ')} time)` : '',
      joinLink: liveCall?.join_url || '',
      offer: getOffer(offerId)?.name || '',
      myName: acct?.name || '',
      signature: SIG_MARK
    }
  };
}

const used = (text, key) => text.includes(`{${key}}`);
export function fill(text, values) {
  return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (k in values ? values[k] : m));
}
const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// [words](https://link) becomes a link; bare links are linked too. The signature goes in as Gmail has it.
export const MD_LINK = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;
export const SIG_MARK = '%%SIGNATURE%%';
export function toHtml(text, signature = "") {
  const links = [];
  const body = escHtml(String(text).replace(MD_LINK, (m, t, u) => `%%LINK${links.push([t, u]) - 1}%%`))
    .replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)]/g, (u) => `<a href="${u}" style="color:#2563c9">${u}</a>`)
    .replace(/%%LINK(\d+)%%/g, (m, n) => `<a href="${escHtml(links[n][1])}" style="color:#2563c9">${escHtml(links[n][0])}</a>`)
    .replace(/\n/g, '<br>')
    .replace(SIG_MARK, signature ? `<div>${signature}</div>` : '');
  return `<!doctype html><html><body style="margin:0;padding:24px 16px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1a2433"><div style="max-width:600px">${body}</div></body></html>`;
}
const textOf = signatureText;

/**
 * Build the message for this person, or say why it can't go. Used for the preview and for the
 * real send, so what you preview is what goes.
 */
export function compose(a, target) {
  const { to, values } = context(a, target);
  const lead = target.lead;
  const tpl = `${a.subject}\n${a.body}`;
  let skip = null;
  if (lead && optedOut(lead)) skip = 'Asked not to be emailed';
  else if (!lead && emailOptedOut(to)) skip = 'Asked not to be emailed';
  else if (!to) skip = 'No email address';
  else if (!EMAIL_RE.test(to)) skip = `Email address doesn't look right (${to})`;
  else if (used(tpl, 'callTime') && !values.callTime) skip = 'Uses {callTime} but there is no booked call';
  else if (used(tpl, 'joinLink') && !values.joinLink) skip = 'Uses {joinLink} but the call has no join link';
  const unknown = [...new Set([...tpl.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((k) => !(k in values)))];
  if (!skip && unknown.length) skip = `Unknown placeholder ${unknown.map((k) => `{${k}}`).join(', ')}`;
  const sig = signatureFor(a.fromEmail);
  const subject = fill(a.subject, { ...values, signature: '' }).replace(/\s+/g, ' ').trim();
  const marked = fill(a.body, values).trim();
  // the plain-text copy: links as "words (link)", the signature as text (or just your name)
  const text = marked.replace(MD_LINK, '$1 ($2)').replace(SIG_MARK, sig ? textOf(sig) : values.myName).trim();
  return { to, subject, text, html: toHtml(marked, sig || escHtml(values.myName)), skip, values: { ...values, signature: sig ? 'yes' : '' }, noSignature: used(tpl, 'signature') && !sig };
}

/**
 * Send this automation's email once to one lead now, as a test (subject starts with [Test]). A lead
 * without a booked call gets an example one (two days out) so {callTime} and {joinLink} fill in.
 */
export async function sendTest(a, leadId) {
  const draft = { ...a, conditions: a.conditions || {} };
  if (!draft.fromEmail) throw new Error('Pick the account it sends from');
  const lead = leadRow(leadId);
  if (!lead) throw new Error('Pick a lead to send the test to');
  const call = lead.call_id ? callRow(lead.call_id) : null;
  const example = { start: new Date(Date.now() + 2 * 864e5).toISOString(), join_url: 'https://zoom.us/j/123456789', status: 'confirmed', offer_id: lead.offer_id };
  const msg = compose(draft, { lead, call: call && call.status !== 'cancelled' ? call : example });
  if (msg.skip) throw new Error(`It wouldn't send: ${msg.skip}`);
  msg.subject = `[Test] ${msg.subject}`;
  const id = await deliver(draft, msg);
  actor.run('Automations', () => logActivity(lead.id, 'mail', `Test automatic email sent: ${msg.subject}`, { detail: `To ${msg.to} from ${draft.fromEmail}\n\n${msg.text}` }));
  return { to: msg.to, subject: msg.subject, id, exampleCall: !call, noSignature: !!msg.noSignature };
}

// ---------- conditions ----------

function conditionSkip(a, { lead, dial }) {
  const c = a.conditions || {};
  if (c.category && !(lead?.category || '').toLowerCase().includes(c.category.toLowerCase())) return `Category isn't "${c.category}"`;
  if (c.reason && dial && (dial.reason || '').toLowerCase() !== c.reason.toLowerCase()) return `Reason isn't "${c.reason}"`;
  return null;
}
const offerOk = (a, offerId) => a.offerId == null || a.offerId === offerId;

// ---------- finding what's happened (every tick) ----------

const insertRun = db.prepare(
  `INSERT OR IGNORE INTO automation_runs(automation_id, event_key, lead_id, call_id, dial_id, call_start, due_at, status, reason, created_at, done_at)
   VALUES(@automation_id, @event_key, @lead_id, @call_id, @dial_id, @call_start, @due_at, @status, @reason, @now, @done_at)`
);
function queue(a, ev) {
  const now = nowIso();
  insertRun.run({ automation_id: a.id, lead_id: null, call_id: null, dial_id: null, call_start: null, status: 'queued', reason: '', done_at: null, now, ...ev });
}
const addMinutes = (iso, m) => new Date(Date.parse(iso) + m * 60000).toISOString();

function scan(a) {
  const raw = db.prepare('SELECT * FROM automations WHERE id = ?').get(a.id);
  const now = nowIso();
  if (a.trigger === 'outcome') {
    // dials logged after it was switched on, by id (dials can be dated for another day). History
    // that came in on an import (no date, a label) is never a trigger.
    const rows = db
      .prepare("SELECT d.*, l.offer_id AS l_offer FROM lead_dials d JOIN leads l ON l.id = d.lead_id WHERE d.id > ? AND d.date IS NOT NULL AND d.label = '' ORDER BY d.id")
      .all(raw.dial_cursor);
    for (const d of rows) if (d.outcome === a.triggerValue && offerOk(a, d.l_offer)) queue(a, { event_key: `dial:${d.id}`, lead_id: d.lead_id, dial_id: d.id, due_at: addMinutes(now, a.waitMinutes) });
    if (rows.length) db.prepare('UPDATE automations SET dial_cursor = ? WHERE id = ?').run(rows.at(-1).id, a.id);
  } else if (a.trigger === 'lead_added') {
    // added by hand, the dialler or Alfred; a spreadsheet import never emails a whole list
    const rows = db.prepare('SELECT * FROM leads WHERE id > ? ORDER BY id').all(raw.lead_cursor);
    const imported = db.prepare("SELECT 1 FROM lead_activity WHERE lead_id = ? AND kind = 'import' LIMIT 1");
    for (const l of rows) if (offerOk(a, l.offer_id) && !imported.get(l.id)) queue(a, { event_key: `lead:${l.id}`, lead_id: l.id, due_at: addMinutes(l.created_at > now ? l.created_at : now, a.waitMinutes) });
    if (rows.length) db.prepare('UPDATE automations SET lead_cursor = ? WHERE id = ?').run(rows.at(-1).id, a.id);
  } else if (a.trigger === 'call_booked') {
    const rows = db.prepare("SELECT rowid AS rid, * FROM calls WHERE rowid > ? ORDER BY rowid").all(raw.call_cursor);
    for (const c of rows) {
      if (c.status === 'cancelled' || !offerOk(a, c.offer_id) || c.start < now) continue;
      queue(a, { event_key: `booked:${c.id}`, call_id: c.id, call_start: c.start, due_at: addMinutes(now, a.waitMinutes) });
    }
    if (rows.length) db.prepare('UPDATE automations SET call_cursor = ? WHERE id = ?').run(rows.at(-1).rid, a.id);
  } else if (a.trigger === 'before_call') {
    // every upcoming call; a move updates the queued run, and a call booked too late is noted as skipped
    const rows = db.prepare("SELECT * FROM calls WHERE status != 'cancelled' AND start > ?").all(now);
    const existing = db.prepare('SELECT * FROM automation_runs WHERE automation_id = ? AND event_key = ?');
    for (const c of rows) {
      if (!offerOk(a, c.offer_id)) continue;
      const key = `before:${c.id}`;
      const due = addMinutes(c.start, -a.waitMinutes);
      const run = existing.get(a.id, key);
      if (!run) {
        // more than 15 minutes late: it was booked (or this was switched on) inside the window
        const late = Date.parse(due) < Date.now() - 15 * 60000;
        queue(a, { event_key: key, call_id: c.id, call_start: c.start, due_at: due, ...(late ? { status: 'skipped', reason: `Booked less than ${waitWords(a.waitMinutes)} before the call`, done_at: now } : {}) });
      } else if (run.status === 'queued' && run.call_start !== c.start) {
        db.prepare('UPDATE automation_runs SET call_start = ?, due_at = ? WHERE id = ?').run(c.start, due, run.id);
      }
    }
  } else if (a.trigger === 'call_outcome') {
    const rows = db.prepare('SELECT * FROM calls WHERE outcome = ? AND updated_at >= ?').all(a.triggerValue, raw.since_at || now);
    for (const c of rows) if (offerOk(a, c.offer_id)) queue(a, { event_key: `outcome:${c.id}:${a.triggerValue}`, call_id: c.id, call_start: c.start, due_at: addMinutes(c.updated_at, a.waitMinutes) });
  }
}

export function waitWords(m) {
  if (!m) return 'no time';
  if (m % 1440 === 0) return `${m / 1440} day${m === 1440 ? '' : 's'}`;
  if (m % 60 === 0) return `${m / 60} hour${m === 60 ? '' : 's'}`;
  return `${m} minute${m === 1 ? '' : 's'}`;
}

// ---------- sending what's due ----------

/** The lead a call belongs to (linked from the lead, or the call's lead_id). */
const leadForCall = (callId) => db.prepare('SELECT * FROM leads WHERE call_id = ? LIMIT 1').get(callId) || null;

/** Is the reason it was queued still true? Returns why not, or null. */
function triggerSkip(a, run, { lead, call, dial }) {
  if (run.dial_id && !dial) return 'The outcome was undone';
  if (run.lead_id && !lead) return 'The lead was deleted';
  if (a.trigger === 'outcome' && a.conditions?.stopOnNewer !== false) {
    const newer = db.prepare('SELECT outcome FROM lead_dials WHERE lead_id = ? AND id > ? AND outcome IS NOT NULL ORDER BY id DESC LIMIT 1').get(run.lead_id, run.dial_id);
    if (newer) return `A newer outcome was logged (${valueLabel('outcome', newer.outcome)})`;
  }
  if (run.call_id) {
    if (!call) return 'The call was removed';
    if (call.status === 'cancelled') return 'The call was cancelled';
    if (a.trigger === 'before_call') {
      if (call.start !== run.call_start) return 'The call moved';
      if (Date.parse(call.start) <= Date.now()) return 'The call has already started';
    }
    if (a.trigger === 'call_outcome' && call.outcome !== a.triggerValue) return `The call's outcome changed to ${valueLabel('call_outcome', call.outcome)}`;
  }
  return null;
}

// test switch: with AUTOMATION_MAIL_STUB=1 nothing leaves the server; the message is logged instead
const stub = () => process.env.AUTOMATION_MAIL_STUB === '1';
const stubbed = [];
export const stubOutbox = () => stubbed;

async function deliver(a, msg) {
  if (a.channel !== 'email') throw new Error(`${a.channel.toUpperCase()} needs a phone integration`);
  if (stub()) {
    const id = `stub-${Date.now().toString(36)}-${stubbed.length}`;
    stubbed.push({ id, from: a.fromEmail, to: msg.to, subject: msg.subject, text: msg.text });
    console.log(`[automations] STUB would send "${msg.subject}" to ${msg.to} from ${a.fromEmail}`);
    return id;
  }
  return sendMail({ from: a.fromEmail, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text });
}

const finish = db.prepare('UPDATE automation_runs SET status = ?, reason = ?, to_email = ?, subject = ?, message_id = ?, done_at = ? WHERE id = ?');

async function runOne(run) {
  // claim it; anything else that got here first wins
  if (db.prepare("UPDATE automation_runs SET status = 'sending' WHERE id = ? AND status = 'queued'").run(run.id).changes !== 1) return;
  const done = (status, reason, msg = {}, messageId = null) => finish.run(status, reason, msg.to || '', msg.subject || '', messageId, nowIso(), run.id);
  try {
    const a = getAutomation(run.automation_id);
    if (!a) return done('skipped', 'The automation was deleted');
    if (!a.enabled) return done('skipped', 'Switched off before it was due');
    const call = run.call_id ? callRow(run.call_id) : null;
    const lead = run.lead_id ? leadRow(run.lead_id) : call ? leadForCall(call.id) : null;
    const dial = run.dial_id ? db.prepare('SELECT * FROM lead_dials WHERE id = ?').get(run.dial_id) : null;
    const why = triggerSkip(a, run, { lead, call, dial }) || conditionSkip(a, { lead, dial });
    if (why) return done('skipped', why);
    const msg = compose(a, { lead, call });
    if (msg.skip) return done('skipped', msg.skip, msg);
    const id = await deliver(a, msg);
    done('sent', stub() ? 'Test mode: not actually sent' : '', msg, id);
    if (lead) {
      actor.run('Automations', () =>
        logActivity(lead.id, 'mail', `Automatic email sent: ${msg.subject}`, { detail: `${a.name ? `Automation: ${a.name}\n` : ''}To ${msg.to} from ${a.fromEmail}\n\n${msg.text}` })
      );
    }
  } catch (e) {
    done('failed', String(e.message || e).slice(0, 300));
  }
}

const PER_TICK = 20;
let running = null;

export async function runAutomations() {
  if (running) return running;
  running = (async () => {
    const out = { queued: 0, processed: 0 };
    for (const a of listEnabled()) {
      try {
        scan(a);
      } catch (e) {
        console.error('[automations] scan', a.id, e);
      }
    }
    const due = db.prepare("SELECT * FROM automation_runs WHERE status = 'queued' AND due_at <= ? ORDER BY due_at LIMIT ?").all(nowIso(), PER_TICK);
    for (const r of due) {
      await runOne(r);
      out.processed++;
    }
    out.queued = db.prepare("SELECT COUNT(*) n FROM automation_runs WHERE status = 'queued'").get().n;
    return out;
  })().finally(() => (running = null));
  return running;
}
const listEnabled = () => db.prepare('SELECT * FROM automations WHERE enabled = 1').all().map(shape);

// ---------- preview ----------

/** What the email would look like for one lead (or a made-up one), and whether it would go. */
export function preview(a, leadId) {
  const draft = { ...a, conditions: a.conditions || {} };
  let lead = leadId ? leadRow(leadId) : null;
  const sample = !lead;
  if (!lead) {
    lead = { id: 0, contact: 'Sam Taylor', business: 'Taylor Plumbing', email: 'sam@example.com', dnc: '', category: '', offer_id: a.offerId };
  }
  const call = lead.call_id ? callRow(lead.call_id) : null;
  const sampleCall = sample || !call ? { start: new Date(Date.now() + 2 * 864e5).toISOString(), join_url: 'https://zoom.us/j/123456789', status: 'confirmed', offer_id: a.offerId } : null;
  const msg = compose(draft, { lead, call: call || (sample ? sampleCall : null) });
  const cond = conditionSkip(draft, { lead, dial: null });
  return { sample, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html, skip: msg.skip || cond || null, noSignature: !!msg.noSignature };
}

// ---------- the timer ----------

let timer = null;
export function startAutomations() {
  if (timer || process.env.NO_AUTOMATIONS) return;
  // a run that was mid-send when the server stopped may or may not have gone: never send it again
  db.prepare("UPDATE automation_runs SET status = 'failed', reason = 'Interrupted while sending (the server restarted). It may or may not have gone, so it was not retried.', done_at = ? WHERE status = 'sending'").run(nowIso());
  const tick = () => runAutomations().catch((e) => console.error('[automations]', e));
  setTimeout(tick, 5000);
  timer = setInterval(tick, 60 * 1000);
  process.once('sveltekit:shutdown', () => clearInterval(timer));
}

// ---------- sending one by hand (the Email box on a lead) ----------

/**
 * Every email automation for this lead's offer, filled in for this lead: subject and message (with
 * [words](links) kept, the signature left to the Email box), the account it sends from, and why it
 * wouldn't go on its own (e.g. no booked call yet), so you can fix it before sending.
 */
export function draftsFor(leadId) {
  const lead = leadRow(leadId);
  if (!lead) return [];
  const live = lead.call_id ? callRow(lead.call_id) : null;
  const call = live && live.status !== 'cancelled' ? live : null;
  return db
    .prepare("SELECT * FROM automations WHERE channel = 'email' ORDER BY enabled DESC, id")
    .all()
    .map(shape)
    .filter((a) => a.offerId == null || a.offerId === lead.offer_id)
    .map((a) => {
      const { values } = context(a, { lead, call });
      const msg = compose(a, { lead, call });
      const plain = { ...values, signature: '' };
      return {
        id: a.id,
        name: a.name || 'Untitled automation',
        enabled: a.enabled,
        fromEmail: a.fromEmail,
        subject: fill(a.subject, plain).replace(/\s+/g, ' ').trim(),
        message: fill(a.body, plain).replace(/[ \t]+$/gm, '').trim(),
        problem: msg.skip && msg.skip !== 'No email address' ? msg.skip : null
      };
    });
}

/** Note a hand-sent automation in its run log (shows under the automation as sent). */
export function recordManualRun(automationId, leadId, { to, subject, messageId }) {
  if (!getAutomation(automationId)) return;
  const now = nowIso();
  db.prepare(
    `INSERT OR IGNORE INTO automation_runs(automation_id, event_key, lead_id, due_at, status, reason, to_email, subject, message_id, created_at, done_at)
     VALUES(?, ?, ?, ?, 'sent', 'Sent by hand from the lead', ?, ?, ?, ?, ?)`
  ).run(Number(automationId), `manual:${leadId}:${Date.now()}`, Number(leadId), now, to, subject, messageId, now, now);
}
