import { json, error } from '@sveltejs/kit';
import { zoomConfig, zoomConnected, saveZoom, clearZoom } from '$lib/server/zoom.js';
// Zoom connection for booking links. The secret never leaves the server.
export const GET = () => {
  const c = zoomConfig();
  return json({ connected: zoomConnected(), accountId: c.accountId, clientId: c.clientId, hasSecret: !!c.secret });
};
export async function POST({ request }) {
  const b = await request.json().catch(() => ({}));
  try {
    return json(await saveZoom(b));
  } catch (e) {
    error(400, e.message);
  }
}
export const DELETE = () => {
  clearZoom();
  return json({ connected: false });
};
