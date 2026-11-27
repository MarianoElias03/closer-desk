import { json, error } from '@sveltejs/kit';
import { composeInfo, sendLeadEmail } from '$lib/server/leadMail.js';
// write an email to a lead from inside Closer Desk: who it can go from (with signatures), and send it
export function GET({ params, locals }) {
  try {
    return json(composeInfo(locals.offer.id, Number(params.id)));
  } catch (e) {
    error(404, e.message);
  }
}
export async function POST({ params, request, locals }) {
  const b = await request.json().catch(() => ({}));
  try {
    return json(await sendLeadEmail(locals.offer.id, Number(params.id), b));
  } catch (e) {
    error(400, e.message);
  }
}
