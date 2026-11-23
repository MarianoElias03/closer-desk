import { db, getSettings, setSetting, sdrDay, dmDay, getOffer } from './db.js';
import { sdrTotal } from '../stats.js';
import { dayKey, dayStartIso, addDays } from '../time.js';

/**
 * "I'm working" timer and pace. Press Start and a work session begins on the open offer; Stop (or
 * Pause) ends it. Each offer can have a target: so many leads an hour, or so many a day over so many
 * hours. While a session runs, the pace check says how many leads you should have done by now and
 * whether you're behind.
 *
 * "Leads" is that offer's own work count for the day: dials (every outcome logged on a lead plus the
 * dial pad taps, the Dialling total) on dialling offers, and leads contacted on DM setting offers. A
 * session snapshots the count when it starts, so only what you do while the clock runs counts towards
 * the hourly pace.
 */

db.exec(`
CREATE TABLE IF NOT EXISTS work_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offer_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  start_count INTEGER NOT NULL DEFAULT 0,
  end_count INTEGER
);
CREATE INDEX IF NOT EXISTS work_sessions_day ON work_sessions(offer_id, date);
`);

const tz = () => getSettings().timezone;
const today = () => dayKey(Date.now(), tz());

/** What counts as a lead worked, for an offer, on a day. */
export function workCount(offer, date) {
  if (!offer) return 0;
  if (offer.roles.includes('sdr')) return sdrTotal(sdrDay(offer.id, date));
  if (offer.roles.includes('dm')) return dmDay(offer.id, date)?.contacted || 0;
  return 0;
}
export const countLabel = (offer) => (offer?.roles.includes('sdr') ? 'dials' : offer?.roles.includes('dm') ? 'leads contacted' : '');

// ---- targets (per offer) ----

const DEFAULT_TARGET = { mode: 'hour', perHour: 0, perDay: 0, dayHours: 4 };

export function getTarget(offerId) {
  try {
    return { ...DEFAULT_TARGET, ...JSON.parse(getSettings()[`pace.${offerId}`] || '{}') };
  } catch {
    return { ...DEFAULT_TARGET };
  }
}
export function setTarget(offerId, t) {
  const n = (v, max) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
  const clean = {
    mode: t.mode === 'day' ? 'day' : 'hour',
    perHour: n(t.perHour, 500),
    perDay: n(t.perDay, 5000),
    dayHours: Math.max(0.5, Math.min(16, Math.round((Number(t.dayHours) || 4) * 2) / 2))
  };
  setSetting(`pace.${offerId}`, JSON.stringify(clean));
  return clean;
}

// ---- sessions ----

const running = () => db.prepare('SELECT * FROM work_sessions WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1').get();

/** Start on an offer. A session already running (on any offer) is ended first, so only one clock runs. */
export function startWork(offerId) {
  const offer = getOffer(offerId);
  if (!offer) throw new Error('Pick an offer first');
  stopWork();
  const d = today();
  db.prepare('INSERT INTO work_sessions(offer_id, date, started_at, start_count) VALUES(?, ?, ?, ?)').run(
    offer.id,
    d,
    new Date().toISOString(),
    workCount(offer, d)
  );
  return workStatus(offer.id);
}

export function stopWork() {
  const s = running();
  if (!s) return null;
  // a session left running past midnight ends at the end of its own day
  const end = s.date === today() ? new Date().toISOString() : dayStartIso(addDays(s.date, 1), tz());
  db.prepare('UPDATE work_sessions SET ended_at = ?, end_count = ? WHERE id = ?').run(end, workCount(getOffer(s.offer_id), s.date), s.id);
  return s;
}

/**
 * Where you're at on an offer today: the clock, what you've done, and the pace.
 * `expected` is how many you should have by now; `behind` how many short you are (0 when on pace).
 */
export function workStatus(offerId) {
  const offer = getOffer(offerId);
  const d = today();
  const now = Date.now();
  let r = running();
  if (r && r.date !== d) {
    stopWork(); // yesterday's forgotten session
    r = null;
  }
  const sessions = db.prepare('SELECT * FROM work_sessions WHERE offer_id = ? AND date = ? ORDER BY id').all(offerId, d);
  const countNow = workCount(offer, d);
  let workedMs = 0;
  let doneInSessions = 0;
  for (const s of sessions) {
    const end = s.ended_at ? Date.parse(s.ended_at) : now;
    workedMs += Math.max(0, end - Date.parse(s.started_at));
    doneInSessions += Math.max(0, (s.ended_at ? s.end_count ?? countNow : countNow) - s.start_count);
  }
  const target = getTarget(offerId);
  const perHour = target.mode === 'day' ? (target.perDay && target.dayHours ? target.perDay / target.dayHours : 0) : target.perHour;
  const hours = workedMs / 3_600_000;
  // give the first ten minutes of the day's work before calling you behind
  const expected = perHour ? Math.floor(perHour * hours) : 0;
  const counted = target.mode === 'day' ? countNow : doneInSessions;
  const behind = perHour && workedMs > 10 * 60_000 ? Math.max(0, expected - counted) : 0;
  const here = r && r.offer_id === offerId ? r : null;
  return {
    offerId,
    label: countLabel(offer),
    running: here ? { since: here.started_at, startCount: here.start_count, done: Math.max(0, countNow - here.start_count) } : null,
    elsewhere: r && r.offer_id !== offerId ? { offerId: r.offer_id, name: getOffer(r.offer_id)?.name || '', since: r.started_at } : null,
    workedMs,
    today: countNow,
    doneInSessions,
    counted,
    target,
    perHour,
    expected,
    behind,
    // the day target, and what's left of it
    dayGoal: target.mode === 'day' ? target.perDay : null,
    dayLeft: target.mode === 'day' && target.perDay ? Math.max(0, target.perDay - countNow) : null,
    at: new Date(now).toISOString()
  };
}
