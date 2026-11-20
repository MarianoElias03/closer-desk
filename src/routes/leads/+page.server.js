import { redirect } from '@sveltejs/kit';
import { coldLeads } from '$lib/server/db.js';
export function load({ locals, url }) {
  // old links (?lead=12) go to the lead's own page
  const id = Number(url.searchParams.get('lead'));
  if (id) redirect(303, `/leads/${id}`);
  return { leads: coldLeads(locals.offer.id) };
}
