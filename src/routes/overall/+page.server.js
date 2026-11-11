import { sdrRange, closeRange, listOffers, monthMeta, getSettings } from '$lib/server/db.js';
import { sdrSummary, closeSummary } from '$lib/stats.js';
import { dayKey, monthBounds } from '$lib/time.js';

const SDR = ['no_answer', 'booked', 'not_interested', 'callback', 'wrong_no'];
const CLOSE = ['no_show', 'closed', 'not_interested', 'callbacks', 'unqualified', 'cash'];

// Sum several offers' rows into one row per date, so a day worked on two offers counts once.
function merge(rows, fields) {
  const by = {};
  for (const r of rows) {
    const d = (by[r.date] ??= Object.fromEntries([['date', r.date], ...fields.map((f) => [f, 0])]));
    for (const f of fields) d[f] += r[f];
  }
  return Object.values(by);
}

export function load({ url }) {
  const tz = getSettings().timezone;
  const today = dayKey(Date.now(), tz);
  const m = url.searchParams.get('m');
  const all = m === 'all';
  const month = /^\d{4}-\d{2}$/.test(m || '') ? m : today.slice(0, 7);
  const { first, last } = all ? { first: '0000-01-01', last: '9999-12-31' } : monthBounds(month);

  const sdr = sdrRange(null, first, last);
  const close = closeRange(null, first, last);
  const offers = listOffers();

  const summarise = (ids, single) => {
    const s = sdr.filter((r) => ids.includes(r.offer_id));
    const c = close.filter((r) => ids.includes(r.offer_id));
    // a manual "days worked" only applies to one offer in one month
    const meta = single && !all ? monthMeta(ids[0], month) : { sdr: null, close: null };
    return { sdr: sdrSummary(merge(s, SDR), meta.sdr), close: closeSummary(merge(c, CLOSE), meta.close) };
  };
  const hasData = (x) => x.sdr.total > 0 || x.close.calls > 0 || x.close.cash > 0;

  const byOffer = offers
    .map((o) => ({ key: String(o.id), id: o.id, name: o.name, industry: o.industry, archived: o.archived, ...summarise([o.id], true) }))
    .filter((r) => !r.archived || hasData(r));

  const groups = {};
  for (const o of offers) (groups[o.industry || ''] ??= []).push(o);
  const byIndustry = Object.entries(groups)
    .map(([industry, os]) => ({
      key: industry || '-',
      name: industry || 'No industry set',
      count: os.length,
      offers: os.map((o) => o.name),
      ...summarise(os.map((o) => o.id), false)
    }))
    .filter(hasData)
    .sort((a, b) => b.close.cash - a.close.cash || b.sdr.total - a.sdr.total);

  return {
    period: all ? 'all' : month,
    month,
    total: summarise(offers.map((o) => o.id), false),
    byOffer,
    byIndustry
  };
}
