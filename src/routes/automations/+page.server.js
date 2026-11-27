import { db, listOffers } from '$lib/server/db.js';
import { mailAccounts } from '$lib/server/mail.js';
import { listAutomations, TRIGGERS, CHANNELS, PLACEHOLDERS } from '$lib/server/automations.js';

export function load({ locals }) {
  // leads on the open offer to preview an email against
  const leads = db
    .prepare("SELECT id, business, contact, email FROM leads WHERE offer_id = ? ORDER BY (email != '') DESC, updated_at DESC LIMIT 1000")
    .all(locals.offer.id)
    .map((l) => ({ id: l.id, name: l.contact && l.business ? `${l.contact}, ${l.business}` : l.contact || l.business || `Lead ${l.id}`, email: l.email }));
  return {
    automations: listAutomations(),
    accounts: mailAccounts(),
    allOffers: listOffers({ includeArchived: false }).map((o) => ({ id: o.id, name: o.name })),
    leads,
    triggers: TRIGGERS,
    channels: CHANNELS,
    placeholders: PLACEHOLDERS
  };
}
