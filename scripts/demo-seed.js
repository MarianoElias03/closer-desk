// Fills an empty database with made-up data so you can try the app (and take screenshots)
// without connecting a calendar. Every name, number and email here is fictional.
// Usage: DATA_DIR=demo-data NO_SYNC=1 node scripts/demo-seed.js
import { db, upsertSdr, upsertClose, listOffers, updateOffer, createOffer } from '../src/lib/server/db.js';
import { dayKey, addDays, dayStartIso } from '../src/lib/time.js';

const TZ = 'Australia/Brisbane';
const today = dayKey(Date.now(), TZ);
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));

const main = updateOffer(listOffers()[0].id, { name: '12-Week Coaching', industry: 'Fitness', price: 1250, keywords: 'GamePlan Call, Discovery Call' }).id;
const second = createOffer({ name: 'Done-for-you Ads', industry: 'Marketing agency', price: 2400, keywords: 'Strategy Session' }).id;
db.prepare('UPDATE offers SET opened_at = ? WHERE id = ?').run(new Date(Date.now() - 864e5).toISOString(), second);
const upsertSdrMain = (d, v) => upsertSdr(main, d, v);

// a few weeks on a second offer, so the Overall page has something to compare
for (let i = 30; i >= 10; i--) {
  const d = addDays(today, -i);
  if (new Date(d + 'T00:00:00Z').getUTCDay() % 6 === 0) continue;
  upsertSdr(second, d, { no_answer: int(14, 30), booked: int(0, 3), not_interested: int(2, 7), callback: int(0, 2), wrong_no: int(0, 3) });
  const closed = rnd() < 0.2 ? 1 : 0;
  upsertClose(second, d, { no_show: int(0, 1), closed, not_interested: int(0, 1), callbacks: int(0, 1), unqualified: 0, cash: closed ? 2400 : 0 });
}

// ~45 days of dialling and closing history
for (let i = 45; i >= 1; i--) {
  const d = addDays(today, -i);
  const dow = new Date(d + 'T00:00:00Z').getUTCDay();
  if (dow === 0) continue;
  const noAns = int(10, 34);
  upsertSdrMain(d, { no_answer: noAns, booked: int(1, 6), not_interested: int(1, 6), callback: int(0, 3), wrong_no: int(0, 2) });
  const closed = rnd() < 0.3 ? 1 : 0;
  upsertClose(main, d, {
    no_show: int(0, 3),
    closed,
    not_interested: int(0, 2),
    callbacks: int(0, 2),
    unqualified: int(0, 1),
    cash: closed ? [625, 750, 1250][int(0, 2)] : 0
  });
}
upsertSdrMain(today, { no_answer: 9, booked: 2, not_interested: 2, callback: 1, wrong_no: 0 });

const people = [
  'Liam Carter', 'Ava Nguyen', 'Noah Patel', 'Mia Thompson', 'Ethan Rossi', 'Chloe Walsh', 'Lucas Ferreira',
  'Isla Morgan', 'Jack Henderson', 'Zoe Kaplan', 'Oscar Bennett', 'Ruby Tanaka', 'Leo Martins', 'Grace Okafor',
  'Harvey Lane', 'Sienna Brooks', 'Mason Clarke', 'Willow Hart'
];
const outcomes = ['closed', 'no_show', 'no_show', 'not_interested', 'callback', 'unqualified'];
const insCall = db.prepare(`INSERT OR REPLACE INTO calls(id,offer_id,title,prospect,email,phone,start,end,join_url,description,kind,status,outcome,cash,notes,fathom_id,source,updated_at)
  VALUES(@id,@offer_id,@title,@prospect,@email,@phone,@start,@end,@join_url,'',@kind,'confirmed',@outcome,@cash,@notes,@fathom_id,'calendar',@now)`);
const insRec = db.prepare(`INSERT OR REPLACE INTO fathom(recording_id,title,meeting_title,url,share_url,meeting_url,start,end,invitees,summary,action_items)
  VALUES(@id,@title,@title,@url,NULL,@meeting_url,@start,@end,'[]',@summary,@actions)`);

const summary = (name) => `## Meeting purpose
Discovery call with ${name.split(' ')[0]} to understand their training goals and whether the 12-week coaching program is a fit.

## Key takeaways
- **Goal:** drop 8 kg before a wedding in March and keep the strength they built last year.
- **Challenge:** shift work makes gym times unpredictable; past programs failed without accountability.
- **Fit:** liked the weekly check-ins and the app-based plan they can follow on night shifts.

## Next steps
- Send the program outline and a sample week.
- Follow up Thursday after they talk it through with their partner.`;

let n = 0;
const slots = ['09:00', '10:30', '13:00', '15:30', '18:00', '19:15'];
for (let i = -6; i <= 4; i++) {
  const d = addDays(today, i);
  const count = i === 0 ? 4 : int(1, 3);
  for (let k = 0; k < count; k++) {
    const name = people[n++ % people.length];
    const [hh, mm] = slots[(k * 2 + (i & 1)) % slots.length].split(':').map(Number);
    const start = new Date(new Date(dayStartIso(d, TZ)).getTime() + (hh * 60 + mm) * 60000);
    const end = new Date(start.getTime() + 45 * 60000);
    const past = end < new Date();
    const kind = k % 3 === 2 ? 'Discovery Call' : 'GamePlan Call';
    const outcome = past ? (i === -1 && k === 0 ? 'pending' : outcomes[int(0, outcomes.length - 1)]) : 'pending';
    const zoom = `https://zoom.us/j/9${String(100000000 + n * 7919).slice(0, 9)}`;
    let fathom_id = null;
    if (past && outcome !== 'no_show' && rnd() < 0.8) {
      fathom_id = `demo-rec-${n}`;
      insRec.run({ id: fathom_id, title: `${name} ${kind}`, url: 'https://fathom.video/', meeting_url: zoom, start: start.toISOString(), end: end.toISOString(), summary: summary(name), actions: JSON.stringify(['Send program outline', 'Follow up Thursday']) });
    }
    insCall.run({
      id: `demo-${n}`,
      offer_id: main,
      title: `${name} ${kind}`,
      prospect: name,
      email: `${name.toLowerCase().replace(' ', '.')}@example.com`,
      phone: `0400 000 ${String(100 + n).padStart(3, '0')}`,
      start: start.toISOString(),
      end: end.toISOString(),
      join_url: zoom,
      kind,
      outcome,
      cash: outcome === 'closed' ? 750 : 0,
      notes: outcome === 'callback' ? 'Wants to check with partner, call back Thursday 6pm.' : '',
      fathom_id,
      now: new Date().toISOString()
    });
  }
}
console.log('Demo data ready:', n, 'calls');
