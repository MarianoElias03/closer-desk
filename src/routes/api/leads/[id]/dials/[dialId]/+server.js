import { json, error } from '@sveltejs/kit';
import { db, removeDial, updateLeadEntry, getColdLead } from '$lib/server/db.js';
import { callbackCalendarFor, unbookCallEvent } from '$lib/server/callbackCal.js';
export async function DELETE({ params, locals }) {
  const made = db.prepare('SELECT event_id FROM lead_dials WHERE id = ? AND lead_id = ? AND offer_id = ?').get(Number(params.dialId), Number(params.id), locals.offer.id)?.event_id;
  removeDial(locals.offer.id, params.id, params.dialId);
  // a Booked that made its own calendar event takes that event back off
  const unbooked = await unbookCallEvent(locals.offer.id, params.id, made);
  const cb = await callbackCalendarFor(params.id);
  return json({ lead: getColdLead(locals.offer.id, params.id), calendar: unbooked || cb });
}
export async function PATCH({ params, request, locals }) {
  const b = await request.json();
  let lead;
  try {
    lead = updateLeadEntry(locals.offer.id, params.id, params.dialId, b);
  } catch (e) {
    error(400, e.message);
  }
  if (!lead) error(404, 'Entry not found');
  return json({ lead, calendar: await callbackCalendarFor(params.id) });
}
