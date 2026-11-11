import { startScheduler } from '$lib/server/sync.js';
import { resolveOffer } from '$lib/server/db.js';
startScheduler();

export async function handle({ event, resolve }) {
  event.locals.offer = resolveOffer(Number(event.cookies.get('offer')) || null);
  return resolve(event);
}
