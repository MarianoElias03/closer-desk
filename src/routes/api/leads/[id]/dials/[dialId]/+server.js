import { json, error } from '@sveltejs/kit';
import { removeDial, updateLeadEntry } from '$lib/server/db.js';
export function DELETE({ params, locals }) {
  return json({ lead: removeDial(locals.offer.id, params.id, params.dialId) });
}
export async function PATCH({ params, request, locals }) {
  let lead;
  try {
    lead = updateLeadEntry(locals.offer.id, params.id, params.dialId, await request.json());
  } catch (e) {
    error(400, e.message);
  }
  if (!lead) error(404, 'Entry not found');
  return json({ lead });
}
