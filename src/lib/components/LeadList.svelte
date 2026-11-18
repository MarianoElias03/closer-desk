<script>
  import { flip } from 'svelte/animate';
  import { fade, slide } from 'svelte/transition';
  import { invalidateAll } from '$app/navigation';
  import Icon from './Icon.svelte';
  import LeadHandle from './LeadHandle.svelte';
  import { DM_OUTCOMES } from '$lib/stats.js';
  import { ddmm, dayLabel } from '$lib/fmt.js';
  import { toast } from '$lib/toast.svelte.js';

  let { leads, today } = $props();

  const STATUS = {
    contacted: { label: 'Messaged', tone: 'iron' },
    booked: { label: 'Booked', tone: 'blue' },
    converted: { label: 'Converted', tone: 'green' },
    not_converted: { label: 'Not converted', tone: 'red' }
  };
  const FILTERS = [
    { key: 'open', label: 'Open', test: (l) => l.status === 'contacted' || l.status === 'booked' },
    { key: 'booked', label: 'Booked', test: (l) => l.status === 'booked' },
    { key: 'converted', label: 'Converted', test: (l) => l.status === 'converted' },
    { key: 'not_converted', label: 'Not converted', test: (l) => l.status === 'not_converted' },
    { key: 'all', label: 'All', test: () => true }
  ];
  let filter = $state('open');
  let q = $state('');
  let expanded = $state(null);
  let notes = $state('');
  let handle = $state('');

  const counts = $derived(Object.fromEntries(FILTERS.map((f) => [f.key, leads.filter(f.test).length])));
  const shown = $derived.by(() => {
    const f = FILTERS.find((x) => x.key === filter);
    const needle = q.trim().toLowerCase().replace(/^@/, '');
    return leads.filter(f.test).filter((l) => !needle || l.handle.toLowerCase().replace(/^@/, '').includes(needle) || l.notes.toLowerCase().includes(needle));
  });

  async function api(id, method, body) {
    const r = await fetch(`/api/dm/leads/${id}`, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.message || 'Could not save');
    return j;
  }
  async function setStatus(l, status) {
    if (status === l.status) return;
    try {
      await api(l.id, 'PATCH', { status, date: today });
      toast(`${l.handle}: ${STATUS[status].label.toLowerCase()}`);
      invalidateAll();
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  function toggle(l) {
    if (expanded === l.id) return (expanded = null);
    expanded = l.id;
    notes = l.notes;
    handle = l.handle;
  }
  async function save(l) {
    try {
      await api(l.id, 'PATCH', { handle, notes });
      toast('Lead saved');
      expanded = null;
      invalidateAll();
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  async function remove(l) {
    if (!confirm(`Delete ${l.handle}? Their taps come off the daily numbers too.`)) return;
    try {
      await api(l.id, 'DELETE');
      toast(`Deleted ${l.handle}`);
      expanded = null;
      invalidateAll();
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  const since = (l) =>
    l.status === 'contacted'
      ? `Messaged ${dayLabel(l.contactedOn, { day: 'numeric', month: 'short' })}`
      : l.status === 'booked'
        ? `Messaged ${ddmm(l.contactedOn)}, booked ${ddmm(l.bookedOn)}`
        : `Messaged ${ddmm(l.contactedOn)}, decided ${ddmm(l.outcomeOn)}`;
</script>

<section class="panel leads">
  <div class="head">
    <div>
      <h2>Leads</h2>
      <p class="muted small">Everyone you've saved from the Contacted button. Change a lead's status here and the day's numbers follow.</p>
    </div>
    <label class="search">
      <Icon name="search" size={16} />
      <input bind:value={q} placeholder="Find a handle or name" aria-label="Search leads" />
    </label>
  </div>

  <div class="tabs" role="tablist">
    {#each FILTERS as f}
      <button role="tab" aria-selected={filter === f.key} class:on={filter === f.key} onclick={() => (filter = f.key)}>
        {f.label}<span class="n num">{counts[f.key]}</span>
      </button>
    {/each}
  </div>

  {#if shown.length}
    <ul class="list">
      {#each shown as l (l.id)}
        <li class="t-{STATUS[l.status].tone}" animate:flip={{ duration: 260 }} in:fade={{ duration: 180 }}>
          <div class="row">
            <button class="who" onclick={() => toggle(l)} aria-expanded={expanded === l.id}>
              <LeadHandle handle={l.handle} link={false} />
              <span class="faint since">{since(l)}{l.notes ? ', has notes' : ''}</span>
            </button>
            <div class="status" role="radiogroup" aria-label="Status for {l.handle}">
              {#each Object.entries(STATUS) as [key, st]}
                <button role="radio" aria-checked={l.status === key} class="t-{st.tone}" class:on={l.status === key} onclick={() => setStatus(l, key)}>
                  <i></i>{st.label}
                </button>
              {/each}
            </div>
          </div>
          {#if expanded === l.id}
            <div class="edit" transition:slide={{ duration: 200 }}>
              <label class="field">IG handle or name<input bind:value={handle} /></label>
              <label class="field">Notes<textarea bind:value={notes} placeholder="What they want, objections, when to follow up"></textarea></label>
              <div class="acts">
                {#if /^@[A-Za-z0-9._]{1,30}$/.test(l.handle)}
                  <a class="btn small ghost" href="https://instagram.com/{l.handle.slice(1)}" target="_blank" rel="noopener"><Icon name="external" size={14} />Open profile</a>
                {/if}
                <button class="btn small ghost danger" onclick={() => remove(l)}>Delete lead</button>
                <button class="btn small primary" onclick={() => save(l)}><Icon name="check" size={14} />Save</button>
              </div>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {:else}
    <div class="empty">
      {#if q.trim()}
        No lead matches "{q.trim()}".
      {:else if !leads.length}
        <strong>No leads saved yet.</strong> Tap Contacted when someone messages you, and add their IG handle or name.
      {:else}
        Nothing in this list right now.
      {/if}
    </div>
  {/if}
</section>

<style>
  .leads {
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
    align-items: start;
  }
  .head p {
    margin: 4px 0 0;
  }
  .small {
    font-size: 13px;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 40px;
    padding: 0 12px;
    border-radius: 12px;
    border: 1px solid var(--line-2);
    background: var(--raised);
    color: var(--ink-3);
    min-width: min(280px, 100%);
  }
  .search input {
    border: 0;
    background: transparent;
    outline: none;
    flex: 1;
    color: var(--ink);
  }
  .search:focus-within {
    border-color: var(--focus);
  }
  .tabs {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 4px;
    border-radius: 12px;
    background: var(--raised);
    border: 1px solid var(--line-2);
    justify-self: start;
  }
  .tabs button {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 32px;
    padding: 0 12px;
    border: 0;
    border-radius: 9px;
    background: transparent;
    font-weight: 600;
    font-size: 13.5px;
    color: var(--ink-2);
    transition: background 0.2s, color 0.2s;
  }
  .tabs button.on {
    background: var(--ink);
    color: var(--chalk);
  }
  .n {
    font-size: 12px;
    opacity: 0.75;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }
  .list > li {
    position: relative;
    border-radius: 12px;
    background: var(--raised);
    border: 1px solid var(--line-2);
    padding: 10px 12px 10px 18px;
  }
  .list > li::before {
    content: '';
    position: absolute;
    left: 0;
    top: 10px;
    bottom: 10px;
    width: 4px;
    border-radius: 0 4px 4px 0;
    background: var(--tone);
    transition: background 0.25s;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px 16px;
  }
  .who {
    display: grid;
    gap: 2px;
    min-width: 0;
    padding: 0;
    border: 0;
    background: none;
    text-align: left;
    font-size: 15px;
  }
  .who:hover :global(.h) {
    color: var(--blue);
  }
  .since {
    font-size: 12.5px;
  }
  .status {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
  .status button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 10px;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: transparent;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--ink-2);
    transition: background 0.18s, border-color 0.18s, color 0.18s, transform 0.25s var(--ease-spring);
  }
  .status i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--tone);
  }
  .status button:hover {
    border-color: var(--tone);
    color: var(--ink);
  }
  .status button.on {
    background: var(--tone);
    border-color: var(--tone);
    color: var(--on-tone);
    transform: scale(1.04);
  }
  .status button.on i {
    background: currentColor;
  }
  .edit {
    display: grid;
    gap: 10px;
    padding-top: 12px;
    margin-top: 10px;
    border-top: 1px solid var(--line-2);
  }
  .edit textarea {
    min-height: 70px;
  }
  .acts {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
  }
  .danger {
    color: var(--red);
  }
  .empty {
    padding: 18px;
    border-radius: 12px;
    border: 1.5px dashed var(--line);
    font-size: 14px;
    color: var(--ink-2);
  }
  @media (max-width: 620px) {
    .leads {
      padding: 16px;
    }
  }
</style>
