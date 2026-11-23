import { closeRange, monthMeta, getSettings, unlinkedRecordings, callsRange } from '$lib/server/db.js';
import { redirect } from '@sveltejs/kit';
import { dayKey, monthBounds, shiftMonth } from '$lib/time.js';

export function load({ url, locals }) {
  // Closing is only for offers where you take the calls
  if (!locals.offer.roles.includes('closing')) redirect(303, '/leads');
  const o = locals.offer.id;
  const tz = getSettings().timezone;
  const today = dayKey(Date.now(), tz);
  const month = /^\d{4}-\d{2}$/.test(url.searchParams.get('m') || '') ? url.searchParams.get('m') : today.slice(0, 7);
  const { first, last } = monthBounds(month);
  const prev = monthBounds(shiftMonth(month, -1));

  return {
    month,
    days: closeRange(o, first, last),
    prevDays: closeRange(o, prev.first, prev.last),
    meta: monthMeta(o, month),
    prevMeta: monthMeta(o, shiftMonth(month, -1)),
    // the call list (was the Calls tab)
    calls: callsRange(o, new Date(Date.now() - 120 * 864e5).toISOString(), new Date(Date.now() + 60 * 864e5).toISOString()),
    recordings: unlinkedRecordings()
  };
}
