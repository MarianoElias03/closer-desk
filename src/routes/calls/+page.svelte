<script>
  import { flip } from 'svelte/animate';
  import { fade, slide } from 'svelte/transition';
  import { page } from '$app/state';
  import { goto, invalidateAll } from '$app/navigation';
  import Icon from '$lib/components/Icon.svelte';
  import CallRow from '$lib/components/CallRow.svelte';
  import CallDrawer from '$lib/components/CallDrawer.svelte';
  import { dayLabel, money } from '$lib/fmt.js';
  import { dayKey } from '$lib/time.js';
  import { toast } from '$lib/toast.svelte.js';

  let { data } = $props();
  const tz = $derived(data.tz);

  const FILTERS = [
    { key: 'upcoming', label: 'Upcoming' },
    { key: 'needs', label: 'Needs outcome' },
    { key: 'past', label: 'Past' },
    { key: 'rec', label: 'With recording' }
  ];
  let filter = $state(page.url.searchParams.get('f') || 'upcoming');
  let q = $state('');

  const now = Date.now();
  const counts = $derived({
    upcoming: data.calls.filter((c) => new Date(c.end) >= now).length,
    needs: data.calls.filter((c) => new Date(c.start) < now && c.outcome === 'pending').length,
    past: data.calls.filter((c) => new Date(c.start) < now).length,
    rec: data.calls.filter((c) => c.fathom).length
  });

  const shown = $derived.by(() => {
    let list = data.calls.filter((c) => {
      const past = new Date(c.start) < now;
      if (filter === 'upcoming') return new Date(c.end) >= now;
      if (filter === 'needs') return past && c.outcome === 'pending';
      if (filter === 'past') return past;
      if (filter === 'rec') return !!c.fathom;
      return true;
    });
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      list = list.filter((c) => [c.prospect, c.email, c.phone, c.title].some((x) => x?.toLowerCase().includes(s)));
    }
    if (filter !== 'upcoming') list = [...list].reverse();
    const groups = [];
    for (const c of list) {
      const k = dayKey(c.start, tz);
      if (groups.at(-1)?.key !== k) groups.push({ key: k, calls: [] });
      groups.at(-1).calls.push(c);
    }
    return groups;
  });

  function setFilter(k) {
    filter = k;
    const u = new URL(page.url);
    u.searchParams.set('f', k);
    goto(u, { replaceState: true, noScroll: true, keepFocus: true });
  }

  let openId = $state(null);
  const openCall = $derived(openId ? data.calls.find((c) => c.id === openId) : null);

  // add a call that is not on the calendar
  let adding = $state(false);
  let form = $state({ prospect: '', phone: '', email: '', date: '', time: '', kind: 'GamePlan Call' });
  async function addCall(e) {
    e.preventDefault();
    if (!form.prospect || !form.date || !form.time) return toast('Add a name, date and time', 'error');
    const start = new Date(`${form.date}T${form.time}:00+10:00`).toISOString();
    const end = new Date(new Date(start).getTime() + 45 * 60000).toISOString();
    const r = await fetch('/api/calls', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...form, start, end })
    });
    if (!r.ok) return toast('Could not add the call', 'error');
    toast(`Added ${form.prospect}`);
    adding = false;
    form = { prospect: '', phone: '', email: '', date: '', time: '', kind: 'GamePlan Call' };
    invalidateAll();
  }
</script>

<svelte:head><title>Calls · Closer Desk</title></svelte:head>

<header class="top">
  <div>
    <h1>Calls</h1>
    <p class="muted">Every sales call from your calendar. Open one to log the outcome, cash and notes, and to see its Fathom recording.</p>
  </div>
  <button class="btn" onclick={() => (adding = !adding)}><Icon name="plus" size={16} />Add a call</button>
</header>

{#if adding}
  <form class="panel add" onsubmit={addCall} transition:slide={{ duration: 260 }}>
    <label class="field">Name<input bind:value={form.prospect} required /></label>
    <label class="field">Phone<input bind:value={form.phone} inputmode="tel" /></label>
    <label class="field">Email<input bind:value={form.email} type="email" /></label>
    <label class="field">Date<input bind:value={form.date} type="date" required /></label>
    <label class="field">Time<input bind:value={form.time} type="time" required /></label>
    <label class="field">Type<select bind:value={form.kind}><option>GamePlan Call</option><option>Discovery Call</option><option>Follow-up</option></select></label>
    <div class="add-actions">
      <button type="button" class="btn ghost" onclick={() => (adding = false)}>Cancel</button>
      <button class="btn primary">Add call</button>
    </div>
  </form>
{/if}

<div class="bar">
  <div class="tabs" role="tablist">
    {#each FILTERS as f}
      <button role="tab" aria-selected={filter === f.key} class:on={filter === f.key} onclick={() => setFilter(f.key)}>
        {f.label}<span class="n num" class:alert={f.key === 'needs' && counts.needs}>{counts[f.key]}</span>
      </button>
    {/each}
  </div>
  <label class="search">
    <Icon name="search" size={16} />
    <input bind:value={q} placeholder="Search name, phone or email" aria-label="Search calls" />
  </label>
</div>

{#if shown.length}
  {#each shown as g (g.key)}
    <section class="day" in:fade={{ duration: 200 }}>
      <h3>
        {dayLabel(g.key, { weekday: 'long', day: 'numeric', month: 'long' })}
        {#if g.key === data.today}<span class="today">Today</span>{/if}
      </h3>
      <div class="list">
        {#each g.calls as c (c.id)}
          <div animate:flip={{ duration: 260 }}>
            <CallRow call={c} {tz} onopen={(x) => (openId = x.id)} />
          </div>
        {/each}
      </div>
    </section>
  {/each}
{:else}
  <div class="empty panel">
    {#if q}
      <p>No calls match "{q}".</p>
    {:else if filter === 'needs'}
      <p><strong>Every past call has an outcome.</strong></p>
    {:else}
      <p><strong>No calls here yet.</strong></p>
      <p class="muted">Press Sync now to pull your calendar, or add a call by hand.</p>
    {/if}
  </div>
{/if}

{#if openCall}
  <CallDrawer call={openCall} {tz} recordings={data.recordings} onclose={() => (openId = null)} />
{/if}

<style>
  .top {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: end;
    gap: 16px;
    margin-bottom: 22px;
  }
  .top p {
    margin: 8px 0 0;
    max-width: 62ch;
  }
  .add {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 14px;
    padding: 20px;
    margin-bottom: 20px;
  }
  .add-actions {
    grid-column: 1 / -1;
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 18px;
  }
  .tabs {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 4px;
    border-radius: 12px;
    background: var(--surface);
    border: 1px solid var(--line-2);
  }
  .tabs button {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 12px;
    border: 0;
    border-radius: 9px;
    background: transparent;
    font-weight: 600;
    font-size: 14px;
    color: var(--ink-2);
    transition: background 0.2s, color 0.2s;
  }
  .tabs button.on {
    background: var(--ink);
    color: var(--chalk);
  }
  .n {
    font-size: 12px;
    font-weight: 700;
    opacity: 0.75;
  }
  .n.alert {
    color: #fff;
    background: var(--red);
    border-radius: 999px;
    padding: 0 7px;
    opacity: 1;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 42px;
    padding: 0 12px;
    border-radius: 12px;
    border: 1px solid var(--line-2);
    background: var(--surface);
    color: var(--ink-3);
    min-width: min(320px, 100%);
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
  .day {
    margin-bottom: 22px;
  }
  .day h3 {
    display: flex;
    gap: 10px;
    align-items: center;
    margin-bottom: 10px;
    font-size: 14px;
    color: var(--ink-2);
  }
  .today {
    font-size: 11.5px;
    color: #fff;
    background: var(--blue);
    padding: 1px 8px;
    border-radius: 999px;
  }
  .list {
    display: grid;
    gap: 8px;
  }
  .empty {
    padding: 28px;
    text-align: center;
  }
  .empty p {
    margin: 0 0 4px;
  }
  @media (max-width: 700px) {
    .add {
      grid-template-columns: 1fr 1fr;
    }
  }
</style>
