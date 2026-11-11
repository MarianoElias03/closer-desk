import { json, error } from '@sveltejs/kit';
import { setMonthMeta } from '$lib/server/db.js';
export async function POST({ request }) {
  const { month, kind, days } = await request.json();
  if (!/^\d{4}-\d{2}$/.test(month || '') || !['sdr', 'close'].includes(kind)) error(400, 'Bad month');
  setMonthMeta(month, kind, days);
  return json({ ok: true });
}
