import { db, getSettings, setSetting, listOffers, resolveOffer } from './db.js';

const env = process.env;

// ---------- Google Calendar (OAuth refresh token, read-only use) ----------

let gToken = { value: null, exp: 0 };

async function googleAccessToken() {
  if (gToken.value && Date.now() < gToken.exp - 60_000) return gToken.value;
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REFRESH_TOKEN) {
    throw new Error('Google Calendar is not connected. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN to the server .env.');
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token'
    })
  });
  const j = await res.json();
  if (!j.access_token) throw new Error(`Google token refresh failed: ${j.error_description || j.error || res.status}`);
  gToken = { value: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return gToken.value;
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_RE = /(?:Phone:-?\s*|\b)(\+?61\s?4\d{2}\s?\d{3}\s?\d{3}|04\d{2}\s?\d{3}\s?\d{3})/;

function prospectFrom(title) {
  const t = title.trim();
  let m = t.match(/between .+? and (.+)$/i);
  if (m) return m[1].trim();
  m = t.match(/^(.+?)\s+(GamePlan|Discovery|Strategy|Sales)\b/i);
  if (m) return m[1].trim();
  return t;
}

function joinUrlFrom(ev) {
  return (
    ev.hangoutLink ||
    ev.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri ||
    (ev.location && /^https?:\/\//.test(ev.location) ? ev.location : null)
  );
}

function matchKeyword(title, keywords) {
  const lower = title.toLowerCase();
  return keywords.find((k) => lower.includes(k.toLowerCase())) || null;
}

// Each offer lists the event titles that are its calls. When several offers match the same title,
// the most recently opened one gets it (you can move a call to another offer from its drawer).
function offerMatcher() {
  const current = resolveOffer()?.id;
  const offers = listOffers({ includeArchived: false })
    .map((o) => ({ id: o.id, keywords: o.keywords.split(',').map((k) => k.trim()).filter(Boolean) }))
    .sort((a, b) => (b.id === current) - (a.id === current));
  return (title) => {
    for (const o of offers) {
      const kind = matchKeyword(title, o.keywords);
      if (kind) return { kind, offerId: o.id };
    }
    return null;
  };
}

export async function syncCalendar() {
  const match = offerMatcher();
  const token = await googleAccessToken();
  const timeMin = new Date(Date.now() - 120 * 864e5).toISOString();
  const timeMax = new Date(Date.now() + 60 * 864e5).toISOString();
  let pageToken;
  let seen = 0;
  let kept = 0;
  const upsert = db.prepare(`
    INSERT INTO calls(id, offer_id, title, prospect, email, phone, start, end, join_url, description, kind, status, source, updated_at)
    VALUES(@id, @offer_id, @title, @prospect, @email, @phone, @start, @end, @join_url, @description, @kind, @status, 'calendar', @now)
    ON CONFLICT(id) DO UPDATE SET title=excluded.title, prospect=excluded.prospect,
      email=COALESCE(excluded.email, calls.email), phone=COALESCE(excluded.phone, calls.phone),
      start=excluded.start, end=excluded.end, join_url=excluded.join_url, description=excluded.description,
      kind=excluded.kind, status=excluded.status`);
  const ids = new Set();
  do {
    const u = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
    u.search = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
      showDeleted: 'true',
      ...(pageToken ? { pageToken } : {})
    });
    const res = await fetch(u, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Calendar API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = await res.json();
    const tx = db.transaction((items) => {
      for (const ev of items) {
        seen++;
        const title = ev.summary || '';
        const hit = match(title);
        if (!hit || !ev.start?.dateTime) continue;
        const { kind, offerId } = hit;
        kept++;
        ids.add(ev.id);
        const desc = ev.description || '';
        const guest = (ev.attendees || []).find((a) => !a.self && !a.organizer);
        const descEmail = desc.match(/Email:-\s*(\S+@\S+)/)?.[1] || null;
        upsert.run({
          id: ev.id,
          offer_id: offerId,
          title,
          prospect: guest?.displayName?.trim() || prospectFrom(title),
          email: guest?.email || descEmail || null,
          phone: desc.match(PHONE_RE)?.[1]?.replace(/\s+/g, ' ') || null,
          start: new Date(ev.start.dateTime).toISOString(),
          end: new Date(ev.end?.dateTime || ev.start.dateTime).toISOString(),
          join_url: joinUrlFrom(ev),
          description: desc.slice(0, 4000),
          kind,
          status: ev.status === 'cancelled' ? 'cancelled' : 'confirmed',
          now: new Date().toISOString()
        });
      }
    });
    tx(j.items || []);
    pageToken = j.nextPageToken;
  } while (pageToken);
  return { seen, kept };
}

// ---------- Fathom ----------

export async function syncFathom() {
  if (!env.FATHOM_API_KEY) throw new Error('Fathom is not connected. Add FATHOM_API_KEY to the server .env.');
  const after = new Date(Date.now() - 120 * 864e5).toISOString();
  let cursor;
  let n = 0;
  const up = db.prepare(`
    INSERT INTO fathom(recording_id, title, meeting_title, url, share_url, meeting_url, start, end, invitees, summary, action_items)
    VALUES(@recording_id, @title, @meeting_title, @url, @share_url, @meeting_url, @start, @end, @invitees, @summary, @action_items)
    ON CONFLICT(recording_id) DO UPDATE SET title=excluded.title, meeting_title=excluded.meeting_title, url=excluded.url,
      share_url=excluded.share_url, meeting_url=excluded.meeting_url, start=excluded.start, end=excluded.end,
      invitees=excluded.invitees, summary=COALESCE(excluded.summary, fathom.summary),
      action_items=COALESCE(excluded.action_items, fathom.action_items)`);
  for (let page = 0; page < 20; page++) {
    const u = new URL('https://api.fathom.ai/external/v1/meetings');
    u.searchParams.set('created_after', after);
    u.searchParams.set('include_summary', 'true');
    u.searchParams.set('include_action_items', 'true');
    if (cursor) u.searchParams.set('cursor', cursor);
    const res = await fetch(u, { headers: { 'X-Api-Key': env.FATHOM_API_KEY } });
    if (res.status === 429) break;
    if (!res.ok) throw new Error(`Fathom API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = await res.json();
    db.transaction((items) => {
      for (const m of items) {
        n++;
        up.run({
          recording_id: String(m.recording_id),
          title: m.title || m.meeting_title || 'Recording',
          meeting_title: m.meeting_title || null,
          url: m.url || null,
          share_url: m.share_url || null,
          meeting_url: m.meeting_url || null,
          start: m.recording_start_time || m.scheduled_start_time || m.created_at,
          end: m.recording_end_time || m.scheduled_end_time || null,
          invitees: JSON.stringify(m.calendar_invitees || []),
          summary: m.default_summary?.markdown_formatted || null,
          action_items: m.action_items ? JSON.stringify(m.action_items.map((a) => a.description || a.text || String(a))) : null
        });
      }
    })(j.items || []);
    cursor = j.next_cursor;
    if (!cursor) break;
  }
  return { recordings: n };
}

// Link recordings to calls: same meeting link first, then same title within 3h, then invitee email same day.
function normUrl(u) {
  if (!u) return null;
  try {
    const x = new URL(u);
    const zoom = x.pathname.match(/\/j\/(\d+)/);
    if (zoom) return 'zoom:' + zoom[1];
    return (x.host + x.pathname).replace(/\/$/, '').toLowerCase();
  } catch {
    return null;
  }
}

export function linkRecordings() {
  const calls = db.prepare("SELECT id, title, start, email, join_url FROM calls WHERE fathom_id IS NULL AND status != 'cancelled'").all();
  const recs = db
    .prepare('SELECT recording_id, title, meeting_title, meeting_url, start, invitees FROM fathom WHERE recording_id NOT IN (SELECT fathom_id FROM calls WHERE fathom_id IS NOT NULL)')
    .all();
  const set = db.prepare('UPDATE calls SET fathom_id = ? WHERE id = ?');
  const used = new Set();
  let linked = 0;
  for (const c of calls) {
    const cs = new Date(c.start).getTime();
    const cu = normUrl(c.join_url);
    const near = (r) => Math.abs(new Date(r.start).getTime() - cs) < 3 * 3600e3;
    const candidates = recs.filter((r) => !used.has(r.recording_id));
    let hit =
      candidates.find((r) => cu && normUrl(r.meeting_url) === cu && near(r)) ||
      candidates.find((r) => near(r) && [r.title, r.meeting_title].some((t) => t && t.trim().toLowerCase() === c.title.trim().toLowerCase())) ||
      candidates.find((r) => {
        if (!c.email || Math.abs(new Date(r.start).getTime() - cs) > 12 * 3600e3) return false;
        try {
          return JSON.parse(r.invitees || '[]').some((i) => i.email?.toLowerCase() === c.email.toLowerCase());
        } catch {
          return false;
        }
      });
    if (hit) {
      used.add(hit.recording_id);
      set.run(hit.recording_id, c.id);
      linked++;
    }
  }
  return linked;
}

let running = null;

export async function syncAll() {
  if (running) return running;
  running = (async () => {
    const out = { at: new Date().toISOString(), calendar: null, fathom: null, linked: 0, errors: [] };
    try {
      out.calendar = await syncCalendar();
    } catch (e) {
      out.errors.push(String(e.message || e));
    }
    try {
      out.fathom = await syncFathom();
    } catch (e) {
      out.errors.push(String(e.message || e));
    }
    out.linked = linkRecordings();
    setSetting('last_sync', JSON.stringify(out));
    return out;
  })().finally(() => (running = null));
  return running;
}

export function lastSync() {
  const v = getSettings().last_sync;
  return v ? JSON.parse(v) : null;
}

export function connections() {
  return {
    calendar: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REFRESH_TOKEN),
    fathom: Boolean(env.FATHOM_API_KEY)
  };
}

let timer = null;
export function startScheduler() {
  if (timer || process.env.NO_SYNC) return;
  const tick = () => syncAll().catch((e) => console.error('[sync]', e));
  setTimeout(tick, 3000);
  timer = setInterval(tick, 10 * 60 * 1000);
}
