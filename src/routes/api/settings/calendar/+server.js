import { json, error } from '@sveltejs/kit';
import { mailAccounts } from '$lib/server/mail.js';
import { personalOn, personalEmail, bookingSetup, setBookingSetup } from '$lib/server/calendars.js';

// which calendar this offer's booked calls go on, and whether a copy goes on your personal one
export async function GET({ locals }) {
  return json({
    personal: personalOn() ? await personalEmail() || 'Personal' : null,
    accounts: mailAccounts().map((a) => ({ email: a.email, calendar: a.calendar })),
    offer: locals.offer.name,
    ...bookingSetup(locals.offer.id)
  });
}
export async function POST({ request, locals }) {
  const b = await request.json().catch(() => ({}));
  try {
    return json(setBookingSetup(locals.offer.id, { book: String(b.book || ''), copy: !!b.copy }));
  } catch (e) {
    error(400, e.message);
  }
}
