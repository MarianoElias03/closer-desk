import { json, error } from '@sveltejs/kit';
import { importColdLeads, linkLeadCalls } from '$lib/server/db.js';
export async function POST({ request, locals }) {
  const { rows } = await request.json();
  if (!Array.isArray(rows) || !rows.length) error(400, 'Nothing to import');
  const out = importColdLeads(locals.offer.id, rows);
  linkLeadCalls();
  return json(out);
}
