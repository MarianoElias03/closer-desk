import { json, error } from '@sveltejs/kit';
import { bookingInfo, editBooking } from '$lib/server/booking.js';
// a booking's link and guests (live from Google), and changes to it: move, meeting link, guests, invites
export async function GET({ params }) {
  try {
    return json(await bookingInfo(params.id));
  } catch (e) {
    error(400, e.message);
  }
}
export async function POST({ params, request }) {
  const b = await request.json().catch(() => ({}));
  try {
    return json(await editBooking(params.id, b));
  } catch (e) {
    error(400, e.message);
  }
}
