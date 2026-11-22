import { json, error } from '@sveltejs/kit';
import { removeDial, updateLeadEntry } from '$lib/server/db.js';
import { callbackCalendarFor } from '$lib/server/callbackCal.js';
export async function DELETE({ params, locals }) {
  const lead = removeDial(locals.offer.id, params.id, params.dialId);
  return json({ lead, calendar: await callbackCalendarFor(params.id) });
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
