import { json } from '@sveltejs/kit';
import { scoring, saveCategories } from '$lib/server/scoring.js';
// the current offer's prospect-score categories; PUT changes them and re-scores its leads
export const GET = ({ locals }) => json(scoring(locals.offer.id));
export async function PUT({ request, locals }) {
  return json(saveCategories(locals.offer.id, await request.json().catch(() => ({}))));
}
