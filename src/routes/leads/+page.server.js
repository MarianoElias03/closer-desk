import { coldLeads, linkableCalls, getSettings } from '$lib/server/db.js';
import { dayKey, dayStartIso, addDays } from '$lib/time.js';
export function load({ locals }) {
  const tz = getSettings().timezone;
  const today = dayKey(Date.now(), tz);
  return {
    leads: coldLeads(locals.offer.id),
    linkable: linkableCalls(locals.offer.id, dayStartIso(addDays(today, -14), tz))
  };
}
