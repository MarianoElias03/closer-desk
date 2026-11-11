import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, 'closer.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS sdr_days (
  date TEXT PRIMARY KEY,
  no_answer INTEGER NOT NULL DEFAULT 0,
  booked INTEGER NOT NULL DEFAULT 0,
  not_interested INTEGER NOT NULL DEFAULT 0,
  callback INTEGER NOT NULL DEFAULT 0,
  wrong_no INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS close_days (
  date TEXT PRIMARY KEY,
  no_show INTEGER NOT NULL DEFAULT 0,
  closed INTEGER NOT NULL DEFAULT 0,
  not_interested INTEGER NOT NULL DEFAULT 0,
  callbacks INTEGER NOT NULL DEFAULT 0,
  unqualified INTEGER NOT NULL DEFAULT 0,
  cash REAL NOT NULL DEFAULT 0,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS month_meta (
  month TEXT NOT NULL,
  kind TEXT NOT NULL,
  days_worked INTEGER,
  PRIMARY KEY (month, kind)
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

const DEFAULTS = {
  keywords: 'GamePlan Call, Discovery Call',
  timezone: 'Australia/Brisbane',
  currency: 'AUD'
};

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

const SDR_FIELDS = ['no_answer', 'booked', 'not_interested', 'callback', 'wrong_no'];
const CLOSE_FIELDS = ['no_show', 'closed', 'not_interested', 'callbacks', 'unqualified', 'cash'];

function upsert(table, fields, date, values) {
  const clean = {};
  for (const f of fields) {
    const n = Number(values[f] ?? 0);
    clean[f] = Number.isFinite(n) && n >= 0 ? (f === 'cash' ? Math.round(n * 100) / 100 : Math.round(n)) : 0;
  }
  const empty = fields.every((f) => clean[f] === 0);
  if (empty) {
    db.prepare(`DELETE FROM ${table} WHERE date = ?`).run(date);
    return null;
  }
  const cols = fields.join(', ');
  const params = fields.map((f) => '@' + f).join(', ');
  const updates = fields.map((f) => `${f} = excluded.${f}`).join(', ');
  db.prepare(
    `INSERT INTO ${table}(date, ${cols}, updated_at) VALUES(@date, ${params}, @now)
     ON CONFLICT(date) DO UPDATE SET ${updates}, updated_at = excluded.updated_at`
  ).run({ ...clean, date, now: new Date().toISOString() });
  return { date, ...clean };
}

export const upsertSdr = (date, v) => upsert('sdr_days', SDR_FIELDS, date, v);
export const upsertClose = (date, v) => upsert('close_days', CLOSE_FIELDS, date, v);

export function sdrRange(from, to) {
  return db.prepare('SELECT * FROM sdr_days WHERE date >= ? AND date <= ? ORDER BY date').all(from, to);
}
export function closeRange(from, to) {
  return db.prepare('SELECT * FROM close_days WHERE date >= ? AND date <= ? ORDER BY date').all(from, to);
}
export function sdrDay(date) {
  return db.prepare('SELECT * FROM sdr_days WHERE date = ?').get(date) ?? null;
}

export function monthMeta(month) {
  const rows = db.prepare('SELECT kind, days_worked FROM month_meta WHERE month = ?').all(month);
  const m = { sdr: null, close: null };
  for (const r of rows) m[r.kind] = r.days_worked;
  return m;
}
export function setMonthMeta(month, kind, days) {
  if (days === null || days === '' || days === undefined) {
    db.prepare('DELETE FROM month_meta WHERE month = ? AND kind = ?').run(month, kind);
  } else {
    db.prepare(
      'INSERT INTO month_meta(month, kind, days_worked) VALUES(?, ?, ?) ON CONFLICT(month, kind) DO UPDATE SET days_worked = excluded.days_worked'
    ).run(month, kind, Math.max(0, Math.round(Number(days))));
  }
}

const CALL_SELECT = `
  SELECT c.*, f.title AS f_title, f.url AS f_url, f.share_url AS f_share_url, f.summary AS f_summary,
         f.action_items AS f_action_items, f.start AS f_start
  FROM calls c LEFT JOIN fathom f ON f.recording_id = c.fathom_id`;

export function callsRange(fromIso, toIso) {
  return db
    .prepare(`${CALL_SELECT} WHERE c.start >= ? AND c.start < ? AND c.status != 'cancelled' ORDER BY c.start`)
    .all(fromIso, toIso)
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
    fathom
  };
}

export const OUTCOMES = ['pending', 'no_show', 'closed', 'not_interested', 'callback', 'unqualified'];

export function updateCall(id, patch) {
  const allowed = { outcome: 'outcome', cash: 'cash', notes: 'notes', fathomManualUrl: 'fathom_manual_url', fathomId: 'fathom_id' };
  const sets = [];
  const vals = {};
  for (const [k, col] of Object.entries(allowed)) {
    if (!(k in patch)) continue;
    let v = patch[k];
    if (k === 'outcome' && !OUTCOMES.includes(v)) continue;
    if (k === 'cash') v = Math.max(0, Number(v) || 0);
    if (k === 'fathomManualUrl' || k === 'fathomId') v = v ? String(v).trim() : null;
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

export function createManualCall(c) {
  const id = 'manual-' + Date.now().toString(36);
  db.prepare(
    `INSERT INTO calls(id, title, prospect, email, phone, start, end, kind, source, updated_at)
     VALUES(@id, @title, @prospect, @email, @phone, @start, @end, @kind, 'manual', @now)`
  ).run({
    id,
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
