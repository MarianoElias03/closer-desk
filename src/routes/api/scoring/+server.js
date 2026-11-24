import { json } from '@sveltejs/kit';
import { scoring, saveCriteria } from '$lib/server/scoring.js';
// the current offer's prospect-score criteria and highest score; PUT changes them and re-scores its leads
export const GET = ({ locals }) => json(scoring(locals.offer.id));
export async function PUT({ request, locals }) {
  return json(saveCriteria(locals.offer.id, await request.json().catch(() => ({}))));
}
