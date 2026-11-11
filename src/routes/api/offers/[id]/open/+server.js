import { json, error } from '@sveltejs/kit';
import { getOffer, openOffer, updateOffer } from '$lib/server/db.js';
import { rememberOffer } from '$lib/server/offerCookie.js';

export function POST({ params, cookies }) {
  const o = getOffer(params.id);
  if (!o) error(404, 'Offer not found');
  if (o.archived) updateOffer(o.id, { archived: false });
  rememberOffer(cookies, o.id);
  return json({ offer: openOffer(o.id) });
}
