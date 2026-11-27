import { db, getSettings, setSetting } from './db.js';
import { googleAccessToken } from './sync.js';
import { accessToken as accountToken, calendarAccounts } from './mail.js';

/**
 * The Google calendars Closer Desk works with:
 *   ''        your personal calendar (the account in the server's GOOGLE_REFRESH_TOKEN)
 *   an email  a connected email account that also allowed calendar events (Settings > Email accounts)
 *
 * Each offer picks which one its booked calls go on, and whether a private copy (no guests) also goes
 * on your personal calendar so you see it there too. Before booking, every calendar is checked for
 * something already at that time.
 */

const env = process.env;
const BASE = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
export const personalOn = () => Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REFRESH_TOKEN);

export const tokenFor = (acct) => (acct ? accountToken(acct) : googleAccessToken());

/** Call the events API on one account's main calendar. 404/410 come back as { gone: true }. */
export async function gapi(acct, method, path = '', body, query = {}) {
  const u = new URL(BASE + path);
  for (const [k, v] of Object.entries(query)) u.searchParams.set(k, String(v));
  const r = await fetch(u, {
    method,
    headers: { authorization: `Bearer ${await tokenFor(acct)}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  if (r.status === 404 || r.status === 410) return { gone: true };
  if (r.status === 204) return {};
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(`Google Calendar${acct ? ` (${acct})` : ''}: ${j.error?.message || r.status}`);
    e.status = r.status;
    throw e;
  }
  return j;
}

/** Your personal calendar's address, looked up once. */
export async function personalEmail() {
  const s = getSettings().personal_cal_email;
  if (s) return s;
  if (!personalOn()) return '';
  try {
    const r = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary', { headers: { authorization: `Bearer ${await googleAccessToken()}` } });
    const id = (await r.json()).id || '';
    if (id) setSetting('personal_cal_email', id);
    return id;
  } catch {
    return '';
  }
}

/** Every calendar to sync and check: [{ acct, label }]. */
export function allCalendars() {
  return [...(personalOn() ? [{ acct: '', label: 'Personal' }] : []), ...calendarAccounts().map((a) => ({ acct: a.email, label: a.email }))];
}
export const calLabel = (acct) => (acct ? acct : 'your personal calendar');

// ---- where an offer's booked calls go ----

export function bookingSetup(offerId) {
  const s = getSettings();
  return { book: s[`cal_book_${offerId}`] || '', copy: s[`cal_copy_${offerId}`] !== '0' };
}
export function setBookingSetup(offerId, { book, copy }) {
  const ok = !book || calendarAccounts().some((a) => a.email.toLowerCase() === String(book).toLowerCase());
  if (!ok) throw new Error(`${book} hasn't given calendar access yet. Reconnect it under Email accounts first.`);
  setSetting(`cal_book_${offerId}`, book ? String(book) : '');
  setSetting(`cal_copy_${offerId}`, copy ? '1' : '0');
  return bookingSetup(offerId);
}
/** The calendar to book on now, falling back to personal if the chosen one lost access. */
export function bookingTarget(offerId) {
  const { book, copy } = bookingSetup(offerId);
  if (book && !calendarAccounts().some((a) => a.email.toLowerCase() === book.toLowerCase()))
    return { acct: '', copy: false, warn: `${book} needs reconnecting with calendar access, so it went on your personal calendar` };
  return { acct: book, copy: !!book && copy && personalOn() };
}

// ---- the private copy on your personal calendar ----

const copyBody = (ev, mainId, acct) => ({
  summary: ev.summary,
  description: `${ev.description || ''}\n\n(Copy of the booking on ${acct}. Change it there or in Closer Desk.)`.trim(),
  location: ev.location || '',
  start: ev.start,
  end: ev.end,
  transparency: 'transparent', // the real event already blocks the time
  extendedProperties: { private: { closerDeskCopyOf: mainId } }
});
export async function makeCopy(ev, mainId, acct) {
  const c = await gapi('', 'POST', '', copyBody(ev, mainId, acct), { sendUpdates: 'none' });
  db.prepare('UPDATE calls SET copy_id = ? WHERE id = ?').run(c.id, mainId);
  return c.id;
}
export async function updateCopy(copyId, ev, mainId, acct) {
  if (!copyId) return;
  const r = await gapi('', 'PATCH', `/${encodeURIComponent(copyId)}`, copyBody(ev, mainId, acct), { sendUpdates: 'none' });
  if (r.gone) await makeCopy(ev, mainId, acct);
}
export async function deleteCopy(copyId, mainId) {
  if (!copyId) return;
  await gapi('', 'DELETE', `/${encodeURIComponent(copyId)}`, null, { sendUpdates: 'none' }).catch(() => {});
  if (mainId) db.prepare('UPDATE calls SET copy_id = NULL WHERE id = ?').run(mainId);
}

// ---- conflicts ----

/**
 * What's already on any calendar between start and end (ISO). Skips cancelled, free and all-day
 * events, ones you declined, and the ids in ignore (the call being moved, and its copy).
 * Returns { clashes: [{ title, start, end, calendar }], unchecked: [labels that couldn't be read] }.
 */
export async function conflicts(start, end, ignore = []) {
  const skip = new Set(ignore.filter(Boolean));
  const clashes = [];
  const unchecked = [];
  await Promise.all(
    allCalendars().map(async ({ acct, label }) => {
      try {
        const j = await gapi(acct, 'GET', '', null, { timeMin: start, timeMax: end, singleEvents: 'true', maxResults: '50' });
        for (const ev of j.items || []) {
          if (ev.status === 'cancelled' || !ev.start?.dateTime || ev.transparency === 'transparent') continue;
          if (skip.has(ev.id) || skip.has(ev.extendedProperties?.private?.closerDeskCopyOf)) continue;
          if ((ev.attendees || []).some((a) => a.self && a.responseStatus === 'declined')) continue;
          if (!(Date.parse(ev.start.dateTime) < Date.parse(end) && Date.parse(ev.end?.dateTime || ev.start.dateTime) > Date.parse(start))) continue;
          clashes.push({ title: ev.summary || '(busy)', start: new Date(ev.start.dateTime).toISOString(), end: new Date(ev.end?.dateTime || ev.start.dateTime).toISOString(), calendar: label });
        }
      } catch {
        unchecked.push(label);
      }
    })
  );
  // the same meeting on two calendars (you're invited on both) shows once
  const seen = new Set();
  return {
    clashes: clashes.filter((c) => (seen.has(c.title + c.start) ? false : seen.add(c.title + c.start))).sort((a, b) => a.start.localeCompare(b.start)),
    unchecked
  };
}

/** "Clashes with SDR - CB FIT (11:00 am, Personal)". */
export function clashNote(list, tz) {
  if (!list?.length) return '';
  const t = (iso) => new Intl.DateTimeFormat('en-AU', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso)).toLowerCase();
  return `Clashes with ${list.map((c) => `${c.title} (${t(c.start)}, ${c.calendar})`).join(', ')}`;
}
