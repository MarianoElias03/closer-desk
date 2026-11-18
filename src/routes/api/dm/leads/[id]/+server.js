import { json, error } from '@sveltejs/kit';
import { getLead, setLeadStatus, updateLead, deleteLead } from '$lib/server/db.js';
export async function PATCH({ params, request, locals }) {
  const o = locals.offer.id;
  if (!getLead(o, params.id)) error(404, 'Lead not found');
  const b = await request.json();
  try {
    let lead = updateLead(o, params.id, b);
    if (b.status) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || '')) error(400, 'Date must be YYYY-MM-DD');
      lead = setLeadStatus(o, params.id, b.status, b.date);
    }
    return json({ lead });
  } catch (e) {
    if (e?.status) throw e;
    error(400, e.message);
  }
}
export async function DELETE({ params, locals }) {
  deleteLead(locals.offer.id, params.id);
  return json({ ok: true });
}
