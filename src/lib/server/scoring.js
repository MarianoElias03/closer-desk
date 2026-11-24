import { db, getSettings, setSetting, logActivity } from './db.js';

/**
 * Prospect score out of 5, built from categories (Website, Google reviews, ...). Each category is
 * scored 0-5 from the criteria ticked in it (more than 5 stops at 5), and the prospect score is the
 * average of the categories, weighted if you give a category more weight. Criteria worth minus
 * points (a very modern website, a 5-star rating) come off that average, and the score stays 0-5. Criteria marked "pick one"
 * in a category can't be ticked together (a site is either missing, outdated or basic, not all three).
 *
 * Each offer keeps its own categories (Advanced on a lead). Ticks start from the sheet's
 * "Why This Score" column; a criterion the sheet uses that isn't in any category joins "Other".
 */

export const MAX = 5;
const WHY = /^(why this score|score reason|why|score breakdown)$/i;
const key = (offerId) => `scoring.${offerId}`;
const norm = (s) => String(s || '').trim().toLowerCase();
const cleanLabel = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 60);
const clampPts = (n) => Math.max(-MAX, Math.min(MAX, Math.round(Number(n) * 2) / 2 || 0));
const round1 = (n) => Math.round(n * 10) / 10;

// where the criteria your sheet uses go to start with, and what they're worth out of 5
const STARTER = [
  {
    name: 'Website',
    weight: 1,
    criteria: [
      { label: 'No website', points: 5, one: true },
      { label: 'Site down', points: 4, one: true },
      { label: 'Outdated site', points: 4, one: true },
      { label: 'Basic site', points: 2, one: true },
      { label: 'Modern website', points: -1.5, one: true },
      { label: 'Not mobile-friendly', points: 1 }
    ]
  },
  {
    name: 'Google reviews',
    weight: 1,
    criteria: [
      { label: 'Under 10 reviews', points: 3 },
      { label: 'Rating under 4.5', points: 2 },
      { label: '5-star rating', points: -1 },
      { label: '50+ reviews', points: -1 }
    ]
  },
  { name: 'Google profile', weight: 1, criteria: [{ label: 'Profile unclaimed', points: 5 }] },
  { name: 'Activity', weight: 1, criteria: [{ label: 'Active', points: 5 }] }
];
const starterFor = (label) => {
  for (const s of STARTER) {
    const c = s.criteria.find((x) => norm(x.label) === norm(label));
    if (c) return { cat: s.name, c };
  }
  return null;
};

function fromOld(old) {
  // the first version was one flat list of criteria with a highest score; sort them into categories
  const cats = [];
  for (const c of old.criteria || []) {
    const s = starterFor(c.label);
    const name = s?.cat || 'Other';
    let cat = cats.find((k) => k.name === name);
    if (!cat) cats.push((cat = { name, weight: 1, criteria: [] }));
    cat.criteria.push(s ? { ...s.c, label: c.label } : { label: c.label, points: clampPts(c.points) });
  }
  // within a category, keep the starter order (No website, Site down, Outdated, Basic, ...)
  const rank = (l) => {
    const s = starterFor(l);
    return s ? STARTER.find((k) => k.name === s.cat).criteria.indexOf(s.c) : 99;
  };
  for (const c of cats) c.criteria.sort((a, b) => rank(a.label) - rank(b.label));
  return { categories: sortCats(cats) };
}
function sortCats(cats) {
  const order = (n) => {
    const i = STARTER.findIndex((s) => s.name === n);
    return i < 0 ? 99 : i;
  };
  return cats.sort((a, b) => order(a.name) - order(b.name));
}

export function scoring(offerId) {
  let v = null;
  try {
    v = JSON.parse(getSettings()[key(offerId)] || 'null');
  } catch {}
  if (v && v.v === 2 && Array.isArray(v.categories)) return { max: MAX, categories: v.categories };
  if (v && Array.isArray(v.criteria)) {
    const up = fromOld(v);
    saveScoring(offerId, up);
    return { max: MAX, categories: up.categories };
  }
  return { max: MAX, categories: [] };
}
const saveScoring = (offerId, s) => setSetting(key(offerId), JSON.stringify({ v: 2, categories: s.categories }));
const findLabel = (sc, label) => sc.categories.flatMap((c) => c.criteria).find((c) => norm(c.label) === norm(label));

/** "Outdated site 2 + Under 10 reviews 1 = 3 pts" -> [{label, points}] */
export function parseWhy(text) {
  return String(text || '')
    .split('=')[0]
    .split('+')
    .map((p) => p.trim().match(/^(.*?)\s+(-?\d+(?:\.\d+)?)$/))
    .filter(Boolean)
    .map((m) => ({ label: cleanLabel(m[1]), points: Number(m[2]) }))
    .filter((c) => c.label);
}

/** Each category's score (0-5) from its plus points, the weighted average, minus the minus points. */
export function scoreOf(sc, ticks) {
  const on = (c) => (ticks || []).some((t) => norm(t) === norm(c.label));
  let minus = 0;
  const cats = sc.categories.map((cat) => {
    const hit = cat.criteria.filter(on);
    minus += hit.filter((c) => c.points < 0).reduce((a, c) => a + c.points, 0);
    const raw = hit.filter((c) => c.points > 0).reduce((a, c) => a + c.points, 0);
    return { name: cat.name, weight: cat.weight, score: Math.min(MAX, raw) };
  });
  const w = cats.reduce((a, c) => a + c.weight, 0);
  const avg = w ? cats.reduce((a, c) => a + c.score * c.weight, 0) / w : 0;
  return { cats, minus, score: round1(Math.max(0, Math.min(MAX, avg + minus))) };
}

/**
 * Minus-point criteria your sheet's own columns show (its "Why This Score" only lists plus points):
 * Website Status "Modern", a 5.0 Rating (from 10+ reviews), 50 or more Google Reviews.
 */
function fromColumns(extra) {
  const get = (re) => (extra.find(([k]) => re.test(String(k).trim())) || [])[1];
  const out = [];
  if (/^modern/i.test(String(get(/^website status$/i) || '').trim())) out.push('Modern website');
  const rating = parseFloat(get(/^(google )?rating$/i));
  const reviews = parseFloat(String(get(/^(google )?reviews$/i) ?? '').replace(/[^\d.]/g, ''));
  // a perfect rating from a handful of reviews isn't a strong profile yet
  if (rating >= 4.95 && reviews >= 10) out.push('5-star rating');
  if (reviews >= 50) out.push('50+ reviews');
  return out;
}
const extraOf = (r) => {
  try {
    return JSON.parse(r.extra || '[]');
  } catch {
    return [];
  }
};

/** Known criteria only, and one "pick one" criterion per category (the last one ticked wins). */
function tidy(sc, ticks) {
  const out = [];
  for (const t of [...(ticks || [])].reverse()) {
    const c = findLabel(sc, t);
    if (!c || out.some((x) => norm(x) === norm(c.label))) continue;
    if (c.one) {
      const cat = sc.categories.find((k) => k.criteria.includes(c));
      if (out.some((x) => cat.criteria.some((k) => k.one && norm(k.label) === norm(x)))) continue;
    }
    out.push(c.label);
  }
  return out.reverse();
}

/**
 * Read ticks from the sheet's reason for every lead on the offer whose reason is new or changed.
 * Criteria not in any category join their usual category, or "Other". Doesn't touch the score.
 */
export function readSheetScores(offerId) {
  const sc = scoring(offerId);
  let grew = false;
  const rows = db.prepare('SELECT id, extra, score_src FROM leads WHERE offer_id = ?').all(offerId);
  const set = db.prepare('UPDATE leads SET score_ticks = ?, score_src = ? WHERE id = ?');
  db.transaction(() => {
    for (const r of rows) {
      const extra = extraOf(r);
      const why = (extra.find(([k]) => WHY.test(String(k).trim())) || [])[1] || '';
      if (!why || why === r.score_src) continue;
      const parts = parseWhy(why);
      for (const p of parts)
        if (!findLabel(sc, p.label)) {
          const s = starterFor(p.label);
          const name = s?.cat || 'Other';
          let cat = sc.categories.find((c) => norm(c.name) === norm(name));
          if (!cat) sc.categories.push((cat = { name, weight: 1, criteria: [] }));
          cat.criteria.push(s ? { ...s.c, label: p.label } : { label: p.label, points: clampPts(p.points) });
          grew = true;
        }
      set.run(JSON.stringify(tidy(sc, [...parts.map((p) => p.label), ...fromColumns(extra).filter((l) => findLabel(sc, l))])), why, r.id);
    }
  })();
  if (grew) {
    sortCats(sc.categories);
    saveScoring(offerId, sc);
  }
  return sc;
}

/** Tick or untick criteria on one lead; the score follows. */
export function setLeadTicks(offerId, leadId, ticks) {
  const sc = scoring(offerId);
  const r = db.prepare('SELECT id, score, score_ticks FROM leads WHERE id = ? AND offer_id = ?').get(Number(leadId), offerId);
  if (!r) return null;
  const list = tidy(sc, ticks);
  const before = JSON.parse(r.score_ticks || '[]');
  const { score } = scoreOf(sc, list);
  db.prepare('UPDATE leads SET score_ticks = ?, score = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(list), score, new Date().toISOString(), r.id);
  const added = list.filter((l) => !before.some((b) => norm(b) === norm(l)));
  const removed = before.filter((b) => !list.some((l) => norm(b) === norm(l)));
  const words = [...added.map((l) => `ticked ${l}`), ...removed.map((l) => `unticked ${l}`)];
  if (words.length) logActivity(r.id, 'score', `Score ${r.score ?? 'none'} → ${score}: ${words.join(', ')}`, { merge: 5 });
  return { score, ticks: list };
}

/** Work out every scored lead on the offer again. */
function rescore(offerId, sc, why, renames = new Map()) {
  const rows = db.prepare('SELECT id, score, score_ticks FROM leads WHERE offer_id = ? AND score_ticks IS NOT NULL').all(offerId);
  const upd = db.prepare('UPDATE leads SET score_ticks = ?, score = ? WHERE id = ?');
  let changed = 0;
  db.transaction(() => {
    for (const r of rows) {
      const ticks = tidy(sc, JSON.parse(r.score_ticks || '[]').map((t) => renames.get(norm(t)) || t));
      const { score } = scoreOf(sc, ticks);
      upd.run(JSON.stringify(ticks), score, r.id);
      if (score !== r.score) {
        changed++;
        logActivity(r.id, 'score', `Score ${r.score ?? 'none'} → ${score} ${why}`);
      }
    }
  })();
  return changed;
}

/** Change the offer's categories and criteria. Every scored lead on the offer is re-scored. */
export function saveCategories(offerId, { categories }) {
  const cats = [];
  const renames = new Map();
  const seen = new Set();
  for (const k of Array.isArray(categories) ? categories.slice(0, 12) : []) {
    const name = cleanLabel(k.name);
    if (!name || cats.some((c) => norm(c.name) === norm(name))) continue;
    const weight = Math.max(0, Math.min(10, Math.round(Number(k.weight) * 10) / 10));
    const criteria = [];
    for (const x of Array.isArray(k.criteria) ? k.criteria.slice(0, 30) : []) {
      const label = cleanLabel(x.label);
      if (!label || seen.has(norm(label))) continue;
      seen.add(norm(label));
      criteria.push({ label, points: clampPts(x.points), ...(x.one ? { one: true } : {}) });
      if (x.was && norm(x.was) !== norm(label)) renames.set(norm(x.was), label);
    }
    cats.push({ name, weight: Number.isFinite(weight) ? weight : 1, criteria });
  }
  const sc = { max: MAX, categories: cats };
  saveScoring(offerId, sc);
  return { ...sc, changed: rescore(offerId, sc, 'after the scoring was changed', renames) };
}

// ---- once at start-up: move the first flat version over, read sheet reasons, and score everyone
// the new way once (the old score was a sum stopped at 5) so the lead list sorts fairly ----
try {
  for (const o of db.prepare('SELECT id FROM offers').all()) {
    let sc = readSheetScores(o.id);
    // minus points arrived later: add the starter ones to an offer that scores, and tick them from
    // the sheet's columns on leads that were already read
    const neg = `scoring.minus.${o.id}`;
    if (sc.categories.length && !getSettings()[neg]) {
      for (const s of STARTER)
        for (const c of s.criteria.filter((x) => x.points < 0)) {
          if (findLabel(sc, c.label)) continue;
          let cat = sc.categories.find((k) => norm(k.name) === norm(s.name));
          if (!cat) sc.categories.push((cat = { name: s.name, weight: 1, criteria: [] }));
          cat.criteria.push({ ...c });
        }
      saveScoring(o.id, sc);
      sc = scoring(o.id);
      const rows = db.prepare('SELECT id, extra, score_ticks FROM leads WHERE offer_id = ? AND score_ticks IS NOT NULL').all(o.id);
      const set = db.prepare('UPDATE leads SET score_ticks = ? WHERE id = ?');
      for (const r of rows) {
        const add = fromColumns(extraOf(r)).filter((l) => findLabel(sc, l));
        if (add.length) set.run(JSON.stringify(tidy(sc, [...JSON.parse(r.score_ticks), ...add])), r.id);
      }
      rescore(o.id, sc, 'with minus points for a modern website, a 5-star rating or 50+ reviews');
      setSetting(neg, '1');
    }
    const done = `scoring.v2done.${o.id}`;
    if (sc.categories.length && !getSettings()[done]) {
      rescore(o.id, sc, 'with the new scoring (each category out of 5, averaged)');
      setSetting(done, '1');
    }
  }
} catch (e) {
  console.error('[scoring]', e);
}
