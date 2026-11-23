import { redirect } from '@sveltejs/kit';
import { hasUsers } from '$lib/server/auth.js';
export function load({ locals, url }) {
  const next = url.searchParams.get('next') || '/';
  if (locals.user) redirect(303, next.startsWith('/') && !next.startsWith('//') ? next : '/');
  return { setup: !hasUsers(), next };
}
