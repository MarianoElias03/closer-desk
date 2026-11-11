// Date helpers. All "day" keys are YYYY-MM-DD in the business timezone.

export function dayKey(date, tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(date)
  );
}

/** Offset in minutes of tz at the given instant (e.g. +600 for Brisbane). */
export function tzOffset(date, tz) {
  const d = new Date(date);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value])
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - Math.floor(d.getTime() / 1000) * 1000) / 60000);
}

/** UTC ISO instant for local midnight of a YYYY-MM-DD day in tz. */
export function dayStartIso(key, tz) {
  const [y, m, d] = key.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const off = tzOffset(guess, tz);
  return new Date(guess - off * 60000).toISOString();
}

export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

export function monthBounds(month) {
  const [y, m] = month.split('-').map(Number);
  const first = `${month}-01`;
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { first, last, days: Number(last.slice(8)) };
}

export function shiftMonth(month, n) {
  const [y, m] = month.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return t.toISOString().slice(0, 7);
}

/** Monday of the week containing key. */
export function weekStart(key) {
  const [y, m, d] = key.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDays(key, -((dow + 6) % 7));
}
