import { db } from '$lib/server/db.js';
export function load() {
  const counts = {
    calls: db.prepare("SELECT COUNT(*) n FROM calls WHERE status != 'cancelled'").get().n,
    recordings: db.prepare('SELECT COUNT(*) n FROM fathom').get().n,
    linked: db.prepare('SELECT COUNT(*) n FROM calls WHERE fathom_id IS NOT NULL').get().n,
    sdrDays: db.prepare('SELECT COUNT(*) n FROM sdr_days').get().n,
    closeDays: db.prepare('SELECT COUNT(*) n FROM close_days').get().n
  };
  return { counts };
}
