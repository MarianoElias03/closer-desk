import { json } from '@sveltejs/kit';
import { listSessions, revokeSession } from '$lib/server/auth.js';
// your signed-in devices; DELETE ?id= signs one out
export const GET = ({ locals }) =>
  json({ sessions: listSessions(locals.user.id).map((s) => ({ ...s, current: locals.user.sessionId.startsWith(s.id) })) });
export const DELETE = ({ locals, url }) => json({ removed: revokeSession(locals.user.id, url.searchParams.get('id')) });
