<script>
  // A lead's prospect score: each category (Website, Google reviews, ...) is scored out of 5 from the
  // criteria you tick in it, and the score is the average of the categories. Advanced sets the
  // categories, their criteria and points, and each category's weight for this offer.
  import { slide } from 'svelte/transition';
  import { invalidateAll } from '$app/navigation';
  import Icon from './Icon.svelte';
  import { toast } from '$lib/toast.svelte.js';

  let { lead, scoring } = $props();
  const MAX = 5;

  const norm = (s) => String(s || '').trim().toLowerCase();
  const pitch = $derived((lead.extra.find(([k]) => /^pitch angle$/i.test(k.trim())) || [])[1] || '');
  let ticks = $state([]);
  $effect.pre(() => {
    ticks = [...(lead.scoreTicks || [])];
  });
  const isOn = (label) => ticks.some((t) => norm(t) === norm(label));
  const round1 = (n) => Math.round(n * 10) / 10;
  const cats = $derived(
    scoring.categories.map((c) => {
      const raw = c.criteria.filter((x) => isOn(x.label) && x.points > 0).reduce((a, x) => a + x.points, 0);
      return { ...c, raw, score: Math.min(MAX, raw) };
    })
  );
  const weightSum = $derived(cats.reduce((a, c) => a + c.weight, 0));
  const avg = $derived(weightSum ? round1(cats.reduce((a, c) => a + c.score * c.weight, 0) / weightSum) : 0);
  // ticked criteria worth minus points come off the average
  const minuses = $derived(scoring.categories.flatMap((c) => c.criteria).filter((x) => x.points < 0 && isOn(x.label)));
  const worked = $derived(round1(Math.max(0, Math.min(MAX, avg + minuses.reduce((a, x) => a + x.points, 0)))));
  const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');
  const evenWeights = $derived(cats.every((c) => c.weight === 1));
  const byHand = $derived(lead.score != null && lead.score !== worked);

  let busy = $state(false);
  async function toggle(cat, label) {
    let next;
    if (isOn(label)) next = ticks.filter((t) => norm(t) !== norm(label));
    else {
      const crit = cat.criteria.find((x) => x.label === label);
      // "pick one" criteria in a category replace each other
      const others = crit.one ? cat.criteria.filter((x) => x.one && x.label !== label).map((x) => norm(x.label)) : [];
      next = [...ticks.filter((t) => !others.includes(norm(t))), label];
    }
    ticks = next;
    busy = true;
    try {
      const r = await fetch(`/api/leads/${lead.id}/score`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticks: next }) });
      if (!r.ok) throw new Error('Could not save the score');
      await invalidateAll();
    } catch (e) {
      toast(e.message, 'error');
      ticks = [...(lead.scoreTicks || [])];
    } finally {
      busy = false;
    }
  }

  // ---- Advanced ----
  let adv = $state(false);
  let edit = $state([]);
  let saving = $state(false);
  const snapshot = () => JSON.stringify(scoring.categories.map((c) => ({ name: c.name, weight: c.weight, criteria: c.criteria.map((x) => ({ label: x.label, points: x.points, one: !!x.one })) })));
  function openAdv() {
    edit = scoring.categories.map((c) => ({ name: c.name, weight: c.weight, criteria: c.criteria.map((x) => ({ label: x.label, points: x.points, one: !!x.one, was: x.label })) }));
    adv = !adv;
  }
  const advDirty = $derived(
    adv &&
      JSON.stringify(edit.map((c) => ({ name: c.name, weight: Number(c.weight), criteria: c.criteria.map((x) => ({ label: x.label, points: Number(x.points), one: !!x.one })) }))) !== snapshot()
  );
  const catTotal = (c) => c.criteria.filter((x) => Number(x.points) > 0).reduce((a, x) => a + Number(x.points), 0);
  async function saveAdv(e) {
    e.preventDefault();
    saving = true;
    try {
      const r = await fetch('/api/scoring', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ categories: edit.filter((c) => c.name.trim()).map((c) => ({ ...c, weight: Number(c.weight), criteria: c.criteria.filter((x) => x.label.trim()).map((x) => ({ ...x, points: Number(x.points) })) })) })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message || 'Could not save');
      toast(j.changed ? `Scoring saved. ${j.changed} lead${j.changed === 1 ? '' : 's'} re-scored` : 'Scoring saved');
      adv = false;
      await invalidateAll();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      saving = false;
    }
  }
</script>

<section class="panel score">
  <div class="head">
    <h2>Prospect score</h2>
    <span class="badge" class:none={lead.score == null}>{lead.score ?? '–'}<small>/ {MAX}</small></span>
  </div>
  {#if pitch}<p class="pitch">{pitch}</p>{/if}

  {#if cats.length}
    <div class="cats">
      {#each cats as c (c.name)}
        <div class="cat">
          <div class="cat-head">
            <span class="cat-name">{c.name}{#if !evenWeights}<span class="faint"> ×{c.weight}</span>{/if}</span>
            <span class="cat-score" class:full={c.score === MAX}>{c.score}<small>/ {MAX}</small></span>
          </div>
          <div class="bar"><i style="width:{(c.score / MAX) * 100}%"></i></div>
          <div class="crit" role="group" aria-label={c.name}>
            {#each c.criteria as x (x.label)}
              <button type="button" class="chip" class:on={isOn(x.label)} aria-pressed={isOn(x.label)} disabled={busy} onclick={() => toggle(c, x.label)}>
                <i class="box" class:round={x.one}>{#if isOn(x.label)}<Icon name="check" size={10} stroke={3.5} />{/if}</i>
                {x.label}<b class:neg={x.points < 0}>{signed(x.points)}</b>
              </button>
            {/each}
          </div>
          {#if c.raw > MAX}<p class="faint tiny">Adds up to {c.raw}, counted as {MAX}</p>{/if}
        </div>
      {/each}
    </div>
    <p class="eq">
      ({#each cats as c, i}{i ? ' + ' : ''}<span>{c.name} <b>{c.score}</b>{#if !evenWeights && c.weight !== 1}×{c.weight}{/if}</span>{/each}) ÷ {weightSum}{#if minuses.length}{' = '}{avg}{#each minuses as m}{' '}<span class="minus">− {-m.points} ({m.label})</span>{/each}{/if}{' = '}<strong>{worked} / {MAX}</strong>
    </p>
    {#if byHand}<p class="faint small">The score is {lead.score} from your sheet or set by hand. Tick or untick something to use the categories.</p>{/if}
  {:else}
    <p class="faint small">No scoring categories on this offer yet. Add them under Advanced, or import a sheet with a "Why This Score" column.</p>
  {/if}

  <button class="adv-btn" onclick={openAdv} aria-expanded={adv}><Icon name="settings" size={13} />Advanced</button>
  {#if adv}
    <form class="adv" transition:slide={{ duration: 160 }} onsubmit={saveAdv}>
      <p class="faint small">Each category is scored out of 5 (points past 5 are ignored), and the score is the average of the categories. Give a category more weight to make it count more. Minus points (e.g. −1 for a 5-star rating) come off the final score, which never goes below 0. "Pick one" criteria can't be ticked together. Saving re-scores every lead on this offer.</p>
      {#each edit as c, ci}
        <fieldset class="ecat">
          <div class="row">
            <input class="lbl name" bind:value={c.name} placeholder="Category, e.g. Website" aria-label="Category name" />
            <label class="w">Weight<input class="num" type="number" min="0" max="10" step="0.5" bind:value={c.weight} /></label>
            <button type="button" class="ico" onclick={() => (edit = edit.filter((_, j) => j !== ci))} aria-label="Remove category {c.name}"><Icon name="x" size={14} /></button>
          </div>
          {#each c.criteria as x, xi}
            <div class="row sub">
              <input class="lbl" bind:value={x.label} placeholder="Criterion, e.g. No website" aria-label="Criterion" />
              <input class="num" class:neg={Number(x.points) < 0} type="number" min="-5" max="5" step="0.5" bind:value={x.points} aria-label="Points for {x.label}" />
              <label class="one" title="Only one of these can be ticked in this category"><input type="checkbox" bind:checked={x.one} />Pick one</label>
              <button type="button" class="ico" onclick={() => (c.criteria = c.criteria.filter((_, j) => j !== xi))} aria-label="Remove {x.label}"><Icon name="x" size={14} /></button>
            </div>
          {/each}
          <div class="row sub foot">
            <button type="button" class="link" onclick={() => (c.criteria = [...c.criteria, { label: '', points: 1, one: false, was: '' }])}><Icon name="plus" size={13} />Add criterion</button>
            {#if catTotal(c) < MAX}<span class="faint tiny">Most it can reach: {catTotal(c)} of 5</span>{/if}
          </div>
        </fieldset>
      {/each}
      <button type="button" class="btn small ghost" onclick={() => (edit = [...edit, { name: '', weight: 1, criteria: [{ label: '', points: 5, one: false, was: '' }] }])}><Icon name="plus" size={14} />Add category</button>
      <div class="acts">
        <button type="button" class="btn small ghost" onclick={() => (adv = false)}>Cancel</button>
        <button class="btn small primary" disabled={!advDirty || saving}><Icon name="check" size={14} />{saving ? 'Saving' : 'Save scoring'}</button>
      </div>
    </form>
  {/if}
</section>

<style>
  .score {
    padding: 20px;
    display: grid;
    gap: 12px;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .head h2 {
    margin: 0;
  }
  .badge {
    font-size: 26px;
    font-weight: 800;
    color: var(--blue);
    font-variant-numeric: tabular-nums;
  }
  .badge small,
  .cat-score small {
    font-size: 12px;
    color: var(--ink-3);
    font-weight: 700;
    margin-left: 3px;
  }
  .badge.none {
    color: var(--ink-3);
  }
  .pitch {
    margin: 0;
    font-size: 14px;
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--surface);
  }
  .cats {
    display: grid;
    gap: 14px;
  }
  .cat {
    display: grid;
    gap: 6px;
  }
  .cat-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-size: 13.5px;
  }
  .cat-name {
    font-weight: 700;
  }
  .cat-score {
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }
  .cat-score.full {
    color: var(--blue);
  }
  .bar {
    height: 5px;
    border-radius: 999px;
    background: var(--line-2);
    overflow: hidden;
  }
  .bar i {
    display: block;
    height: 100%;
    background: var(--blue);
    border-radius: 999px;
    transition: width 0.2s;
  }
  .crit {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 999px;
    border: 1px solid var(--line);
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
    color: var(--ink-2);
  }
  .chip {
    background: transparent;
    font-family: inherit;
  }
  .chip:disabled {
    cursor: progress;
  }
  .box {
    width: 14px;
    height: 14px;
    border-radius: 4px;
    border: 1.5px solid var(--ink-3);
    display: inline-grid;
    place-items: center;
    color: #fff;
    flex: none;
  }
  .box.round {
    border-radius: 50%;
  }
  .chip.on .box {
    background: var(--blue);
    border-color: var(--blue);
  }
  .chip b {
    color: var(--ink-3);
    font-variant-numeric: tabular-nums;
  }
  .chip.on {
    border-color: var(--blue);
    background: var(--blue-soft);
    color: var(--ink);
  }
  .chip.on b {
    color: var(--blue);
  }
  .chip b.neg,
  .minus {
    color: var(--red);
  }
  .chip.on b.neg {
    color: var(--red);
  }
  input.num.neg {
    color: var(--red);
  }
  .eq {
    margin: 0;
    font-size: 13px;
    line-height: 1.6;
    padding-top: 8px;
    border-top: 1px solid var(--line-2);
  }
  .eq b {
    font-variant-numeric: tabular-nums;
  }
  .small {
    font-size: 13px;
    margin: 0;
  }
  .tiny {
    font-size: 11.5px;
    margin: 0;
  }
  .adv-btn,
  .link {
    justify-self: start;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 0;
    background: transparent;
    color: var(--ink-3);
    font-size: 12.5px;
    font-weight: 700;
    padding: 4px 0;
    cursor: pointer;
  }
  .adv-btn:hover,
  .link:hover {
    color: var(--ink);
  }
  .adv {
    display: grid;
    gap: 10px;
    padding: 12px;
    border-radius: 12px;
    background: var(--surface);
    border: 1px solid var(--line-2);
  }
  .ecat {
    margin: 0;
    padding: 10px;
    border: 1px solid var(--line-2);
    border-radius: 10px;
    background: var(--raised);
    display: grid;
    gap: 6px;
  }
  .row {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .row.sub {
    padding-left: 12px;
  }
  .row.foot {
    justify-content: space-between;
  }
  .row input:not([type='checkbox']) {
    height: 32px;
    border-radius: 8px;
    border: 1px solid var(--line);
    padding: 0 8px;
    font-size: 13px;
    background: var(--raised);
    color: var(--ink);
  }
  .name {
    font-weight: 700;
  }
  .lbl {
    flex: 1;
    min-width: 0;
  }
  .num {
    width: 58px;
  }
  .w,
  .one {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 11.5px;
    font-weight: 700;
    color: var(--ink-3);
    white-space: nowrap;
  }
  .one input {
    margin: 0;
    accent-color: var(--blue);
  }
  .ico {
    border: 0;
    background: transparent;
    color: var(--ink-3);
    padding: 5px;
    border-radius: 7px;
  }
  .ico:hover {
    color: var(--red);
    background: var(--red-soft);
  }
  .btn.small.ghost {
    justify-self: start;
  }
  .acts {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
</style>
