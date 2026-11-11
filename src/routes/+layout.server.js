import { lastSync, connections } from '$lib/server/sync.js';
import { getSettings } from '$lib/server/db.js';
import { dayKey } from '$lib/time.js';
export function load() {
  const s = getSettings();
  return { ownerName: process.env.OWNER_NAME || '', tz: s.timezone, today: dayKey(Date.now(), s.timezone), lastSync: lastSync(), connections: connections() };
}
