import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { dayKey, dayStartIso } from '../time.js';
import { wallClock } from '../leads.js';

const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, 'closer.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS offers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  industry TEXT NOT NULL DEFAULT '',
  price REAL,
  keywords TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT,
  opened_at TEXT
);
CREATE TABLE IF NOT EXISTS calls (
  id TEXT PRIMARY KEY,
  title TEXT,
  prospect TEXT,
  email TEXT,
  phone TEXT,
  start TEXT,
  end TEXT,
  join_url TEXT,
  description TEXT,
  kind TEXT,
  status TEXT DEFAULT 'confirmed',
  outcome TEXT DEFAULT 'pending',
  cash REAL DEFAULT 0,
  notes TEXT DEFAULT '',
  fathom_id TEXT,
  fathom_manual_url TEXT,
  source TEXT DEFAULT 'calendar',
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS fathom (
  recording_id TEXT PRIMARY KEY,
  title TEXT,
  meeting_title TEXT,
  url TEXT,
  share_url TEXT,
  meeting_url TEXT,
  start TEXT,
  end TEXT,
  invitees TEXT,
  summary TEXT,
  action_items TEXT
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
`);

const DAY_TABLES = {
  sdr_days: `
    offer_id INTEGER NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    no_answer INTEGER NOT NULL DEFAULT 0,
    booked INTEGER NOT NULL DEFAULT 0,
    not_interested INTEGER NOT NULL DEFAULT 0,
    callback INTEGER NOT NULL DEFAULT 0,
    wrong_no INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT,
    PRIMARY KEY (offer_id, date)`,
  close_days: `
    offer_id INTEGER NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    no_show INTEGER NOT NULL DEFAULT 0,
    closed INTEGER NOT NULL DEFAULT 0,
    not_interested INTEGER NOT NULL DEFAULT 0,
    callbacks INTEGER NOT NULL DEFAULT 0,
    unqualified INTEGER NOT NULL DEFAULT 0,
    cash REAL NOT NULL DEFAULT 0,
    updated_at TEXT,
    PRIMARY KEY (offer_id, date)`,
  dm_days: `
    offer_id INTEGER NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    contacted INTEGER NOT NULL DEFAULT 0,
    booked INTEGER NOT NULL DEFAULT 0,
    converted INTEGER NOT NULL DEFAULT 0,
    not_converted INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT,
    PRIMARY KEY (offer_id, date)`,
  month_meta: `
    offer_id INTEGER NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
    month TEXT NOT NULL,
    kind TEXT NOT NULL,
    days_worked INTEGER,
    PRIMARY KEY (offer_id, month, kind)`
};

const DEFAULTS = {
  keywords: 'GamePlan Call, Discovery Call',
  timezone: 'Australia/Brisbane',
  currency: 'AUD'
};

const hasColumn = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
const tableExists = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);

// One-off move from the single-offer layout: everything that existed becomes the first offer.
db.transaction(() => {
  let first = db.prepare('SELECT id FROM offers ORDER BY id LIMIT 1').get()?.id;
  if (!first) {
    const kw = db.prepare("SELECT value FROM settings WHERE key = 'keywords'").get()?.value || DEFAULTS.keywords;
    const now = new Date().toISOString();
    first = db
      .prepare('INSERT INTO offers(name, industry, keywords, created_at, opened_at) VALUES(?, ?, ?, ?, ?)')
      .run(process.env.FIRST_OFFER_NAME || 'My offer', process.env.FIRST_OFFER_INDUSTRY || '', kw, now, now).lastInsertRowid;
  }
  for (const [t, cols] of Object.entries(DAY_TABLES)) {
    if (!tableExists(t)) {
      db.exec(`CREATE TABLE ${t} (${cols})`);
    } else if (!hasColumn(t, 'offer_id')) {
      const old = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
      db.exec(`ALTER TABLE ${t} RENAME TO ${t}_old; CREATE TABLE ${t} (${cols});`);
      db.prepare(`INSERT INTO ${t}(offer_id, ${old.join(', ')}) SELECT ?, ${old.join(', ')} FROM ${t}_old`).run(first);
      db.exec(`DROP TABLE ${t}_old`);
    }
  }
  // What you do on each offer. Offers from before this setting keep the two tabs they always had.
  if (!hasColumn('offers', 'roles')) db.exec("ALTER TABLE offers ADD COLUMN roles TEXT NOT NULL DEFAULT 'sdr,closing'");
  if (!hasColumn('calls', 'offer_id')) db.exec('ALTER TABLE calls ADD COLUMN offer_id INTEGER REFERENCES offers(id)');
  db.prepare('UPDATE calls SET offer_id = ? WHERE offer_id IS NULL').run(first);
  db.exec('CREATE INDEX IF NOT EXISTS calls_offer_start ON calls(offer_id, start)');
})();

export function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = { ...DEFAULTS };
  for (const r of rows) s[r.key] = r.value;
  return s;
}

export function setSetting(key, value) {
  db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    String(value)
  );
}

// ---------- offers ----------

export const ROLES = ['dm', 'sdr', 'closing'];
const parseRoles = (v) => {
  const list = Array.isArray(v) ? v : String(v ?? '').split(',');
  return ROLES.filter((r) => list.map((x) => String(x).trim()).includes(r));
};

const shapeOffer = (r) =>
  r && {
    id: r.id,
    name: r.name,
    industry: r.industry,
    price: r.price,
    keywords: r.keywords,
    notes: r.notes,
    roles: parseRoles(r.roles),
    archived: !!r.archived,
    createdAt: r.created_at,
    openedAt: r.opened_at
  };

export function listOffers({ includeArchived = true } = {}) {
  return db
    .prepare(`SELECT * FROM offers ${includeArchived ? '' : 'WHERE archived = 0'} ORDER BY archived, opened_at DESC, id`)
    .all()
    .map(shapeOffer);
}
export const getOffer = (id) => shapeOffer(db.prepare('SELECT * FROM offers WHERE id = ?').get(Number(id)));

const cleanKeywords = (k) =>
  String(k ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .join(', ');

function offerFields(o) {
  const out = {};
  if ('name' in o) out.name = String(o.name ?? '').trim().slice(0, 80);
  if ('industry' in o) out.industry = String(o.industry ?? '').trim().slice(0, 80);
  if ('price' in o) {
    const n = Number(o.price);
    out.price = o.price === '' || o.price == null || !Number.isFinite(n) || n < 0 ? null : Math.round(n * 100) / 100;
  }
  if ('keywords' in o) out.keywords = cleanKeywords(o.keywords);
  if ('notes' in o) out.notes = String(o.notes ?? '').slice(0, 4000);
  if ('archived' in o) out.archived = o.archived ? 1 : 0;
  if ('roles' in o) {
    const roles = parseRoles(o.roles);
    if (!roles.length) throw new Error('Pick at least one role for the offer');
    out.roles = roles.join(',');
  }
  return out;
}

export function createOffer(o) {
  const f = { name: '', industry: '', price: null, keywords: '', notes: '', roles: 'sdr,closing', ...offerFields(o) };
  if (!f.name) throw new Error('Give the offer a name');
  const now = new Date().toISOString();
  const id = db
    .prepare(
      'INSERT INTO offers(name, industry, price, keywords, notes, roles, created_at, opened_at) VALUES(@name, @industry, @price, @keywords, @notes, @roles, @now, @now)'
    )
    .run({ ...f, now }).lastInsertRowid;
  return getOffer(id);
}

export function updateOffer(id, patch) {
  const f = offerFields(patch);
  if ('name' in f && !f.name) throw new Error('Give the offer a name');
  const keys = Object.keys(f);
  if (keys.length) db.prepare(`UPDATE offers SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...f, id: Number(id) });
  return getOffer(id);
}

// The offer the app opens on: this browser's pick if it still exists, else the one opened most recently anywhere.
export function resolveOffer(preferredId) {
  const pick = preferredId ? getOffer(preferredId) : null;
  if (pick && !pick.archived) return pick;
  return shapeOffer(db.prepare('SELECT * FROM offers ORDER BY archived, opened_at DESC, id LIMIT 1').get());
}
export function openOffer(id) {
  db.prepare('UPDATE offers SET opened_at = ? WHERE id = ?').run(new Date().toISOString(), Number(id));
  return getOffer(id);
}

// ---------- day tallies (per offer) ----------

const SDR_FIELDS = ['no_answer', 'booked', 'not_interested', 'callback', 'wrong_no'];
const DM_FIELDS = ['contacted', 'booked', 'converted', 'not_converted'];
const CLOSE_FIELDS = ['no_show', 'closed', 'not_interested', 'callbacks', 'unqualified', 'cash'];

function upsert(table, fields, offerId, date, values) {
  const clean = {};
  for (const f of fields) {
    const n = Number(values[f] ?? 0);
    clean[f] = Number.isFinite(n) && n >= 0 ? (f === 'cash' ? Math.round(n * 100) / 100 : Math.round(n)) : 0;
  }
  const empty = fields.every((f) => clean[f] === 0);
  if (empty) {
    db.prepare(`DELETE FROM ${table} WHERE offer_id = ? AND date = ?`).run(offerId, date);
    return null;
  }
  const cols = fields.join(', ');
  const params = fields.map((f) => '@' + f).join(', ');
  const updates = fields.map((f) => `${f} = excluded.${f}`).join(', ');
  db.prepare(
    `INSERT INTO ${table}(offer_id, date, ${cols}, updated_at) VALUES(@offer_id, @date, ${params}, @now)
     ON CONFLICT(offer_id, date) DO UPDATE SET ${updates}, updated_at = excluded.updated_at`
  ).run({ ...clean, offer_id: offerId, date, now: new Date().toISOString() });
  return { date, ...clean };
}

export const upsertSdr = (offerId, date, v) => upsert('sdr_days', SDR_FIELDS, offerId, date, v);
export const upsertClose = (offerId, date, v) => upsert('close_days', CLOSE_FIELDS, offerId, date, v);
export const upsertDm = (offerId, date, v) => upsert('dm_days', DM_FIELDS, offerId, date, v);

// offerId null = every offer (used by the Overall page)
const offerWhere = (offerId) => (offerId == null ? '' : 'offer_id = @offerId AND ');

export function sdrRange(offerId, from, to) {
  return db
    .prepare(`SELECT * FROM sdr_days WHERE ${offerWhere(offerId)}date >= @from AND date <= @to ORDER BY date`)
    .all({ offerId, from, to });
}
export function closeRange(offerId, from, to) {
  return db
    .prepare(`SELECT * FROM close_days WHERE ${offerWhere(offerId)}date >= @from AND date <= @to ORDER BY date`)
    .all({ offerId, from, to });
}
export function dmRange(offerId, from, to) {
  return db
    .prepare(`SELECT * FROM dm_days WHERE ${offerWhere(offerId)}date >= @from AND date <= @to ORDER BY date`)
    .all({ offerId, from, to });
}
export function dmDay(offerId, date) {
  return db.prepare('SELECT * FROM dm_days WHERE offer_id = ? AND date = ?').get(offerId, date) ?? null;
}
export function sdrDay(offerId, date) {
  return db.prepare('SELECT * FROM sdr_days WHERE offer_id = ? AND date = ?').get(offerId, date) ?? null;
}

export function monthMeta(offerId, month) {
  const rows = db.prepare('SELECT kind, days_worked FROM month_meta WHERE offer_id = ? AND month = ?').all(offerId, month);
  const m = { sdr: null, close: null, dm: null };
  for (const r of rows) m[r.kind] = r.days_worked;
  return m;
}
export function allMonthMeta() {
  return db.prepare('SELECT offer_id, month, kind, days_worked FROM month_meta').all();
}
export function setMonthMeta(offerId, month, kind, days) {
  if (days === null || days === '' || days === undefined) {
    db.prepare('DELETE FROM month_meta WHERE offer_id = ? AND month = ? AND kind = ?').run(offerId, month, kind);
  } else {
    db.prepare(
      'INSERT INTO month_meta(offer_id, month, kind, days_worked) VALUES(?, ?, ?, ?) ON CONFLICT(offer_id, month, kind) DO UPDATE SET days_worked = excluded.days_worked'
    ).run(offerId, month, kind, Math.max(0, Math.round(Number(days))));
  }
}

const CALL_SELECT = `
  SELECT c.*, f.title AS f_title, f.url AS f_url, f.share_url AS f_share_url, f.summary AS f_summary,
         f.action_items AS f_action_items, f.start AS f_start,
         (SELECT l.id FROM leads l WHERE l.call_id = c.id LIMIT 1) AS lead_id
  FROM calls c LEFT JOIN fathom f ON f.recording_id = c.fathom_id`;

export function callsRange(offerId, fromIso, toIso) {
  return db
    .prepare(
      `${CALL_SELECT} WHERE ${offerId == null ? '' : 'c.offer_id = @offerId AND '}c.start >= @fromIso AND c.start < @toIso AND c.status != 'cancelled' ORDER BY c.start`
    )
    .all({ offerId, fromIso, toIso })
    .map(shapeCall);
}
export function getCall(id) {
  const r = db.prepare(`${CALL_SELECT} WHERE c.id = ?`).get(id);
  return r ? shapeCall(r) : null;
}

function shapeCall(r) {
  const fathom = r.fathom_id
    ? {
        id: r.fathom_id,
        title: r.f_title,
        url: r.f_url,
        shareUrl: r.f_share_url,
        summary: r.f_summary,
        actionItems: r.f_action_items ? JSON.parse(r.f_action_items) : []
      }
    : r.fathom_manual_url
      ? { id: null, title: null, url: r.fathom_manual_url, shareUrl: null, summary: null, actionItems: [] }
      : null;
  return {
    id: r.id,
    title: r.title,
    prospect: r.prospect,
    email: r.email,
    phone: r.phone,
    start: r.start,
    end: r.end,
    joinUrl: r.join_url,
    description: r.description,
    kind: r.kind,
    outcome: r.outcome,
    cash: r.cash,
    notes: r.notes,
    source: r.source,
    offerId: r.offer_id,
    leadId: r.lead_id,
    fathom
  };
}

export const OUTCOMES = ['pending', 'no_show', 'closed', 'not_interested', 'callback', 'unqualified'];

export function updateCall(id, patch) {
  const allowed = { outcome: 'outcome', cash: 'cash', notes: 'notes', fathomManualUrl: 'fathom_manual_url', fathomId: 'fathom_id', offerId: 'offer_id' };
  const sets = [];
  const vals = {};
  for (const [k, col] of Object.entries(allowed)) {
    if (!(k in patch)) continue;
    let v = patch[k];
    if (k === 'outcome' && !OUTCOMES.includes(v)) continue;
    if (k === 'cash') v = Math.max(0, Number(v) || 0);
    if (k === 'fathomManualUrl' || k === 'fathomId') v = v ? String(v).trim() : null;
    if (k === 'offerId' && !getOffer(v)) continue;
    if (k === 'offerId') v = Number(v);
    sets.push(`${col} = @${col}`);
    vals[col] = v;
  }
  if (!sets.length) return getCall(id);
  db.prepare(`UPDATE calls SET ${sets.join(', ')}, updated_at = @now WHERE id = @id`).run({
    ...vals,
    now: new Date().toISOString(),
    id
  });
  return getCall(id);
}

export function createManualCall(offerId, c) {
  const id = 'manual-' + Date.now().toString(36);
  db.prepare(
    `INSERT INTO calls(id, offer_id, title, prospect, email, phone, start, end, kind, source, updated_at)
     VALUES(@id, @offerId, @title, @prospect, @email, @phone, @start, @end, @kind, 'manual', @now)`
  ).run({
    id,
    offerId,
    title: c.title || `${c.prospect} call`,
    prospect: c.prospect || '',
    email: c.email || null,
    phone: c.phone || null,
    start: c.start,
    end: c.end || c.start,
    kind: c.kind || 'Call',
    now: new Date().toISOString()
  });
  return getCall(id);
}

export function deleteManualCall(id) {
  db.prepare("DELETE FROM calls WHERE id = ? AND source = 'manual'").run(id);
}

export function unlinkedRecordings(limit = 40) {
  return db
    .prepare(
      `SELECT recording_id AS id, title, url, start FROM fathom
       WHERE recording_id NOT IN (SELECT fathom_id FROM calls WHERE fathom_id IS NOT NULL)
       ORDER BY start DESC LIMIT ?`
    )
    .all(limit);
}

// ---------- DM leads ----------
// Each lead is one person who messaged in, saved by IG handle or name. Moving a lead along
// (booked, converted, not converted) also bumps the matching day tally, on the day it happened,
// so the daily numbers and the lead list never disagree.

db.exec(`
CREATE TABLE IF NOT EXISTS dm_leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offer_id INTEGER NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  handle TEXT NOT NULL,
  contacted_on TEXT NOT NULL,
  booked_on TEXT,
  outcome TEXT,
  outcome_on TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS dm_leads_offer ON dm_leads(offer_id, contacted_on);
`);

export const LEAD_STATUSES = ['contacted', 'booked', 'converted', 'not_converted'];

function bumpDm(offerId, date, key, delta) {
  const cur = dmDay(offerId, date) || { contacted: 0, booked: 0, converted: 0, not_converted: 0 };
  cur[key] = Math.max(0, (cur[key] || 0) + delta);
  upsertDm(offerId, date, cur);
}

const shapeLead = (r) =>
  r && {
    id: r.id,
    handle: r.handle,
    contactedOn: r.contacted_on,
    bookedOn: r.booked_on,
    outcome: r.outcome,
    outcomeOn: r.outcome_on,
    status: r.outcome || (r.booked_on ? 'booked' : 'contacted'),
    notes: r.notes,
    updatedAt: r.updated_at
  };

export function getLead(offerId, id) {
  return shapeLead(db.prepare('SELECT * FROM dm_leads WHERE id = ? AND offer_id = ?').get(Number(id), offerId));
}

export function dmLeads(offerId, { open = false, limit = 1000 } = {}) {
  return db
    .prepare(`SELECT * FROM dm_leads WHERE offer_id = ? ${open ? 'AND outcome IS NULL' : ''} ORDER BY updated_at DESC, id DESC LIMIT ?`)
    .all(offerId, limit)
    .map(shapeLead);
}

export function createLead(offerId, handle, date) {
  const h = String(handle || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  if (!h) throw new Error('Add their IG handle or name');
  return db.transaction(() => {
    const now = new Date().toISOString();
    const id = db
      .prepare('INSERT INTO dm_leads(offer_id, handle, contacted_on, created_at, updated_at) VALUES(?, ?, ?, ?, ?)')
      .run(offerId, h, date, now, now).lastInsertRowid;
    bumpDm(offerId, date, 'contacted', 1);
    return getLead(offerId, id);
  })();
}

/** Move a lead to a status. `today` is the day the change counts on. */
export function setLeadStatus(offerId, id, status, today) {
  if (!LEAD_STATUSES.includes(status)) throw new Error('Unknown status');
  return db.transaction(() => {
    const r = db.prepare('SELECT * FROM dm_leads WHERE id = ? AND offer_id = ?').get(Number(id), offerId);
    if (!r) return null;
    let { booked_on, outcome, outcome_on } = r;
    // take back what no longer applies
    if (outcome && outcome !== status) {
      bumpDm(offerId, outcome_on, outcome, -1);
      outcome = outcome_on = null;
    }
    if (status === 'contacted' && booked_on) {
      bumpDm(offerId, booked_on, 'booked', -1);
      booked_on = null;
    }
    // add what's new
    if (status === 'booked' && !booked_on) {
      booked_on = today;
      bumpDm(offerId, today, 'booked', 1);
    }
    if ((status === 'converted' || status === 'not_converted') && outcome !== status) {
      outcome = status;
      outcome_on = today;
      bumpDm(offerId, today, status, 1);
    }
    db.prepare('UPDATE dm_leads SET booked_on = ?, outcome = ?, outcome_on = ?, updated_at = ? WHERE id = ?').run(
      booked_on,
      outcome,
      outcome_on,
      new Date().toISOString(),
      r.id
    );
    return getLead(offerId, r.id);
  })();
}

export function updateLead(offerId, id, patch) {
  const sets = [];
  const vals = { id: Number(id), offerId, now: new Date().toISOString() };
  if ('handle' in patch) {
    const h = String(patch.handle || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    if (!h) throw new Error('Add their IG handle or name');
    sets.push('handle = @handle');
    vals.handle = h;
  }
  if ('notes' in patch) {
    sets.push('notes = @notes');
    vals.notes = String(patch.notes || '').slice(0, 2000);
  }
  if (sets.length) db.prepare(`UPDATE dm_leads SET ${sets.join(', ')}, updated_at = @now WHERE id = @id AND offer_id = @offerId`).run(vals);
  return getLead(offerId, id);
}

/** Remove a lead and take back everything it added to the day tallies. */
export function deleteLead(offerId, id) {
  db.transaction(() => {
    const r = db.prepare('SELECT * FROM dm_leads WHERE id = ? AND offer_id = ?').get(Number(id), offerId);
    if (!r) return;
    bumpDm(offerId, r.contacted_on, 'contacted', -1);
    if (r.booked_on) bumpDm(offerId, r.booked_on, 'booked', -1);
    if (r.outcome) bumpDm(offerId, r.outcome_on, r.outcome, -1);
    db.prepare('DELETE FROM dm_leads WHERE id = ?').run(r.id);
  })();
}

// ---------- Cold-call leads ----------
// One row per business on the call list, scoped to an offer. Every dial logged against a lead is a
// row in lead_dials and adds 1 to that day's SDR tally (same per-dial counting as the sheet), so
// undoing a dial or deleting a lead takes it back off. Call 1/2/3 history that came in on an import
// is kept on the lead for reference but never counted: those dials were already tallied by hand.

db.exec(`
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offer_id INTEGER NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  business TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  phone_key TEXT,
  email TEXT NOT NULL DEFAULT '',
  suburb TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  score REAL,
  follow_up TEXT,
  notes TEXT NOT NULL DEFAULT '',
  extra TEXT NOT NULL DEFAULT '[]',
  call_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS leads_offer ON leads(offer_id);
CREATE INDEX IF NOT EXISTS leads_phone ON leads(phone_key);
CREATE TABLE IF NOT EXISTS lead_dials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  offer_id INTEGER NOT NULL,
  date TEXT,
  outcome TEXT,
  label TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  counted INTEGER NOT NULL DEFAULT 1,
  prev_follow_up TEXT,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS lead_dials_lead ON lead_dials(lead_id);
`);
if (!hasColumn('lead_dials', 'prev_follow_up')) db.exec('ALTER TABLE lead_dials ADD COLUMN prev_follow_up TEXT');
// how the contact happened: everything before this column existed was a phone call
if (!hasColumn('lead_dials', 'channel')) db.exec("ALTER TABLE lead_dials ADD COLUMN channel TEXT NOT NULL DEFAULT 'call'");
// emails keep a subject line (the note is the body), and an id from the mail system so importing
// the same message twice doesn't add it twice
if (!hasColumn('lead_dials', 'subject')) db.exec("ALTER TABLE lead_dials ADD COLUMN subject TEXT NOT NULL DEFAULT ''");
if (!hasColumn('lead_dials', 'ext_id')) db.exec('ALTER TABLE lead_dials ADD COLUMN ext_id TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS lead_dials_ext ON lead_dials(lead_id, ext_id) WHERE ext_id IS NOT NULL');
// contact consent: the channels a lead has asked not to be contacted on (call, sms, email)
if (!hasColumn('leads', 'dnc')) db.exec("ALTER TABLE leads ADD COLUMN dnc TEXT NOT NULL DEFAULT ''");
if (!hasColumn('leads', 'dnc_note')) db.exec("ALTER TABLE leads ADD COLUMN dnc_note TEXT NOT NULL DEFAULT ''");
if (!hasColumn('leads', 'dnc_at')) db.exec('ALTER TABLE leads ADD COLUMN dnc_at TEXT');

export const DIAL_OUTCOMES = SDR_FIELDS;

export function phoneKey(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.startsWith('61')) d = '0' + d.slice(2);
  return d.length >= 8 ? d.slice(-9) : null;
}

// Words people write in a Call 1/2/3 cell, mapped to an outcome. Anything else stays as plain text.
export function guessOutcome(text) {
  const t = String(text || '').toLowerCase().trim();
  if (!t) return null;
  if (/wrong|disconn|invalid|not in service|bad n/.test(t)) return 'wrong_no';
  if (/not int|\bni\b|no thanks|not keen|hung up|\bdnc\b|do not call|happy with|already (paid|have|has|got|using|use)|not looking|no need|don'?t need/.test(t)) return 'not_interested';
  if (/book/.test(t)) return 'booked';
  if (/inbound|called (me |us )?back|returned (my |the )?call|rang (me )?back/.test(t)) return 'inbound';
  if (/call ?back|\bcb\b|follow|later|busy/.test(t)) return 'callback';
  if (/no ?ans|\bna\b|n\/a|\bvm\b|voice ?mail|no pick|rang out|left msg|left message|\bnr\b/.test(t)) return 'no_answer';
  return null;
}

function bumpSdr(offerId, date, key, delta) {
  const cur = sdrDay(offerId, date) || Object.fromEntries(SDR_FIELDS.map((k) => [k, 0]));
  cur[key] = Math.max(0, (cur[key] || 0) + delta);
  upsertSdr(offerId, date, cur);
}

const LEAD_TEXT = { business: 120, contact: 120, phone: 40, email: 160, suburb: 80, category: 80 };

function leadFields(o) {
  const f = {};
  for (const [k, max] of Object.entries(LEAD_TEXT)) if (k in o) f[k] = String(o[k] ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
  if ('phone' in f) f.phone_key = phoneKey(f.phone);
  if ('score' in o) {
    const n = parseFloat(String(o.score ?? '').replace(/[^\d.-]/g, ''));
    f.score = Number.isFinite(n) ? n : null;
  }
  if ('followUp' in o) f.follow_up = /^\d{4}-\d{2}-\d{2}$/.test(o.followUp || '') ? o.followUp : null;
  if ('notes' in o) f.notes = String(o.notes ?? '').slice(0, 4000);
  if ('extra' in o) {
    const list = (Array.isArray(o.extra) ? o.extra : [])
      .map(([k, v]) => [String(k).trim().slice(0, 60), String(v ?? '').trim().slice(0, 1000)])
      .filter(([k, v]) => k && v);
    f.extra = JSON.stringify(list.slice(0, 40));
  }
  return f;
}

const LEAD_SELECT = `
  SELECT l.*, c.start AS c_start, c.outcome AS c_outcome, c.cash AS c_cash, c.status AS c_status, c.title AS c_title, c.offer_id AS c_offer
  FROM leads l LEFT JOIN calls c ON c.id = l.call_id`;

function shapeColdLead(r, dials) {
  if (!r) return null;
  const last = dials.filter((d) => SDR_FIELDS.includes(d.outcome)).at(-1) || null;
  const call = r.call_id && r.c_start ? { id: r.call_id, start: r.c_start, outcome: r.c_outcome, cash: r.c_cash, title: r.c_title, cancelled: r.c_status === 'cancelled' } : null;
  let stage = last?.outcome || 'new';
  if (call && !call.cancelled) stage = call.outcome && call.outcome !== 'pending' ? 'call_' + call.outcome : 'booked';
  return {
    id: r.id,
    business: r.business,
    contact: r.contact,
    phone: r.phone,
    email: r.email,
    suburb: r.suburb,
    category: r.category,
    score: r.score,
    followUp: r.follow_up,
    notes: r.notes,
    extra: JSON.parse(r.extra || '[]'),
    call,
    stage,
    doNotContact: parseDnc(r.dnc),
    dncNote: r.dnc_note || '',
    dncAt: r.dnc_at || null,
    dials,
    attempts: dials.filter((d) => d.channel === 'call' && d.outcome !== 'inbound').length,
    lastDialOn: dials.filter((d) => d.date).at(-1)?.date || null,
    lastContactAt: dials.filter((d) => d.date).at(-1)?.at || null,
    updatedAt: r.updated_at
  };
}

const shapeDial = (d) => ({ id: d.id, date: d.date, outcome: d.outcome, channel: d.channel || 'call', subject: d.subject || '', label: d.label, note: d.note, counted: !!d.counted, at: d.at, extId: d.ext_id || null });

export function getColdLead(offerId, id) {
  const r = db.prepare(`${LEAD_SELECT} WHERE l.id = ? AND l.offer_id = ?`).get(Number(id), offerId);
  if (!r) return null;
  return shapeColdLead(r, db.prepare('SELECT * FROM lead_dials WHERE lead_id = ? ORDER BY (date IS NULL) DESC, at, id').all(r.id).map(shapeDial));
}

export function coldLeads(offerId) {
  const rows = db.prepare(`${LEAD_SELECT} WHERE l.offer_id = ? ORDER BY l.id`).all(offerId);
  const by = new Map(rows.map((r) => [r.id, []]));
  for (const d of db.prepare('SELECT * FROM lead_dials WHERE offer_id = ? ORDER BY (date IS NULL) DESC, at, id').all(offerId)) by.get(d.lead_id)?.push(shapeDial(d));
  return rows.map((r) => shapeColdLead(r, by.get(r.id)));
}

export const coldLeadCount = (offerId) => db.prepare('SELECT COUNT(*) n FROM leads WHERE offer_id = ?').get(offerId).n;

function insertLead(offerId, f) {
  const now = new Date().toISOString();
  const row = { business: '', contact: '', phone: '', phone_key: null, email: '', suburb: '', category: '', score: null, follow_up: null, notes: '', extra: '[]', ...f };
  return db
    .prepare(
      `INSERT INTO leads(offer_id, business, contact, phone, phone_key, email, suburb, category, score, follow_up, notes, extra, created_at, updated_at)
       VALUES(@offerId, @business, @contact, @phone, @phone_key, @email, @suburb, @category, @score, @follow_up, @notes, @extra, @now, @now)`
    )
    .run({ ...row, offerId, now }).lastInsertRowid;
}

const needsName = (f) => !f.business && !f.contact && !f.phone;

export function createColdLead(offerId, o) {
  const f = leadFields(o);
  if (needsName(f)) throw new Error('Add a business, a name or a number');
  return getColdLead(offerId, insertLead(offerId, f));
}

export function updateColdLead(offerId, id, patch) {
  const f = leadFields(patch);
  if ('callId' in patch) {
    const cid = patch.callId ? String(patch.callId) : null;
    if (cid && !db.prepare('SELECT 1 FROM calls WHERE id = ?').get(cid)) throw new Error('That call is gone');
    f.call_id = cid;
    if (cid) {
      db.prepare('UPDATE calls SET offer_id = ? WHERE id = ?').run(offerId, cid);
      f.follow_up = dayKey(db.prepare('SELECT start FROM calls WHERE id = ?').get(cid).start, getSettings().timezone);
    } else {
      // unlinking: drop the follow-up date that came from that call
      const was = db.prepare('SELECT l.follow_up, c.start FROM leads l LEFT JOIN calls c ON c.id = l.call_id WHERE l.id = ?').get(Number(id));
      if (was?.start && was.follow_up === dayKey(was.start, getSettings().timezone)) f.follow_up = null;
    }
  }
  const cur = getColdLead(offerId, id);
  if (!cur) return null;
  if (needsName({ business: f.business ?? cur.business, contact: f.contact ?? cur.contact, phone: f.phone ?? cur.phone })) throw new Error('Add a business, a name or a number');
  const keys = Object.keys(f);
  if (keys.length)
    db.prepare(`UPDATE leads SET ${keys.map((k) => `${k} = @${k}`).join(', ')}, updated_at = @now WHERE id = @id AND offer_id = @offerId`).run({
      ...f,
      now: new Date().toISOString(),
      id: Number(id),
      offerId
    });
  return getColdLead(offerId, id);
}

/** Delete a lead and take every dial it logged back off the day tallies. */
export function deleteColdLead(offerId, id) {
  db.transaction(() => {
    const l = db.prepare('SELECT id FROM leads WHERE id = ? AND offer_id = ?').get(Number(id), offerId);
    if (!l) return;
    for (const d of db.prepare('SELECT * FROM lead_dials WHERE lead_id = ? AND counted = 1').all(l.id)) bumpSdr(offerId, d.date, d.outcome, -1);
    db.prepare('DELETE FROM lead_dials WHERE lead_id = ?').run(l.id);
    db.prepare('DELETE FROM leads WHERE id = ?').run(l.id);
  })();
}

/** Log one dial on a lead. It counts on `date` in the SDR tallies. */
export function logDial(offerId, leadId, { outcome, date, followUp, note }) {
  if (!SDR_FIELDS.includes(outcome)) throw new Error('Unknown outcome');
  return db.transaction(() => {
    const l = db.prepare('SELECT id, follow_up FROM leads WHERE id = ? AND offer_id = ?').get(Number(leadId), offerId);
    if (!l) return null;
    db.prepare('INSERT INTO lead_dials(lead_id, offer_id, date, outcome, note, counted, prev_follow_up, at) VALUES(?, ?, ?, ?, ?, 1, ?, ?)').run(
      l.id,
      offerId,
      date,
      outcome,
      String(note || '').slice(0, 1000),
      l.follow_up,
      // stamped now, unless it's being logged for another day
      dayKey(Date.now(), getSettings().timezone) === date ? new Date().toISOString() : atFrom(date, '12:00')
    );
    bumpSdr(offerId, date, outcome, 1);
    const fu = outcome === 'callback' || outcome === 'no_answer' ? (/^\d{4}-\d{2}-\d{2}$/.test(followUp || '') ? followUp : null) : null;
    db.prepare('UPDATE leads SET follow_up = ?, updated_at = ? WHERE id = ?').run(fu, new Date().toISOString(), l.id);
    if (outcome === 'booked') linkLeadCalls();
    return getColdLead(offerId, l.id);
  })();
}

/** Remove one dial (undo). Counted dials come back off the tally for their day. */
export function removeDial(offerId, leadId, dialId) {
  return db.transaction(() => {
    const d = db.prepare('SELECT * FROM lead_dials WHERE id = ? AND lead_id = ? AND offer_id = ?').get(Number(dialId), Number(leadId), offerId);
    if (!d) return getColdLead(offerId, leadId);
    if (d.counted) bumpSdr(offerId, d.date, d.outcome, -1);
    // undoing the latest dial puts the follow-up date back to what it was before that dial
    const latest = db.prepare('SELECT MAX(id) id FROM lead_dials WHERE lead_id = ? AND counted = 1').get(d.lead_id).id;
    if (d.counted && latest === d.id) db.prepare('UPDATE leads SET follow_up = ?, updated_at = ? WHERE id = ?').run(d.prev_follow_up, new Date().toISOString(), d.lead_id);
    db.prepare('DELETE FROM lead_dials WHERE id = ?').run(d.id);
    return getColdLead(offerId, leadId);
  })();
}

/**
 * Bring in rows from a spreadsheet. A row matches an existing lead by mobile, then email, then
 * business name. Matches only fill in blanks and refresh the research columns, so anything logged
 * in the app (dials, notes, follow-ups) is never overwritten.
 */
export function importColdLeads(offerId, rows) {
  const out = { added: 0, updated: 0, skipped: 0 };
  db.transaction(() => {
    const existing = db.prepare('SELECT * FROM leads WHERE offer_id = ?').all(offerId);
    const byPhone = new Map(existing.filter((l) => l.phone_key).map((l) => [l.phone_key, l]));
    const byEmail = new Map(existing.filter((l) => l.email).map((l) => [l.email.toLowerCase(), l]));
    const byName = new Map(existing.filter((l) => l.business).map((l) => [l.business.toLowerCase(), l]));
    const hasHistory = db.prepare("SELECT 1 FROM lead_dials WHERE lead_id = ? AND counted = 0 AND label != '' AND date IS NULL LIMIT 1");
    const addHistory = db.prepare("INSERT INTO lead_dials(lead_id, offer_id, date, outcome, channel, label, counted, at) VALUES(?, ?, NULL, ?, ?, ?, 0, ?)");
    const now = new Date().toISOString();
    for (const raw of (rows || []).slice(0, 5000)) {
      const f = leadFields(raw);
      if (needsName(f)) {
        out.skipped++;
        continue;
      }
      const match = (f.phone_key && byPhone.get(f.phone_key)) || (f.email && byEmail.get(f.email.toLowerCase())) || (f.business && byName.get(f.business.toLowerCase()));
      let id;
      if (match) {
        const sets = {};
        for (const k of ['business', 'contact', 'phone', 'phone_key', 'email', 'suburb', 'category', 'notes', 'follow_up'])
          if (f[k] && !match[k]) sets[k] = f[k];
        if (f.score != null) sets.score = f.score;
        if ('extra' in f) {
          const merged = new Map(JSON.parse(match.extra || '[]'));
          for (const [k, v] of JSON.parse(f.extra)) merged.set(k, v);
          sets.extra = JSON.stringify([...merged]);
        }
        const keys = Object.keys(sets);
        if (keys.length) db.prepare(`UPDATE leads SET ${keys.map((k) => `${k} = @${k}`).join(', ')}, updated_at = @now WHERE id = @id`).run({ ...sets, now, id: match.id });
        Object.assign(match, sets);
        id = match.id;
        out.updated++;
      } else {
        id = insertLead(offerId, f);
        const row = { id, ...f };
        if (f.phone_key) byPhone.set(f.phone_key, row);
        if (f.email) byEmail.set(f.email.toLowerCase(), row);
        if (f.business) byName.set(f.business.toLowerCase(), row);
        out.added++;
      }
      const history = (Array.isArray(raw.history) ? raw.history : []).map((h) => String(h ?? '').trim().slice(0, 200)).filter(Boolean);
      if (history.length && !hasHistory.get(id)) for (const h of history) addHistory.run(id, offerId, guessOutcome(h.replace(/^[^:]*:\s*/, '')), guessChannel(h), h, now);
    }
  })();
  return out;
}

/**
 * Match booked leads to calendar calls: same mobile, then same email, then the business or contact
 * name in the event title or guest name. Every offer uses the same booking-call titles, so a call can
 * land on any offer; once it matches a lead it is moved onto that lead's offer.
 */
export function linkLeadCalls() {
  const n = matchLeadCalls();
  syncCallFollowUps();
  return n;
}

/**
 * A booked lead's follow-up date is its call's date, so the list, the lead page and sorting all show
 * when the call is. Kept in step on every calendar sync, so a rescheduled call moves it too.
 */
export function syncCallFollowUps() {
  const tz = getSettings().timezone;
  const rows = db
    .prepare("SELECT l.id, l.follow_up, c.start FROM leads l JOIN calls c ON c.id = l.call_id WHERE c.status != 'cancelled'")
    .all();
  const set = db.prepare('UPDATE leads SET follow_up = ?, updated_at = ? WHERE id = ?');
  let n = 0;
  for (const r of rows) {
    const day = dayKey(r.start, tz);
    if (r.follow_up !== day) {
      set.run(day, new Date().toISOString(), r.id);
      n++;
    }
  }
  return n;
}

function matchLeadCalls() {
  const leads = db
    .prepare(
      `SELECT l.*, (SELECT MIN(date) FROM lead_dials d WHERE d.lead_id = l.id AND d.outcome = 'booked') AS booked_on
       FROM leads l LEFT JOIN calls c ON c.id = l.call_id
       WHERE l.call_id IS NULL OR c.id IS NULL OR c.status = 'cancelled'`
    )
    .all()
    .filter((l) => l.booked_on);
  if (!leads.length) return 0;
  const taken = new Set(db.prepare('SELECT call_id FROM leads WHERE call_id IS NOT NULL').all().map((r) => r.call_id));
  const calls = db.prepare("SELECT id, title, prospect, email, phone, start FROM calls WHERE status != 'cancelled' ORDER BY start").all();
  const set = db.prepare('UPDATE leads SET call_id = ?, updated_at = ? WHERE id = ?');
  const move = db.prepare('UPDATE calls SET offer_id = ? WHERE id = ?');
  let linked = 0;
  for (const l of leads) {
    const from = new Date(l.booked_on + 'T00:00:00Z').getTime() - 2 * 864e5;
    const open = calls.filter((c) => !taken.has(c.id) && new Date(c.start).getTime() >= from);
    const names = [l.business, l.contact].map((s) => s.toLowerCase().trim()).filter((s) => s.length >= 4);
    const hit =
      (l.phone_key && open.find((c) => phoneKey(c.phone) === l.phone_key)) ||
      (l.email && open.find((c) => c.email?.toLowerCase() === l.email.toLowerCase())) ||
      open.find((c) => names.some((n) => `${c.title} ${c.prospect}`.toLowerCase().includes(n)));
    if (hit) {
      taken.add(hit.id);
      set.run(hit.id, new Date().toISOString(), l.id);
      move.run(l.offer_id, hit.id);
      linked++;
    }
  }
  return linked;
}

export function linkableCalls(offerId, fromIso) {
  return db
    .prepare(
      `SELECT id, title, prospect, start, offer_id FROM calls
       WHERE status != 'cancelled' AND start >= ? AND id NOT IN (SELECT call_id FROM leads WHERE call_id IS NOT NULL)
       ORDER BY (offer_id = ?) DESC, start LIMIT 60`
    )
    .all(fromIso, offerId);
}

// ---------- lead history ----------
// Every dial is a history entry with a date and time. Ones logged from the dialler are stamped
// automatically; these let you add a contact that happened elsewhere, or fix the date and time on
// one (like a Call 1 that came in from the sheet with no date). "counted" says whether it is in the
// Dialling numbers for its day; changing the date, outcome or that switch moves the tally to match.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const ENTRY_TYPES = [...SDR_FIELDS, 'inbound'];
export const CHANNELS = ['call', 'sms', 'email'];
const guessChannel = (t) => (/\b(sms|texts?|texted|txt)\b/i.test(t) ? 'sms' : /e-?mail/i.test(t) ? 'email' : 'call');
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** Wall-clock date + time in the business timezone -> ISO instant. */
function atFrom(date, time) {
  const tz = getSettings().timezone;
  const m = String(time || '').match(TIME_RE);
  const mins = m ? Number(m[1]) * 60 + Number(m[2]) : 12 * 60;
  return new Date(new Date(dayStartIso(date, tz)).getTime() + mins * 60000).toISOString();
}

function entryFields(e) {
  if (!DATE_RE.test(e.date || '')) throw new Error('Pick the date it happened');
  const outcome = e.outcome ? String(e.outcome) : null;
  if (outcome && !ENTRY_TYPES.includes(outcome)) throw new Error('Unknown outcome');
  const channel = CHANNELS.includes(e.channel) ? e.channel : 'call';
  // only calls you made go in the dial numbers: not texts, emails, or them ringing you
  const counted = !!e.counted && channel === 'call' && outcome !== 'inbound';
  if (counted && !outcome) throw new Error('Pick an outcome to count it on Dialling');
  const at = atFrom(e.date, e.time);
  return {
    date: dayKey(at, getSettings().timezone),
    at,
    outcome,
    channel,
    counted,
    subject: String(e.subject ?? '').replace(/\s+/g, ' ').trim().slice(0, 300),
    // long enough for a whole email body
    note: String(e.note ?? '').replace(/\r\n/g, '\n').slice(0, 20000),
    extId: e.extId ? String(e.extId).trim().slice(0, 200) : null
  };
}

export function addLeadEntry(offerId, leadId, e) {
  const f = entryFields(e);
  return db.transaction(() => {
    const l = db.prepare('SELECT id FROM leads WHERE id = ? AND offer_id = ?').get(Number(leadId), offerId);
    if (!l) return null;
    if (f.extId) {
      const seen = db.prepare('SELECT id FROM lead_dials WHERE lead_id = ? AND ext_id = ?').get(l.id, f.extId);
      if (seen) return { ...getColdLead(offerId, l.id), duplicateOf: seen.id };
    }
    db.prepare('INSERT INTO lead_dials(lead_id, offer_id, date, outcome, channel, subject, note, ext_id, counted, at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      l.id, offerId, f.date, f.outcome, f.channel, f.subject, f.note, f.extId, f.counted ? 1 : 0, f.at
    );
    if (f.counted) bumpSdr(offerId, f.date, f.outcome, 1);
    db.prepare('UPDATE leads SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), l.id);
    return getColdLead(offerId, l.id);
  })();
}

export function updateLeadEntry(offerId, leadId, dialId, e) {
  return db.transaction(() => {
    const d = db.prepare('SELECT * FROM lead_dials WHERE id = ? AND lead_id = ? AND offer_id = ?').get(Number(dialId), Number(leadId), offerId);
    if (!d) return null;
    const was = d.date ? wallClock(d.at, getSettings().timezone) : {};
    const f = entryFields({ ...was, outcome: d.outcome, channel: d.channel, subject: d.subject, note: d.note, extId: d.ext_id, counted: !!d.counted, ...e });
    if (d.counted) bumpSdr(offerId, d.date, d.outcome, -1);
    if (f.counted) bumpSdr(offerId, f.date, f.outcome, 1);
    db.prepare('UPDATE lead_dials SET date = ?, at = ?, outcome = ?, channel = ?, subject = ?, note = ?, counted = ? WHERE id = ?').run(
      f.date, f.at, f.outcome, f.channel, f.subject, f.note, f.counted ? 1 : 0, d.id
    );
    return getColdLead(offerId, leadId);
  })();
}

// ---------- contact consent ----------
// A lead can ask not to be called, texted or emailed (or all three). The app warns and keeps them out
// of the call queue; the MCP refuses to log outbound contact on a channel they opted out of.

const DNC_CHANNELS = ['call', 'sms', 'email'];
function parseDnc(v) {
  const set = String(v || '').split(',').map((x) => x.trim());
  return DNC_CHANNELS.filter((c) => set.includes(c));
}
const CHANNEL_WORD = { call: 'calls', sms: 'texts', email: 'emails' };

/**
 * Opt a lead out of (block) or back into (allow) channels. Each change also goes in the lead's
 * history as a note on that channel, so you can see when and why.
 */
export function setConsent(offerId, leadId, { block = [], allow = [], note = '' }) {
  const expand = (list) => (list.includes('all') ? DNC_CHANNELS : DNC_CHANNELS.filter((c) => list.includes(c)));
  const add = expand(block);
  const remove = expand(allow);
  return db.transaction(() => {
    const r = db.prepare('SELECT * FROM leads WHERE id = ? AND offer_id = ?').get(Number(leadId), offerId);
    if (!r) return null;
    const before = parseDnc(r.dnc);
    const after = DNC_CHANNELS.filter((c) => (before.includes(c) || add.includes(c)) && !remove.includes(c));
    const added = after.filter((c) => !before.includes(c));
    const removed = before.filter((c) => !after.includes(c));
    if (!added.length && !removed.length) return getColdLead(offerId, r.id);
    const now = new Date().toISOString();
    const why = String(note || '').trim().slice(0, 500);
    db.prepare('UPDATE leads SET dnc = ?, dnc_note = ?, dnc_at = ?, updated_at = ? WHERE id = ?').run(
      after.join(','),
      after.length ? why || (added.length ? '' : r.dnc_note) : '',
      after.length ? (added.length ? now : r.dnc_at) : null,
      now,
      r.id
    );
    const tz = getSettings().timezone;
    const day = dayKey(now, tz);
    const log = db.prepare("INSERT INTO lead_dials(lead_id, offer_id, date, outcome, channel, label, note, counted, at) VALUES(?, ?, ?, NULL, ?, ?, ?, 0, ?)");
    for (const c of added) log.run(r.id, offerId, day, c, 'Opted out', `Asked not to get ${CHANNEL_WORD[c]}${why ? `: ${why}` : ''}`, now);
    for (const c of removed) log.run(r.id, offerId, day, c, 'Opted back in', `OK to contact by ${CHANNEL_WORD[c]} again${why ? `: ${why}` : ''}`, now);
    return getColdLead(offerId, r.id);
  })();
}
