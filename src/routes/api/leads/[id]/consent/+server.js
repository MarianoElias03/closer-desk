import { json, error } from '@sveltejs/kit';
import { setConsent } from '$lib/server/db.js';
// { block: ['sms'|'call'|'email'|'all'], allow: [...], note }
export async function POST({ params, request, locals }) {
  const b = await request.json();
  const lead = setConsent(locals.offer.id, params.id, {
    block: Array.isArray(b.block) ? b.block : [],
    allow: Array.isArray(b.allow) ? b.allow : [],
    note: b.note
  });
  if (!lead) error(404, 'Lead not found');
  return json({ lead });
}
