import { json, error } from '@sveltejs/kit';
import { addLeadEntry, cleanTime } from '$lib/server/db.js';
import { callbackCalendarFor } from '$lib/server/callbackCal.js';
// Add a contact that happened outside the dialler, with its own date and time.
export async function POST({ params, request, locals }) {
  const b = await request.json();
  if (b.outcome && !String(b.reason || '').trim()) error(400, 'Add a reason for this outcome');
  if (b.outcome === 'callback' && b.followUp && !cleanTime(b.followUpTime)) error(400, 'Pick a time for the callback');
  let lead;
  try {
    lead = addLeadEntry(locals.offer.id, params.id, b);
  } catch (e) {
    error(400, e.message);
  }
  if (!lead) error(404, 'Lead not found');
  return json({ lead, calendar: lead.duplicateOf ? null : await callbackCalendarFor(params.id) });
}
