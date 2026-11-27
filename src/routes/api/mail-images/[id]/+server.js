import { error } from '@sveltejs/kit';
import { getImage } from '$lib/server/mail.js';
// a signature image (open without signing in so email previews can show it; ids can't be guessed)
export function GET({ params }) {
  const img = /^[a-f0-9]{24}$/.test(params.id) ? getImage(params.id) : null;
  if (!img) error(404, 'Not found');
  return new Response(img.data, { headers: { 'content-type': img.type, 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' } });
}
