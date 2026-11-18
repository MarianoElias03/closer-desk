<script>
  // Tap pad for DM setting, same feel as the dial session: one tap per lead, keys 1 to 4, Z undoes.
  import { fly, slide } from 'svelte/transition';
  import { tick } from 'svelte';
  import LeadHandle from '$lib/components/LeadHandle.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Stat from '$lib/components/Stat.svelte';
  import { DM_OUTCOMES } from '$lib/stats.js';
  import { pct, ddmm } from '$lib/fmt.js';
  import { toast } from '$lib/toast.svelte.js';
  import { invalidateAll } from '$app/navigation';

  let { today, day, leads = [], title = "Today's DMs" } = $props();

  const blank = () => Object.fromEntries(DM_OUTCOMES.map((o) => [o.key, 0]));
  let counts = $state(blank());
  let history = $state([]);
  let pending = 0;
  $effect(() => {
    const src = day;
    if (pending === 0) counts = { ...blank(), ...(src ? Object.fromEntries(DM_OUTCOMES.map((o) => [o.key, src[o.key]])) : {}) };
  });

  // Raw tally change (minus buttons, and "just count it" for leads you didn't save by name)
  async function tally(key, delta = 1, remember = true) {
    if (delta < 0 && counts[key] === 0) return;
    counts[key] += delta;
    if (delta > 0 && remember) history = [...history.slice(-30), { type: 'tally', key }];
    pending++;
    try {
      const r = await fetch('/api/dm/tap', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ date: today, key, delta })
      });
      if (!r.ok) throw new Error();
    } catch {
      counts[key] -= delta;
      toast('That tap did not save. Check your connection.', 'error');
    } finally {
      pending--;
      if (pending === 0) invalidateAll();
    }
  }

  // ----- who was it? -----
  let sheet = $state(null); // null | 'contacted' | 'booked' | 'converted' | 'not_converted'
  let q = $state('');
  let busy = $state(false);
  let input = $state(null);

  async function open(key) {
    sheet = key;
    q = '';
    await tick();
    input?.focus();
  }
  const close = () => (sheet = null);

  const label = (key) => DM_OUTCOMES.find((o) => o.key === key).label.toLowerCase();
  const eligible = $derived.by(() => {
    if (!sheet || sheet === 'contacted') return [];
    const ok = sheet === 'booked' ? ['contacted'] : ['contacted', 'booked'];
    const needle = q.trim().toLowerCase().replace(/^@/, '');
    return leads
      .filter((l) => ok.includes(l.status))
      .filter((l) => !needle || l.handle.toLowerCase().replace(/^@/, '').includes(needle))
      .slice(0, 8);
  });
  const exact = $derived(leads.some((l) => l.handle.toLowerCase() === q.trim().toLowerCase()));

  async function api(url, method, body) {
    const r = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.message || 'Could not save');
    return j;
  }

  async function addLead(handle, thenStatus = null) {
    if (!handle.trim()) return toast('Add their IG handle or name', 'error');
    busy = true;
    try {
      const { lead } = await api('/api/dm/leads', 'POST', { handle, date: today });
      history = [...history.slice(-30), { type: 'new', id: lead.id }];
      if (thenStatus) await api(`/api/dm/leads/${lead.id}`, 'PATCH', { status: thenStatus, date: today });
      toast(thenStatus ? `${lead.handle} added and marked ${label(thenStatus)}` : `${lead.handle} added`);
      close();
      await invalidateAll();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      busy = false;
    }
  }

  async function move(lead, status) {
    busy = true;
    try {
      await api(`/api/dm/leads/${lead.id}`, 'PATCH', { status, date: today });
      history = [...history.slice(-30), { type: 'status', id: lead.id, prev: lead.status }];
      toast(`${lead.handle}: ${label(status)}`);
      close();
      await invalidateAll();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      busy = false;
    }
  }

  function justCount() {
    tally(sheet);
    close();
  }

  async function undo() {
    const h = history.at(-1);
    if (!h) return;
    history = history.slice(0, -1);
    try {
      if (h.type === 'tally') {
        await tally(h.key, -1, false);
        toast(`Removed one ${label(h.key)}`);
      } else if (h.type === 'new') {
        await api(`/api/dm/leads/${h.id}`, 'DELETE');
        toast('Removed the lead you just added');
      } else {
        await api(`/api/dm/leads/${h.id}`, 'PATCH', { status: h.prev, date: today });
        toast('Undone');
      }
    } catch (e) {
      toast(e.message, 'error');
    }
    invalidateAll();
  }

  function onkey(e) {
    if (e.key === 'Escape' && sheet) return close();
    if (e.target.closest('input, textarea, select, dialog, [role="dialog"]') || e.metaKey || e.ctrlKey || e.altKey) return;
    const i = Number(e.key) - 1;
    if (i >= 0 && i < DM_OUTCOMES.length) {
      e.preventDefault();
      open(DM_OUTCOMES[i].key);
    } else if (e.key === 'z' || e.key === 'Backspace') {
      e.preventDefault();
      undo();
    }
  }

  const decided = $derived(counts.converted + counts.not_converted);
</script>

<svelte:window onkeydown={onkey} />

<section class="panel dmpad">
  <div class="head">
    <div>
      <h2>{title}</h2>
      <p class="muted small">Tap as each lead comes in, then add who it was. Keys 1 to 4 work too, Z undoes.</p>
    </div>
    <button class="btn small ghost" onclick={undo} disabled={!history.length}><Icon name="undo" size={15} />Undo</button>
  </div>

  <div class="pads">
    {#each DM_OUTCOMES as o, i}
      <div class="padwrap">
        <button class="pad t-{o.tone}" class:active={sheet === o.key} onclick={() => open(o.key)} aria-label="Add one {o.label}, now {counts[o.key]}">
          <span class="key">{i + 1}</span>
          <span class="count score">
            {#key counts[o.key]}
              <span in:fly={{ y: -18, duration: 320 }}>{counts[o.key]}</span>
            {/key}
          </span>
          <span class="plabel">{o.label}</span>
        </button>
        <button class="minus" onclick={() => tally(o.key, -1)} disabled={!counts[o.key]} aria-label="Take one off {o.label}">
          <Icon name="minus" size={14} />
        </button>
      </div>
    {/each}
  </div>

  {#if sheet}
    <div class="who t-{DM_OUTCOMES.find((o) => o.key === sheet).tone}" transition:slide={{ duration: 220 }}>
      {#if sheet === 'contacted'}
        <form onsubmit={(e) => (e.preventDefault(), addLead(q))}>
          <label class="field">Who messaged? IG handle or name
            <input bind:this={input} bind:value={q} placeholder="@handle or First Last" autocomplete="off" disabled={busy} />
          </label>
          <div class="acts">
            <button type="button" class="btn ghost" onclick={close}>Cancel</button>
            <button class="btn primary" disabled={busy || !q.trim()}>Save lead</button>
          </div>
        </form>
        {#if q.trim() && exact}<p class="warn">You already have a lead called {q.trim()}. Save anyway if it's someone new.</p>{/if}
      {:else}
        <label class="field">Which lead {sheet === 'booked' ? 'booked a call' : `has ${label(sheet)}`}?
          <input bind:this={input} bind:value={q} placeholder="Search by handle or name" autocomplete="off" disabled={busy}
            onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (eligible[0]) move(eligible[0], sheet); else if (q.trim()) addLead(q, sheet); } }} />
        </label>
        <ul class="picks">
          {#each eligible as l (l.id)}
            <li><button type="button" onclick={() => move(l, sheet)} disabled={busy}><LeadHandle handle={l.handle} link={false} /><span class="faint">{l.status === 'booked' ? `Booked ${ddmm(l.bookedOn)}` : `Messaged ${ddmm(l.contactedOn)}`}</span></button></li>
          {:else}
            <li class="none faint">{q.trim() ? 'No open lead matches.' : 'No open leads yet.'}</li>
          {/each}
        </ul>
        <div class="acts">
          <button type="button" class="btn ghost" onclick={close}>Cancel</button>
          <button type="button" class="btn ghost" onclick={justCount} disabled={busy}>Just count it</button>
          {#if q.trim() && !exact}<button type="button" class="btn" onclick={() => addLead(q, sheet)} disabled={busy}>Add {q.trim()} as a new lead</button>{/if}
        </div>
      {/if}
    </div>
  {/if}

  <div class="tallies">
    <Stat label="Booking rate" value={counts.contacted ? counts.booked / counts.contacted : null} format={(n) => pct(n)} size="sm" />
    <Stat label="Conversion rate" value={decided ? counts.converted / decided : null} format={(n) => pct(n)} size="sm" />
  </div>
</section>

<style>
  .dmpad {
    display: grid;
    gap: 20px;
    padding: 22px;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: start;
    gap: 12px;
  }
  .head h2,
  .head p {
    margin: 0;
  }
  .head p {
    margin-top: 4px;
  }
  .small {
    font-size: 13px;
  }
  .pads {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 10px;
  }
  .padwrap {
    position: relative;
    display: grid;
  }
  .pad {
    position: relative;
    display: grid;
    grid-template-rows: auto 1fr auto;
    justify-items: start;
    gap: 10px;
    min-height: 140px;
    padding: 14px 14px 13px;
    border-radius: 14px;
    border: 0;
    text-align: left;
    background: var(--tone);
    color: var(--on-tone);
    box-shadow: inset 0 -5px 0 rgba(0, 0, 0, 0.16), 0 6px 16px -10px var(--tone);
    transition: transform 0.18s var(--ease-spring), box-shadow 0.18s;
    overflow: hidden;
  }
  .pad::after {
    content: '';
    position: absolute;
    inset: 6px;
    border-radius: 10px;
    border: 1.5px solid rgba(255, 255, 255, 0.18);
    pointer-events: none;
  }
  .pad:hover {
    transform: translateY(-2px);
  }
  .pad:active {
    transform: translateY(2px) scale(0.97);
    box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.16);
  }
  .minus {
    position: absolute;
    top: 10px;
    right: 10px;
    z-index: 1;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    border: 0;
    background: rgba(0, 0, 0, 0.18);
    color: var(--on-tone);
    opacity: 0.85;
  }
  .minus:hover:not(:disabled) {
    opacity: 1;
    background: rgba(0, 0, 0, 0.3);
  }
  .minus:disabled {
    opacity: 0.3;
  }
  .key {
    font-size: 11.5px;
    font-weight: 700;
    opacity: 0.7;
    border: 1.5px solid currentColor;
    border-radius: 5px;
    padding: 0 5px;
    line-height: 17px;
  }
  .count {
    font-size: 46px;
    display: grid;
  }
  .count > span {
    grid-area: 1 / 1;
  }
  .plabel {
    font-weight: 700;
    font-size: 13.5px;
    line-height: 1.15;
  }
  .pad.active {
    outline: 3px solid var(--tone);
    outline-offset: 3px;
  }
  .who {
    display: grid;
    gap: 12px;
    padding: 16px;
    border-radius: 12px;
    background: var(--raised);
    border: 1px solid var(--line-2);
    border-left: 4px solid var(--tone);
  }
  .who form {
    display: grid;
    gap: 12px;
  }
  .acts {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
  }
  .warn {
    margin: 0;
    font-size: 13px;
    color: var(--ink-2);
  }
  .picks {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 4px;
  }
  .picks button {
    width: 100%;
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 9px 12px;
    border-radius: 9px;
    border: 1px solid var(--line-2);
    background: var(--surface);
    text-align: left;
    font-size: 14px;
  }
  .picks button:hover {
    border-color: var(--tone);
  }
  .picks li:first-child button {
    border-color: color-mix(in srgb, var(--tone) 60%, transparent);
  }
  .picks .none {
    font-size: 13.5px;
    padding: 4px 2px;
  }
  .tallies {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 14px;
    border-top: 1px solid var(--line-2);
    padding-top: 18px;
  }
  @media (max-width: 620px) {
    .dmpad {
      padding: 16px;
    }
    .pads {
      grid-template-columns: repeat(2, 1fr);
    }
    .pad {
      min-height: 108px;
    }
    .count {
      font-size: 38px;
    }
    .key {
      display: none;
    }
    .tallies {
      grid-template-columns: repeat(2, 1fr);
    }
  }
</style>
