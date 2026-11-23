import { json, error } from '@sveltejs/kit';
import { workStatus, startWork, stopWork, setTarget } from '$lib/server/work.js';
// the work timer and pace for the open offer
export const GET = ({ locals }) => json(workStatus(locals.offer.id));
export async function POST({ request, locals }) {
  const b = await request.json().catch(() => ({}));
  try {
    if (b.action === 'start') return json(startWork(locals.offer.id));
    if (b.action === 'stop') {
      stopWork();
      return json(workStatus(locals.offer.id));
    }
    if (b.action === 'target') {
      setTarget(locals.offer.id, b.target || {});
      return json(workStatus(locals.offer.id));
    }
  } catch (e) {
    error(400, e.message);
  }
  error(400, 'Unknown action');
}
