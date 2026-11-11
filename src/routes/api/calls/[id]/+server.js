import { json, error } from '@sveltejs/kit';
import { getCall, updateCall, deleteManualCall } from '$lib/server/db.js';
export async function PATCH({ params, request }) {
  if (!getCall(params.id)) error(404, 'Call not found');
  return json({ call: updateCall(params.id, await request.json()) });
}
export async function DELETE({ params }) {
  deleteManualCall(params.id);
  return json({ ok: true });
}
