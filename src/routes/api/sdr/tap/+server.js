import { json, error } from '@sveltejs/kit';
import { db, sdrDay, upsertSdr } from '$lib/server/db.js';
const KEYS = ['no_answer', 'booked', 'not_interested', 'callback', 'wrong_no'];
export async function POST({ request, locals }) {
  const { date, key, delta } = await request.json();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !KEYS.includes(key)) error(400, 'Bad tap');
  const day = db.transaction(() => {
    const cur = sdrDay(locals.offer.id, date) || Object.fromEntries(KEYS.map((k) => [k, 0]));
    cur[key] = Math.max(0, (cur[key] || 0) + (delta === -1 ? -1 : 1));
    return upsertSdr(locals.offer.id, date, cur);
  })();
  return json({ day });
}
