import { error } from '@sveltejs/kit';
import { coldLeads, linkableCalls, getSettings, reasonsUsed } from '$lib/server/db.js';
import { dayKey, dayStartIso, addDays } from '$lib/time.js';
import { listView, neighbours } from '$lib/leads.js';

export function load({ params, locals, url }) {
  const tz = getSettings().timezone;
  const today = dayKey(Date.now(), tz);
  const leads = coldLeads(locals.offer.id);
  const id = Number(params.id);
  const lead = leads.find((l) => l.id === id);
  if (!lead) error(404, `That lead isn't on ${locals.offer.name}. Switch offer, or go back to the lead list.`);
  const view = listView(url.searchParams);
  return {
    lead,
    view,
    nav: neighbours(leads, id, view, today),
    reasons: reasonsUsed(locals.offer.id),
    linkable: linkableCalls(locals.offer.id, dayStartIso(addDays(today, -14), tz))
  };
}
