import { json, error } from '@sveltejs/kit';
import { logDial, getSettings, getColdLead, cleanTime } from '$lib/server/db.js';
import { dayKey } from '$lib/time.js';
import { callbackCalendarFor, bookCallEvent } from '$lib/server/callbackCal.js';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function POST({ params, request, locals }) {
  const b = await request.json();
  if (!String(b.reason || '').trim()) error(400, 'Pick a reason for this outcome');
  // every callback goes on the calendar as a 15-minute slot, so it needs a time
  if (b.outcome === 'callback' && !cleanTime(b.followUpTime)) error(400, 'Pick a time for the callback');
  // pressing Booked puts the 1-hour call on the calendar, unless it's already there
  const mode = locals.offer.roles.includes('sdr') ? 'sdr' : locals.offer.roles.includes('dm') ? 'dm' : null;
  if (!mode) error(400, 'This offer has no dialling or DM setting, so log contacts in the history instead');
  const channel = mode === 'dm' ? 'dm' : 'call';
  const before = b.outcome === 'booked' ? getColdLead(locals.offer.id, params.id) : null;
  // a booked call goes on the calendar only on offers where you take the calls
  const book = b.outcome === 'booked' && locals.offer.roles.includes('closing') && !b.bookSkip && !(before?.call && !before.call.cancelled);
  if (book && !(DAY.test(b.bookDate || '') && cleanTime(b.bookTime))) error(400, 'Pick the date and time of the call');
  const date = DAY.test(b.date || '') ? b.date : dayKey(Date.now(), getSettings().timezone);
  let lead;
  try {
    lead = logDial(locals.offer.id, params.id, { ...b, date, channel });
  } catch (e) {
    error(400, e.message);
  }
  if (!lead) error(404, 'Lead not found');
  let calendar = null;
  if (book) {
    const dialId = Math.max(...lead.dials.map((d) => d.id));
    calendar = await bookCallEvent(locals.offer.id, params.id, dialId, b.bookDate, b.bookTime);
    lead = getColdLead(locals.offer.id, params.id);
  }
  const cb = await callbackCalendarFor(params.id);
  return json({ lead, calendar: calendar || cb });
}
