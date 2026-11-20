<script>
  import { slide, fade } from 'svelte/transition';
  import { page } from '$app/state';
  import { goto, invalidateAll } from '$app/navigation';
  import Icon from './Icon.svelte';
  import {
    FILTERS,
    SORTS,
    CHANNELS,
    COLUMNS,
    DEFAULT_COLUMNS,
    researchColumns,
    sortState,
    lastChannel,
    channelOf,
    stageOf,
    leadName,
    linkFor,
    isDue,
    sinceLabel,
    whenLabel,
    listLeads,
    listView,
    viewQuery,
    consentLabel
  } from '$lib/leads.js';
  import { CALL_OUTCOMES } from '$lib/stats.js';
  import { ddmm, money } from '$lib/fmt.js';
  import { toast } from '$lib/toast.svelte.js';

  let { leads, today, tz } = $props();

  // filter, search and sort live in the URL, so a lead page knows the order you were browsing in
  // and Back lands on the same view
  const start = listView(page.url.searchParams);
  let filter = $state(start.filter);
  let q = $state(start.q);
  let sort = $state(start.sort);
  let channel = $state(start.channel);
  let limit = $state(100);
  let adding = $state(false);
  let draft = $state({ business: '', contact: '', phone: '', suburb: '' });

  const query = $derived(viewQuery({ filter, sort, q, channel }));
  $effect(() => {
    const want = query;
    if (want !== page.url.search) goto(page.url.pathname + want, { replaceState: true, keepFocus: true, noScroll: true });
  });

  const counts = $derived(Object.fromEntries(FILTERS.map((f) => [f.key, listLeads(leads, { filter: f.key, q: '', sort, channel }, today).length])));
  const shown = $derived(listLeads(leads, { filter, q, sort, channel }, today));

  // ---- columns: which ones show, in what order. Saved in this browser, per offer. ----
  const research = $derived(researchColumns(leads));
  const allColumns = $derived([...COLUMNS, ...research]);
  const storeKey = $derived(`closer.leadColumns.${page.data.offer?.id}`);
  let chosen = $state(null);
  $effect(() => {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(storeKey) || 'null');
    } catch {}
    chosen = Array.isArray(saved) ? saved : [...DEFAULT_COLUMNS];
  });
  function persist() {
    try {
      localStorage.setItem(storeKey, JSON.stringify(chosen));
    } catch {}
  }
  const visible = $derived(
    (chosen || DEFAULT_COLUMNS).map((k) => allColumns.find((c) => c.key === k)).filter(Boolean).concat(
      // the business name always shows
      (chosen || DEFAULT_COLUMNS).includes('name') ? [] : [COLUMNS.find((c) => c.key === 'name')]
    )
  );
  function toggle(key) {
    chosen = chosen.includes(key) ? chosen.filter((k) => k !== key) : [...chosen, key];
    persist();
  }
  function move(key, by) {
    const i = chosen.indexOf(key);
    const j = i + by;
    if (i < 0 || j < 0 || j >= chosen.length) return;
    const next = [...chosen];
    [next[i], next[j]] = [next[j], next[i]];
    chosen = next;
    persist();
  }
  function reset() {
    chosen = [...DEFAULT_COLUMNS];
    persist();
  }
  let picking = $state(false);

  // ---- header sorting ----
  const sorted = $derived(sortState(sort));
  function sortBy(col) {
    if (sorted.key === col.key) sort = sorted.rev ? col.key : '-' + col.key;
    else sort = col.key;
    limit = 100;
  }
  const arrow = (col) => (sorted.key !== col.key ? '' : (col.dir === 'desc') !== sorted.rev ? 'down' : 'up');

  function openRow(e, l) {
    if (e.target.closest('a, button, input, select')) return;
    goto(`/leads/${l.id}${query}`);
  }

  const callOutcome = (k) => CALL_OUTCOMES.find((o) => o.key === k) || CALL_OUTCOMES[0];
  const tel = (p) => p.replace(/[^\d+]/g, '');
  const researchValue = (l, col) => l.extra.find(([k]) => k === col.label)?.[1] || '';

  async function add() {
    try {
      const r = await fetch('/api/leads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(draft) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || 'Could not add that lead');
      toast(`Added ${leadName(j.lead)}`);
      draft = { business: '', contact: '', phone: '', suburb: '' };
      adding = false;
      await invalidateAll();
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  const onkey = (e) => e.key === 'Escape' && picking && (picking = false);
</script>

<svelte:window onkeydown={onkey} />

<section class="panel cold">
  <div class="head">
    <div>
      <h2>Lead list</h2>
      <p class="muted small">Click a lead to open its page. Click a heading to sort by it, and pick which columns show.</p>
    </div>
    <div class="tools">
      <label class="search">
        <Icon name="search" size={16} />
        <input bind:value={q} placeholder="Business, name, suburb or number" aria-label="Search leads" />
      </label>
      <select bind:value={channel} aria-label="Contacted by">
        <option value="">Any contact</option>
        {#each CHANNELS as c}<option value={c.key}>{c.key === 'call' ? 'Called' : c.key === 'sms' ? 'Texted' : 'Emailed'}</option>{/each}
      </select>
      <select bind:value={sort} aria-label="Sort leads">
        {#each SORTS as s}<option value={s.key}>{s.label}</option>{/each}
        {#if !SORTS.some((s) => s.key === sort)}
          <option value={sort}>By {allColumns.find((c) => c.key === sorted.key)?.label || 'column'}{sorted.rev ? ', reversed' : ''}</option>
        {/if}
      </select>
      <div class="picker-wrap">
        <button class="btn small" onclick={() => (picking = !picking)} aria-expanded={picking}><Icon name="list" size={15} />Columns</button>
        {#if picking}
          <div class="scrim" role="presentation" onclick={() => (picking = false)}></div>
          <div class="picker" transition:fade={{ duration: 120 }} role="dialog" aria-label="Choose columns">
            <div class="ph">
              <strong>Columns</strong>
              <button class="btn small ghost" onclick={reset}>Reset</button>
            </div>
            <p class="faint small">Saved in this browser for this offer.</p>
            {#snippet item(c)}
              {@const on = c.fixed || chosen.includes(c.key)}
              <li class:on>
                <label>
                  <input type="checkbox" checked={on} disabled={c.fixed} onchange={() => toggle(c.key)} />
                  <span>{c.label}</span>
                </label>
                {#if on && !c.fixed && chosen.includes(c.key)}
                  <span class="mv">
                    <button onclick={() => move(c.key, -1)} aria-label="Move {c.label} left" disabled={chosen.indexOf(c.key) === 0}><Icon name="left" size={13} /></button>
                    <button onclick={() => move(c.key, 1)} aria-label="Move {c.label} right" disabled={chosen.indexOf(c.key) === chosen.length - 1}><Icon name="right" size={13} /></button>
                  </span>
                {/if}
              </li>
            {/snippet}
            <span class="grp">Lead details</span>
            <ul>{#each COLUMNS as c}{@render item(c)}{/each}</ul>
            {#if research.length}
              <span class="grp">From your spreadsheet</span>
              <ul>{#each research as c}{@render item(c)}{/each}</ul>
            {/if}
          </div>
        {/if}
      </div>
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
    <div class="scroll">
      <table>
        <thead>
          <tr>
            {#each visible as col (col.key)}
              <th class="c-{col.research ? 'x' : col.key}" aria-sort={arrow(col) === 'down' ? 'descending' : arrow(col) === 'up' ? 'ascending' : 'none'}>
                <button class="sort" class:active={sorted.key === col.key} onclick={() => sortBy(col)}>
                  {col.key === 'score' ? 'Score' : col.label}
                  <span class="ar ar-{arrow(col) || 'none'}" aria-hidden="true"><Icon name="down" size={12} /></span>
                </button>
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each shown.slice(0, limit) as l (l.id)}
            {@const st = stageOf(l)}
            <tr class="t-{st.tone}" onclick={(e) => openRow(e, l)}>
              {#each visible as col (col.key)}
                <td class="c-{col.research ? 'x' : col.key}">
                  {#if col.key === 'score'}
                    <span class="sc num" class:none={l.score == null}>{l.score ?? '–'}</span>
                  {:else if col.key === 'name'}
                    <a class="nm" href="/leads/{l.id}{query}">{leadName(l)}</a>{#if l.doNotContact?.length}<span class="dnc" title={consentLabel(l.doNotContact)}>{l.doNotContact.length === 3 ? 'DNC' : l.doNotContact.map((c) => (c === 'call' ? 'no call' : c === 'sms' ? 'no SMS' : 'no email')).join(', ')}</span>{/if}
                  {:else if col.key === 'contact'}
                    {l.contact}
                  {:else if col.key === 'phone'}
                    {#if l.phone}<a class="num tel" href="tel:{tel(l.phone)}" title="Call {l.phone}">{l.phone}</a>{/if}
                  {:else if col.key === 'status'}
                    <span class="chip"><span class="dot"></span>{st.label}{l.call?.cash ? ` ${money(l.call.cash)}` : ''}</span>
                  {:else if col.key === 'last'}
                    {#if l.lastContactAt}
                      <span class="two-line"><span>{whenLabel(l.lastContactAt, tz, false)}</span><span class="faint">{sinceLabel(l.lastContactAt, today, tz)}</span></span>
                    {:else if l.attempts}
                      <span class="faint">On sheet, no date</span>
                    {:else}
                      <span class="faint">Never</span>
                    {/if}
                  {:else if col.key === 'follow'}
                    {#if l.followUp}<span class="fu" class:due={isDue(l, today)}><Icon name="clock" size={13} />{ddmm(l.followUp)}</span>{/if}
                  {:else if col.key === 'suburb'}
                    {l.suburb}
                  {:else if col.key === 'category'}
                    {l.category}
                  {:else if col.key === 'email'}
                    {#if l.email}<a href="mailto:{l.email}" class="em">{l.email}</a>{/if}
                  {:else if col.key === 'attempts'}
                    <span class="num">{l.attempts || ''}</span>
                  {:else if col.key === 'channel'}
                    {#if lastChannel(l)}<span class="chan"><Icon name={channelOf(lastChannel(l)).icon} size={13} />{channelOf(lastChannel(l)).label}</span>{/if}
                  {:else if col.key === 'call'}
                    {#if l.call && !l.call.cancelled}
                      <span class="two-line"><span>{whenLabel(l.call.start, tz, false)}</span><span class="faint">{callOutcome(l.call.outcome).key === 'pending' ? 'Not logged' : callOutcome(l.call.outcome).label}</span></span>
                    {/if}
                  {:else if col.key === 'consent'}
                    {#if l.doNotContact?.length}<span class="dnc-cell">{consentLabel(l.doNotContact)}</span>{/if}
                  {:else if col.key === 'notes'}
                    <span class="clip" title={l.notes}>{l.notes}</span>
                  {:else if col.research}
                    {@const v = researchValue(l, col)}
                    {#if linkFor(v)}<a href={linkFor(v)} target="_blank" rel="noopener" class="clip">{v}</a>{:else}<span class="clip" title={v}>{v}</span>{/if}
                  {/if}
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#if shown.length > limit}
      <button class="btn small ghost more" onclick={() => (limit += 200)}>Show {Math.min(200, shown.length - limit)} more of {shown.length - limit}</button>
    {/if}
  {:else}
    <div class="empty">
      {#if q.trim()}
        No lead matches "{q.trim()}".
      {:else if channel}
        No lead in this list has been {channel === 'call' ? 'called' : channel === 'sms' ? 'texted' : 'emailed'} yet.
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
    min-width: 0;
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
    min-width: min(240px, 100%);
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
  .picker-wrap {
    position: relative;
  }
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 39;
  }
  .picker {
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    z-index: 40;
    width: 280px;
    max-height: min(70vh, 560px);
    overflow: auto;
    padding: 14px;
    border-radius: 14px;
    background: var(--raised);
    border: 1px solid var(--line-2);
    box-shadow: var(--shadow), 0 18px 40px -20px rgba(0, 0, 0, 0.35);
    display: grid;
    gap: 6px;
  }
  .ph {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .picker p {
    margin: 0 0 4px;
  }
  .grp {
    font-size: 11.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-3);
    margin-top: 6px;
  }
  .picker ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
  }
  .picker li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 3px 4px;
    border-radius: 8px;
  }
  .picker li:hover {
    background: var(--iron-soft);
  }
  .picker label {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 14px;
    flex: 1;
    min-width: 0;
    cursor: pointer;
  }
  .picker label span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mv {
    display: flex;
    gap: 2px;
  }
  .mv button {
    border: 0;
    background: transparent;
    color: var(--ink-3);
    padding: 3px;
    border-radius: 6px;
    display: inline-flex;
  }
  .mv button:hover:not(:disabled) {
    color: var(--ink);
    background: var(--raised);
  }
  .mv button:disabled {
    opacity: 0.3;
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

  /* ---- table ---- */
  .scroll {
    overflow-x: auto;
    border: 1px solid var(--line-2);
    border-radius: 12px;
    background: var(--raised);
  }
  table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    font-size: 13.5px;
  }
  th {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--surface);
    border-bottom: 1px solid var(--line-2);
    text-align: left;
    padding: 0;
    white-space: nowrap;
  }
  .sort {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    height: 38px;
    padding: 0 12px;
    border: 0;
    background: transparent;
    font-size: 11.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-3);
    text-align: left;
  }
  .sort:hover,
  .sort.active {
    color: var(--ink);
  }
  .ar {
    display: inline-flex;
    opacity: 0;
    transition: transform 0.15s, opacity 0.15s;
  }
  .sort:hover .ar-none {
    opacity: 0.35;
  }
  .ar-down,
  .ar-up {
    opacity: 1;
  }
  .ar-up {
    transform: rotate(180deg);
  }
  td {
    padding: 9px 12px;
    border-bottom: 1px solid var(--line-2);
    vertical-align: middle;
    white-space: nowrap;
  }
  tbody tr {
    cursor: pointer;
    transition: background 0.12s;
  }
  tbody tr:last-child td {
    border-bottom: 0;
  }
  tbody tr:hover {
    background: var(--surface);
  }
  tbody tr td:first-child {
    box-shadow: inset 4px 0 0 var(--tone);
  }
  .c-score {
    width: 56px;
  }
  .sc {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-weight: 800;
    font-size: 13px;
    background: var(--blue-soft);
    color: var(--blue);
  }
  .sc.none {
    background: var(--iron-soft);
    color: var(--ink-3);
  }
  .nm {
    font-weight: 700;
    color: var(--ink);
    text-decoration: none;
  }
  .nm:hover {
    text-decoration: underline;
  }
  td.c-name {
    max-width: 260px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .dnc {
    margin-left: 8px;
    padding: 1px 7px;
    border-radius: 999px;
    background: var(--red-soft);
    color: var(--red);
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    vertical-align: 1px;
  }
  .dnc-cell {
    color: var(--red);
    font-weight: 600;
  }
  .tel,
  .em {
    color: var(--ink-2);
    text-decoration: none;
  }
  .tel:hover,
  .em:hover {
    color: var(--blue);
    text-decoration: underline;
  }
  .two-line {
    display: grid;
    line-height: 1.25;
  }
  .two-line .faint {
    font-size: 12px;
  }
  .fu {
    display: inline-flex;
    gap: 4px;
    align-items: center;
    color: var(--ink-2);
  }
  .fu.due {
    color: var(--ink);
    font-weight: 700;
  }
  .chan {
    display: inline-flex;
    gap: 5px;
    align-items: center;
    color: var(--ink-2);
  }
  .clip {
    display: inline-block;
    max-width: 240px;
    overflow: hidden;
    text-overflow: ellipsis;
    vertical-align: bottom;
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
    .add {
      grid-template-columns: 1fr 1fr;
    }
    .picker {
      position: fixed;
      left: 12px;
      right: 12px;
      top: 80px;
      width: auto;
    }
  }
</style>
