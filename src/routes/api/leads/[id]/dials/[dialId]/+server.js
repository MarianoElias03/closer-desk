import { json } from '@sveltejs/kit';
import { removeDial } from '$lib/server/db.js';
export function DELETE({ params, locals }) {
  return json({ lead: removeDial(locals.offer.id, params.id, params.dialId) });
}
