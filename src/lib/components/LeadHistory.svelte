<script>
  import { slide } from 'svelte/transition';
  import { invalidateAll } from '$app/navigation';
  import Icon from './Icon.svelte';
  import { ENTRY_TYPES, entryType, entryLabel, CHANNELS, channelOf, whenLabel, wallClock, sinceLabel } from '$lib/leads.js';
  import { toast } from '$lib/toast.svelte.js';

  let { lead, tz, today } = $props();

  // newest first; sheet history with no date goes last
  let show = $state('');
  const all = $derived([...lead.dials].reverse());
  const entries = $derived(show ? all.filter((d) => d.channel === show) : all);
  const byChannel = $derived(Object.fromEntries(CHANNELS.map((c) => [c.key, all.filter((d) => d.channel === c.key).length])));
  const outcome = entryType;
  // only calls you made can go in the Dialling numbers
  const countable = (f) => f.channel === 'call' && !!f.outcome && f.outcome !== 'inbound';
  const whyNot = (f) =>
    f.channel !== 'call'
      ? `${channelOf(f.channel).plural} don't count on Dialling, but still show as contact`
      : f.outcome === 'inbound'
        ? "Inbound calls don't count on Dialling"
        : "Notes don't count on Dialling";

  let adding = $state(false);
  let draft = $state(blankDraft());
  let editing = $state(null);
  let form = $state({});
  let busy = $state(false);

  function blankDraft(channel = 'call') {
    const now = wallClock(new Date().toISOString(), tz);
    return { ...now, channel, outcome: channel === 'call' ? 'no_answer' : '', note: '', counted: false };
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
    const body = { ...draft, counted: countable(draft) && draft.counted };
    const what = draft.outcome === 'inbound' ? `${entryLabel('inbound', draft.channel)}, added` : `${channelOf(draft.channel).label} added to their history`;
    if (await send(`/api/leads/${lead.id}/history`, 'POST', body, what)) {
      adding = false;
      draft = blankDraft();
    }
  }
  function startEdit(d) {
    editing = d.id;
    const w = d.date ? wallClock(d.at, tz) : { date: today, time: '' };
    form = { ...w, channel: d.channel, outcome: d.outcome || '', note: d.note, counted: d.counted };
  }
  async function save(e, d) {
    e.preventDefault();
    const body = { ...form, counted: countable(form) && form.counted };
    if (await send(`/api/leads/${lead.id}/dials/${d.id}`, 'PATCH', body, 'Entry updated')) editing = null;
  }
  async function remove(d) {
    if (d.counted && !confirm(`Remove this ${outcome(d.outcome)?.label.toLowerCase()}? It comes off that day's Dialling numbers.`)) return;
    send(`/api/leads/${lead.id}/dials/${d.id}`, 'DELETE', null, 'Entry removed');
  }
</script>

{#snippet fields(f, label, cancel)}
  <div class="chan" role="radiogroup" aria-label="How it happened">
    {#each CHANNELS as c}
      <button type="button" role="radio" aria-checked={f.channel === c.key} class:on={f.channel === c.key} onclick={() => (f.channel = c.key)}>
        <Icon name={c.icon} size={14} />{c.label}
      </button>
    {/each}
  </div>
  <label class="field">Date<input type="date" bind:value={f.date} max={today} required /></label>
  <label class="field">Time<input type="time" bind:value={f.time} /></label>
  <label class="field">What happened
    <select bind:value={f.outcome}>
      {#each ENTRY_TYPES as o}<option value={o.key}>{entryLabel(o.key, f.channel)}</option>{/each}
      <option value="">{f.channel === 'call' ? 'Other (note only)' : f.channel === 'sms' ? 'Sent a text' : 'Sent an email'}</option>
    </select>
  </label>
  <label class="field wide">Note<input bind:value={f.note} placeholder={f.channel === 'call' ? 'Spoke to his wife, owner back Friday...' : 'What you sent or what they said'} /></label>
  {#if countable(f)}
    <label class="check"><input type="checkbox" bind:checked={f.counted} />Count it on Dialling for that day</label>
  {:else}
    <span class="check faint">{whyNot(f)}</span>
  {/if}
  <div class="btns">
    <button type="button" class="btn small ghost" onclick={cancel}>Cancel</button>
    <button class="btn small primary" disabled={busy}><Icon name="check" size={14} />{label}</button>
  </div>
{/snippet}

<div class="hist">
  <div class="top">
    <span class="k">History</span>
    {#if lead.lastContactAt}
      <span class="last">Last contacted <strong>{sinceLabel(lead.lastContactAt, today, tz)}</strong>, {whenLabel(lead.lastContactAt, tz)}</span>
    {:else}
      <span class="last faint">No contact with a date yet</span>
    {/if}
    <button class="btn small" onclick={inbound}><Icon name="phone" size={14} />They called in</button>
    <button class="btn small" onclick={() => ((draft = blankDraft()), (adding = !adding))} aria-expanded={adding}><Icon name="plus" size={14} />Add contact</button>
  </div>

  {#if adding}
    <form class="entry-form" transition:slide={{ duration: 180 }} onsubmit={add}>
      {@render fields(draft, 'Add', () => (adding = false))}
    </form>
  {/if}

  {#if all.length && Object.values(byChannel).filter(Boolean).length > 1}
    <div class="filter" role="tablist" aria-label="Show contacts by">
      <button role="tab" aria-selected={!show} class:on={!show} onclick={() => (show = '')}>All<span class="n">{all.length}</span></button>
      {#each CHANNELS.filter((c) => byChannel[c.key]) as c}
        <button role="tab" aria-selected={show === c.key} class:on={show === c.key} onclick={() => (show = c.key)}>
          <Icon name={c.icon} size={13} />{c.plural}<span class="n">{byChannel[c.key]}</span>
        </button>
      {/each}
    </div>
  {/if}

  {#if entries.length}
    <ol class="timeline">
      {#each entries as d (d.id)}
        {@const o = outcome(d.outcome)}
        <li class="t-{o?.tone || 'none'}">
          <i class="dot"></i>
          {#if editing === d.id}
            <form class="entry-form" onsubmit={(e) => save(e, d)}>
              {@render fields(form, 'Save', () => (editing = null))}
            </form>
          {:else}
            <div class="what">
              <span class="when"><Icon name={channelOf(d.channel).icon} size={12} />{channelOf(d.channel).label}, {d.date ? whenLabel(d.at, tz) : 'date not recorded'}</span>
              <span>
                <strong>{d.outcome || d.channel === 'call' ? entryLabel(d.outcome, d.channel) : d.channel === 'sms' ? 'Sent a text' : 'Sent an email'}</strong>{#if d.label && !d.date}<span class="faint">, from your sheet ({d.label})</span>{/if}{#if d.note}<span class="muted">, "{d.note}"</span>{/if}
              </span>
              {#if d.counted}<span class="tag faint">in Dialling numbers</span>{/if}
            </div>
            <div class="row-btns">
              <button class="ico" onclick={() => startEdit(d)} aria-label="Edit this entry"><Icon name="edit" size={14} /></button>
              <button class="ico del" onclick={() => remove(d)} aria-label="Remove this entry"><Icon name="x" size={14} /></button>
            </div>
          {/if}
        </li>
      {/each}
    </ol>
  {:else if all.length}
    <p class="faint small">No {channelOf(show).plural.toLowerCase()} with this lead yet.</p>
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
  .chan,
  .filter {
    grid-column: 1 / -1;
    display: inline-flex;
    justify-self: start;
    flex-wrap: wrap;
    gap: 4px;
    padding: 3px;
    border-radius: 10px;
    background: var(--iron-soft);
  }
  .chan button,
  .filter button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 12px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    font-weight: 600;
    font-size: 13px;
    color: var(--ink-2);
  }
  .chan button.on,
  .filter button.on {
    background: var(--raised);
    color: var(--ink);
    box-shadow: var(--shadow);
  }
  .filter .n {
    font-size: 11.5px;
    color: var(--ink-3);
  }
  .when {
    display: inline-flex;
    align-items: center;
    gap: 5px;
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
