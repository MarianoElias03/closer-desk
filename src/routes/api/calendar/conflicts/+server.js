import { json, error } from '@sveltejs/kit';
import { atFrom, getSettings } from '$lib/server/db.js';
import { conflicts, clashNote } from '$lib/server/calendars.js';

// ?date=2026-12-01&time=10:00&minutes=60 (or start=&end= ISO), &ignore=eventId,copyId
// What's already on any of your calendars then.
export async function GET({ url }) {
  const p = url.searchParams;
  const start = p.get('start') ? new Date(p.get('start')).toISOString() : p.get('date') && p.get('time') ? atFrom(p.get('date'), p.get('time')) : null;
  if (!start) error(400, 'Give a date and time');
  const end = p.get('end') ? new Date(p.get('end')).toISOString() : new Date(Date.parse(start) + (Number(p.get('minutes')) || 60) * 60000).toISOString();
  const r = await conflicts(start, end, (p.get('ignore') || '').split(','));
  return json({ ...r, note: clashNote(r.clashes, getSettings().timezone) });
}
