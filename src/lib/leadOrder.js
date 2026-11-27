// The list you're working through, as it was when you opened it. Marking a lead (not interested,
// no answer…) changes the live list, but previous / next keep stepping through this snapshot until
// you go back to the lead list or reload the page. Browser memory only: a reload starts fresh.
import { browser } from '$app/environment';

let snap = null;

/** The lead ids to step through for this list (query = its filters as a ?search string). */
export function listOrder(query, ids) {
  if (!browser) return ids;
  if (!snap || snap.query !== query) snap = { query, ids: [...ids] };
  return snap.ids;
}
/** Start fresh next time (the lead list is open again). */
export function forgetOrder() {
  snap = null;
}
/** A deleted lead comes out of the snapshot. */
export function dropFromOrder(id) {
  if (snap) snap.ids = snap.ids.filter((x) => x !== id);
}
