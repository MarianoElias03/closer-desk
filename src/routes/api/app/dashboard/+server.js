import { json } from '@sveltejs/kit';
import { dashboard } from '$lib/server/appApi.js';
export const GET = () => json(dashboard());
