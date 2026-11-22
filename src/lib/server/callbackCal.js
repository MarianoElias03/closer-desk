import { db, getSettings } from './db.js';
import { googleAccessToken } from './sync.js';
import { dayKey, addDays } from '../time.js';

/**
 * Callbacks on the calendar. A lead whose latest outcome is a callback, with a follow-up date of today
 * or later and no booked call, gets one event on the primary Google Calendar: at the callback time if
 * one was given (15 minutes, reminder 10 minutes before), otherwise all day.
 *
 * The CRM is the source of truth and this keeps the calendar in step with it: a new date or time moves
 * the event, and once the callback is no longer wanted (they booked, another outcome, undo, the lead
 * was deleted) a future event is removed. Past events are left alone as a record. The calendar sync
 * skips these events (tagged closerDeskLead), so they never show up as calls.
 */

const env = process.env;
const connected = () => Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REFRESH_TOKEN);
const API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

function wanted(today) {
  const leads = db
    .prepare(
      `SELECT l.id, l.offer_id, l.business, l.contact, l.phone, l.email, l.follow_up, o.name AS offer
       FROM leads l JOIN offers o ON o.id = l.offer_id LEFT JOIN calls c ON c.id = l.call_id
       WHERE l.follow_up >= ? AND (l.call_id IS NULL OR c.id IS NULL OR c.status = 'cancelled')`
    )
    .all(today);
  // the latest outcome you logged (sheet history and plain notes don't change what's next)
  const latest = db.prepare(
    `SELECT outcome, reason, note, cb_time FROM lead_dials
     WHERE lead_id = ? AND label = '' AND outcome IS NOT NULL AND outcome != ''
     ORDER BY (date IS NULL), at DESC, id DESC LIMIT 1`
  );
  const out = new Map();
  for (const l of leads) {
    const d = latest.get(l.id);
    if (d?.outcome !== 'callback') continue;
    out.set(l.id, { ...l, time: d.cb_time || null, reason: d.reason || '', note: d.note || '' });
  }
  return out;
}

const sigOf = (w) => JSON.stringify([w.follow_up, w.time, w.business, w.contact, w.phone, w.reason, w.note]);

function plusMinutes(time, n) {
  const [h, m] = time.split(':').map(Number);
  const t = Math.min(h * 60 + m + n, 23 * 60 + 59);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

function eventBody(w, tz) {
  const who = w.business || w.contact || w.phone || 'lead';
  const lines = [
    w.phone && `Phone: ${w.phone}`,
    w.contact && w.business && `Contact: ${w.contact}`,
    w.email && `Email: ${w.email}`,
    w.reason && `Reason: ${w.reason}`,
    w.note && `Note: ${w.note}`,
    `Offer: ${w.offer}`,
    (env.APP_URL || env.ORIGIN) && `Lead: ${(env.APP_URL || env.ORIGIN).replace(/\/$/, '')}/leads/${w.id}`
  ];
  const timing = w.time
    ? {
        start: { dateTime: `${w.follow_up}T${w.time}:00`, timeZone: tz },
        end: { dateTime: `${w.follow_up}T${plusMinutes(w.time, 15)}:00`, timeZone: tz },
        reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 10 }] },
        transparency: 'opaque'
      }
    : { start: { date: w.follow_up }, end: { date: addDays(w.follow_up, 1) }, reminders: { useDefault: true }, transparency: 'transparent' };
  return {
    summary: `Call back ${who}${w.contact && w.business ? ` (${w.contact})` : ''}`,
    description: `${lines.filter(Boolean).join('\n')}\n\nAdded by Closer Desk. It moves or goes away when the callback changes there.`,
    ...timing,
    extendedProperties: { private: { closerDeskLead: String(w.id) } }
  };
}

async function google(method, url, token, body) {
  const r = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  if (r.status === 404 || r.status === 410) return { gone: true };
  if (!r.ok) throw new Error(`Calendar ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return r.status === 204 ? {} : r.json();
}

async function run() {
  const tz = getSettings().timezone;
  const today = dayKey(Date.now(), tz);
  const want = wanted(today);
  const have = new Map(db.prepare('SELECT * FROM lead_cal').all().map((r) => [r.lead_id, r]));
  const todo = [];
  for (const [id, w] of want) if (have.get(id)?.sig !== sigOf(w)) todo.push(['put', id, w]);
  for (const [id, r] of have) if (!want.has(id)) todo.push(['drop', id, r]);
  const result = { added: [], moved: [], removed: [], errors: [] };
  if (!todo.length) return result;
  const token = await googleAccessToken();
  const save = db.prepare(
    `INSERT INTO lead_cal(lead_id, offer_id, event_id, day, sig) VALUES(?, ?, ?, ?, ?)
     ON CONFLICT(lead_id) DO UPDATE SET offer_id = excluded.offer_id, event_id = excluded.event_id, day = excluded.day, sig = excluded.sig`
  );
  const forget = db.prepare('DELETE FROM lead_cal WHERE lead_id = ?');
  for (const [op, id, x] of todo) {
    try {
      if (op === 'put') {
        const cur = have.get(id);
        const body = eventBody(x, tz);
        let ev = cur ? await google('PUT', `${API}/${encodeURIComponent(cur.event_id)}`, token, body) : null;
        if (!ev || ev.gone || ev.status === 'cancelled') ev = await google('POST', API, token, body);
        save.run(id, x.offer_id, ev.id, x.follow_up, sigOf(x));
        (cur ? result.moved : result.added).push(id);
      } else {
        // only take a callback off the calendar while it's still ahead; past ones stay as a record
        if (x.day >= today) await google('DELETE', `${API}/${encodeURIComponent(x.event_id)}`, token);
        forget.run(id);
        if (x.day >= today) result.removed.push(id);
      }
    } catch (e) {
      result.errors.push(`${id}: ${e.message || e}`);
    }
  }
  return result;
}

let chain = Promise.resolve();

/** Bring the calendar in line with every lead's callback. Runs one at a time; safe to call after any write. */
export function syncCallbackEvents() {
  if (!connected()) return Promise.resolve({ skipped: true });
  const next = chain.then(run, run);
  chain = next.catch(() => {});
  return next;
}

/**
 * Sync, then say what happened to one lead's callback, for a toast: "added", "moved", "removed",
 * an error message, or null when nothing changed. Never throws: a calendar problem must not lose a dial.
 */
export async function callbackCalendarFor(leadId) {
  try {
    const r = await syncCallbackEvents();
    if (r.skipped) return null;
    const id = Number(leadId);
    const err = r.errors.find((e) => e.startsWith(`${id}:`));
    if (err) return { error: 'Could not update your calendar' };
    for (const k of ['added', 'moved', 'removed']) if (r[k].includes(id)) return { [k]: true };
    return null;
  } catch (e) {
    console.error('[callbacks]', e);
    return { error: 'Could not reach your calendar' };
  }
}
