import { json } from '@sveltejs/kit';
import { directory } from '$lib/server/appApi.js';
export const GET = () => json(directory());
