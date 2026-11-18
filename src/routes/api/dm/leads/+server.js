import { json, error } from '@sveltejs/kit';
import { createLead } from '$lib/server/db.js';
export async function POST({ request, locals }) {
  const { handle, date } = await request.json();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) error(400, 'Date must be YYYY-MM-DD');
  try {
    return json({ lead: createLead(locals.offer.id, handle, date) });
  } catch (e) {
    error(400, e.message);
  }
}
