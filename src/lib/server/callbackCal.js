import { db, getSettings, atFrom, getColdLead, updateColdLead, logActivity, niceWhen, niceDay } from './db.js';
import { googleAccessToken } from './sync.js';
import { zoomConnected, createZoomMeeting, deleteZoomMeeting } from './zoom.js';
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
        const at12 = x.time ? ` at ${((+x.time.slice(0, 2) + 11) % 12) + 1}:${x.time.slice(3)} ${+x.time.slice(0, 2) < 12 ? 'am' : 'pm'}` : '';
        const verb = !cur ? 'added to' : cur.day !== x.follow_up ? 'moved on' : 'updated on';
        logActivity(id, 'calendar', `Callback ${verb} your calendar: ${niceDay(x.follow_up)}${at12}`, { merge: verb === 'updated on' ? 10 : 0 });
      } else {
        // only take a callback off the calendar while it's still ahead; past ones stay as a record
        if (x.day >= today) await google('DELETE', `${API}/${encodeURIComponent(x.event_id)}`, token);
        forget.run(id);
        if (x.day >= today) {
          result.removed.push(id);
          logActivity(id, 'calendar', `Callback on ${niceDay(x.day)} taken off your calendar`);
        }
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

// ---------- booked calls ----------

const BOOKED_MINUTES = 60;

/**
 * You pressed Booked and gave the call's date and time: put a 1-hour event on the calendar, titled with
 * the offer's first call keyword ("Offroad Hybrids GamePlan Call") so the calendar sync treats it like
 * any other booking, and link it to the lead straight away. The lead is not invited. Skipped when the
 * lead already has a booked call (e.g. they booked through your link and it has synced).
 */
/**
 * opts.meeting: 'zoom' (a new Zoom meeting, the default once Zoom is connected), 'meet' (Google Meet,
 * the default until then), a https link, or 'none'. opts.guests: emails to invite (the lead, a
 * teammate); opts.notify: email them the invite.
 */
export async function bookCallEvent(offerId, leadId, dialId, date, time, opts = {}) {
  try {
    if (!connected()) return { error: "Google Calendar isn't connected, so the call wasn't added" };
    const lead = getColdLead(offerId, leadId);
    if (!lead) return null;
    if (lead.call && !lead.call.cancelled) return { linked: true };
    const tz = getSettings().timezone;
    const offer = db.prepare('SELECT keywords FROM offers WHERE id = ?').get(offerId);
    const kind = (offer?.keywords || '').split(',').map((k) => k.trim()).filter(Boolean)[0] || 'Discovery Call';
    const who = lead.business || lead.contact || lead.phone || 'Lead';
    const start = atFrom(date, time);
    const end = new Date(new Date(start).getTime() + BOOKED_MINUTES * 60000).toISOString();
    const lines = [
      lead.contact && `Contact: ${lead.contact}`,
      lead.phone && `Phone:- ${lead.phone}`,
      lead.email && `Email:- ${lead.email}`,
      (env.APP_URL || env.ORIGIN) && `Lead: ${(env.APP_URL || env.ORIGIN).replace(/\/$/, '')}/leads/${lead.id}`
    ];
    const meeting = opts.meeting || (zoomConnected() ? 'zoom' : 'meet');
    let joinUrl = null;
    let meetingId = null;
    let warn = null;
    if (meeting === 'zoom') {
      try {
        const m = await createZoomMeeting(`${who} ${kind}`, start, end, tz);
        joinUrl = m.joinUrl;
        meetingId = m.id;
      } catch (e) {
        warn = `${e.message}. Booked with Google Meet instead.`;
      }
    } else if (/^https:\/\/\S+$/.test(meeting)) joinUrl = meeting;
    const useMeet = meeting === 'meet' || (meeting === 'zoom' && !joinUrl);
    const label = joinUrl ? (/zoom\.us/.test(joinUrl) ? 'Join Zoom' : 'Join the call') : null;
    const guests = [...new Set((opts.guests || []).map((e) => String(e).trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))];
    const body = {
      summary: `${who} ${kind}`,
      description: `${label ? `${label}: ${joinUrl}\n\n` : ''}${lines.filter(Boolean).join('\n')}\n\nBooked from Closer Desk.`,
      start: { dateTime: start, timeZone: tz },
      end: { dateTime: end, timeZone: tz },
      ...(joinUrl ? { location: joinUrl } : {}),
      ...(useMeet ? { conferenceData: { createRequest: { requestId: `cd-book-${lead.id}-${Date.now()}`, conferenceSolutionKey: { type: 'hangoutsMeet' } } } } : {}),
      ...(guests.length ? { attendees: guests.map((email) => ({ email })), guestsCanSeeOtherGuests: true } : {}),
      extendedProperties: { private: { closerDeskBooked: String(lead.id) } }
    };
    const token = await googleAccessToken();
    const q = new URLSearchParams({ sendUpdates: opts.notify && guests.length ? 'all' : 'none', ...(useMeet ? { conferenceDataVersion: '1' } : {}) });
    const ev = await google('POST', `${API}?${q}`, token, body);
    joinUrl = ev.hangoutLink || joinUrl;
    db.prepare(
      `INSERT INTO calls(id, offer_id, title, prospect, email, phone, start, end, join_url, description, kind, status, source, meeting_id, attendees, updated_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', 'calendar', ?, ?, ?) ON CONFLICT(id) DO NOTHING`
    ).run(ev.id, offerId, body.summary, who, lead.email || null, lead.phone || null, start, end, joinUrl, body.description, kind, meetingId, JSON.stringify(guests), new Date().toISOString());
    db.prepare('UPDATE lead_dials SET event_id = ? WHERE id = ?').run(ev.id, Number(dialId));
    updateColdLead(offerId, lead.id, { callId: ev.id }, { log: false });
    const how = joinUrl ? (meetingId ? 'Zoom' : useMeet ? 'Google Meet' : 'your link') : null;
    logActivity(lead.id, 'call', `Call booked for ${niceWhen(start)}${how ? ` on ${how}` : ''}, added to your calendar`);
    if (opts.notify && guests.length) logActivity(lead.id, 'mail', `Calendar invite emailed to ${guests.join(', ')}`);
    if (warn) logActivity(lead.id, 'call', warn);
    return { booked: true, invited: opts.notify && guests.length ? guests.length : 0, meeting: joinUrl ? (meetingId ? 'zoom' : useMeet ? 'meet' : 'link') : null, warn };
  } catch (e) {
    console.error('[booked]', e);
    return { error: 'Could not add the call to your calendar' };
  }
}

/**
 * Undoing a Booked that made its own event: take the event off (only while it's still ahead) and drop
 * the call it created. Calls you booked any other way are left alone.
 */
export async function unbookCallEvent(offerId, leadId, eventId) {
  if (!eventId) return null;
  try {
    const call = db.prepare('SELECT start, meeting_id FROM calls WHERE id = ?').get(eventId);
    const lead = getColdLead(offerId, leadId);
    if (lead?.call?.id === eventId) updateColdLead(offerId, leadId, { callId: null }, { log: false });
    if (!call || new Date(call.start) < new Date()) return null;
    logActivity(leadId, 'call', `Booked call on ${niceWhen(call.start)} taken off your calendar (Booked undone)`);
    db.prepare('DELETE FROM calls WHERE id = ?').run(eventId);
    if (call.meeting_id) await deleteZoomMeeting(call.meeting_id).catch(() => {});
    if (connected()) await google('DELETE', `${API}/${encodeURIComponent(eventId)}`, await googleAccessToken());
    return { unbooked: true };
  } catch (e) {
    console.error('[booked]', e);
    return { error: 'Could not take the call off your calendar' };
  }
}
