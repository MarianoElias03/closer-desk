import { json } from '@sveltejs/kit';
import { regularGuests, setRegularGuests } from '$lib/server/booking.js';
// people you often add to bookings (a teammate), offered as one-tap guests
export const GET = () => json({ guests: regularGuests() });
export async function POST({ request }) {
  const b = await request.json().catch(() => ({}));
  return json({ guests: setRegularGuests(b.guests) });
}
