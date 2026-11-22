import { json, error } from '@sveltejs/kit';
import { updateColdLead, deleteColdLead } from '$lib/server/db.js';
import { callbackCalendarFor } from '$lib/server/callbackCal.js';
export async function PATCH({ params, request, locals }) {
  let lead;
  try {
    lead = updateColdLead(locals.offer.id, params.id, await request.json());
  } catch (e) {
    error(400, e.message);
  }
  if (!lead) error(404, 'Lead not found');
  return json({ lead, calendar: await callbackCalendarFor(params.id) });
}
export async function DELETE({ params, locals }) {
  deleteColdLead(locals.offer.id, params.id);
  return json({ ok: true, calendar: await callbackCalendarFor(params.id) });
}
