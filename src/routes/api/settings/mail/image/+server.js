import { json, error } from '@sveltejs/kit';
import { saveImage } from '$lib/server/mail.js';
// upload an image for your signature (form field "file"); returns where it's shown
export async function POST({ request }) {
  const f = (await request.formData().catch(() => null))?.get('file');
  if (!f || typeof f === 'string') error(400, 'Pick an image');
  try {
    return json({ url: saveImage(Buffer.from(await f.arrayBuffer()), f.type) });
  } catch (e) {
    error(400, e.message);
  }
}
