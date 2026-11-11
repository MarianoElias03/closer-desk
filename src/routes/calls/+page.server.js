import { callsRange, getSettings, unlinkedRecordings } from '$lib/server/db.js';
export function load() {
  const from = new Date(Date.now() - 120 * 864e5).toISOString();
  const to = new Date(Date.now() + 60 * 864e5).toISOString();
  return { calls: callsRange(from, to), recordings: unlinkedRecordings() };
}
