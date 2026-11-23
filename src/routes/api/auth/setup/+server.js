import { json, error } from '@sveltejs/kit';
import { createFirstUser, startSession, COOKIE, cookieOpts } from '$lib/server/auth.js';
// Create the first account. Only works while there are no accounts at all.
export async function POST({ request, cookies, url }) {
  const b = await request.json().catch(() => ({}));
  let id;
  try {
    id = createFirstUser(b.username, b.password);
  } catch (e) {
    error(400, e.message);
  }
  const token = startSession(id, String(b.device || request.headers.get('user-agent') || 'Browser').slice(0, 80));
  cookies.set(COOKIE, token, cookieOpts(url, request));
  return json({ token, username: String(b.username).trim() });
}
