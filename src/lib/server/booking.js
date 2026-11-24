import { db, getSettings, setSetting, getCall, closeDayFromCalls, syncCallFollowUps, logActivity, niceWhen } from './db.js';
import { googleAccessToken } from './sync.js';
import { zoomConnected, createZoomMeeting, moveZoomMeeting, deleteZoomMeeting } from './zoom.js';
import { dayKey } from '../time.js';

/**
 * Change a booking on your Google Calendar from Closer Desk: move it, change its meeting link (a new
 * Zoom meeting, Google Meet, or any link you paste), and choose who's invited. Google only emails the
 * guests when you ask it to (notify), and then sends the invite or the update from your calendar.
 *
 * Calls added by hand in Closer Desk aren't on Google Calendar, so only their time and link change here.
 */

const API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const env = process.env;
const googleOn = () => Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REFRESH_TOKEN);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---- regular guests (e.g. a teammate you often bring onto calls), set in Settings ----

export function regularGuests() {
  try {
    return JSON.parse(getSettings().guests || '[]');
  } catch {
    return [];
  }
}
export function setRegularGuests(list) {
  const clean = (Array.isArray(list) ? list : [])
    .map((g) => ({ name: String(g.name || '').trim().slice(0, 60), email: String(g.email || '').trim().toLowerCase().slice(0, 160) }))
    .filter((g) => EMAIL.test(g.email))
    .slice(0, 20);
  setSetting('guests', JSON.stringify(clean));
  return clean;
}

// ---- Google ----

async function gcal(method, path, body, query = {}) {
  const u = new URL(API + path);
  for (const [k, v] of Object.entries(query)) u.searchParams.set(k, String(v));
  const r = await fetch(u, {
    method,
    headers: { authorization: `Bearer ${await googleAccessToken()}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const why = j.error?.message || r.status;
    if (r.status === 403) throw new Error(`Google won't let you change this one (${why}). It may belong to someone else's calendar.`);
    if (r.status === 404 || r.status === 410) throw new Error("That booking isn't on your Google Calendar any more");
    throw new Error(`Google Calendar: ${why}`);
  }
  return j;
}

const joinUrlOf = (ev) =>
  ev.hangoutLink || ev.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri || (/^https?:\/\//.test(ev.location || '') ? ev.location : null);
const guestsOf = (ev) => (ev.attendees || []).filter((a) => !a.self && !a.resource).map((a) => ({ email: a.email, name: a.displayName || '', status: a.responseStatus || '' }));

/** The "Join: <link>" line we keep at the top of the description, swapped when the link changes. */
function withJoinLine(desc, url) {
  const rest = String(desc || '').replace(/^Join (?:Zoom|the call|Google Meet): \S+\n*/m, '').trimStart();
  if (!url) return rest;
  const label = /zoom\.us/.test(url) ? 'Join Zoom' : /meet\.google/.test(url) ? 'Join Google Meet' : 'Join the call';
  return `${label}: ${url}\n\n${rest}`.trimEnd();
}

/** Where a call stands: its link, guests, and whether Closer Desk can change it on Google. */
export async function bookingInfo(callId) {
  const call = getCall(callId);
  if (!call) throw new Error('Call not found');
  const row = db.prepare('SELECT source, meeting_id FROM calls WHERE id = ?').get(callId);
  const base = { id: call.id, start: call.start, end: call.end, joinUrl: call.joinUrl, meetingId: row?.meeting_id || null, regular: regularGuests(), zoom: zoomConnected() };
  if (row?.source === 'manual' || !googleOn()) return { ...base, onGoogle: false, guests: [], editable: true };
  try {
    const ev = await gcal('GET', `/${encodeURIComponent(callId)}`);
    return { ...base, onGoogle: true, editable: ev.organizer?.self !== false, organizer: ev.organizer?.email || '', guests: guestsOf(ev), joinUrl: joinUrlOf(ev) || call.joinUrl };
  } catch (e) {
    return { ...base, onGoogle: false, guests: [], editable: true, problem: e.message };
  }
}

/**
 * Change a booking. Any of:
 *   start, end            ISO times (move it)
 *   meeting               'zoom' (a new Zoom meeting) | 'meet' (Google Meet) | 'keep' | a https link | '' (no link)
 *   guests                every guest email it should have (replaces the list)
 *   notify                email the guests the invite or update (Google sends it from your calendar)
 */
export async function editBooking(callId, change) {
  const before = getCall(callId);
  if (!before) throw new Error('Call not found');
  const row = db.prepare('SELECT source, meeting_id FROM calls WHERE id = ?').get(callId);
  const tz = getSettings().timezone;
  const start = change.start ? new Date(change.start).toISOString() : before.start;
  const end = change.end ? new Date(change.end).toISOString() : change.start ? new Date(Date.parse(start) + (Date.parse(before.end) - Date.parse(before.start))).toISOString() : before.end;
  if (!(Date.parse(end) > Date.parse(start))) throw new Error('The call has to end after it starts');
  const moved = start !== before.start || end !== before.end;
  let meetingId = row?.meeting_id || null;
  let joinUrl = before.joinUrl;
  let note = [];

  // 1. the meeting link
  const want = change.meeting ?? 'keep';
  if (want === 'zoom') {
    if (!zoomConnected()) throw new Error('Connect Zoom in Settings first');
    if (meetingId) await deleteZoomMeeting(meetingId).catch(() => {});
    const m = await createZoomMeeting(before.title || before.prospect || 'Sales call', start, end, tz);
    meetingId = m.id;
    joinUrl = m.joinUrl;
  } else if (want !== 'keep' && want !== 'meet') {
    if (want && !/^https:\/\/\S+$/.test(want)) throw new Error('Paste a full https:// meeting link');
    if (meetingId) await deleteZoomMeeting(meetingId).catch(() => {});
    meetingId = null;
    joinUrl = want || null;
  } else if (want === 'meet' && meetingId) {
    await deleteZoomMeeting(meetingId).catch(() => {});
    meetingId = null;
  }
  // our own Zoom meeting follows the booking's new time
  if (moved && meetingId && want === 'keep') await moveZoomMeeting(meetingId, start, end, tz).catch((e) => note.push(e.message));

  // 2. Google Calendar
  let ev = null;
  if (row?.source !== 'manual' && googleOn()) {
    const cur = await gcal('GET', `/${encodeURIComponent(callId)}`);
    const patch = {};
    const query = { sendUpdates: change.notify ? 'all' : 'none' };
    if (moved) {
      patch.start = { dateTime: start, timeZone: tz };
      patch.end = { dateTime: end, timeZone: tz };
    }
    if (want === 'meet') {
      patch.conferenceData = { createRequest: { requestId: `cd-${callId.slice(0, 20)}-${Date.now()}`, conferenceSolutionKey: { type: 'hangoutsMeet' } } };
      patch.location = /^https?:\/\//.test(cur.location || '') ? '' : cur.location || '';
      patch.description = withJoinLine(cur.description, null);
      query.conferenceDataVersion = 1;
    } else if (want !== 'keep') {
      // a Zoom or pasted link replaces any Google Meet on the event
      if (cur.conferenceData) {
        patch.conferenceData = null;
        query.conferenceDataVersion = 1;
      }
      patch.location = joinUrl || '';
      patch.description = withJoinLine(cur.description, joinUrl);
    }
    if (Array.isArray(change.guests)) {
      const emails = [...new Set(change.guests.map((e) => String(e).trim().toLowerCase()).filter((e) => EMAIL.test(e)))];
      const keepSelf = (cur.attendees || []).filter((a) => a.self || a.resource);
      const existing = new Map((cur.attendees || []).map((a) => [a.email?.toLowerCase(), a]));
      patch.attendees = [...keepSelf, ...emails.map((e) => existing.get(e) || { email: e })];
      patch.guestsCanSeeOtherGuests = true;
    }
    if (Object.keys(patch).length) ev = await gcal('PATCH', `/${encodeURIComponent(callId)}`, patch, query);
    else ev = cur;
    joinUrl = joinUrlOf(ev) || joinUrl;
  }

  // 3. Closer Desk's own copy, the closing numbers for both days, and the lead's follow-up date
  db.prepare('UPDATE calls SET start = ?, end = ?, join_url = ?, meeting_id = ?, attendees = ?, updated_at = ? WHERE id = ?').run(
    start,
    end,
    joinUrl,
    meetingId,
    ev ? JSON.stringify(guestsOf(ev).map((g) => g.email)) : null,
    new Date().toISOString(),
    callId
  );
  // 4. the lead's timeline
  const beforeGuests = new Set((before.guests || []).map((g) => String(g.email || g).toLowerCase()));
  const afterGuests = ev ? guestsOf(ev).map((g) => g.email.toLowerCase()) : [];
  const lines = [];
  if (moved) lines.push(`Call moved to ${niceWhen(start)}`);
  if (want !== 'keep') lines.push(want === 'zoom' ? 'New Zoom link' : want === 'meet' ? 'Switched to Google Meet' : want ? 'Meeting link changed' : 'Meeting link removed');
  if (Array.isArray(change.guests) && ev) {
    const added = afterGuests.filter((g) => !beforeGuests.has(g));
    const gone = [...beforeGuests].filter((g) => !afterGuests.includes(g));
    if (added.length) lines.push(`invited ${added.join(', ')}`);
    if (gone.length) lines.push(`removed ${gone.join(', ')}`);
  }
  const notified = !!change.notify && !!ev;
  for (const l of db.prepare('SELECT id FROM leads WHERE call_id = ?').all(callId)) {
    if (lines.length) logActivity(l.id, 'call', lines.map((x, i) => (i ? x : x[0].toUpperCase() + x.slice(1))).join('; '));
    if (notified && afterGuests.length) logActivity(l.id, 'mail', `Calendar ${moved || want !== 'keep' ? 'update' : 'invite'} emailed to ${afterGuests.join(', ')}`);
  }
  if (moved) {
    const tzName = tz;
    for (const iso of new Set([before.start, start])) closeDayFromCalls(before.offerId, dayKey(iso, tzName));
    syncCallFollowUps({ log: false });
  }
  return { call: getCall(callId), guests: ev ? guestsOf(ev) : [], notified: !!change.notify && !!ev, warnings: note };
}
