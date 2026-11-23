import { json } from '@sveltejs/kit';
import { endSession, tokenFrom, COOKIE } from '$lib/server/auth.js';
export function POST({ request, cookies }) {
  endSession(tokenFrom(request, cookies));
  cookies.delete(COOKIE, { path: '/' });
  return json({ ok: true });
}
