import { json } from '@sveltejs/kit';
import { syncAll } from '$lib/server/sync.js';
export async function POST() {
  return json(await syncAll());
}
