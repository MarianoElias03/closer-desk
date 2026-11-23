import { json, error } from '@sveltejs/kit';
import { getCall, updateCall, deleteManualCall, closeDayFromCalls, getSettings } from '$lib/server/db.js';
import { dayKey } from '$lib/time.js';

// a call's outcome, cash or offer feeds that day's Closing numbers
const touched = (c) => c && [c.offerId, dayKey(c.start, getSettings().timezone)];
function refresh(...calls) {
  const seen = new Set();
  for (const t of calls.map(touched).filter(Boolean)) {
    const k = t.join('|');
    if (!seen.has(k)) seen.add(k) && closeDayFromCalls(...t);
  }
}

export async function PATCH({ params, request }) {
  const before = getCall(params.id);
  if (!before) error(404, 'Call not found');
  const patch = await request.json();
  const call = updateCall(params.id, patch);
  if (['outcome', 'cash', 'offerId'].some((k) => k in patch)) refresh(before, call);
  return json({ call });
}
export async function DELETE({ params }) {
  const before = getCall(params.id);
  deleteManualCall(params.id);
  if (before && !getCall(params.id)) refresh(before);
  return json({ ok: true });
}
