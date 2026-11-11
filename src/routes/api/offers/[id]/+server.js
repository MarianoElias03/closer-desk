import { json, error } from '@sveltejs/kit';
import { getOffer, updateOffer, listOffers } from '$lib/server/db.js';

export async function PATCH({ params, request }) {
  const cur = getOffer(params.id);
  if (!cur) error(404, 'Offer not found');
  const patch = await request.json();
  if (patch.archived && !cur.archived && listOffers({ includeArchived: false }).length <= 1) error(400, 'Keep at least one active offer');
  try {
    return json({ offer: updateOffer(params.id, patch) });
  } catch (e) {
    error(400, e.message);
  }
}
