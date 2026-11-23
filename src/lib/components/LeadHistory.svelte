<script>
  import { slide } from 'svelte/transition';
  import { invalidateAll } from '$app/navigation';
  import Icon from './Icon.svelte';
  import { ENTRY_TYPES, entryType, entryLabel, CHANNELS, channelOf, whenLabel, wallClock, sinceLabel, reasonOptions, calendarNote, typesFor, DM_KEYS } from '$lib/leads.js';
  import { toast } from '$lib/toast.svelte.js';
  import { addDays } from '$lib/time.js';

  let { lead, tz, today, reasons = {}, mode = 'sdr' } = $props();
  const listId = `reasons-${Math.random().toString(36).slice(2, 8)}`;

  // newest first; sheet history with no date goes last
  let show = $state('');
  const all = $derived([...lead.dials].reverse());
  const entries = $derived(show ? all.filter((d) => d.channel === show) : all);
  const byChannel = $derived(Object.fromEntries(CHANNELS.map((c) => [c.key, all.filter((d) => d.channel === c.key).length])));
  const outcome = entryType;
  // only calls you made can go in the Dialling numbers, and DM outcomes in the DM Setting numbers
  const countable = (f) => (f.channel === 'dm' ? DM_KEYS.includes(f.outcome) : f.channel === 'call' && !!f.outcome && !DM_KEYS.filter((k) => k !== 'booked').includes(f.outcome) && f.outcome !== 'inbound');
  const board = (f) => (f.channel === 'dm' ? 'DM Setting' : 'Dialling');
  const whyNot = (f) =>
    f.channel === 'sms' || f.channel === 'email'
      ? `${channelOf(f.channel).plural} don't count on Dialling, but still show as contact`
      : f.outcome === 'inbound'
        ? "Inbound calls don't count on Dialling"
        : `Notes don't count on ${board(f)}`;

  let adding = $state(false);
  let draft = $state(blankDraft());
  let editing = $state(null);
  let form = $state({});
  let busy = $state(false);

  function blankDraft(channel = mode === 'dm' ? 'dm' : 'call') {
    const now = wallClock(new Date().toISOString(), tz);
    return { ...now, channel, outcome: channel === 'call' && mode === 'sdr' ? 'no_answer' : channel === 'dm' ? 'contacted' : '', reason: '', subject: '', note: '', counted: false, followUp: addDays(now.date, 1), followUpTime: '' };
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
      toast(msg + calendarNote(j.calendar), j.calendar?.error ? 'error' : undefined);
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
    // old entries saved without a reason can still be edited; changing the outcome needs one
    form = { ...w, was: d.reason ? null : d.outcome || '', channel: d.channel, outcome: d.outcome || '', reason: d.reason, subject: d.subject, note: d.note, counted: d.counted };
  }
  async function save(e, d) {
    e.preventDefault();
    const body = { ...form, counted: countable(form) && form.counted };
    if (await send(`/api/leads/${lead.id}/dials/${d.id}`, 'PATCH', body, 'Entry updated')) editing = null;
  }
  // the note box grows with what you type (field-sizing where the browser has it, this otherwise)
  function grow(el) {
    const fit = () => {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight + 2, window.innerHeight * 0.6) + 'px';
    };
    queueMicrotask(fit);
    el.addEventListener('input', fit);
    return { destroy: () => el.removeEventListener('input', fit) };
  }
  // long notes and email bodies start folded
  let unfolded = $state([]);
  const long = (d) => d.note.length > 260 || d.note.split('\n').length > 4;
  const flip = (id) => (unfolded = unfolded.includes(id) ? unfolded.filter((x) => x !== id) : [...unfolded, id]);

  async function remove(d) {
    if (d.counted && !confirm(`Remove this ${outcome(d.outcome)?.label.toLowerCase()}? It comes off that day's ${d.channel === 'dm' ? 'DM Setting' : 'Dialling'} numbers.`)) return;
    send(`/api/leads/${lead.id}/dials/${d.id}`, 'DELETE', null, 'Entry removed');
  }
</script>

{#snippet fields(f, label, cancel)}
  <div class="chan" role="radiogroup" aria-label="How it happened">
    {#each CHANNELS as c}
      <button type="button" role="radio" aria-checked={f.channel === c.key} class:on={f.channel === c.key} onclick={() => ((f.channel = c.key), typesFor(c.key).some((o) => o.key === f.outcome) || (f.outcome = ''))}>
        <Icon name={c.icon} size={14} />{c.label}
      </button>
    {/each}
  </div>
  <label class="field">Date<input type="date" bind:value={f.date} max={today} required /></label>
  <label class="field">Time<input type="time" bind:value={f.time} /></label>
  <label class="field">What happened
    <select bind:value={f.outcome}>
      {#each typesFor(f.channel) as o}<option value={o.key}>{entryLabel(o.key, f.channel)}</option>{/each}
      <option value="">{f.channel === 'call' ? 'Other (note only)' : entryLabel('', f.channel)}</option>
    </select>
  </label>
  {#if f.outcome}
    <label class="field wide">Reason
      <input required={f.outcome !== (f.was ?? null)} bind:value={f.reason} list="{listId}-{f.outcome}" placeholder={reasonOptions(f.outcome, reasons).slice(0, 3).join(', ') || 'More detail'} maxlength="80" />
      <datalist id="{listId}-{f.outcome}">{#each reasonOptions(f.outcome, reasons) as r}<option value={r}></option>{/each}</datalist>
    </label>
  {/if}
  {#if f.outcome === 'callback' && 'followUp' in f}
    <label class="field">Call back on<input type="date" bind:value={f.followUp} min={today} required /></label>
    <label class="field">At<input type="time" bind:value={f.followUpTime} required title="Goes on your calendar as a 15-minute slot" /></label>
  {/if}
  {#if f.channel === 'email'}
    <label class="field wide">Subject<input bind:value={f.subject} placeholder="Subject line" /></label>
  {/if}
  <label class="field wide">{f.channel === 'email' ? 'Email' : 'Note'}
    <textarea
      use:grow
      rows="2"
      bind:value={f.note}
      placeholder={f.channel === 'call' ? 'Who you spoke to, what they said, when to call back' : f.channel === 'sms' ? 'The text you sent or got' : 'The body of the email'}
    ></textarea>
  </label>
  {#if countable(f)}
    <label class="check"><input type="checkbox" bind:checked={f.counted} />Count it on {board(f)} for that day</label>
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
    {#if mode !== 'dm'}<button class="btn small" onclick={inbound}><Icon name="phone" size={14} />They called in</button>{/if}
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
                <strong class:optout={d.label === 'Opted out'}>{d.label && d.date ? d.label : entryLabel(d.outcome, d.channel)}</strong>{#if d.reason}<span class="rsn">{d.reason}</span>{/if}{#if d.label && !d.date}<span class="faint">, from your sheet ({d.label})</span>{/if}
              </span>
              {#if d.subject}<span class="subj">{d.subject}</span>{/if}
              {#if d.note}
                <div class="body" class:email={d.channel === 'email'} class:folded={long(d) && !unfolded.includes(d.id)}>{d.note}</div>
                {#if long(d)}
                  <button class="more" onclick={() => flip(d.id)}>
                    {unfolded.includes(d.id) ? 'Show less' : d.channel === 'email' ? 'Show full email' : 'Show all'}
                  </button>
                {/if}
              {/if}
              {#if d.counted}<span class="tag faint">in {d.channel === 'dm' ? 'DM Setting' : 'Dialling'} numbers</span>{/if}
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
  .entry-form .field.wide {
    grid-column: 1 / -1;
  }
  .entry-form .field textarea,
  .entry-form .field input {
    width: 100%;
    min-width: 0;
  }
  textarea {
    resize: vertical;
    min-height: 60px;
    max-height: 60vh;
    field-sizing: content;
    line-height: 1.45;
  }
  .rsn {
    display: inline-block;
    margin-left: 8px;
    padding: 1px 9px;
    border-radius: 999px;
    background: var(--tone-soft, var(--iron-soft));
    border: 1px solid color-mix(in srgb, var(--tone, var(--line)) 40%, transparent);
    font-size: 12px;
    font-weight: 600;
    color: var(--ink);
    vertical-align: 1px;
  }
  .optout {
    color: var(--red);
  }
  .subj {
    font-weight: 700;
    color: var(--ink);
    margin-top: 2px;
  }
  .body {
    margin-top: 4px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--ink-2);
    font-size: 13.5px;
    line-height: 1.5;
  }
  .body.email {
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--surface);
    border: 1px solid var(--line-2);
  }
  .body.folded {
    max-height: 6.2em;
    overflow: hidden;
    mask-image: linear-gradient(to bottom, #000 55%, transparent);
  }
  .more {
    justify-self: start;
    border: 0;
    background: transparent;
    padding: 2px 0;
    font-size: 12.5px;
    font-weight: 700;
    color: var(--blue);
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
