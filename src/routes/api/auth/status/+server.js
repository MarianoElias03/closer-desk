import { json } from '@sveltejs/kit';
import { hasUsers } from '$lib/server/auth.js';
// tells the sign-in page (and the app) whether to offer "create your account"
export const GET = ({ locals }) => json({ setup: !hasUsers(), signedIn: !!locals.user, username: locals.user?.username || null });
