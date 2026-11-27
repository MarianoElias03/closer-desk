import { getColdLead, getSettings, addLeadEntry } from './db.js';
import { sendMail, mailAccounts, signatureFor, signatureText } from './mail.js';
import { regularGuests } from './booking.js';
import { toHtml, MD_LINK, SIG_MARK, draftsFor, recordManualRun } from './automations.js';
import { wallClock } from '../leads.js';

/**
 * Write and send an email to a lead without leaving Closer Desk: from one of your connected accounts,
 * with your signature for that account under it. It goes on the lead's history straight away.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function composeInfo(offerId, leadId) {
  const lead = getColdLead(offerId, leadId);
  if (!lead) throw new Error('Lead not found');
  return {
    to: lead.email || '',
    blocked: lead.doNotContact?.includes('email') || false,
    accounts: mailAccounts().map((a) => ({ email: a.email, name: a.name, signature: a.signature })),
    guests: regularGuests(),
    automations: draftsFor(leadId)
  };
}

export async function sendLeadEmail(offerId, leadId, { from, to, cc = [], subject, message, signature = true, automationId = null }) {
  const lead = getColdLead(offerId, leadId);
  if (!lead) throw new Error('Lead not found');
  if (lead.doNotContact?.includes('email')) throw new Error('They asked not to be emailed');
  const toEmail = String(to || '').trim();
  if (!EMAIL.test(toEmail)) throw new Error('Add the email it goes to');
  const ccList = [...new Set([].concat(cc).map((e) => String(e).trim().toLowerCase()).filter((e) => EMAIL.test(e) && e !== toEmail.toLowerCase()))];
  const subj = String(subject || '').replace(/\s+/g, ' ').trim();
  if (!subj) throw new Error('Add a subject');
  const body = String(message || '').replace(/\r\n/g, '\n').trim();
  if (!body) throw new Error('Write the email first');
  const sig = signature ? signatureFor(from) : '';
  const html = toHtml(sig ? `${body}\n\n${SIG_MARK}` : body, sig);
  const text = `${body.replace(MD_LINK, '$1 ($2)')}${sig ? `\n\n${signatureText(sig)}` : ''}`;
  const id = await sendMail({ from, to: toEmail, cc: ccList, subject: subj, html, text });
  const now = wallClock(new Date().toISOString(), getSettings().timezone);
  addLeadEntry(offerId, leadId, {
    date: now.date,
    time: now.time,
    channel: 'email',
    outcome: '',
    subject: subj,
    note: `${body}\n\nSent from ${from} to ${toEmail}${ccList.length ? `, cc ${ccList.join(', ')}` : ''}`,
    extId: `gmail:${id}`
  });
  if (automationId) recordManualRun(automationId, leadId, { to: toEmail, subject: subj, messageId: id });
  return { id, to: toEmail, cc: ccList };
}
