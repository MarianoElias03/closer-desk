import { json, error } from '@sveltejs/kit';
import { addLeadEntry } from '$lib/server/db.js';
// Add a contact that happened outside the dialler, with its own date and time.
export async function POST({ params, request, locals }) {
  let lead;
  try {
    lead = addLeadEntry(locals.offer.id, params.id, await request.json());
  } catch (e) {
    error(400, e.message);
  }
  if (!lead) error(404, 'Lead not found');
  return json({ lead });
}
