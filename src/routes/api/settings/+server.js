import { json, error } from '@sveltejs/kit';
import { setSetting } from '$lib/server/db.js';
export async function POST({ request }) {
  const b = await request.json();
  if (typeof b.keywords === 'string') {
    const k = b.keywords.split(',').map((s) => s.trim()).filter(Boolean);
    if (!k.length) error(400, 'Add at least one keyword');
    setSetting('keywords', k.join(', '));
  }
  return json({ ok: true });
}
