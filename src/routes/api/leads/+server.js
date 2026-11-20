import { json, error } from '@sveltejs/kit';
import { createColdLead } from '$lib/server/db.js';
export async function POST({ request, locals }) {
  try {
    return json({ lead: createColdLead(locals.offer.id, await request.json()) });
  } catch (e) {
    error(400, e.message);
  }
}
