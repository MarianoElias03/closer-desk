<script>
  import { slide, fade } from 'svelte/transition';
  import { tick } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import Icon from './Icon.svelte';
  import { SDR_OUTCOMES, CALL_OUTCOMES } from '$lib/stats.js';
  import { FILTERS, stageOf, leadName, linkFor, isDue } from '$lib/leads.js';
  import { ddmm, dayLabel, money } from '$lib/fmt.js';
  import { toast } from '$lib/toast.svelte.js';

  let { leads, today, tz, linkable = [], expanded = $bindable(null), ondial } = $props();

  let filter = $state('queue');
  let q = $state('');
  let sort = $state('score');
  let limit = $state(100);
  let form = $state({});
  let adding = $state(false);
  let draft = $state({ business: '', contact: '', phone: '', suburb: '' });
  let pickCall = $state('');

  const counts = $derived(Object.fromEntries(FILTERS.map((f) => [f.key, leads.filter((l) => f.test(l, today)).length])));
  const shown = $derived.by(() => {
    const f = FILTERS.find((x) => x.key === filter);
    const needle = q.trim().toLowerCase();
    const digits = needle.replace(/\D/g, '');
    const list = leads.filter((l) => f.test(l, today)).filter((l) => {
      if (!needle) return true;
      if (digits.length >= 3 && l.phone.replace(/\D/g, '').includes(digits)) return true;
      return [l.business, l.contact, l.suburb, l.category, l.email, l.notes].some((s) => s.toLowerCase().includes(needle));
    });
    const by = {
      score: (a, b) => (b.score ?? -1) - (a.score ?? -1) || a.id - b.id,
      recent: (a, b) => (b.lastDialOn || '').localeCompare(a.lastDialOn || '') || b.id - a.id,
      name: (a, b) => leadName(a).localeCompare(leadName(b)),
      follow: (a, b) => (a.followUp || '9').localeCompare(b.followUp || '9')
    };
    return list.sort(by[sort]);
  });

  // opened from elsewhere (the dialler, a call's "Open lead"): show it
  $effect(() => {
    const id = expanded;
    if (id == null) return;
    const l = leads.find((x) => x.id === id);
    if (!l) return;
    if (!shown.some((x) => x.id === id)) filter = 'all';
    if (form.id !== id) fill(l);
    tick().then(() => document.getElementById(`lead-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  });

  function fill(l) {
    form = { id: l.id, business: l.business, contact: l.contact, phone: l.phone, email: l.email, suburb: l.suburb, category: l.category, score: l.score ?? '', followUp: l.followUp || '', notes: l.notes };
    pickCall = '';
  }
  function toggle(l) {
    if (expanded === l.id) expanded = null;
    else {
      fill(l);
      expanded = l.id;
    }
  }

  async function api(path, method, body) {
    const r = await fetch(path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.message || 'Could not save');
    return j;
  }
  async function save(l) {
    try {
      const { id, ...patch } = form;
      await api(`/api/leads/${l.id}`, 'PATCH', patch);
      toast(`${leadName({ ...l, ...patch })} saved`);
      await invalidateAll();
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  async function remove(l) {
    const n = l.dials.filter((d) => d.counted).length;
    if (!confirm(`Delete ${leadName(l)}?${n ? ` Its ${n} ${n === 1 ? 'dial comes' : 'dials come'} off your daily numbers too.` : ''}`)) return;
    try {
      await api(`/api/leads/${l.id}`, 'DELETE');
      toast(`Deleted ${leadName(l)}`);
      expanded = null;
      await invalidateAll();
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  async function dropDial(l, d) {
    if (d.counted && !confirm(`Remove the ${ddmm(d.date)} ${outcomeLabel(d.outcome).toLowerCase()}? It comes off that day's numbers.`)) return;
    try {
      await api(`/api/leads/${l.id}/dials/${d.id}`, 'DELETE');
      toast('Dial removed');
      await invalidateAll();
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  async function link(l, callId) {
    try {
      await api(`/api/leads/${l.id}`, 'PATCH', { callId });
      toast(callId ? 'Call linked to this lead' : 'Call unlinked');
      await invalidateAll();
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  async function add() {
    try {
      const { lead } = await api('/api/leads', 'POST', draft);
      toast(`Added ${leadName(lead)}`);
      draft = { business: '', contact: '', phone: '', suburb: '' };
      adding = false;
      await invalidateAll();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  const outcomeLabel = (k) => SDR_OUTCOMES.find((o) => o.key === k)?.label || 'Note';
  const outcomeTone = (k) => SDR_OUTCOMES.find((o) => o.key === k)?.tone || 'none';
  const callOutcome = (k) => CALL_OUTCOMES.find((o) => o.key === k) || CALL_OUTCOMES[0];
  const when = (iso) =>
    new Intl.DateTimeFormat('en-AU', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
</script>

<section class="panel cold">
  <div class="head">
    <div>
      <h2>Lead list</h2>
      <p class="muted small">Everything on this offer's call list. Click a lead to edit it, see its dials or link its booked call.</p>
    </div>
    <div class="tools">
      <label class="search">
        <Icon name="search" size={16} />
        <input bind:value={q} placeholder="Business, name, suburb or number" aria-label="Search leads" />
      </label>
      <select bind:value={sort} aria-label="Sort leads">
        <option value="score">Highest score</option>
        <option value="follow">Follow-up date</option>
        <option value="recent">Last dialled</option>
        <option value="name">A to Z</option>
      </select>
      <button class="btn small" onclick={() => (adding = !adding)}><Icon name="plus" size={15} />Add lead</button>
    </div>
  </div>

  {#if adding}
    <form class="add" transition:slide={{ duration: 180 }} onsubmit={(e) => (e.preventDefault(), add())}>
      <label class="field">Business<input bind:value={draft.business} /></label>
      <label class="field">Contact name<input bind:value={draft.contact} /></label>
      <label class="field">Mobile<input bind:value={draft.phone} inputmode="tel" /></label>
      <label class="field">Suburb<input bind:value={draft.suburb} /></label>
      <button class="btn primary small" type="submit"><Icon name="check" size={14} />Add</button>
    </form>
  {/if}

  <div class="tabs" role="tablist">
    {#each FILTERS as f}
      <button role="tab" aria-selected={filter === f.key} class:on={filter === f.key} onclick={() => ((filter = f.key), (limit = 100))}>
        {f.label}<span class="n num">{counts[f.key]}</span>
      </button>
    {/each}
  </div>

  {#if shown.length}
    <ul class="list">
      {#each shown.slice(0, limit) as l (l.id)}
        {@const st = stageOf(l)}
        <li id="lead-{l.id}" class="t-{st.tone}" class:open={expanded === l.id} in:fade={{ duration: 160 }}>
          <button class="row" onclick={() => toggle(l)} aria-expanded={expanded === l.id}>
            <span class="sc num" class:none={l.score == null}>{l.score ?? '–'}</span>
            <span class="nm">
              <strong>{leadName(l)}</strong>
              <span class="faint">{[l.business && l.contact, l.suburb, l.category].filter(Boolean).join(', ')}</span>
            </span>
            <span class="ph num faint">{l.phone}</span>
            <span class="meta">
              <span class="chip"><span class="dot"></span>{st.label}{l.call?.cash ? ` ${money(l.call.cash)}` : ''}</span>
              {#if l.followUp && !l.call}<span class="fu" class:due={isDue(l, today)}><Icon name="clock" size={13} />{ddmm(l.followUp)}</span>{/if}
              {#if l.attempts}<span class="faint at">{l.attempts}x</span>{/if}
            </span>
          </button>

          {#if expanded === l.id}
            <div class="edit" transition:slide={{ duration: 200 }}>
              <div class="grid">
                <label class="field">Business<input bind:value={form.business} /></label>
                <label class="field">Contact name<input bind:value={form.contact} /></label>
                <label class="field">Mobile<input bind:value={form.phone} inputmode="tel" /></label>
                <label class="field">Email<input bind:value={form.email} type="email" /></label>
                <label class="field">Suburb<input bind:value={form.suburb} /></label>
                <label class="field">Category<input bind:value={form.category} /></label>
                <label class="field">Prospect score<input bind:value={form.score} inputmode="decimal" /></label>
                <label class="field">Follow-up date<input bind:value={form.followUp} type="date" /></label>
              </div>
              <label class="field">Notes<textarea bind:value={form.notes} placeholder="Who you spoke to, objections, best time to call"></textarea></label>

              {#if l.extra.length}
                <dl class="facts">
                  {#each l.extra as [k, v]}
                    <div>
                      <dt>{k}</dt>
                      <dd>{#if linkFor(v)}<a href={linkFor(v)} target="_blank" rel="noopener">{v}</a>{:else}{v}{/if}</dd>
                    </div>
                  {/each}
                </dl>
              {/if}

              <div class="block">
                <span class="k">Dials</span>
                {#if l.dials.length}
                  <ul class="dials">
                    {#each l.dials as d (d.id)}
                      <li class="t-{outcomeTone(d.outcome)}">
                        <i></i>
                        <span>
                          {#if d.date}<strong>{dayLabel(d.date, { day: 'numeric', month: 'short' })}</strong> {outcomeLabel(d.outcome)}{:else}{d.label} <span class="faint">(from your sheet, not counted)</span>{/if}
                          {#if d.note}<span class="muted">, "{d.note}"</span>{/if}
                        </span>
                        <button class="x" onclick={() => dropDial(l, d)} aria-label="Remove this dial"><Icon name="x" size={13} /></button>
                      </li>
                    {/each}
                  </ul>
                {:else}
                  <p class="faint small">Not dialled yet.</p>
                {/if}
              </div>

              <div class="block">
                <span class="k">Booked call</span>
                {#if l.call}
                  {@const co = callOutcome(l.call.outcome)}
                  <div class="call t-{co.tone}">
                    <span><strong>{l.call.title}</strong>, {when(l.call.start)}{l.call.cancelled ? ' (cancelled)' : ''}</span>
                    <span class="chip"><span class="dot"></span>{co.key === 'pending' ? 'Outcome not logged' : co.label}{l.call.cash ? `, ${money(l.call.cash)}` : ''}</span>
                    <a class="btn small ghost" href="/calls?open={encodeURIComponent(l.call.id)}">Open call</a>
                    <button class="btn small ghost" onclick={() => link(l, null)}>Unlink</button>
                  </div>
                {:else}
                  <p class="faint small">
                    {l.stage === 'booked' ? 'Waiting for the booking to show up on your calendar. It links by mobile, email or business name on the next sync.' : 'Book them and the calendar event links here, with its closing outcome.'}
                  </p>
                  {#if linkable.length}
                    <div class="pick">
                      <select bind:value={pickCall} aria-label="Pick a call to link">
                        <option value="">Link a calendar call by hand</option>
                        {#each linkable as c}<option value={c.id}>{c.prospect || c.title}, {when(c.start)}</option>{/each}
                      </select>
                      <button class="btn small" disabled={!pickCall} onclick={() => link(l, pickCall)}><Icon name="link" size={14} />Link</button>
                    </div>
                  {/if}
                {/if}
              </div>

              <div class="acts">
                <button class="btn small ghost danger" onclick={() => remove(l)}>Delete lead</button>
                <button class="btn small" onclick={() => ondial?.(l.id)}><Icon name="phone" size={14} />Dial now</button>
                <button class="btn small primary" onclick={() => save(l)}><Icon name="check" size={14} />Save</button>
              </div>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
    {#if shown.length > limit}
      <button class="btn small ghost more" onclick={() => (limit += 200)}>Show {Math.min(200, shown.length - limit)} more of {shown.length - limit}</button>
    {/if}
  {:else}
    <div class="empty">
      {#if q.trim()}
        No lead matches "{q.trim()}".
      {:else if !leads.length}
        <strong>No leads on this offer yet.</strong> Import your spreadsheet, or add one by hand.
      {:else}
        Nothing in this list right now.
      {/if}
    </div>
  {/if}
</section>

<style>
  .cold {
    padding: 22px;
    margin-bottom: 18px;
    display: grid;
    gap: 16px;
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 12px;
  }
  .head p {
    margin: 4px 0 0;
  }
  .small {
    font-size: 13px;
  }
  .tools {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 36px;
    padding: 0 12px;
    border-radius: 10px;
    border: 1px solid var(--line-2);
    background: var(--raised);
    color: var(--ink-3);
    min-width: min(260px, 100%);
  }
  .search input {
    border: 0;
    background: transparent;
    outline: none;
    flex: 1;
    color: var(--ink);
    min-width: 0;
  }
  .search:focus-within {
    border-color: var(--focus);
  }
  select {
    height: 36px;
    border-radius: 10px;
    border: 1px solid var(--line-2);
    background: var(--raised);
    color: var(--ink);
    padding: 0 10px;
  }
  .add {
    display: grid;
    grid-template-columns: repeat(4, 1fr) auto;
    gap: 10px;
    align-items: end;
  }
  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 4px;
    border-radius: 12px;
    background: var(--iron-soft);
    justify-self: start;
  }
  .tabs button {
    height: 32px;
    padding: 0 12px;
    border: 0;
    border-radius: 9px;
    background: transparent;
    font-weight: 600;
    font-size: 13.5px;
    color: var(--ink-2);
    display: inline-flex;
    gap: 7px;
    align-items: center;
  }
  .tabs button.on {
    background: var(--raised);
    color: var(--ink);
    box-shadow: var(--shadow);
  }
  .tabs .n {
    font-size: 12px;
    color: var(--ink-3);
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  li {
    border-radius: 12px;
    border: 1px solid var(--line-2);
    background: var(--raised);
    border-left: 4px solid var(--tone);
  }
  li.open {
    box-shadow: var(--shadow);
  }
  .row {
    width: 100%;
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr) 130px auto;
    gap: 12px;
    align-items: center;
    padding: 10px 14px 10px 10px;
    border: 0;
    background: transparent;
    text-align: left;
    color: var(--ink);
  }
  .sc {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-weight: 800;
    font-size: 14px;
    background: var(--blue-soft);
    color: var(--blue);
  }
  .sc.none {
    background: var(--iron-soft);
    color: var(--ink-3);
  }
  .nm {
    display: grid;
    min-width: 0;
  }
  .nm > * {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .nm .faint {
    font-size: 12.5px;
  }
  .ph {
    font-size: 13px;
  }
  .meta {
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: end;
  }
  .fu {
    display: inline-flex;
    gap: 4px;
    align-items: center;
    font-size: 12.5px;
    color: var(--ink-3);
  }
  .fu.due {
    color: var(--ink);
    font-weight: 700;
  }
  .at {
    font-size: 12px;
    min-width: 22px;
    text-align: right;
  }
  .edit {
    padding: 4px 16px 16px;
    display: grid;
    gap: 14px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 10px;
  }
  .facts {
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
    gap: 10px 18px;
    padding: 12px 14px;
    border-radius: 10px;
    background: var(--surface);
  }
  .facts dt {
    font-size: 12px;
    color: var(--ink-3);
  }
  .facts dd {
    margin: 2px 0 0;
    font-size: 13.5px;
    overflow-wrap: anywhere;
  }
  .block {
    display: grid;
    gap: 6px;
  }
  .block p {
    margin: 0;
  }
  .k {
    font-size: 11.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-3);
  }
  .dials {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 4px;
  }
  .dials li {
    border: 0;
    background: transparent;
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 13.5px;
  }
  .dials i {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--tone);
  }
  .x {
    margin-left: auto;
    border: 0;
    background: transparent;
    color: var(--ink-3);
    padding: 4px;
    border-radius: 6px;
  }
  .x:hover {
    color: var(--red);
    background: var(--red-soft);
  }
  .call {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 12px;
    align-items: center;
    font-size: 13.5px;
  }
  .call > span:first-child {
    margin-right: auto;
  }
  .pick {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .pick select {
    flex: 1;
    min-width: 0;
  }
  .acts {
    display: flex;
    gap: 8px;
    justify-content: end;
    flex-wrap: wrap;
  }
  .acts .danger {
    margin-right: auto;
    color: var(--red);
  }
  .more {
    justify-self: center;
  }
  .empty {
    padding: 26px;
    text-align: center;
    color: var(--ink-2);
    border: 1px dashed var(--line);
    border-radius: 14px;
  }
  @media (max-width: 760px) {
    .cold {
      padding: 16px;
    }
    .row {
      grid-template-columns: 34px minmax(0, 1fr) auto;
    }
    .ph {
      display: none;
    }
    .grid,
    .add {
      grid-template-columns: 1fr 1fr;
    }
  }
</style>
