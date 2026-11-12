import { json, error } from '@sveltejs/kit';
import { upsertDm } from '$lib/server/db.js';
export async function POST({ request, locals }) {
  const { date, values } = await request.json();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) error(400, 'Date must be YYYY-MM-DD');
  return json({ day: upsertDm(locals.offer.id, date, values || {}) });
}
