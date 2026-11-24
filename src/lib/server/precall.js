import { db, getSettings, setSetting, getColdLead, getOffer, addLeadEntry, logActivity } from './db.js';
import { Page, renderPdf, pdfSafe } from './pdf.js';
import { sendMail } from './mail.js';
import { wallClock } from '../leads.js';
import { dayKey } from '../time.js';

/**
 * Pre-call info: before a booked call you send the lead a one-page "what missed calls are costing you"
 * snapshot (PDF), the call details and a video to watch first. The numbers (missed calls a week,
 * average job, how many callers become customers) are kept on the lead, so the PDF can be downloaded
 * any time and is rebuilt on the server when the email goes out.
 */

db.exec(`
CREATE TABLE IF NOT EXISTS lead_precall (
  lead_id INTEGER PRIMARY KEY,
  calls REAL,
  value REAL,
  rate REAL NOT NULL DEFAULT 30,
  updated_at TEXT NOT NULL
);
`);

// the video sent with pre-call info; set in Settings (or PRECALL_VIDEO in the env)
export const DEFAULT_VIDEO = process.env.PRECALL_VIDEO || '';
export const precallVideo = () => getSettings()['precall.video'] || DEFAULT_VIDEO;
export const setPrecallVideo = (u) => setSetting('precall.video', /^https:\/\/\S+$/.test(String(u || '').trim()) ? String(u).trim() : '');

export function getPrecall(leadId) {
  const r = db.prepare('SELECT * FROM lead_precall WHERE lead_id = ?').get(Number(leadId));
  return figures(r ? { calls: r.calls, value: r.value, rate: r.rate, updatedAt: r.updated_at } : { calls: null, value: null, rate: 30 });
}
export function savePrecall(leadId, p) {
  const num = (v, max) => {
    const x = parseFloat(String(v ?? '').replace(/[^\d.]/g, ''));
    return Number.isFinite(x) ? Math.min(max, Math.max(0, x)) : null;
  };
  const row = { calls: num(p.calls, 10000), value: num(p.value, 10_000_000), rate: Math.max(1, Math.min(100, num(p.rate, 100) ?? 30)) };
  const was = getPrecall(leadId);
  if (was.calls !== row.calls || was.value !== row.value || was.rate !== row.rate) {
    const f = figures(row);
    const parts = [row.calls != null && `${row.calls} missed calls a week`, row.value != null && `${aud(row.value)} average job`, `${row.rate}% become customers`].filter(Boolean);
    // typing saves many times; one entry per sitting
    logActivity(leadId, 'precall', `Pre-call numbers ${was.calls == null && was.value == null ? 'added' : 'updated'}: ${parts.join(', ')}${f.ready ? ` (${aud(f.year)} a year)` : ''}`, { merge: 15 });
  }
  db.prepare(
    `INSERT INTO lead_precall(lead_id, calls, value, rate, updated_at) VALUES(?, ?, ?, ?, ?)
     ON CONFLICT(lead_id) DO UPDATE SET calls = excluded.calls, value = excluded.value, rate = excluded.rate, updated_at = excluded.updated_at`
  ).run(Number(leadId), row.calls, row.value, row.rate, new Date().toISOString());
  return getPrecall(leadId);
}

/** Missed calls a week x close rate x average job = lost a week; x52 a year. */
export function figures(p) {
  const ready = p.calls != null && p.value != null && p.calls > 0 && p.value > 0;
  const week = ready ? p.calls * (p.rate / 100) * p.value : 0;
  return { ...p, ready, week, month: (week * 52) / 12, year: week * 52 };
}

const aud = (v) => '$' + Math.round(v).toLocaleString('en-AU');
const who = (l) => l.business || l.contact || 'your business';
const firstName = (l) => (l.contact || '').trim().split(/\s+/)[0] || '';
function callWhen(l, tz) {
  if (!l.call || l.call.cancelled) return null;
  return new Intl.DateTimeFormat('en-AU', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', timeZone: tz }).format(new Date(l.call.start));
}

// ---------- the PDF ----------

export function precallPdf(offerId, leadId) {
  const lead = getColdLead(offerId, leadId);
  if (!lead) throw new Error('Lead not found');
  const offer = getOffer(offerId);
  const f = getPrecall(leadId);
  if (!f.ready) throw new Error('Add the missed calls a week and the average job first');
  const tz = getSettings().timezone;
  const brand = offer?.name || 'Closer Desk';
  const NAVY = '#0f1330', INK = '#0f1330', INK2 = '#3b4166', INK3 = '#6b7196', LINE = '#dfe2ef', LOSS = '#e4365a', LOSS_SOFT = '#fdecef', GLOW = '#9aa6ff', INDIGO = '#2433c9', GAIN = '#13a86b', GAIN_SOFT = '#e5f7ef';
  const p = new Page();
  const X = 40, Wd = p.w - 80;

  // header band
  p.rect(0, 0, p.w, 132, NAVY);
  p.rect(0, 132, p.w, 4, INDIGO);
  p.text(brand, X, 34, { size: 22, bold: true, color: '#ffffff' });
  p.text('PRE-CALL REVENUE SNAPSHOT', X, 64, { size: 9.5, bold: true, color: GLOW });
  p.text('Prepared for', p.w - X, 34, { size: 9.5, color: '#b9bfe6', align: 'right' });
  p.text(who(lead), p.w - X, 48, { size: 14, bold: true, color: '#ffffff', align: 'right' });
  p.text(dayKey(Date.now(), tz).split('-').reverse().join('/'), p.w - X, 68, { size: 9.5, color: '#b9bfe6', align: 'right' });
  p.para(`What missed calls could be costing ${who(lead)}`, X, 92, Wd, { size: 15, bold: true, color: '#ffffff', lineHeight: 18 });

  // the big number
  let y = 160;
  p.rect(X, y, Wd, 96, LOSS_SOFT, 12);
  p.text('ESTIMATED REVENUE LOST EACH YEAR', X + 18, y + 18, { size: 9, bold: true, color: LOSS });
  p.text(aud(f.year), X + 18, y + 38, { size: 40, bold: true, color: LOSS });
  y += 110;
  const half = (Wd - 12) / 2;
  for (const [i, [label, v]] of [['EACH MONTH', f.month], ['EACH WEEK', f.week]].entries()) {
    const x = X + i * (half + 12);
    p.rect(x, y, half, 62, '#f5f6fb', 10);
    p.text(label, x + 16, y + 14, { size: 8.5, bold: true, color: INK3 });
    p.text(aud(v), x + 16, y + 30, { size: 22, bold: true, color: INK });
  }

  // the numbers it came from
  y += 82;
  p.text('THE NUMBERS', X, y, { size: 9, bold: true, color: INK3 });
  y += 18;
  const rows = [
    ['Missed calls a week', String(+f.calls.toFixed(1))],
    ['Callers who become customers', `${+f.rate.toFixed(1)}%`],
    ['Average job or sale', aud(f.value)]
  ];
  for (const [label, v] of rows) {
    p.rect(X, y + 22, Wd, 0.8, LINE);
    p.text(label, X, y + 4, { size: 11.5, color: INK2 });
    p.text(v, X + Wd, y + 4, { size: 11.5, bold: true, color: INK, align: 'right' });
    y += 28;
  }
  p.text(`${+f.calls.toFixed(1)} calls x ${+f.rate.toFixed(1)}% x ${aud(f.value)} = ${aud(f.week)} a week, ${aud(f.year)} over 52 weeks`, X, y + 6, { size: 10, color: INK3 });

  // 12 months adding up
  y += 36;
  p.text('HOW IT ADDS UP OVER 12 MONTHS', X, y, { size: 9, bold: true, color: INK3 });
  y += 18;
  const chartH = 110, bw = Wd / 12;
  for (let i = 1; i <= 12; i++) {
    const v = f.month * i;
    const h = Math.max(4, (chartH - 18) * (i / 12));
    const x = X + (i - 1) * bw + bw * 0.18;
    p.rect(x, y + (chartH - 18 - h), bw * 0.64, h, i === 12 ? LOSS : i % 3 === 0 ? '#ef8aa0' : '#f6b9c6', 3);
    if (i === 1 || i % 3 === 0) p.text(i === 12 ? 'Month 12' : `M${i}`, x + bw * 0.32, y + chartH - 12, { size: 8, color: INK3, align: 'center' });
    if (i === 12) p.text(aud(v), x + bw * 0.64, y + (chartH - 18 - h) - 13, { size: 9, bold: true, color: LOSS, align: 'right' });
  }

  // half of it back, the call, the video
  y += chartH + 16;
  p.rect(X, y, Wd, 34, GAIN_SOFT, 8);
  p.text(`Answering even half of those calls is worth about ${aud(f.year / 2)} a year.`, X + 14, y + 11, { size: 11, bold: true, color: '#0b5e3d' });
  y += 48;
  const when = callWhen(lead, tz);
  const join = lead.call ? db.prepare('SELECT join_url FROM calls WHERE id = ?').get(lead.call.id)?.join_url : null;
  const video = precallVideo();
  const boxW = when && video ? half : Wd;
  if (when) {
    p.rect(X, y, half, 70, NAVY, 10);
    p.text('YOUR CALL', X + 14, y + 12, { size: 8.5, bold: true, color: GLOW });
    p.para(`${when} (Brisbane time)`, X + 14, y + 26, half - 28, { size: 11, bold: true, color: '#ffffff', lineHeight: 14 });
    if (join) {
      p.text('Join the call  >', X + 14, y + 52, { size: 10, bold: true, color: GLOW });
      p.link(X, y, half, 70, join);
    }
  }
  if (video) {
    const vx = when ? X + half + 12 : X;
    p.rect(vx, y, boxW, 70, '#eef0ff', 10);
    p.text('WATCH BEFORE OUR CALL', vx + 14, y + 12, { size: 8.5, bold: true, color: INDIGO });
    p.para('A short video on how we answer every call for you.', vx + 14, y + 26, boxW - 28, { size: 10.5, color: INK2, lineHeight: 13 });
    p.text('Watch the video  >', vx + 14, y + 52, { size: 10, bold: true, color: INDIGO });
    p.link(vx, y, boxW, 70, video);
  }

  p.para(
    'Estimates from the numbers above: missed calls a week x callers who become customers x average job, over 52 weeks. Real results vary. A guide only, not financial advice.',
    X,
    p.h - 46,
    Wd,
    { size: 8, color: INK3, lineHeight: 10.5 }
  );
  return { pdf: renderPdf(p, { title: `${brand}: pre-call snapshot for ${who(lead)}`, author: brand }), filename: `${pdfSafe(who(lead)).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'Lead'}-missed-call-snapshot.pdf` };
}

// ---------- the email ----------

/** What the send box starts with, so you can edit it before it goes. */
export function precallDraft(offerId, leadId, fromName = '') {
  const lead = getColdLead(offerId, leadId);
  if (!lead) throw new Error('Lead not found');
  const tz = getSettings().timezone;
  const when = callWhen(lead, tz);
  const f = getPrecall(leadId);
  const name = firstName(lead);
  return {
    to: lead.email || '',
    subject: `Before our call: what missed calls could be costing ${who(lead)}`,
    message: [
      `Hi ${name || 'there'},`,
      '',
      when ? `Thanks for booking a time to chat on ${when}.` : 'Thanks for your time on the phone.',
      '',
      `I've put together a quick snapshot of what missed calls could be costing ${who(lead)}${f.ready ? `, around ${aud(f.year)} a year based on the numbers we went through` : ''}. It's attached as a PDF.`,
      '',
      ...(precallVideo() ? ["There's also a short video below on how we answer every call for you. It's worth a quick watch before we speak.", ''] : []),
      when ? 'See you then,' : 'Speak soon,',
      fromName || ''
    ]
      .join('\n')
      .trimEnd(),
    when,
    ready: f.ready
  };
}

const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function youtubeId(u) {
  const m = String(u).match(/(?:youtu\.be\/|v=|embed\/)([\w-]{6,})/);
  return m ? m[1] : null;
}

/** Send it: the message, the numbers, the call, the video, and the PDF attached. Logs it on the lead. */
export async function sendPrecall(offerId, leadId, { from, to, cc = [], subject, message }) {
  const lead = getColdLead(offerId, leadId);
  if (!lead) throw new Error('Lead not found');
  if (lead.doNotContact?.includes('email')) throw new Error(`${who(lead)} asked not to be emailed`);
  const toEmail = String(to || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) throw new Error('Add the email it goes to');
  const ccList = [...new Set([].concat(cc).map((e) => String(e).trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e !== toEmail.toLowerCase()))];
  const f = getPrecall(leadId);
  const { pdf, filename } = precallPdf(offerId, leadId);
  const tz = getSettings().timezone;
  const when = callWhen(lead, tz);
  const join = lead.call ? db.prepare('SELECT join_url FROM calls WHERE id = ?').get(lead.call.id)?.join_url : null;
  const video = precallVideo();
  const vid = youtubeId(video);
  const body = String(message || '').trim();

  const text = [
    body,
    '',
    `What missed calls could be costing ${who(lead)}: about ${aud(f.year)} a year (${aud(f.month)} a month, ${aud(f.week)} a week).`,
    when ? `Our call: ${when} (Brisbane time)${join ? `\nJoin: ${join}` : ''}` : '',
    video ? `Watch before we speak: ${video}` : '',
    '',
    `The full snapshot is attached (${filename}).`
  ]
    .filter((x) => x !== '')
    .join('\n');

  const btn = (href, label, bg) =>
    `<a href="${escHtml(href)}" style="display:inline-block;background:${bg};color:#ffffff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px;font-size:15px">${escHtml(label)}</a>`;
  const html = `<!doctype html><html><body style="margin:0;background:#f5f6fb;font-family:Helvetica,Arial,sans-serif;color:#0f1330">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6fb;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #dfe2ef">
<tr><td style="padding:28px 28px 8px;font-size:15.5px;line-height:1.6;color:#0f1330">${escHtml(body).replace(/\n/g, '<br>')}</td></tr>
<tr><td style="padding:16px 28px 4px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fdecef;border-radius:12px"><tr><td style="padding:18px 20px">
    <div style="font-size:11px;font-weight:700;letter-spacing:1.4px;color:#e4365a">WHAT MISSED CALLS COULD BE COSTING ${escHtml(who(lead).toUpperCase())}</div>
    <div style="font-size:36px;font-weight:800;color:#e4365a;margin-top:4px">${aud(f.year)} <span style="font-size:15px;font-weight:600">a year</span></div>
    <div style="font-size:14px;color:#3b4166;margin-top:4px">${aud(f.month)} a month, ${aud(f.week)} a week. The full snapshot is attached.</div>
  </td></tr></table>
</td></tr>
${when ? `<tr><td style="padding:16px 28px 4px"><div style="font-size:11px;font-weight:700;letter-spacing:1.4px;color:#6b7196">OUR CALL</div><div style="font-size:17px;font-weight:700;margin:4px 0 12px">${escHtml(when)} (Brisbane time)</div>${join ? btn(join, /zoom\.us/.test(join) ? 'Join on Zoom' : 'Join the call', '#2433c9') : ''}</td></tr>` : ''}
${video ? `<tr><td style="padding:20px 28px 28px">
  <div style="font-size:11px;font-weight:700;letter-spacing:1.4px;color:#6b7196;margin-bottom:8px">WATCH BEFORE WE SPEAK</div>
  ${vid ? `<a href="${escHtml(video)}"><img src="https://img.youtube.com/vi/${vid}/hqdefault.jpg" width="544" alt="Watch the video" style="width:100%;max-width:544px;border-radius:12px;display:block;border:0"></a><div style="margin-top:12px">${btn(video, 'Watch the video', '#0f1330')}</div>` : btn(video, 'Watch the video', '#0f1330')}
</td></tr>` : '<tr><td style="padding:0 0 20px"></td></tr>'}
</table></td></tr></table></body></html>`;

  const id = await sendMail({ from, to: toEmail, cc: ccList, subject, html, text, attachments: [{ filename, type: 'application/pdf', data: pdf }] });
  // it shows in the lead's history like any other email you send
  const now = wallClock(new Date().toISOString(), tz);
  addLeadEntry(offerId, leadId, {
    date: now.date,
    time: now.time,
    channel: 'email',
    outcome: '',
    subject,
    note: `${text}\n\nSent from ${from}${ccList.length ? `, cc ${ccList.join(', ')}` : ''}. Attached: ${filename}`,
    extId: `gmail:${id}`
  });
  return { id, to: toEmail, cc: ccList, filename };
}
