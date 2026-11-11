import { callsRange, getSettings, unlinkedRecordings } from '$lib/server/db.js';
import { dayKey, weekStart, addDays, dayStartIso } from '$lib/time.js';
export function load({ url, locals }) {
  const tz = getSettings().timezone;
  const today = dayKey(Date.now(), tz);
  const w = url.searchParams.get('w');
  const start = weekStart(/^\d{4}-\d{2}-\d{2}$/.test(w || '') ? w : today);
  return {
    week: start,
    calls: callsRange(locals.offer.id, dayStartIso(start, tz), dayStartIso(addDays(start, 7), tz)),
    recordings: unlinkedRecordings()
  };
}
