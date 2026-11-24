import { json, error } from '@sveltejs/kit';
import { setLeadTicks } from '$lib/server/scoring.js';
// tick or untick prospect-score criteria on a lead: { ticks: [label, ...] }
export async function PUT({ params, request, locals }) {
  const { ticks } = await request.json().catch(() => ({}));
  const r = setLeadTicks(locals.offer.id, params.id, Array.isArray(ticks) ? ticks : []);
  if (!r) error(404, 'Lead not found');
  return json(r);
}
