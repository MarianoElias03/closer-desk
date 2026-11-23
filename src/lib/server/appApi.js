import { listOffers, coldLeads, sdrRange, closeRange, dmRange, monthMeta, callsRange, getSettings, reasonsUsed, phoneKey, db } from './db.js';
import { sdrSummary, closeSummary, dmSummary, sdrTotal, closeCalls } from '../stats.js';
import { dayKey, dayStartIso, addDays, monthBounds } from '../time.js';
import { leadMode, STAGES, reasonOptions, ENTRY_TYPES, isDue, inQueue } from '../leads.js';

// What the Android app reads: one dashboard across every offer, and a compact phone book of every lead
// (and booked call) so it can match a ringing number on the phone itself, with no round trip.

export function dashboard() {
  const tz = getSettings().timezone;
  const today = dayKey(Date.now(), tz);
  const month = today.slice(0, 7);
  const { first, last } = monthBounds(month);
  const dayFrom = dayStartIso(today, tz);
  const dayTo = dayStartIso(addDays(today, 1), tz);
  const offers = listOffers({ includeArchived: false }).map((o) => {
    const meta = monthMeta(o.id, month);
    const sdr = sdrRange(o.id, first, last);
    const close = closeRange(o.id, first, last);
    const dm = dmRange(o.id, first, last);
    const leads = coldLeads(o.id);
    const callsToday = callsRange(o.id, dayFrom, dayTo);
    const upcoming = callsRange(o.id, new Date().toISOString(), dayStartIso(addDays(today, 8), tz)).slice(0, 5);
    const day = (rows) => rows.find((r) => r.date === today) || null;
    const s = sdrSummary(sdr, meta.sdr);
    const c = closeSummary(close, meta.close);
    const d = dmSummary(dm, meta.dm);
    return {
      id: o.id,
      name: o.name,
      industry: o.industry,
      roles: o.roles,
      mode: leadMode(o),
      today: {
        dials: sdrTotal(day(sdr)),
        booked: (day(sdr)?.booked || 0) + (day(dm)?.booked || 0),
        dms: day(dm)?.contacted || 0,
        calls: callsToday.length,
        closed: day(close)?.closed || 0,
        cash: day(close)?.cash || 0,
        contacted: leads.filter((l) => l.dials.some((x) => x.date === today && !x.label)).length
      },
      month: {
        dials: s.total,
        pickupRate: s.pickupRate,
        booked: s.booked + d.booked,
        bookingRate: s.bookingRate,
        dms: d.contacted,
        converted: d.converted,
        calls: c.calls,
        closed: c.closed,
        cash: c.cash,
        conversion: c.conversion
      },
      leads: {
        total: leads.length,
        toDial: leadMode(o) === 'sdr' ? leads.filter((l) => inQueue(l, today)).length : 0,
        due: leads.filter((l) => isDue(l, today)).length
      },
      nextCalls: upcoming.map((x) => ({ id: x.id, title: x.title, prospect: x.prospect, start: x.start, outcome: x.outcome }))
    };
  });
  return { today, month, offers };
}

/** Every lead on every live offer, trimmed to what a caller card and the search need. */
export function directory() {
  const tz = getSettings().timezone;
  const offers = listOffers({ includeArchived: false });
  const leads = [];
  const reasons = {};
  for (const o of offers) {
    const used = reasonsUsed(o.id);
    reasons[o.id] = Object.fromEntries(ENTRY_TYPES.map((t) => [t.key, reasonOptions(t.key, used).slice(0, 9)]));
    for (const l of coldLeads(o.id)) {
      const last = l.dials.filter((d) => d.date && !d.label).at(-1) || l.dials.at(-1) || null;
      leads.push({
        id: l.id,
        offerId: o.id,
        offer: o.name,
        mode: leadMode(o),
        business: l.business,
        contact: l.contact,
        phone: l.phone,
        phoneKey: phoneKey(l.phone),
        email: l.email,
        suburb: l.suburb,
        score: l.score,
        stage: l.stage,
        status: STAGES[l.stage]?.label || l.stage,
        reason: l.reason,
        followUp: l.followUp,
        doNotContact: l.doNotContact,
        lastContactAt: l.lastContactAt,
        lastNote: last ? (last.subject || last.note || '').slice(0, 280) : '',
        attempts: l.attempts,
        call: l.call ? { start: l.call.start, outcome: l.call.outcome, title: l.call.title } : null
      });
    }
  }
  // booked calls with a phone number that no lead has, so a prospect ringing about their call still matches
  const linked = new Set(db.prepare('SELECT call_id FROM leads WHERE call_id IS NOT NULL').all().map((r) => r.call_id));
  const from = new Date(Date.now() - 30 * 864e5).toISOString();
  const to = new Date(Date.now() + 60 * 864e5).toISOString();
  const calls = [];
  for (const o of offers)
    for (const c of callsRange(o.id, from, to))
      if (c.phone && !linked.has(c.id)) calls.push({ id: c.id, offerId: o.id, offer: o.name, prospect: c.prospect, title: c.title, phone: c.phone, phoneKey: phoneKey(c.phone), start: c.start, outcome: c.outcome });
  return { at: new Date().toISOString(), tz, leads, calls, reasons };
}
