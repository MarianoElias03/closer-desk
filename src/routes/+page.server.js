import { sdrDay, sdrRange, closeRange, dmRange, callsRange, getSettings, monthMeta, unlinkedRecordings } from '$lib/server/db.js';
import { dayKey, dayStartIso, addDays, monthBounds } from '$lib/time.js';

export function load({ locals }) {
  const o = locals.offer.id;
  const tz = getSettings().timezone;
  const today = dayKey(Date.now(), tz);
  const month = today.slice(0, 7);
  const { first, last } = monthBounds(month);
  const calls = callsRange(o, dayStartIso(today, tz), dayStartIso(addDays(today, 1), tz));
  const upcoming = callsRange(o, dayStartIso(addDays(today, 1), tz), dayStartIso(addDays(today, 8), tz)).slice(0, 6);
  const needsOutcome = callsRange(o, dayStartIso(addDays(today, -7), tz), dayStartIso(today, tz)).filter((c) => c.outcome === 'pending');
  return {
    month,
    sdrToday: sdrDay(o, today),
    calls,
    upcoming,
    needsOutcome,
    sdrMonth: sdrRange(o, first, last),
    closeMonth: closeRange(o, first, last),
    dmMonth: dmRange(o, first, last),
    meta: monthMeta(o, month),
    recordings: unlinkedRecordings()
  };
}
