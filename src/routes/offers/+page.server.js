import { db } from '$lib/server/db.js';
export function load() {
  const counts = {};
  const add = (sql, key) => {
    for (const r of db.prepare(sql).all()) (counts[r.offer_id] ??= { calls: 0, sdrDays: 0, closeDays: 0 })[key] = r.n;
  };
  add("SELECT offer_id, COUNT(*) n FROM calls WHERE status != 'cancelled' GROUP BY offer_id", 'calls');
  add('SELECT offer_id, COUNT(*) n FROM sdr_days GROUP BY offer_id', 'sdrDays');
  add('SELECT offer_id, COUNT(*) n FROM close_days GROUP BY offer_id', 'closeDays');
  return { counts };
}
