// MCP server (Model Context Protocol, Streamable HTTP, stateless JSON) so an AI assistant can read
// and update the CRM. It is part of the app, so its tools change with the code on every deploy.
// Every tool that writes is recorded in api_log so you can see what the assistant did.
import fs from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import {
  db,
  listOffers,
  getOffer,
  coldLeads,
  getColdLead,
  createColdLead,
  updateColdLead,
  importColdLeads,
  addLeadEntry,
  sdrRange,
  monthMeta,
  getSettings,
  phoneKey,
  CHANNELS,
  ENTRY_TYPES,
  linkLeadCalls,
  setConsent,
  reasonsUsed
} from './db.js';
import { FILTERS, listLeads, STAGES, entryLabel, wallClock, REASONS } from '../leads.js';
import { sdrSummary } from '../stats.js';
import { dayKey, monthBounds } from '../time.js';

export const VERSION = (() => {
  try {
    return fs.readFileSync('build/VERSION', 'utf8').trim();
  } catch {
    return 'dev';
  }
})();

db.exec(`CREATE TABLE IF NOT EXISTS api_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  tool TEXT NOT NULL,
  offer_id INTEGER,
  args TEXT NOT NULL,
  result TEXT NOT NULL
)`);

const tz = () => getSettings().timezone;
const today = () => dayKey(Date.now(), tz());

// ---------- shaping ----------

const brief = (l) => ({
  id: l.id,
  business: l.business,
  contact: l.contact,
  phone: l.phone,
  email: l.email,
  suburb: l.suburb,
  category: l.category,
  score: l.score,
  status: STAGES[l.stage]?.label || l.stage,
  ...(l.reason ? { status_reason: l.reason } : {}),
  ...(l.doNotContact.length ? { do_not_contact: l.doNotContact } : {}),
  follow_up: l.followUp,
  last_contacted: l.lastContactAt ? `${wallClock(l.lastContactAt, tz()).date} ${wallClock(l.lastContactAt, tz()).time}` : null,
  call_attempts: l.attempts
});

const consentOf = (l) => ({
  lead_id: l.id,
  business: l.business,
  calls_ok: !l.doNotContact.includes('call'),
  sms_ok: !l.doNotContact.includes('sms'),
  email_ok: !l.doNotContact.includes('email'),
  ...(l.doNotContact.length ? { opted_out_of: l.doNotContact, since: l.dncAt, reason: l.dncNote || undefined } : {})
});

const full = (l) => ({
  ...brief(l),
  consent: consentOf(l),
  notes: l.notes,
  research: Object.fromEntries(l.extra),
  booked_call: l.call ? { title: l.call.title, start: l.call.start, outcome: l.call.outcome, cash: l.call.cash, cancelled: l.call.cancelled } : null,
  history: l.dials.map((d) => ({
    entry_id: d.id,
    when: d.date ? `${wallClock(d.at, tz()).date} ${wallClock(d.at, tz()).time}` : 'date not recorded',
    channel: d.channel,
    outcome: d.outcome,
    label: d.label || entryLabel(d.outcome, d.channel),
    ...(d.reason ? { reason: d.reason } : {}),
    ...(d.subject ? { subject: d.subject } : {}),
    note: d.note,
    ...(d.extId ? { external_id: d.extId } : {}),
    counted_on_dialling: d.counted
  }))
});

// ---------- offer + lead lookup ----------

function pickOffer(arg) {
  const offers = listOffers({ includeArchived: false });
  if (arg == null || arg === '') {
    const o = offers.find((x) => x.roles.includes('sdr'));
    if (!o) throw new Error('No offer has a lead list. Pass offer.');
    return o;
  }
  const byId = /^\d+$/.test(String(arg)) ? getOffer(Number(arg)) : null;
  if (byId) return byId;
  const want = String(arg).toLowerCase().trim();
  const hit = offers.find((o) => o.name.toLowerCase() === want) || offers.find((o) => o.name.toLowerCase().includes(want));
  if (!hit) throw new Error(`No offer called "${arg}". Offers: ${offers.map((o) => `${o.id} ${o.name}`).join(', ')}`);
  return hit;
}

function findLead(offerId, match) {
  if (match == null) throw new Error('Say which lead: lead_id, phone, email or business');
  if (typeof match !== 'object') match = { lead_id: match };
  if (match.lead_id != null) {
    const l = getColdLead(offerId, match.lead_id);
    if (!l) throw new Error(`No lead ${match.lead_id} on this offer`);
    return l;
  }
  const leads = coldLeads(offerId);
  let hits = [];
  if (match.phone) hits = leads.filter((l) => phoneKey(l.phone) && phoneKey(l.phone) === phoneKey(match.phone));
  else if (match.email) hits = leads.filter((l) => l.email.toLowerCase() === String(match.email).toLowerCase().trim());
  else if (match.business) {
    const b = String(match.business).toLowerCase().trim();
    hits = leads.filter((l) => l.business.toLowerCase() === b);
    if (!hits.length) hits = leads.filter((l) => l.business.toLowerCase().includes(b));
  }
  if (hits.length === 1) return hits[0];
  if (!hits.length) throw new Error(`No lead matches ${JSON.stringify(match)}`);
  throw new Error(`${hits.length} leads match ${JSON.stringify(match)}: ${hits.slice(0, 5).map((l) => `${l.id} ${l.business}`).join(', ')}. Use lead_id.`);
}

const LEAD_FIELDS = {
  business: 'string',
  contact: 'string',
  phone: 'string',
  email: 'string',
  suburb: 'string',
  category: 'string',
  score: 'number',
  follow_up: 'string',
  notes: 'string'
};
const leadFieldSchema = {
  type: 'object',
  properties: {
    business: { type: 'string' },
    contact: { type: 'string', description: 'Contact person' },
    phone: { type: 'string', description: 'Mobile or phone number' },
    email: { type: 'string' },
    suburb: { type: 'string' },
    category: { type: 'string', description: 'Trade or business type' },
    score: { type: 'number', description: 'Prospect score' },
    follow_up: { type: 'string', description: 'Follow-up date YYYY-MM-DD, or empty to clear' },
    notes: { type: 'string', description: 'Replaces the lead notes. Use append_note to add instead.' }
  },
  additionalProperties: false
};

/** MCP field names -> the app's lead patch. */
function toPatch(set = {}) {
  const p = {};
  for (const k of Object.keys(set)) {
    if (!(k in LEAD_FIELDS)) throw new Error(`Unknown field "${k}". Fields: ${Object.keys(LEAD_FIELDS).join(', ')}`);
    if (k === 'follow_up') p.followUp = set[k] || null;
    else p[k] = set[k];
  }
  return p;
}

function appendNote(lead, text) {
  const t = String(text || '').trim();
  if (!t) return lead.notes;
  return lead.notes ? `${lead.notes}\n${t}` : t;
}

// ---------- tools ----------

const offerArg = { offer: { type: ['string', 'number'], description: 'Offer name or id. Defaults to the first offer with a lead list.' } };
const matchSchema = {
  type: 'object',
  description: 'Which lead. Give one of these.',
  properties: {
    lead_id: { type: 'number' },
    phone: { type: 'string' },
    email: { type: 'string' },
    business: { type: 'string', description: 'Exact business name, or a unique part of it' }
  }
};

const contactProps = {
  channel: { type: 'string', enum: CHANNELS, default: 'call' },
  outcome: {
    type: 'string',
    enum: [...ENTRY_TYPES, 'note'],
    description:
      'no_answer (or no reply), booked, not_interested, callback (follow up), wrong_no (or bounced), inbound (the lead contacted the user, e.g. an email reply), note (the user just sent something). On DM-setting offers use channel dm with contacted, booked, converted or not_converted.'
  },
  reason: {
    type: 'string',
    description:
      'Optional second disposition, short: e.g. not_interested + "Too expensive" / "Not looking to grow" / "Closed down business"; no_answer + "Voicemail"; wrong_no + "Disconnected". Reuse the wording already used on the offer where it fits (see crm_overview reasons).'
  },
  subject: { type: 'string', description: 'Email subject line' },
  body: { type: 'string', description: 'The note, or the full email / text body. Keep line breaks. Up to 20,000 characters.' },
  note: { type: 'string', description: 'Same as body' },
  date: { type: 'string', description: 'YYYY-MM-DD, defaults to today' },
  time: { type: 'string', description: 'HH:mm 24h in the business timezone, defaults to now' },
  external_id: {
    type: 'string',
    description: 'The message id from the mail or SMS system. Logging the same id on the same lead twice is skipped, so re-importing is safe.'
  },
  follow_up: { type: 'string', description: 'For outcome callback: the day to call back, YYYY-MM-DD (today or later). Sets the lead\'s follow-up date and puts the callback on the user\'s calendar.' },
  follow_up_time: { type: 'string', description: 'For outcome callback with follow_up: the time to call back, HH:mm 24h (required with follow_up). It goes on the calendar as a 15-minute slot.' },
  count_on_dialling: { type: 'boolean', default: false }
};

function logOne(offerId, a) {
  const l = findLead(offerId, a.lead);
  const channel = a.channel || 'call';
  if (l.doNotContact.includes(channel) && a.outcome !== 'inbound') {
    const word = { call: 'called', sms: 'texted', email: 'emailed' }[channel];
    throw new Error(
      `${l.business || 'This lead'} asked not to be ${word}${l.dncNote ? ` (${l.dncNote})` : ''}. Don't contact them this way. Only their own messages (outcome inbound) can be logged on this channel.`
    );
  }
  if (a.outcome === 'callback' && a.follow_up && !/^([01]\d|2[0-3]):[0-5]\d$/.test(a.follow_up_time || ''))
    throw new Error('A callback needs follow_up_time (HH:mm) as well as follow_up: every callback goes on the calendar as a 15-minute slot. Ask the user what time if you do not know.');
  const now = wallClock(new Date().toISOString(), tz());
  const updated = addLeadEntry(offerId, l.id, {
    date: a.date || now.date,
    time: a.time || (a.date && a.date !== now.date ? '12:00' : now.time),
    channel: a.channel || 'call',
    outcome: a.outcome === 'note' ? '' : a.outcome,
    reason: a.reason || '',
    subject: a.subject || '',
    note: a.body ?? a.note ?? '',
    extId: a.external_id || null,
    followUp: a.follow_up || null,
    followUpTime: a.follow_up_time || null,
    counted: !!a.count_on_dialling
  });
  if (updated.duplicateOf) return { lead: brief(updated), duplicate: true, entry_id: updated.duplicateOf };
  const e = updated.dials.reduce((m, d) => (d.id > m.id ? d : m));
  return { lead: brief(updated), logged: { entry_id: e.id, channel: e.channel, label: entryLabel(e.outcome, e.channel), subject: e.subject || undefined, counted_on_dialling: e.counted } };
}

export const TOOLS = [
  {
    name: 'crm_overview',
    description:
      'Start here. Lists the offers in Closer Desk (the CRM), which ones have a lead list, the lead pipeline counts for each, and the server version. Read only.',
    inputSchema: { type: 'object', properties: {} },
    run() {
      const t = today();
      return {
        version: VERSION,
        today: t,
        timezone: tz(),
        offers: listOffers({ includeArchived: false }).map((o) => {
          const leads = o.roles.includes('sdr') ? coldLeads(o.id) : [];
          return {
            id: o.id,
            name: o.name,
            industry: o.industry,
            price: o.price,
            roles: o.roles,
            leads: leads.length,
            pipeline: leads.length ? Object.fromEntries(FILTERS.filter((f) => f.key !== 'all').map((f) => [f.label, leads.filter((l) => f.test(l, t)).length])) : null,
            reasons_in_use: o.roles.includes('sdr') ? reasonsUsed(o.id) : undefined
          };
        }),
        suggested_reasons: REASONS,
        rules: [
          'Check consent before contacting anyone: check_consent, or search_leads with contactable_by. Never message a lead on a channel they opted out of.',
          'If a lead asks to stop (STOP, unsubscribe, "don\'t call me"), record it straight away with set_consent and tell the user.',
          'Only phone calls you make count on the Dialling numbers. SMS, email and inbound contacts are recorded as contact but never counted.',
          'Changing a lead field never changes Dialling numbers.',
          'Do not count a call on Dialling unless the user says they made it and has not already tapped it in the app.'
        ]
      };
    }
  },
  {
    name: 'search_leads',
    description:
      'Find leads on an offer. Filter by list (to_dial, follow_ups, booked, closed, out, all), free text (business, contact, suburb, category, email, notes or phone digits), or how they were contacted. Returns short lead cards. Read only.',
    inputSchema: {
      type: 'object',
      properties: {
        ...offerArg,
        list: { type: 'string', enum: ['to_dial', 'follow_ups', 'booked', 'closed', 'out', 'all'], default: 'all' },
        query: { type: 'string' },
        contacted_by: { type: 'string', enum: ['call', 'sms', 'email'] },
        missing: { type: 'string', enum: ['email', 'contact', 'phone'], description: 'Only leads with this field empty' },
        contactable_by: { type: 'string', enum: ['call', 'sms', 'email'], description: 'Leave out leads who opted out of this channel. Use it when picking who to message.' },
        sort: { type: 'string', enum: ['score', 'follow', 'recent', 'name'], default: 'score' },
        limit: { type: 'number', default: 50, maximum: 500 }
      }
    },
    run(a) {
      const o = pickOffer(a.offer);
      const listKey = { to_dial: 'queue', follow_ups: 'follow', booked: 'booked', closed: 'closed', out: 'out', all: 'all' }[a.list || 'all'] || 'all';
      let leads = listLeads(coldLeads(o.id), { filter: listKey, q: a.query || '', sort: a.sort || 'score', channel: a.contacted_by || '' }, today());
      if (a.missing) leads = leads.filter((l) => !String(l[a.missing] || '').trim());
      if (a.contactable_by) leads = leads.filter((l) => !l.doNotContact.includes(a.contactable_by));
      const limit = Math.min(Math.max(1, Number(a.limit) || 50), 500);
      return { offer: o.name, total: leads.length, shown: Math.min(limit, leads.length), leads: leads.slice(0, limit).map(brief) };
    }
  },
  {
    name: 'get_lead',
    description: 'Everything about one lead: details, notes, research columns from the sheet, booked call, and the full contact history. Read only.',
    inputSchema: { type: 'object', properties: { ...offerArg, lead: matchSchema }, required: ['lead'] },
    run(a) {
      const o = pickOffer(a.offer);
      return { offer: o.name, lead: full(findLead(o.id, a.lead)) };
    }
  },
  {
    name: 'update_lead',
    description:
      'Change fields on one lead (email, contact, phone, notes, follow-up date, and so on) and/or add to its notes. Never touches the Dialling numbers.',
    inputSchema: {
      type: 'object',
      properties: {
        ...offerArg,
        lead: matchSchema,
        set: leadFieldSchema,
        append_note: { type: 'string', description: 'Added on a new line at the end of the notes' },
        only_fill_blanks: { type: 'boolean', default: false, description: 'Leave any field that already has a value alone' }
      },
      required: ['lead']
    },
    write: true,
    run(a) {
      const o = pickOffer(a.offer);
      const l = findLead(o.id, a.lead);
      const out = applyUpdate(o.id, l, a);
      return { offer: o.name, ...out };
    }
  },
  {
    name: 'update_leads',
    description:
      'Update many leads in one go, e.g. filling in emails you found. Each item says which lead (lead_id, phone, email or business) and what to set. Items that fail are reported and the rest still save. Never touches the Dialling numbers.',
    inputSchema: {
      type: 'object',
      properties: {
        ...offerArg,
        updates: {
          type: 'array',
          maxItems: 1000,
          items: {
            type: 'object',
            properties: { lead: matchSchema, set: leadFieldSchema, append_note: { type: 'string' } },
            required: ['lead']
          }
        },
        only_fill_blanks: { type: 'boolean', default: true, description: 'Leave fields that already have a value alone (default true for bulk updates)' }
      },
      required: ['updates']
    },
    write: true,
    run(a) {
      const o = pickOffer(a.offer);
      const results = [];
      const fill = a.only_fill_blanks !== false;
      for (const [i, u] of (a.updates || []).entries()) {
        try {
          const l = findLead(o.id, u.lead);
          const r = applyUpdate(o.id, l, { ...u, only_fill_blanks: fill });
          results.push({ item: i, lead_id: l.id, business: l.business, changed: r.changed, skipped: r.skipped });
        } catch (e) {
          results.push({ item: i, error: e.message });
        }
      }
      return {
        offer: o.name,
        updated: results.filter((r) => r.changed?.length).length,
        unchanged: results.filter((r) => r.changed && !r.changed.length).length,
        failed: results.filter((r) => r.error).length,
        results
      };
    }
  },
  {
    name: 'add_lead',
    description: 'Add one new lead to an offer. Refuses if a lead with the same mobile, email or business already exists (use update_lead then).',
    inputSchema: {
      type: 'object',
      properties: { ...offerArg, lead: leadFieldSchema, research: { type: 'object', description: 'Extra columns shown on the lead, e.g. {"Pitch Angle": "..."}', additionalProperties: { type: 'string' } } },
      required: ['lead']
    },
    write: true,
    run(a) {
      const o = pickOffer(a.offer);
      const p = toPatch(a.lead);
      const leads = coldLeads(o.id);
      const dupe = leads.find(
        (l) =>
          (p.phone && phoneKey(p.phone) && phoneKey(l.phone) === phoneKey(p.phone)) ||
          (p.email && l.email && l.email.toLowerCase() === String(p.email).toLowerCase()) ||
          (p.business && l.business.toLowerCase() === String(p.business).toLowerCase())
      );
      if (dupe) throw new Error(`Already on the list as lead ${dupe.id} (${dupe.business}). Use update_lead.`);
      const l = createColdLead(o.id, { ...p, extra: Object.entries(a.research || {}) });
      return { offer: o.name, added: full(l) };
    }
  },
  {
    name: 'import_leads',
    description:
      'Add many leads at once, like the spreadsheet import. Leads already on the list (same mobile, email or business) only get blanks filled and research refreshed; nothing logged in the app is overwritten.',
    inputSchema: {
      type: 'object',
      properties: {
        ...offerArg,
        leads: {
          type: 'array',
          maxItems: 5000,
          items: {
            type: 'object',
            properties: { ...leadFieldSchema.properties, research: { type: 'object', additionalProperties: { type: 'string' } } }
          }
        }
      },
      required: ['leads']
    },
    write: true,
    run(a) {
      const o = pickOffer(a.offer);
      const rows = (a.leads || []).map(({ research, ...rest }) => ({ ...toPatch(rest), extra: Object.entries(research || {}) }));
      const r = importColdLeads(o.id, rows);
      linkLeadCalls();
      return { offer: o.name, ...r };
    }
  },
  {
    name: 'log_contact',
    description:
      "Add an entry to a lead's contact history: a call, SMS or email. For emails pass subject and the full body, and external_id (the message id) so re-imports don't duplicate. A reply from the lead is outcome inbound. It shows as the lead's last contact. It only counts on the Dialling numbers when it is a call the user made AND count_on_dialling is true; leave that false unless told.",
    inputSchema: { type: 'object', properties: { ...offerArg, lead: matchSchema, ...contactProps }, required: ['lead', 'outcome'] },
    write: true,
    run(a) {
      const o = pickOffer(a.offer);
      return { offer: o.name, ...logOne(o.id, a) };
    }
  },
  {
    name: 'log_contacts',
    description:
      'Log many history entries at once, e.g. a batch of sent emails and their replies across leads. Same fields as log_contact per item. Items with an external_id already on that lead are skipped as duplicates; items that fail are reported and the rest still save.',
    inputSchema: {
      type: 'object',
      properties: {
        ...offerArg,
        entries: { type: 'array', maxItems: 500, items: { type: 'object', properties: { lead: matchSchema, ...contactProps }, required: ['lead', 'outcome'] } }
      },
      required: ['entries']
    },
    write: true,
    run(a) {
      const o = pickOffer(a.offer);
      const results = (a.entries || []).map((e, i) => {
        try {
          const r = logOne(o.id, e);
          return { item: i, lead_id: r.lead.id, business: r.lead.business, ...(r.duplicate ? { duplicate: true } : { entry_id: r.logged.entry_id }) };
        } catch (err) {
          return { item: i, error: err.message };
        }
      });
      return {
        offer: o.name,
        added: results.filter((r) => r.entry_id).length,
        duplicates: results.filter((r) => r.duplicate).length,
        failed: results.filter((r) => r.error).length,
        results
      };
    }
  },
  {
    name: 'check_consent',
    description:
      'Before calling, texting or emailing a lead, check they have not asked you to stop. Give one lead or a list of leads (and optionally the channel). Returns, per lead, whether calls, SMS and email are OK. Read only.',
    inputSchema: {
      type: 'object',
      properties: {
        ...offerArg,
        lead: matchSchema,
        leads: { type: 'array', maxItems: 500, items: matchSchema },
        channel: { type: 'string', enum: CHANNELS, description: 'If given, each result also has ok: true/false for this channel' }
      }
    },
    run(a) {
      const o = pickOffer(a.offer);
      const list = a.leads?.length ? a.leads : a.lead ? [a.lead] : [];
      if (!list.length) throw new Error('Give lead or leads');
      const results = list.map((m) => {
        try {
          const c = consentOf(findLead(o.id, m));
          return a.channel ? { ...c, ok: c[{ call: 'calls_ok', sms: 'sms_ok', email: 'email_ok' }[a.channel]] } : c;
        } catch (e) {
          return { match: m, error: e.message };
        }
      });
      return { offer: o.name, ...(a.channel ? { channel: a.channel, blocked: results.filter((r) => r.ok === false).length } : {}), results };
    }
  },
  {
    name: 'set_consent',
    description:
      'Record that a lead asked not to be contacted on a channel (opt_out), or said it is fine again (opt_in). Use opt_out straight away when someone replies STOP, unsubscribe, or asks not to be called/texted/emailed, and tell the user. opt_in only when the user tells you the lead agreed: set user_confirmed true.',
    inputSchema: {
      type: 'object',
      properties: {
        ...offerArg,
        lead: matchSchema,
        opt_out: { type: 'array', items: { type: 'string', enum: [...CHANNELS, 'all'] } },
        opt_in: { type: 'array', items: { type: 'string', enum: [...CHANNELS, 'all'] } },
        reason: { type: 'string', description: 'e.g. "Replied STOP to the text on 20 Nov"' },
        user_confirmed: { type: 'boolean', description: 'Required for opt_in' }
      },
      required: ['lead']
    },
    write: true,
    run(a) {
      const o = pickOffer(a.offer);
      const l = findLead(o.id, a.lead);
      if (a.opt_in?.length && !a.user_confirmed) throw new Error('Only opt a lead back in when the user says so (set user_confirmed: true).');
      if (!a.opt_out?.length && !a.opt_in?.length) throw new Error('Give opt_out or opt_in');
      const updated = setConsent(o.id, l.id, { block: a.opt_out || [], allow: a.opt_in || [], note: a.reason || '' });
      return { offer: o.name, consent: consentOf(updated) };
    }
  },
  {
    name: 'dialling_stats',
    description: 'The Dialling numbers for a month on an offer: dials, pick-up rate, bookings and so on, the same as the Dialling tab. Read only.',
    inputSchema: { type: 'object', properties: { ...offerArg, month: { type: 'string', description: 'YYYY-MM, defaults to this month' } } },
    run(a) {
      const o = pickOffer(a.offer);
      const month = /^\d{4}-\d{2}$/.test(a.month || '') ? a.month : today().slice(0, 7);
      const { first, last } = monthBounds(month);
      const days = sdrRange(o.id, first, last);
      const s = sdrSummary(days, monthMeta(o.id, month).sdr);
      return { offer: o.name, month, summary: s, days: days.map(({ offer_id, updated_at, ...d }) => d) };
    }
  },
  {
    name: 'recent_changes',
    description: 'What has been changed through this connection lately (by you or another assistant). Read only.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', default: 20, maximum: 200 } } },
    run(a) {
      return db
        .prepare('SELECT at, tool, offer_id, args, result FROM api_log ORDER BY id DESC LIMIT ?')
        .all(Math.min(Number(a.limit) || 20, 200))
        .map((r) => ({ ...r, args: JSON.parse(r.args), result: JSON.parse(r.result) }));
    }
  }
];

function applyUpdate(offerId, l, a) {
  const patch = toPatch(a.set || {});
  const skipped = [];
  if (a.only_fill_blanks) {
    for (const k of Object.keys(patch)) {
      const cur = l[k];
      if (cur != null && String(cur).trim() !== '' && String(cur) !== String(patch[k])) {
        skipped.push(k);
        delete patch[k];
      }
    }
  }
  if (a.append_note) patch.notes = appendNote({ notes: patch.notes ?? l.notes }, a.append_note);
  const changed = Object.keys(patch).filter((k) => String(patch[k] ?? '') !== String(l[k] ?? ''));
  const updated = changed.length ? updateColdLead(offerId, l.id, Object.fromEntries(changed.map((k) => [k, patch[k]]))) : l;
  return { lead: brief(updated), changed, skipped };
}

// ---------- JSON-RPC ----------

export function authorised(request) {
  const want = process.env.CLOSER_MCP_TOKEN || '';
  if (want.length < 24) return false;
  const got = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

const PROTOCOL = '2025-06-18';
const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

function callTool(name, args) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { content: [{ type: 'text', text: `Unknown tool ${name}` }], isError: true };
  try {
    const result = tool.write ? db.transaction(() => tool.run(args || {}))() : tool.run(args || {});
    if (tool.write) {
      let offerId = null;
      try {
        offerId = pickOffer(args?.offer).id;
      } catch {}
      const short = JSON.stringify(result).length > 4000 ? { summary: Object.fromEntries(Object.entries(result).filter(([, v]) => typeof v !== 'object')) } : result;
      db.prepare('INSERT INTO api_log(at, tool, offer_id, args, result) VALUES(?, ?, ?, ?, ?)').run(
        new Date().toISOString(),
        name,
        offerId,
        JSON.stringify(args || {}).slice(0, 20000),
        JSON.stringify(short)
      );
    }
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 1) }], structuredContent: result };
  } catch (e) {
    return { content: [{ type: 'text', text: String(e.message || e) }], isError: true };
  }
}

export function handleRpc(msg) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return fail(msg?.id ?? null, -32600, 'Invalid request');
  const { id, method, params } = msg;
  if (id === undefined) return null; // notification, e.g. notifications/initialized
  switch (method) {
    case 'initialize':
      return ok(id, {
        protocolVersion: params?.protocolVersion || PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'closer-desk', title: 'Closer Desk CRM', version: VERSION },
        instructions:
          'Closer Desk is the user\'s sales CRM. Call crm_overview first. Leads belong to an offer. Check consent (check_consent) before contacting any lead, and record opt-outs with set_consent. Only calls the user made count on Dialling; never set count_on_dialling unless they ask. Prefer update_leads with only_fill_blanks for bulk fills.'
      });
    case 'ping':
      return ok(id, {});
    case 'tools/list':
      return ok(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case 'tools/call':
      return ok(id, callTool(params?.name, params?.arguments));
    default:
      return fail(id, -32601, `Method not found: ${method}`);
  }
}
