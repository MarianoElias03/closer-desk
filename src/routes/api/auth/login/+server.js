import { json, error } from '@sveltejs/kit';
import { checkLogin, startSession, COOKIE, cookieOpts } from '$lib/server/auth.js';
// Sign in. Sets the session cookie, and also returns the token for the Android app.
export async function POST({ request, cookies, url }) {
  const b = await request.json().catch(() => ({}));
  let user;
  try {
    user = checkLogin(b.username, b.password);
  } catch (e) {
    error(401, e.message);
  }
  const device = String(b.device || request.headers.get('user-agent') || 'Browser').slice(0, 80);
  const token = startSession(user.id, device);
  cookies.set(COOKIE, token, cookieOpts(url, request));
  return json({ token, username: user.username });
}
