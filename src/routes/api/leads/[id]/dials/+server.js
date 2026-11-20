import { json, error } from '@sveltejs/kit';
import { logDial, getSettings } from '$lib/server/db.js';
import { dayKey } from '$lib/time.js';
export async function POST({ params, request, locals }) {
  const b = await request.json();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : dayKey(Date.now(), getSettings().timezone);
  let lead;
  try {
    lead = logDial(locals.offer.id, params.id, { ...b, date });
  } catch (e) {
    error(400, e.message);
  }
  if (!lead) error(404, 'Lead not found');
  return json({ lead });
}
