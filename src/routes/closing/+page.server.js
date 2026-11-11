import { closeRange, monthMeta, getSettings, callsRange } from '$lib/server/db.js';
import { dayKey, monthBounds, shiftMonth, dayStartIso, addDays } from '$lib/time.js';
import { CALL_OUTCOMES } from '$lib/stats.js';

export function load({ url }) {
  const tz = getSettings().timezone;
  const today = dayKey(Date.now(), tz);
  const month = /^\d{4}-\d{2}$/.test(url.searchParams.get('m') || '') ? url.searchParams.get('m') : today.slice(0, 7);
  const { first, last } = monthBounds(month);
  const prev = monthBounds(shiftMonth(month, -1));

  // what the calendar + logged call outcomes say per day
  const fromCalls = {};
  for (const c of callsRange(dayStartIso(first, tz), dayStartIso(addDays(last, 1), tz))) {
    const d = dayKey(c.start, tz);
    const t = (fromCalls[d] ??= { scheduled: 0, logged: 0, no_show: 0, closed: 0, not_interested: 0, callbacks: 0, unqualified: 0, cash: 0 });
    t.scheduled++;
    const col = CALL_OUTCOMES.find((o) => o.key === c.outcome)?.column;
    if (col) {
      t.logged++;
      t[col]++;
    }
    t.cash += c.cash || 0;
  }
  return {
    month,
    days: closeRange(first, last),
    prevDays: closeRange(prev.first, prev.last),
    meta: monthMeta(month),
    prevMeta: monthMeta(shiftMonth(month, -1)),
    fromCalls
  };
}
