import { sdrDay, sdrRange, closeRange, callsRange, getSettings, monthMeta, unlinkedRecordings } from '$lib/server/db.js';
import { dayKey, dayStartIso, addDays, monthBounds } from '$lib/time.js';

export function load() {
  const tz = getSettings().timezone;
  const today = dayKey(Date.now(), tz);
  const month = today.slice(0, 7);
  const { first, last } = monthBounds(month);
  const calls = callsRange(dayStartIso(today, tz), dayStartIso(addDays(today, 1), tz));
  const upcoming = callsRange(dayStartIso(addDays(today, 1), tz), dayStartIso(addDays(today, 8), tz)).slice(0, 6);
  const needsOutcome = callsRange(dayStartIso(addDays(today, -7), tz), dayStartIso(today, tz)).filter((c) => c.outcome === 'pending');
  return {
    month,
    sdrToday: sdrDay(today),
    calls,
    upcoming,
    needsOutcome,
    sdrMonth: sdrRange(first, last),
    closeMonth: closeRange(first, last),
    meta: monthMeta(month),
    recordings: unlinkedRecordings()
  };
}
