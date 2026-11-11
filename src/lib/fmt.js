export const TZ = 'Australia/Brisbane';

export const pct = (v, digits = 1) => (v == null ? '–' : `${(v * 100).toFixed(digits)}%`);
export const num = (v, digits = 0) => (v == null ? '–' : Number(v).toFixed(digits));

const money0 = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
const money2 = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });
export const money = (v, cents = false) => (v == null ? '–' : (cents ? money2 : money0).format(v));

export function time(iso, tz = TZ) {
  return new Intl.DateTimeFormat('en-AU', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}
export function dayLabel(key, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  const [y, m, d] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('en-AU', { ...opts, timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
}
export function ddmm(key) {
  return `${key.slice(8, 10)}/${key.slice(5, 7)}`;
}
export function monthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
}
export function duration(startIso, endIso) {
  const mins = Math.round((new Date(endIso) - new Date(startIso)) / 60000);
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60 ? (mins % 60) + 'm' : ''}`.trim() : `${mins} min`;
}
export function relative(iso) {
  const diff = (new Date(iso) - Date.now()) / 60000;
  const abs = Math.abs(diff);
  if (abs < 1) return 'now';
  const unit = abs < 60 ? ['min', abs] : abs < 1440 ? ['h', abs / 60] : ['d', abs / 1440];
  const n = Math.round(unit[1]);
  return diff > 0 ? `in ${n} ${unit[0]}` : `${n} ${unit[0]} ago`;
}
