import { json, error } from '@sveltejs/kit';
import { createOffer, openOffer } from '$lib/server/db.js';
import { rememberOffer } from '$lib/server/offerCookie.js';

export async function POST({ request, cookies }) {
  let offer;
  try {
    offer = createOffer(await request.json());
  } catch (e) {
    error(400, e.message);
  }
  openOffer(offer.id);
  rememberOffer(cookies, offer.id);
  return json({ offer });
}
