<script>
  import { slide } from 'svelte/transition';
  import { invalidateAll } from '$app/navigation';
  import Icon from './Icon.svelte';
  import { ENTRY_TYPES, entryType, whenLabel, wallClock, sinceLabel } from '$lib/leads.js';
  import { toast } from '$lib/toast.svelte.js';

  let { lead, tz, today } = $props();

  // newest first; sheet history with no date goes last
  const entries = $derived([...lead.dials].reverse());
  const outcome = entryType;
  const countable = (k) => !!k && k !== 'inbound';

  let adding = $state(false);
  let draft = $state(blankDraft());
  let editing = $state(null);
  let form = $state({});
  let busy = $state(false);

  function blankDraft() {
    const now = wallClock(new Date().toISOString(), tz);
    return { ...now, outcome: 'no_answer', note: '', counted: false };
  }
  // they rang you: open the form already set to an inbound call at the current time
  function inbound() {
    draft = { ...blankDraft(), outcome: 'inbound' };
    adding = true;
  }

  async function send(path, method, body, msg) {
    busy = true;
    try {
      const r = await fetch(path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || 'Could not save');
      toast(msg);
      await invalidateAll();
      return true;
    } catch (e) {
      toast(e.message, 'error');
      return false;
    } finally {
      busy = false;
    }
  }

  async function add(e) {
    e.preventDefault();
    const body = { ...draft, counted: countable(draft.outcome) && draft.counted };
    if (await send(`/api/leads/${lead.id}/history`, 'POST', body, draft.outcome === 'inbound' ? 'Inbound call added' : 'Added to their history')) {
      adding = false;
      draft = blankDraft();
    }
  }
  function startEdit(d) {
    editing = d.id;
    const w = d.date ? wallClock(d.at, tz) : { date: today, time: '' };
    form = { ...w, outcome: d.outcome || '', note: d.note, counted: d.counted };
  }
  async function save(e, d) {
    e.preventDefault();
    const body = { ...form, counted: countable(form.outcome) && form.counted };
    if (await send(`/api/leads/${lead.id}/dials/${d.id}`, 'PATCH', body, 'Entry updated')) editing = null;
  }
  async function remove(d) {
    if (d.counted && !confirm(`Remove this ${outcome(d.outcome)?.label.toLowerCase()}? It comes off that day's Dialling numbers.`)) return;
    send(`/api/leads/${lead.id}/dials/${d.id}`, 'DELETE', null, 'Entry removed');
  }
</script>

<div class="hist">
  <div class="top">
    <span class="k">History</span>
    {#if lead.lastContactAt}
      <span class="last">Last contacted <strong>{sinceLabel(lead.lastContactAt, today, tz)}</strong>, {whenLabel(lead.lastContactAt, tz)}</span>
    {:else}
      <span class="last faint">No contact with a date yet</span>
    {/if}
    <button class="btn small" onclick={inbound}><Icon name="phone" size={14} />They called in</button>
    <button class="btn small" onclick={() => (adding = !adding)} aria-expanded={adding}><Icon name="plus" size={14} />Add contact</button>
  </div>

  {#if adding}
    <form class="entry-form" transition:slide={{ duration: 180 }} onsubmit={add}>
      <label class="field">Date<input type="date" bind:value={draft.date} max={today} required /></label>
      <label class="field">Time<input type="time" bind:value={draft.time} /></label>
      <label class="field">What happened
        <select bind:value={draft.outcome}>
          {#each ENTRY_TYPES as o}<option value={o.key}>{o.label}</option>{/each}
          <option value="">Other (note only)</option>
        </select>
      </label>
      <label class="field wide">Note<input bind:value={draft.note} placeholder="Texted the quote, spoke to his wife, emailed..." /></label>
      {#if countable(draft.outcome)}
        <label class="check"><input type="checkbox" bind:checked={draft.counted} />Count it on Dialling for that day</label>
      {:else}
        <span class="check faint">{draft.outcome === 'inbound' ? "Inbound calls don't count on Dialling" : "Notes don't count on Dialling"}</span>
      {/if}
      <div class="btns">
        <button type="button" class="btn small ghost" onclick={() => (adding = false)}>Cancel</button>
        <button class="btn small primary" disabled={busy}><Icon name="check" size={14} />Add</button>
      </div>
    </form>
  {/if}

  {#if entries.length}
    <ol class="timeline">
      {#each entries as d (d.id)}
        {@const o = outcome(d.outcome)}
        <li class="t-{o?.tone || 'none'}">
          <i class="dot"></i>
          {#if editing === d.id}
            <form class="entry-form" onsubmit={(e) => save(e, d)}>
              <label class="field">Date<input type="date" bind:value={form.date} required /></label>
              <label class="field">Time<input type="time" bind:value={form.time} /></label>
              <label class="field">What happened
                <select bind:value={form.outcome}>
                  {#each ENTRY_TYPES as x}<option value={x.key}>{x.label}</option>{/each}
                  <option value="">Other (note only)</option>
                </select>
              </label>
              <label class="field wide">Note<input bind:value={form.note} /></label>
              {#if countable(form.outcome)}
                <label class="check"><input type="checkbox" bind:checked={form.counted} />Count it on Dialling for that day</label>
              {:else}
                <span class="check faint">{form.outcome === 'inbound' ? "Inbound calls don't count on Dialling" : "Notes don't count on Dialling"}</span>
              {/if}
              <div class="btns">
                <button type="button" class="btn small ghost" onclick={() => (editing = null)}>Cancel</button>
                <button class="btn small primary" disabled={busy}><Icon name="check" size={14} />Save</button>
              </div>
            </form>
          {:else}
            <div class="what">
              <span class="when">{d.date ? whenLabel(d.at, tz) : 'Date not recorded'}</span>
              <span>
                <strong>{o?.label || 'Note'}</strong>{#if d.label && !d.date}<span class="faint">, from your sheet ({d.label})</span>{/if}{#if d.note}<span class="muted">, "{d.note}"</span>{/if}
              </span>
              {#if d.outcome === 'inbound'}<span class="tag faint">they called you, not in Dialling numbers</span>{:else if !d.counted}<span class="tag faint">not in Dialling numbers</span>{/if}
            </div>
            <div class="row-btns">
              <button class="ico" onclick={() => startEdit(d)} aria-label="Edit this entry"><Icon name="edit" size={14} /></button>
              <button class="ico del" onclick={() => remove(d)} aria-label="Remove this entry"><Icon name="x" size={14} /></button>
            </div>
          {/if}
        </li>
      {/each}
    </ol>
  {:else}
    <p class="faint small">Nothing yet. Dials from the dialler land here with their date and time.</p>
  {/if}
</div>

<style>
  .hist {
    display: grid;
    gap: 10px;
  }
  .top {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 14px;
  }
  .k {
    font-size: 11.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-3);
  }
  .last {
    font-size: 13.5px;
    margin-right: auto;
  }
  .small {
    font-size: 13px;
    margin: 0;
  }
  .entry-form {
    display: grid;
    grid-template-columns: 150px 120px 180px 1fr;
    gap: 10px;
    align-items: end;
    padding: 12px 14px;
    border-radius: 12px;
    background: var(--surface);
    border: 1px solid var(--line-2);
    width: 100%;
  }
  .field select {
    height: 40px;
  }
  .check {
    grid-column: 1 / 4;
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 13.5px;
  }
  .btns {
    display: flex;
    gap: 8px;
    justify-content: end;
  }
  .timeline {
    list-style: none;
    margin: 0;
    padding: 0 0 0 6px;
    display: grid;
  }
  .timeline li {
    position: relative;
    display: flex;
    gap: 12px;
    align-items: start;
    padding: 8px 0 8px 20px;
    border: 0;
    background: transparent;
    border-left: 2px solid var(--line-2);
    border-radius: 0;
  }
  .timeline li:last-child {
    border-left-color: transparent;
  }
  .dot {
    position: absolute;
    left: -6px;
    top: 12px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--tone);
    box-shadow: 0 0 0 3px var(--raised);
  }
  .what {
    display: grid;
    gap: 1px;
    font-size: 13.5px;
    flex: 1;
    min-width: 0;
  }
  .when {
    font-size: 12px;
    color: var(--ink-3);
    font-weight: 600;
  }
  .tag {
    font-size: 11.5px;
  }
  .row-btns {
    display: flex;
    gap: 2px;
  }
  .ico {
    border: 0;
    background: transparent;
    color: var(--ink-3);
    padding: 5px;
    border-radius: 7px;
  }
  .ico:hover {
    color: var(--ink);
    background: var(--iron-soft);
  }
  .ico.del:hover {
    color: var(--red);
    background: var(--red-soft);
  }
  @media (max-width: 760px) {
    .entry-form {
      grid-template-columns: 1fr 1fr;
    }
    .field.wide,
    .check {
      grid-column: 1 / -1;
    }
  }
</style>
