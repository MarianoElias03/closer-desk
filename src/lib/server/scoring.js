import { db, getSettings, setSetting, logActivity } from './db.js';

/**
 * Prospect score as a sum of criteria ("Outdated site 2 + Under 10 reviews 1 + Active 1 = 4 pts"),
 * capped at a highest score. Each offer keeps its own list of criteria and points (Advanced on a
 * lead). Criteria start out as whatever your sheet's "Why This Score" column uses, so nothing is
 * hard-coded: a new criterion in the sheet joins the list with the points the sheet gave it.
 */

const WHY = /^(why this score|score reason|why|score breakdown)$/i;
const DEFAULT_CAP = 5;
const key = (offerId) => `scoring.${offerId}`;
const norm = (s) => String(s || '').trim().toLowerCase();
const cleanLabel = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 60);

export function scoring(offerId) {
  let v = null;
  try {
    v = JSON.parse(getSettings()[key(offerId)] || 'null');
  } catch {}
  return { cap: Number.isFinite(v?.cap) ? v.cap : DEFAULT_CAP, criteria: Array.isArray(v?.criteria) ? v.criteria : [] };
}
const saveScoring = (offerId, s) => setSetting(key(offerId), JSON.stringify(s));

/** "Outdated site 2 + Under 10 reviews 1 = 3 pts" -> [{label, points}] */
export function parseWhy(text) {
  const left = String(text || '').split('=')[0];
  return left
    .split('+')
    .map((p) => p.trim().match(/^(.*?)\s+(-?\d+(?:\.\d+)?)$/))
    .filter(Boolean)
    .map((m) => ({ label: cleanLabel(m[1]), points: Number(m[2]) }))
    .filter((c) => c.label);
}

/** Score from ticks with the offer's current points. */
export function scoreOf(sc, ticks) {
  const on = sc.criteria.filter((c) => (ticks || []).some((t) => norm(t) === norm(c.label)));
  const total = on.reduce((a, c) => a + c.points, 0);
  return { on, total, score: Math.max(0, Math.min(sc.cap, total)) };
}

/**
 * Read ticks from the sheet's reason for every lead on the offer whose reason is new or changed.
 * Unknown criteria join the offer's list. Doesn't touch the score itself (the sheet gave one).
 */
export function readSheetScores(offerId) {
  const sc = scoring(offerId);
  let grew = false;
  const rows = db.prepare('SELECT id, extra, score_src FROM leads WHERE offer_id = ?').all(offerId);
  const set = db.prepare('UPDATE leads SET score_ticks = ?, score_src = ? WHERE id = ?');
  db.transaction(() => {
    for (const r of rows) {
      let why = '';
      try {
        why = (JSON.parse(r.extra || '[]').find(([k]) => WHY.test(String(k).trim())) || [])[1] || '';
      } catch {}
      if (!why || why === r.score_src) continue;
      const parts = parseWhy(why);
      for (const p of parts)
        if (!sc.criteria.some((c) => norm(c.label) === norm(p.label))) {
          sc.criteria.push(p);
          grew = true;
        }
      set.run(JSON.stringify(parts.map((p) => sc.criteria.find((c) => norm(c.label) === norm(p.label)).label)), why, r.id);
    }
  })();
  if (grew) saveScoring(offerId, sc);
  return sc;
}

/** Tick or untick criteria on one lead; the score follows. */
export function setLeadTicks(offerId, leadId, ticks) {
  const sc = scoring(offerId);
  const r = db.prepare('SELECT id, score, score_ticks FROM leads WHERE id = ? AND offer_id = ?').get(Number(leadId), offerId);
  if (!r) return null;
  const list = sc.criteria.filter((c) => (ticks || []).some((t) => norm(t) === norm(c.label))).map((c) => c.label);
  const before = JSON.parse(r.score_ticks || '[]');
  const { score } = scoreOf(sc, list);
  db.prepare('UPDATE leads SET score_ticks = ?, score = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(list), score, new Date().toISOString(), r.id);
  const added = list.filter((l) => !before.some((b) => norm(b) === norm(l)));
  const removed = before.filter((b) => !list.some((l) => norm(b) === norm(l)));
  const pts = (l) => sc.criteria.find((c) => c.label === l)?.points ?? 0;
  const words = [...added.map((l) => `ticked ${l} (+${pts(l)})`), ...removed.map((l) => `unticked ${l}`)];
  if (words.length) logActivity(r.id, 'score', `Score ${r.score ?? 'none'} → ${score}: ${words.join(', ')}`, { merge: 5 });
  return { score, ticks: list };
}

/**
 * Change the offer's criteria (points, names, new ones, removed ones) and highest score. Every scored
 * lead on the offer is worked out again with the new points.
 */
export function saveCriteria(offerId, { cap, criteria }) {
  const old = scoring(offerId);
  const c = Math.max(1, Math.min(1000, Math.round(Number(cap)) || DEFAULT_CAP));
  const list = [];
  const renames = new Map();
  for (const x of Array.isArray(criteria) ? criteria.slice(0, 40) : []) {
    const label = cleanLabel(x.label);
    const points = Math.max(-100, Math.min(100, Number(x.points)));
    if (!label || !Number.isFinite(points) || list.some((l) => norm(l.label) === norm(label))) continue;
    list.push({ label, points });
    if (x.was && norm(x.was) !== norm(label)) renames.set(norm(x.was), label);
  }
  const sc = { cap: c, criteria: list };
  saveScoring(offerId, sc);
  const rows = db.prepare('SELECT id, score, score_ticks FROM leads WHERE offer_id = ? AND score_ticks IS NOT NULL').all(offerId);
  const upd = db.prepare('UPDATE leads SET score_ticks = ?, score = ? WHERE id = ?');
  let changed = 0;
  const diff = [];
  for (const o of old.criteria) {
    const n = list.find((l) => norm(l.label) === norm(renames.get(norm(o.label)) || o.label));
    if (!n) diff.push(`${o.label} removed`);
    else if (n.points !== o.points) diff.push(`${n.label} ${o.points} → ${n.points}`);
  }
  if (old.cap !== c) diff.push(`highest score ${old.cap} → ${c}`);
  db.transaction(() => {
    for (const r of rows) {
      const ticks = JSON.parse(r.score_ticks || '[]').map((t) => renames.get(norm(t)) || t).filter((t) => list.some((l) => norm(l.label) === norm(t)));
      const { score } = scoreOf(sc, ticks);
      upd.run(JSON.stringify(ticks), score, r.id);
      if (score !== r.score) {
        changed++;
        logActivity(r.id, 'score', `Score ${r.score ?? 'none'} → ${score} after the scoring points changed${diff.length ? ` (${diff.join(', ')})` : ''}`);
      }
    }
  })();
  return { ...sc, changed };
}

// read any sheet reasons already in the database once at start-up
try {
  for (const o of db.prepare('SELECT id FROM offers').all()) readSheetScores(o.id);
} catch (e) {
  console.error('[scoring]', e);
}
