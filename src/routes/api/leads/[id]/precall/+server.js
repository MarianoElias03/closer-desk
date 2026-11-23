import { json, error } from '@sveltejs/kit';
import { getColdLead } from '$lib/server/db.js';
import { getPrecall, savePrecall, precallDraft, precallVideo } from '$lib/server/precall.js';
import { mailAccounts, mailReady } from '$lib/server/mail.js';
import { regularGuests } from '$lib/server/booking.js';
// the lead's pre-call numbers, plus what the send box needs (draft, accounts to send from, regular guests)
export function GET({ params, locals }) {
  if (!getColdLead(locals.offer.id, params.id)) error(404, 'Lead not found');
  const accounts = mailAccounts();
  return json({
    numbers: getPrecall(params.id),
    draft: precallDraft(locals.offer.id, params.id, accounts[0]?.name || ''),
    accounts,
    mailReady: mailReady(),
    guests: regularGuests(),
    video: precallVideo()
  });
}
export async function POST({ params, request, locals }) {
  if (!getColdLead(locals.offer.id, params.id)) error(404, 'Lead not found');
  return json({ numbers: savePrecall(params.id, await request.json().catch(() => ({}))) });
}
