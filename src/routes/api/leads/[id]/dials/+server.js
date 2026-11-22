import { json, error } from '@sveltejs/kit';
import { logDial, getSettings } from '$lib/server/db.js';
import { dayKey } from '$lib/time.js';
import { callbackCalendarFor } from '$lib/server/callbackCal.js';
export async function POST({ params, request, locals }) {
  const b = await request.json();
  if (!String(b.reason || '').trim()) error(400, 'Pick a reason for this outcome');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : dayKey(Date.now(), getSettings().timezone);
  let lead;
  try {
    lead = logDial(locals.offer.id, params.id, { ...b, date });
  } catch (e) {
    error(400, e.message);
  }
  if (!lead) error(404, 'Lead not found');
  return json({ lead, calendar: await callbackCalendarFor(params.id) });
}
