import { json, error } from '@sveltejs/kit';
import { sendPrecall } from '$lib/server/precall.js';
// email the pre-call info (message, numbers, call, video, PDF) from a connected account
export async function POST({ params, request, locals }) {
  const b = await request.json().catch(() => ({}));
  try {
    return json(await sendPrecall(locals.offer.id, params.id, b));
  } catch (e) {
    error(400, e.message);
  }
}
