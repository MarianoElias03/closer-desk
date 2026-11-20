<script>
  import { slide } from 'svelte/transition';
  import { page } from '$app/state';
  import { goto, invalidateAll } from '$app/navigation';
  import Icon from './Icon.svelte';
  import { FILTERS, SORTS, stageOf, leadName, isDue, sinceLabel, listLeads, listView, viewQuery } from '$lib/leads.js';
  import { ddmm, money } from '$lib/fmt.js';
  import { toast } from '$lib/toast.svelte.js';

  let { leads, today, tz } = $props();

  // filter, search and sort live in the URL, so a lead page knows the order you were browsing in
  // and Back lands on the same view
  const start = listView(page.url.searchParams);
  let filter = $state(start.filter);
  let q = $state(start.q);
  let sort = $state(start.sort);
  let limit = $state(100);
  let adding = $state(false);
  let draft = $state({ business: '', contact: '', phone: '', suburb: '' });

  const query = $derived(viewQuery({ filter, sort, q }));
  $effect(() => {
    const want = query;
    if (want !== page.url.search) goto(page.url.pathname + want, { replaceState: true, keepFocus: true, noScroll: true });
  });

  const counts = $derived(Object.fromEntries(FILTERS.map((f) => [f.key, leads.filter((l) => f.test(l, today)).length])));
  const shown = $derived(listLeads(leads, { filter, q, sort }, today));

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
</script>

<section class="panel cold">
  <div class="head">
    <div>
      <h2>Lead list</h2>
      <p class="muted small">Everything on this offer's call list. Click a lead to open its page.</p>
    </div>
    <div class="tools">
      <label class="search">
        <Icon name="search" size={16} />
        <input bind:value={q} placeholder="Business, name, suburb or number" aria-label="Search leads" />
      </label>
      <select bind:value={sort} aria-label="Sort leads">
        {#each SORTS as s}<option value={s.key}>{s.label}</option>{/each}
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
        <li class="t-{st.tone}">
          <a class="row" href="/leads/{l.id}{query}">
            <span class="sc num" class:none={l.score == null}>{l.score ?? '–'}</span>
            <span class="nm">
              <strong>{leadName(l)}</strong>
              <span class="faint">{[l.business && l.contact, l.suburb, l.category].filter(Boolean).join(', ')}</span>
            </span>
            <span class="ph num faint">{l.phone}</span>
            <span class="meta">
              <span class="chip"><span class="dot"></span>{st.label}{l.call?.cash ? ` ${money(l.call.cash)}` : ''}</span>
              {#if l.followUp && !l.call}<span class="fu" class:due={isDue(l, today)}><Icon name="clock" size={13} />{ddmm(l.followUp)}</span>{/if}
              {#if l.lastContactAt}<span class="faint at" title="Last contacted">{sinceLabel(l.lastContactAt, today, tz)}</span>{:else if l.attempts}<span class="faint at">{l.attempts}x</span>{/if}
              <span class="go" aria-hidden="true"><Icon name="right" size={16} /></span>
            </span>
          </a>
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
    transition: box-shadow 0.15s, transform 0.15s var(--ease-out);
  }
  li:hover {
    box-shadow: var(--shadow);
    transform: translateX(2px);
  }
  .row {
    width: 100%;
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr) 130px auto;
    gap: 12px;
    align-items: center;
    padding: 10px 12px 10px 10px;
    text-decoration: none;
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
  .go {
    display: inline-flex;
    color: var(--ink-3);
  }
  li:hover .go {
    color: var(--ink);
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
    .ph,
    .at {
      display: none;
    }
    .add {
      grid-template-columns: 1fr 1fr;
    }
  }
</style>
