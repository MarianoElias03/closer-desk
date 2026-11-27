import { redirect, json } from '@sveltejs/kit';
import { startScheduler } from '$lib/server/sync.js';
import { startAutomations } from '$lib/server/automations.js';
import { resolveOffer } from '$lib/server/db.js';
import { sessionUser, tokenFrom } from '$lib/server/auth.js';
startScheduler();
startAutomations();

// open without signing in: the sign-in page and its API, and the MCP endpoint (Alfred has its own token)
// and signature images (random ids), so email previews can load them
const OPEN = [/^\/login\/?$/, /^\/api\/auth\/(login|setup|status)$/, /^\/mcp\/?$/, /^\/api\/mail-images\/[a-f0-9]{24}$/];

export async function handle({ event, resolve }) {
  const path = event.url.pathname;
  event.locals.user = sessionUser(tokenFrom(event.request, event.cookies));
  if (!event.locals.user && !OPEN.some((r) => r.test(path))) {
    if (path.startsWith('/api/')) return json({ message: 'Sign in first' }, { status: 401 });
    redirect(303, `/login?next=${encodeURIComponent(path + event.url.search)}`);
  }
  // the Android app says which offer a call is about with X-Offer; browsers use the offer cookie
  const pick = Number(event.request.headers.get('x-offer')) || Number(event.cookies.get('offer')) || null;
  event.locals.offer = resolveOffer(pick);
  return resolve(event);
}
