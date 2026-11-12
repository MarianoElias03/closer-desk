import { dmRange, monthMeta, getSettings } from '$lib/server/db.js';
import { dayKey, monthBounds, shiftMonth } from '$lib/time.js';
export function load({ url, locals }) {
  const o = locals.offer.id;
  const tz = getSettings().timezone;
  const today = dayKey(Date.now(), tz);
  const month = /^\d{4}-\d{2}$/.test(url.searchParams.get('m') || '') ? url.searchParams.get('m') : today.slice(0, 7);
  const { first, last } = monthBounds(month);
  const prev = monthBounds(shiftMonth(month, -1));
  return {
    month,
    days: dmRange(o, first, last),
    prevDays: dmRange(o, prev.first, prev.last),
    meta: monthMeta(o, month),
    prevMeta: monthMeta(o, shiftMonth(month, -1))
  };
}
