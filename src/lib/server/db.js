import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

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

const shapeOffer = (r) =>
  r && {
    id: r.id,
    name: r.name,
    industry: r.industry,
    price: r.price,
    keywords: r.keywords,
    notes: r.notes,
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
  return out;
}

export function createOffer(o) {
  const f = { name: '', industry: '', price: null, keywords: '', notes: '', ...offerFields(o) };
  if (!f.name) throw new Error('Give the offer a name');
  const now = new Date().toISOString();
  const id = db
    .prepare(
      'INSERT INTO offers(name, industry, price, keywords, notes, created_at, opened_at) VALUES(@name, @industry, @price, @keywords, @notes, @now, @now)'
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
export function sdrDay(offerId, date) {
  return db.prepare('SELECT * FROM sdr_days WHERE offer_id = ? AND date = ?').get(offerId, date) ?? null;
}

export function monthMeta(offerId, month) {
  const rows = db.prepare('SELECT kind, days_worked FROM month_meta WHERE offer_id = ? AND month = ?').all(offerId, month);
  const m = { sdr: null, close: null };
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
         f.action_items AS f_action_items, f.start AS f_start
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
