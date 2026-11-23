import { getSettings, setSetting } from './db.js';

/**
 * Zoom meetings for bookings, through a Zoom "Server-to-Server OAuth" app on your own Zoom account.
 * Its account ID, client ID and client secret are pasted in Settings and kept in the database (the
 * secret is never sent back to the browser). Each booking gets its own meeting, like a booking tool.
 *
 * The app needs the scopes to create, update and delete meetings (meeting:write:admin, or the
 * granular meeting:write:meeting:admin / meeting:update:meeting:admin / meeting:delete:meeting:admin).
 */

const KEYS = { accountId: 'zoom.accountId', clientId: 'zoom.clientId', secret: 'zoom.secret' };

export function zoomConfig() {
  const s = getSettings();
  return { accountId: s[KEYS.accountId] || '', clientId: s[KEYS.clientId] || '', secret: s[KEYS.secret] || '' };
}
export const zoomConnected = () => {
  const c = zoomConfig();
  return !!(c.accountId && c.clientId && c.secret);
};

/** Save the app's credentials (blank secret keeps the current one), then check they work. */
export async function saveZoom({ accountId, clientId, secret }) {
  const cur = zoomConfig();
  setSetting(KEYS.accountId, String(accountId ?? cur.accountId).trim());
  setSetting(KEYS.clientId, String(clientId ?? cur.clientId).trim());
  if (secret) setSetting(KEYS.secret, String(secret).trim());
  token = { value: null, exp: 0 };
  if (!zoomConnected()) return { connected: false };
  const me = await zoomApi('GET', '/users/me');
  return { connected: true, account: me.email || me.display_name || 'connected' };
}
export function clearZoom() {
  for (const k of Object.values(KEYS)) setSetting(k, '');
  token = { value: null, exp: 0 };
}

let token = { value: null, exp: 0 };
async function zoomToken() {
  if (token.value && Date.now() < token.exp - 60_000) return token.value;
  const c = zoomConfig();
  if (!zoomConnected()) throw new Error('Zoom is not connected. Add it in Settings.');
  const r = await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(c.accountId)}`, {
    method: 'POST',
    headers: { authorization: 'Basic ' + Buffer.from(`${c.clientId}:${c.secret}`).toString('base64') }
  });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) throw new Error(`Zoom sign-in failed: ${j.reason || j.error || r.status}`);
  token = { value: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return token.value;
}

async function zoomApi(method, path, body) {
  const r = await fetch(`https://api.zoom.us/v2${path}`, {
    method,
    headers: { authorization: `Bearer ${await zoomToken()}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  if (r.status === 204) return {};
  const j = await r.json().catch(() => ({}));
  if (r.status === 404 && method === 'DELETE') return {};
  if (!r.ok) throw new Error(`Zoom: ${j.message || r.status}`);
  return j;
}

const minutes = (startIso, endIso) => Math.max(15, Math.round((Date.parse(endIso) - Date.parse(startIso)) / 60000));

/** A new meeting for a booking. Returns { id, joinUrl }. */
export async function createZoomMeeting(topic, startIso, endIso, tz) {
  const m = await zoomApi('POST', '/users/me/meetings', {
    topic: String(topic).slice(0, 190),
    type: 2,
    start_time: new Date(startIso).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    duration: minutes(startIso, endIso),
    timezone: tz,
    settings: { join_before_host: true, waiting_room: false }
  });
  return { id: String(m.id), joinUrl: m.join_url };
}
export async function moveZoomMeeting(id, startIso, endIso, tz) {
  await zoomApi('PATCH', `/meetings/${encodeURIComponent(id)}`, {
    start_time: new Date(startIso).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    duration: minutes(startIso, endIso),
    timezone: tz
  });
}
export const deleteZoomMeeting = (id) => zoomApi('DELETE', `/meetings/${encodeURIComponent(id)}`);
