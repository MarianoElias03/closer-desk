import { json, error } from '@sveltejs/kit';
import { mailAccounts, mailReady, connectUrl, finishConnect, removeMailAccount } from '$lib/server/mail.js';
import { precallVideo, setPrecallVideo } from '$lib/server/precall.js';
// email accounts you can send from, and the pre-call video
export const GET = () => json({ ready: mailReady(), accounts: mailAccounts(), video: precallVideo() });
export async function POST({ request }) {
  const b = await request.json().catch(() => ({}));
  try {
    if (b.action === 'start') return json({ url: connectUrl(b.hint || '') });
    if (b.action === 'finish') return json({ account: await finishConnect(b.pasted) });
    if (b.action === 'video') return json({ video: (setPrecallVideo(b.video), precallVideo()) });
  } catch (e) {
    error(400, e.message);
  }
  error(400, 'Unknown action');
}
export const DELETE = ({ url }) => json({ removed: removeMailAccount(url.searchParams.get('email')) });
