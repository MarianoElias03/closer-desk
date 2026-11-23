import { json, error } from '@sveltejs/kit';
import { changePassword } from '$lib/server/auth.js';
// new password; every other device gets signed out
export async function POST({ request, locals }) {
  const b = await request.json().catch(() => ({}));
  try {
    changePassword(locals.user.id, b.current, b.next, locals.user.sessionId);
  } catch (e) {
    error(400, e.message);
  }
  return json({ ok: true });
}
