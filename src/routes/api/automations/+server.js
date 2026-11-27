import { json, error } from '@sveltejs/kit';
import { listAutomations, saveAutomation, setEnabled, deleteAutomation, cancelRun, preview, runAutomations, sendTest } from '$lib/server/automations.js';

// list every automation with its recent runs
export const GET = () => json({ automations: listAutomations() });

export async function POST({ request }) {
  const b = await request.json().catch(() => ({}));
  try {
    if (b.action === 'save') return json({ automation: saveAutomation(b.automation || {}) });
    if (b.action === 'toggle') return json({ automation: setEnabled(b.id, !!b.enabled) });
    if (b.action === 'delete') return json({ removed: deleteAutomation(b.id) });
    if (b.action === 'cancel') return json({ cancelled: cancelRun(b.runId) });
    if (b.action === 'preview') return json({ preview: preview(b.automation || {}, b.leadId ? Number(b.leadId) : null) });
    if (b.action === 'test') return json({ test: await sendTest(b.automation || {}, Number(b.leadId)) });
    // check for new triggers and send anything due now, instead of waiting for the next minute
    if (b.action === 'run') return json(await runAutomations());
  } catch (e) {
    error(400, e.message);
  }
  error(400, 'Unknown action');
}
