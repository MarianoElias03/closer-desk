import { redirect } from '@sveltejs/kit';
// Calls now lives inside the Closing tab; old links (?f=needs, ?open=<id>) still work
export function load({ url }) {
  redirect(308, `/closing${url.search}#calls`);
}
