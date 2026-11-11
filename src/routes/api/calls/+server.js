import { json, error } from '@sveltejs/kit';
import { createManualCall } from '$lib/server/db.js';
export async function POST({ request, locals }) {
  const b = await request.json();
  if (!b.prospect || !b.start) error(400, 'Add a name and a start time');
  return json({ call: createManualCall(locals.offer.id, b) });
}
