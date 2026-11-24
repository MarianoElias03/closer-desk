<script>
  // A lead's prospect score as criteria you tick, the sum written out, and Advanced: the points each
  // criterion is worth on this offer (changing them re-scores every lead on it).
  import { slide } from 'svelte/transition';
  import { invalidateAll } from '$app/navigation';
  import Icon from './Icon.svelte';
  import { toast } from '$lib/toast.svelte.js';

  let { lead, scoring } = $props();

  const norm = (s) => String(s || '').trim().toLowerCase();
  const pitch = $derived((lead.extra.find(([k]) => /^pitch angle$/i.test(k.trim())) || [])[1] || '');
  let ticks = $state([]);
  $effect.pre(() => {
    ticks = [...(lead.scoreTicks || [])];
  });
  const isOn = (label) => ticks.some((t) => norm(t) === norm(label));
  const on = $derived(scoring.criteria.filter((c) => isOn(c.label)));
  const total = $derived(on.reduce((a, c) => a + c.points, 0));
  const worked = $derived(Math.max(0, Math.min(scoring.cap, total)));
  const byHand = $derived(lead.scoreTicks && lead.score != null && lead.score !== worked);
  const pts = (n) => `${n} ${Math.abs(n) === 1 ? 'pt' : 'pts'}`;

  let busy = $state(false);
  async function toggle(label) {
    const next = isOn(label) ? ticks.filter((t) => norm(t) !== norm(label)) : [...ticks, label];
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
  let rows = $state([]);
  let cap = $state(5);
  let saving = $state(false);
  function openAdv() {
    rows = scoring.criteria.map((c) => ({ label: c.label, points: c.points, was: c.label }));
    cap = scoring.cap;
    adv = !adv;
  }
  const advDirty = $derived(
    adv && (Number(cap) !== scoring.cap || rows.length !== scoring.criteria.length || rows.some((r, i) => r.label !== scoring.criteria[i]?.label || Number(r.points) !== scoring.criteria[i]?.points))
  );
  async function saveAdv(e) {
    e.preventDefault();
    saving = true;
    try {
      const r = await fetch('/api/scoring', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cap: Number(cap), criteria: rows.filter((r) => r.label.trim()).map((r) => ({ label: r.label, points: Number(r.points), was: r.was })) })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message || 'Could not save');
      toast(j.changed ? `Points saved. ${j.changed} lead${j.changed === 1 ? '' : 's'} re-scored` : 'Points saved');
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
    <span class="badge" class:none={lead.score == null}>{lead.score ?? '–'}<small>/ {scoring.cap}</small></span>
  </div>
  {#if pitch}<p class="pitch">{pitch}</p>{/if}

  {#if scoring.criteria.length}
    <div class="crit" role="group" aria-label="Scoring criteria">
      {#each scoring.criteria as c (c.label)}
        <label class="chip" class:on={isOn(c.label)}>
          <input type="checkbox" checked={isOn(c.label)} disabled={busy} onchange={() => toggle(c.label)} />
          {c.label}<b>{c.points > 0 ? '+' : ''}{c.points}</b>
        </label>
      {/each}
    </div>
    <p class="eq">
      {#if on.length}
        {#each on as c, i}{i ? ' + ' : ''}<span>{c.label} <b>{c.points}</b></span>{/each} = <strong>{pts(total)}</strong>{#if total > scoring.cap}<span class="faint">, capped at {scoring.cap}</span>{/if}
      {:else}
        <span class="faint">Nothing ticked: 0 pts</span>
      {/if}
    </p>
    {#if byHand}<p class="faint small">The score was set to {lead.score} by hand or by your sheet. Tick or untick a criterion to use the sum.</p>{/if}
  {:else}
    <p class="faint small">No scoring criteria on this offer yet. Add them under Advanced, or import a sheet with a "Why This Score" column.</p>
  {/if}

  <button class="adv-btn" onclick={openAdv} aria-expanded={adv}><Icon name="settings" size={13} />Advanced</button>
  {#if adv}
    <form class="adv" transition:slide={{ duration: 160 }} onsubmit={saveAdv}>
      <p class="faint small">Points for each criterion on this offer. Saving works out the score again for every lead on it.</p>
      {#each rows as r, i}
        <div class="row">
          <input class="lbl" bind:value={r.label} placeholder="Criterion, e.g. No website" aria-label="Criterion" />
          <input class="num" type="number" step="1" bind:value={r.points} aria-label="Points for {r.label}" />
          <button type="button" class="ico" onclick={() => (rows = rows.filter((_, j) => j !== i))} aria-label="Remove {r.label}"><Icon name="x" size={14} /></button>
        </div>
      {/each}
      <button type="button" class="btn small ghost" onclick={() => (rows = [...rows, { label: '', points: 1, was: '' }])}><Icon name="plus" size={14} />Add criterion</button>
      <label class="row capr">Highest score<input class="num" type="number" min="1" step="1" bind:value={cap} /></label>
      <div class="acts">
        <button type="button" class="btn small ghost" onclick={() => (adv = false)}>Cancel</button>
        <button class="btn small primary" disabled={!advDirty || saving}><Icon name="check" size={14} />{saving ? 'Saving' : 'Save points'}</button>
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
  .badge small {
    font-size: 13px;
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
  .crit {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    border-radius: 999px;
    border: 1px solid var(--line);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    color: var(--ink-2);
  }
  .chip input {
    margin: 0;
    accent-color: var(--blue);
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
  .eq {
    margin: 0;
    font-size: 13.5px;
    line-height: 1.6;
  }
  .eq b {
    font-variant-numeric: tabular-nums;
  }
  .small {
    font-size: 13px;
    margin: 0;
  }
  .adv-btn {
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
  .adv-btn:hover {
    color: var(--ink);
  }
  .adv {
    display: grid;
    gap: 8px;
    padding: 12px;
    border-radius: 12px;
    background: var(--surface);
    border: 1px solid var(--line-2);
  }
  .row {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .row input {
    height: 34px;
    border-radius: 8px;
    border: 1px solid var(--line);
    padding: 0 8px;
    font-size: 13.5px;
    background: var(--raised);
    color: var(--ink);
  }
  .lbl {
    flex: 1;
    min-width: 0;
  }
  .num {
    width: 70px;
  }
  .capr {
    font-size: 13px;
    font-weight: 600;
    justify-content: space-between;
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
