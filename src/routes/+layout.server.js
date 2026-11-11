import { lastSync, connections } from '$lib/server/sync.js';
import { getSettings, listOffers } from '$lib/server/db.js';
import { dayKey } from '$lib/time.js';
export function load({ locals }) {
  const s = getSettings();
  return { ownerName: process.env.OWNER_NAME || '', tz: s.timezone, today: dayKey(Date.now(), s.timezone), lastSync: lastSync(), connections: connections(), offer: locals.offer, offers: listOffers() };
}
