// Cold-call leads: stages, the dial queue, and turning a spreadsheet into lead rows.
import { SDR_OUTCOMES } from './stats.js';

/** What a history entry can be: the five dial outcomes, plus a call they made to you (never counted). */
export const ENTRY_TYPES = [...SDR_OUTCOMES, { key: 'inbound', label: 'Inbound call', short: 'Inbound', tone: 'green' }];
export const entryType = (k) => ENTRY_TYPES.find((o) => o.key === k);

/** Suggested second dispositions for each outcome. Anything you type yourself joins these. */
export const REASONS = {
  no_answer: ['Voicemail', 'Rang out', 'Line busy', 'Switched off', 'Left a message', 'Receptionist, owner out'],
  not_interested: [
    'Not looking to grow',
    'Too expensive',
    'Too hard / no time',
    'Already has someone',
    'Happy as is',
    'Closed down business',
    'Bad timing',
    'Not the decision maker',
    'Hung up'
  ],
  wrong_no: ['Disconnected', 'Wrong person', 'Business closed', 'Number not in service', 'Landline / fax'],
  callback: ['Busy right now', 'Call back later today', 'Wants info first', 'Talk to partner', 'Owner away'],
  booked: ['Discovery call', 'Wants a quote', 'Wants a demo'],
  inbound: ['Returned my call', 'Asked for info', 'Ready to book', 'Asked to stop']
};
export function reasonOptions(outcome, used = {}) {
  const base = REASONS[outcome] || [];
  const extra = (used[outcome] || []).filter((r) => !base.some((b) => b.toLowerCase() === r.toLowerCase()));
  return [...base, ...extra];
}
/** "No answer" + "Voicemail" -> "No answer, voicemail" */
export const withReason = (label, reason) => (reason ? `${label}, ${reason[0].toLowerCase()}${reason.slice(1)}` : label);

/** How a contact happened. Only calls you make can count on Dialling. */
export const CHANNELS = [
  { key: 'call', label: 'Call', plural: 'Calls', icon: 'phone' },
  { key: 'sms', label: 'SMS', plural: 'SMS', icon: 'chat' },
  { key: 'email', label: 'Email', plural: 'Emails', icon: 'mail' }
];
export const channelOf = (k) => CHANNELS.find((c) => c.key === k) || CHANNELS[0];

/** "Do not contact" when every channel is blocked, otherwise e.g. "No calls, no SMS". */
export function consentLabel(list = []) {
  if (!list.length) return '';
  if (list.length === 3) return 'Do not contact';
  const word = { call: 'calls', sms: 'SMS', email: 'emails' };
  const parts = list.map((c) => word[c]);
  return 'No ' + parts.join(', no ');
}

// the same outcome reads differently over text or email
const WRITTEN = {
  sms: { no_answer: 'No reply', callback: 'Follow up', inbound: 'They texted you', wrong_no: 'Wrong number' },
  email: { no_answer: 'No reply', callback: 'Follow up', inbound: 'They emailed you', wrong_no: 'Bounced' }
};
/** Label for an outcome on a channel, e.g. "No reply" for an SMS that got no answer. */
export function entryLabel(outcome, channel = 'call') {
  if (!outcome) return channel === 'sms' ? 'Sent a text' : channel === 'email' ? 'Sent an email' : 'Note';
  return WRITTEN[channel]?.[outcome] || entryType(outcome)?.label || 'Note';
}

export const STAGES = {
  new: { label: 'Not called', tone: 'none' },
  no_answer: { label: 'No answer', tone: 'iron' },
  callback: { label: 'Callback', tone: 'yellow' },
  booked: { label: 'Booked', tone: 'blue' },
  not_interested: { label: 'Not interested', tone: 'red' },
  wrong_no: { label: 'Wrong number', tone: 'slate' },
  call_no_show: { label: 'No show', tone: 'iron' },
  call_closed: { label: 'Closed', tone: 'green' },
  call_not_interested: { label: 'Said no on call', tone: 'red' },
  call_callback: { label: 'Call follow-up', tone: 'yellow' },
  call_unqualified: { label: 'Unqualified', tone: 'slate' }
};
export const stageOf = (l) => STAGES[l.stage] || STAGES.new;

const DIALABLE = ['new', 'no_answer', 'callback'];
export const isDue = (l, today) => !!l.followUp && l.followUp <= today && DIALABLE.includes(l.stage);

export const FILTERS = [
  { key: 'queue', label: 'To dial', test: (l, today) => inQueue(l, today) },
  { key: 'follow', label: 'Follow-ups', test: (l) => ['callback', 'call_callback', 'call_no_show'].includes(l.stage) },
  { key: 'booked', label: 'Booked', test: (l) => l.stage === 'booked' },
  { key: 'closed', label: 'Closed', test: (l) => l.stage === 'call_closed' },
  { key: 'out', label: 'Out', test: (l) => ['not_interested', 'wrong_no', 'call_not_interested', 'call_unqualified'].includes(l.stage) },
  { key: 'optout', label: 'Opted out', test: (l) => !!l.doNotContact?.length },
  { key: 'all', label: 'All', test: () => true }
];

/** Ready to ring today: never called, no answer, or a callback whose date has come. */
export function inQueue(l, today) {
  if (!DIALABLE.includes(l.stage)) return false;
  // asked not to be called: never in the call queue
  if (l.doNotContact?.includes('call')) return false;
  if (l.followUp) return l.followUp <= today;
  if (l.stage === 'callback') return true;
  return l.lastDialOn !== today;
}

/** Callbacks that are due come first, then fresh leads by score, then no-answers you've tried least. */
export function dialQueue(leads, today) {
  const rank = (l) => (isDue(l, today) ? 0 : l.stage === 'new' ? 1 : 2);
  const score = (l) => (l.score == null ? -Infinity : l.score);
  return leads
    .filter((l) => inQueue(l, today))
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (rank(a) === 0 ? a.followUp.localeCompare(b.followUp) : 0) ||
        (rank(a) === 2 ? a.attempts - b.attempts || (a.lastDialOn || '').localeCompare(b.lastDialOn || '') : 0) ||
        score(b) - score(a) ||
        a.id - b.id
    );
}

export const leadName = (l) => l.business || l.contact || l.phone || 'Lead';

/** Research columns worth putting up top while you're on the phone. */
export function pickExtra(l, re) {
  return l.extra.find(([k]) => re.test(k))?.[1] || '';
}

export function linkFor(v) {
  const s = String(v || '').trim();
  if (/\s/.test(s) || s.length < 5) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(s)) return 'https://' + s;
  return null;
}

// ---------- spreadsheet columns ----------

export const FIELDS = [
  { key: 'business', label: 'Business' },
  { key: 'contact', label: 'Contact name' },
  { key: 'phone', label: 'Mobile / phone' },
  { key: 'email', label: 'Email' },
  { key: 'suburb', label: 'Suburb' },
  { key: 'category', label: 'Category' },
  { key: 'score', label: 'Prospect score' },
  { key: 'followUp', label: 'Follow-up date' },
  { key: 'notes', label: 'Notes' },
  { key: 'history', label: 'Past call (not counted)' },
  { key: 'extra', label: 'Research detail' },
  { key: 'skip', label: "Don't import" }
];

const GUESS = [
  ['business', /^(business|business name|company|company name|account)$/],
  ['contact', /^(contact|contact name|name|owner|decision maker|first name)$/],
  ['phone', /^(mobile|phone|phone number|mobile number|number|cell|ph)$/],
  ['email', /^(email|e-mail|email address)$/],
  ['suburb', /^(suburb|city|town|location|area)$/],
  ['category', /^(category|industry|niche|type)$/],
  ['score', /^(prospect score|score|lead score)$/],
  ['followUp', /^(follow-?up( date)?|call ?back( date)?|next call)$/],
  ['notes', /^(notes?|comments?)$/],
  ['history', /^(call|dial|attempt) ?\d+$/]
];

export function guessField(header) {
  const h = String(header || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!h) return 'skip';
  return GUESS.find(([, re]) => re.test(h))?.[0] || 'extra';
}

/** Excel serial, DD/MM/YYYY (Australian), YYYY-MM-DD, or "20 Nov 2026". */
export function parseDate(v, today) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const pad = (n) => String(n).padStart(2, '0');
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 864e5);
    return d.toISOString().slice(0, 10);
  }
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/);
  if (m) {
    const y = m[3] ? (m[3].length === 2 ? '20' + m[3] : m[3]) : (today || new Date().toISOString()).slice(0, 4);
    const [d, mo] = [Number(m[1]), Number(m[2])];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${y}-${pad(mo)}-${pad(d)}`;
  }
  const t = Date.parse(/\d{4}/.test(s) ? s : `${s} ${(today || new Date().toISOString()).slice(0, 4)}`);
  if (Number.isFinite(t)) {
    const d = new Date(t);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  return null;
}

/** Spreadsheet rows (first row = headers) to lead objects for /api/leads/import. */
export function toLeads(headers, rows, mapping, today) {
  const out = [];
  for (const r of rows) {
    if (!r.some((c) => String(c ?? '').trim())) continue;
    const lead = { extra: [], history: [] };
    headers.forEach((h, i) => {
      // Excel/Sheets exports often write whole numbers as "8.0"
      const v = String(r[i] ?? '').trim().replace(/^(-?\d+)\.0+$/, '$1');
      const f = mapping[i];
      if (!v || f === 'skip') return;
      if (f === 'extra') lead.extra.push([h || `Column ${i + 1}`, v]);
      else if (f === 'history') lead.history.push(`${h}: ${v}`);
      else if (f === 'followUp') {
        const d = parseDate(v, today);
        if (d) lead.followUp = d;
        else lead.extra.push([h, v]);
      } else if (f === 'phone') {
        // Excel drops the leading 0 off mobiles stored as numbers
        const d = v.replace(/\s/g, '');
        lead.phone = /^4\d{8}$/.test(d) ? '0' + v : /^614\d{8}$/.test(d) ? '+' + v : v;
      } else lead[f] = lead[f] ? `${lead[f]} ${v}` : v;
    });
    if (lead.business || lead.contact || lead.phone) out.push(lead);
  }
  return out;
}

// ---------- reading files ----------

/** CSV or tab-separated (what you get copying cells out of Excel). Handles quoted cells. */
export function parseDelimited(text) {
  const first = text.split(/\r?\n/, 1)[0];
  const sep = first.includes('\t') ? '\t' : (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === sep) row.push(cell), (cell = '');
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell), rows.push(row), (row = []), (cell = '');
    } else cell += c;
  }
  if (cell !== '' || row.length) row.push(cell), rows.push(row);
  return rows.filter((r) => r.some((c) => c.trim()));
}

async function unzip(buf) {
  const v = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--)
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error('That file is not a .xlsx workbook');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const files = new Map();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    const method = v.getUint16(p + 10, true);
    const size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(buf, p + 46, nameLen));
    files.set(name, { method, size, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return async (name) => {
    const f = files.get(name);
    if (!f) return null;
    const start = f.local + 30 + v.getUint16(f.local + 26, true) + v.getUint16(f.local + 28, true);
    const bytes = new Uint8Array(buf, start, f.size);
    if (f.method === 0) return dec.decode(bytes);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).text();
  };
}

const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
const kids = (el, tag) => [...el.getElementsByTagName(tag)];
const colIndex = (ref) => [...ref.replace(/\d+/g, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/** Read an .xlsx in the browser. Returns { sheets: [name], read(name) -> rows }. */
export async function readXlsx(buf) {
  const get = await unzip(buf);
  const wb = xml((await get('xl/workbook.xml')) || '');
  const rels = xml((await get('xl/_rels/workbook.xml.rels')) || '<r/>');
  const target = Object.fromEntries(kids(rels, 'Relationship').map((r) => [r.getAttribute('Id'), r.getAttribute('Target')]));
  const sheets = kids(wb, 'sheet').map((s) => {
    const t = target[s.getAttribute('r:id')] || '';
    return { name: s.getAttribute('name'), path: t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, '') };
  });
  if (!sheets.length) throw new Error('No sheets found in that workbook');
  const ssText = await get('xl/sharedStrings.xml');
  const shared = ssText ? kids(xml(ssText), 'si').map((si) => kids(si, 't').map((t) => t.textContent).join('')) : [];
  return {
    sheets: sheets.map((s) => s.name),
    async read(name) {
      const s = sheets.find((x) => x.name === name) || sheets[0];
      const doc = xml((await get(s.path)) || '<x/>');
      const rows = [];
      for (const r of kids(doc, 'row')) {
        const row = [];
        for (const c of kids(r, 'c')) {
          const t = c.getAttribute('t');
          const val = c.getElementsByTagName('v')[0]?.textContent ?? '';
          const text =
            t === 's'
              ? (shared[Number(val)] ?? '')
              : t === 'inlineStr'
                ? kids(c, 't').map((x) => x.textContent).join('')
                : t === 'b'
                  ? val === '1' ? 'TRUE' : 'FALSE'
                  : /^-?\d+\.\d{7,}$/.test(val) ? String(Number(Number(val).toPrecision(12))) : val;
          row[colIndex(c.getAttribute('r') || 'A')] = text;
        }
        rows[Number(r.getAttribute('r') || rows.length + 1) - 1] = Array.from(row, (x) => x ?? '');
      }
      return Array.from(rows, (x) => x ?? []).filter((r) => r.some((c) => String(c).trim()));
    }
  };
}

// ---------- history times (always shown in the business timezone) ----------

export function whenLabel(iso, tz, withDay = true) {
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: tz,
    ...(withDay ? { weekday: 'short' } : {}),
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(iso));
}

/** ISO instant -> { date: 'YYYY-MM-DD', time: 'HH:mm' } on the wall clock in tz. */
export function wallClock(iso, tz) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value])
  );
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

export function sinceLabel(iso, today, tz) {
  const d = wallClock(iso, tz).date;
  const days = Math.round((Date.UTC(...today.split('-').map((n, i) => n - (i === 1))) - Date.UTC(...d.split('-').map((n, i) => n - (i === 1)))) / 864e5);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}

// ---------- list order (shared by the lead list and the lead page's previous / next) ----------

// Columns the lead list can show. `get` is the value used for sorting; empty values always sort last.
// Research columns from the spreadsheet are added per offer as "x:<column name>".
const STAGE_ORDER = Object.keys(STAGES);
const numeric = (v) => {
  const n = parseFloat(String(v ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) && /\d/.test(String(v ?? '')) ? n : null;
};

export const COLUMNS = [
  { key: 'score', label: 'Score', dir: 'desc', get: (l) => l.score, on: true },
  { key: 'name', label: 'Business', fixed: true, get: (l) => leadName(l).toLowerCase() },
  { key: 'contact', label: 'Contact', get: (l) => l.contact.toLowerCase() || null, on: true },
  { key: 'phone', label: 'Mobile', get: (l) => l.phone || null, on: true },
  { key: 'status', label: 'Status', get: (l) => STAGE_ORDER.indexOf(l.stage), on: true },
  { key: 'reason', label: 'Reason', get: (l) => l.reason?.toLowerCase() || null, on: true },
  { key: 'last', label: 'Last contact', dir: 'desc', get: (l) => l.lastContactAt, on: true },
  { key: 'follow', label: 'Follow-up', get: (l) => l.followUp, on: true },
  { key: 'suburb', label: 'Suburb', get: (l) => l.suburb.toLowerCase() || null, on: true },
  { key: 'category', label: 'Category', get: (l) => l.category.toLowerCase() || null },
  { key: 'email', label: 'Email', get: (l) => l.email.toLowerCase() || null },
  { key: 'attempts', label: 'Calls made', dir: 'desc', get: (l) => l.attempts || null },
  { key: 'channel', label: 'Last contacted by', get: (l) => lastChannel(l) },
  { key: 'call', label: 'Booked call', get: (l) => (l.call && !l.call.cancelled ? l.call.start : null) },
  { key: 'notes', label: 'Notes', get: (l) => l.notes.toLowerCase() || null },
  { key: 'consent', label: 'Opted out of', get: (l) => consentLabel(l.doNotContact) || null }
];
export const DEFAULT_COLUMNS = COLUMNS.filter((c) => c.on || c.fixed).map((c) => c.key);

export function lastChannel(l) {
  return l.dials.filter((d) => d.date).at(-1)?.channel || null;
}

/** Research columns found on any lead, in sheet order. */
export function researchColumns(leads) {
  const seen = new Map();
  for (const l of leads) for (const [k, v] of l.extra) if (!seen.has(k)) seen.set(k, numeric(v) != null);
  for (const l of leads) for (const [k, v] of l.extra) if (v && numeric(v) == null) seen.set(k, false);
  return [...seen].map(([name, num]) => ({
    key: 'x:' + name,
    label: name,
    research: true,
    dir: num ? 'desc' : 'asc',
    get: (l) => {
      const v = l.extra.find(([k]) => k === name)?.[1];
      if (!v) return null;
      return num ? numeric(v) : v.toLowerCase();
    }
  }));
}

/** Sort spec "key" (natural direction) or "-key" (reversed). Old links used "recent" for last contact. */
function parseSort(s) {
  const rev = String(s || '').startsWith('-');
  let key = String(s || '').replace(/^-/, '');
  if (key === 'recent') key = 'last';
  return { key, rev };
}
const columnFor = (key) => COLUMNS.find((c) => c.key === key) || (key.startsWith('x:') ? null : undefined);

function comparator(sort, leads) {
  const { key, rev } = parseSort(sort);
  const col = columnFor(key) ?? researchColumns(leads).find((c) => c.key === key) ?? COLUMNS[0];
  const down = (col.dir === 'desc') !== rev;
  return (a, b) => {
    const x = col.get(a);
    const y = col.get(b);
    const xe = x == null || x === '';
    const ye = y == null || y === '';
    if (xe || ye) return xe && ye ? a.id - b.id : xe ? 1 : -1;
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
    return (down ? -c : c) || a.id - b.id;
  };
}

/** Sort choices for the dropdown (the headers sort by any column). */
export const SORTS = [
  { key: 'score', label: 'Highest score' },
  { key: 'follow', label: 'Follow-up date' },
  { key: 'last', label: 'Last contacted' },
  { key: '-last', label: 'Longest since contact' },
  { key: 'name', label: 'A to Z' }
];
export const sortState = (sort) => parseSort(sort);

/** The list's view settings from a URL, with defaults. */
export function listView(params) {
  const f = params.get('f');
  const s = params.get('s');
  const c = params.get('c');
  return {
    filter: FILTERS.some((x) => x.key === f) ? f : 'queue',
    sort: /^-?([a-z]+|x:.{1,80})$/.test(s || '') ? s : 'score',
    q: (params.get('q') || '').slice(0, 100),
    channel: CHANNELS.some((x) => x.key === c) ? c : ''
  };
}
export function viewQuery({ filter, sort, q, channel = '' }) {
  const p = new URLSearchParams();
  if (filter !== 'queue') p.set('f', filter);
  if (sort !== 'score') p.set('s', sort);
  if (channel) p.set('c', channel);
  if (q.trim()) p.set('q', q.trim());
  const s = p.toString();
  return s ? '?' + s : '';
}

function matches(l, q) {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const digits = needle.replace(/\D/g, '');
  if (digits.length >= 3 && l.phone.replace(/\D/g, '').includes(digits)) return true;
  return [l.business, l.contact, l.suburb, l.category, l.email, l.notes].some((s) => s.toLowerCase().includes(needle));
}

/** Leads you've been in touch with over a channel at least once. */
export const usedChannel = (l, channel) => !channel || l.dials.some((d) => d.channel === channel);

const sorted = (leads, { sort, q, channel }) =>
  leads.filter((l) => matches(l, q) && usedChannel(l, channel)).sort(comparator(sort, leads));

export function listLeads(leads, view, today) {
  const f = FILTERS.find((x) => x.key === view.filter);
  return sorted(leads, view).filter((l) => f.test(l, today));
}

/**
 * Where a lead sits in the list it was opened from. If logging an outcome just moved it out of that
 * list (say, out of To dial), previous and next still step from the spot it was in.
 */
export function neighbours(leads, id, view, today) {
  const f = FILTERS.find((x) => x.key === view.filter);
  const all = sorted(leads, view);
  const at = all.findIndex((l) => l.id === id);
  const inList = (l) => f.test(l, today);
  if (at < 0) {
    // this lead isn't in that search at all: next starts the list from the top
    const list = all.filter(inList);
    return { prev: null, next: list[0]?.id ?? null, position: null, total: list.length };
  }
  const before = all.slice(0, at).filter(inList);
  const after = all.slice(at + 1).filter(inList);
  const here = inList(all[at]);
  return {
    prev: before.at(-1)?.id ?? null,
    next: after[0]?.id ?? null,
    position: here ? before.length + 1 : null,
    total: before.length + after.length + (here ? 1 : 0)
  };
}
