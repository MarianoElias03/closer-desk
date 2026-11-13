<script>
  import { fly } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import Icon from '$lib/components/Icon.svelte';
  import Stat from '$lib/components/Stat.svelte';
  import StackBar from '$lib/components/StackBar.svelte';
  import CallRow from '$lib/components/CallRow.svelte';
  import CallDrawer from '$lib/components/CallDrawer.svelte';
  import DmPad from '$lib/components/DmPad.svelte';
  import { SDR_OUTCOMES, sdrSummary, closeSummary, dmSummary, sdrTotal, sdrSpoken } from '$lib/stats.js';
  import { pct, money, num, dayLabel, monthLabel } from '$lib/fmt.js';
  import { dayKey } from '$lib/time.js';
  import { toast } from '$lib/toast.svelte.js';
  import { invalidateAll } from '$app/navigation';

  let { data } = $props();
  const tz = $derived(data.tz);

  // Dial session — optimistic counts, server is the source of truth.
  const blank = () => Object.fromEntries(SDR_OUTCOMES.map((o) => [o.key, 0]));
  let counts = $state(blank());
  let history = $state([]);
  let pulse = $state(null);
  let pending = 0;
  $effect(() => {
    const src = data.sdrToday;
    if (pending === 0) counts = { ...blank(), ...(src ? Object.fromEntries(SDR_OUTCOMES.map((o) => [o.key, src[o.key]])) : {}) };
  });

  async function tap(key, delta = 1) {
    if (delta < 0 && counts[key] === 0) return;
    counts[key] += delta;
    pulse = { key, n: Date.now() };
    if (delta > 0) history = [...history.slice(-30), key];
    pending++;
    try {
      const r = await fetch('/api/sdr/tap', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ date: data.today, key, delta })
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
  function undo() {
    const key = history.at(-1);
    if (!key) return;
    history = history.slice(0, -1);
    tap(key, -1);
    toast(`Removed one ${SDR_OUTCOMES.find((o) => o.key === key).label.toLowerCase()}`);
  }
  function onkey(e) {
    if (!has('sdr') || open || e.target.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
    const i = Number(e.key) - 1;
    if (i >= 0 && i < SDR_OUTCOMES.length) {
      e.preventDefault();
      tap(SDR_OUTCOMES[i].key);
    } else if (e.key === 'z' || e.key === 'Backspace') {
      e.preventDefault();
      undo();
    }
  }

  const total = $derived(sdrTotal(counts));
  const spoken = $derived(sdrSpoken(counts));
  const segments = $derived(SDR_OUTCOMES.map((o) => ({ key: o.key, label: o.label, tone: o.tone, value: counts[o.key] })));

  const sdrM = $derived(sdrSummary(data.sdrMonth, data.meta.sdr));
  const closeM = $derived(closeSummary(data.closeMonth, data.meta.close));
  const dmM = $derived(dmSummary(data.dmMonth, data.meta.dm));
  const has = (role) => data.offer.roles.includes(role);

  const nextCall = $derived(data.calls.find((c) => new Date(c.end) > new Date()));
  let open = $state(null);
  // keep drawer data fresh after invalidation
  const openCall = $derived(open ? [...data.calls, ...data.upcoming, ...data.needsOutcome].find((c) => c.id === open.id) || open : null);

  const hour = Number(new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Brisbane', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  const greeting = hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Evening';
</script>

<svelte:window onkeydown={onkey} />
<svelte:head><title>Today · Closer Desk</title></svelte:head>

<header class="top">
  <div>
    <p class="muted greet">{greeting}{data.ownerName ? `, ${data.ownerName}` : ''}</p>
    <h1>{dayLabel(data.today, { weekday: 'long', day: 'numeric', month: 'long' })}</h1>
  </div>
  <p class="muted daysum">
    {data.calls.length} {data.calls.length === 1 ? 'call' : 'calls'} on the calendar today{#if data.needsOutcome.length}, <a href="/calls?f=needs">{data.needsOutcome.length} {data.needsOutcome.length === 1 ? 'call' : 'calls'} from the last week still {data.needsOutcome.length === 1 ? 'needs' : 'need'} an outcome</a>{/if}
  </p>
</header>

<div class="grid" class:solo={!has('sdr') && !has('dm')}>
  {#if !has('sdr') && has('dm')}
  <DmPad today={data.today} day={data.dmToday} />
  {/if}
  {#if has('sdr')}
  <section class="panel dial">
    <div class="dial-head">
      <div>
        <h2>Dial session</h2>
        <p class="muted small">Tap after every dial. Keys 1 to 5 work too, Z undoes.</p>
      </div>
      <button class="btn small ghost" onclick={undo} disabled={!history.length}><Icon name="undo" size={15} />Undo</button>
    </div>

    <div class="pads">
      {#each SDR_OUTCOMES as o, i}
        <button class="pad t-{o.tone}" onclick={() => tap(o.key)} aria-label="Log {o.label}, now {counts[o.key]}">
          <span class="key">{i + 1}</span>
          <span class="count score">
            {#key counts[o.key]}
              <span in:fly={{ y: -18, duration: 320 }}>{counts[o.key]}</span>
            {/key}
          </span>
          <span class="plabel">{o.label}</span>
        </button>
      {/each}
    </div>

    <StackBar {segments} height={16} {pulse} showLegend={false} />

    <div class="tallies">
      <Stat label="Dials" value={total} size="sm" />
      <Stat label="Spoken with" value={spoken} size="sm" />
      <Stat label="Pick-up rate" value={total ? spoken / total : null} format={(n) => pct(n)} size="sm" />
      <Stat label="Booked" value={counts.booked} tone="blue" size="sm" />
    </div>
  </section>
  {/if}

  <section class="panel calls">
    <div class="sec-head">
      <h2>Today's calls</h2>
      <a class="btn small ghost" href="/calendar">Week view</a>
    </div>
    {#if data.calls.length}
      <div class="list">
        {#each data.calls as c (c.id)}
          <div animate:flip={{ duration: 250 }}>
            <CallRow call={c} {tz} onopen={(x) => (open = x)} next={nextCall?.id === c.id} />
          </div>
        {/each}
      </div>
    {:else}
      <div class="empty">
        <p><strong>No sales calls on the calendar today.</strong></p>
        <p class="muted">Calls with "GamePlan Call" or "Discovery Call" in the title show up here after each sync. You can change those words in Settings.</p>
      </div>
    {/if}

    {#if data.upcoming.length}
      <h3 class="later">Coming up</h3>
      <ul class="upcoming">
        {#each data.upcoming as c (c.id)}
          <li>
            <button onclick={() => (open = c)}>
              <span class="num d">{dayLabel(dayKey(c.start, tz), { weekday: 'short', day: 'numeric' })}</span>
              <span class="n">{c.prospect}</span>
              <span class="faint k">{c.kind}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="panel month">
    <div class="sec-head">
      <h2>{monthLabel(data.month)} so far</h2>
    </div>
    <div class="month-cols">
      {#if has('dm')}
      <a class="mcol" href="/dm">
        <h3><Icon name="chat" size={16} />DM Setting</h3>
        <div class="mstats">
          <Stat label="Contacted us" value={dmM.contacted} />
          <Stat label="Booked" value={dmM.booked} tone="blue" />
          <Stat label="Converted" value={dmM.converted} tone="green" />
          <Stat label="Conversion rate" value={dmM.conversionRate} format={(n) => pct(n)} />
        </div>
      </a>
      {/if}
      {#if has('sdr')}
      <a class="mcol" href="/sdr">
        <h3><Icon name="phone" size={16} />Dialling</h3>
        <div class="mstats">
          <Stat label="Dials" value={sdrM.total} />
          <Stat label="Pick-up rate" value={sdrM.pickupRate} format={(n) => pct(n)} />
          <Stat label="Booked" value={sdrM.booked} tone="blue" />
          <Stat label="Booking rate" value={sdrM.bookingRate} format={(n) => pct(n)} />
        </div>
      </a>
      {/if}
      {#if has('closing')}
      <a class="mcol" href="/closing">
        <h3><Icon name="handshake" size={16} />Closing</h3>
        <div class="mstats">
          <Stat label="Calls" value={closeM.calls} />
          <Stat label="Show rate" value={closeM.showRate} format={(n) => pct(n)} />
          <Stat label="Closed" value={closeM.closed} tone="green" />
          <Stat label="Cash collected" value={closeM.cash} format={(n) => money(n)} tone="green" />
        </div>
      </a>
      {/if}
    </div>
  </section>
</div>

{#if openCall}
  <CallDrawer call={openCall} {tz} recordings={data.recordings} onclose={() => (open = null)} />
{/if}

<style>
  .top {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: end;
    gap: 10px 24px;
    margin-bottom: 26px;
  }
  .greet {
    margin: 0 0 6px;
    font-weight: 600;
  }
  .daysum {
    margin: 0;
    font-size: 14px;
  }
  .daysum a {
    color: var(--red);
    font-weight: 600;
  }
  .small {
    font-size: 13.5px;
    margin: 4px 0 0;
  }
  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
    gap: 20px;
    align-items: start;
  }
  .grid.solo {
    grid-template-columns: minmax(0, 1fr);
  }
  .panel {
    padding: 22px;
  }
  .dial {
    display: grid;
    gap: 20px;
  }
  .dial-head,
  .sec-head {
    display: flex;
    justify-content: space-between;
    align-items: start;
    gap: 12px;
  }
  .sec-head {
    align-items: center;
    margin-bottom: 14px;
  }
  .pads {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 10px;
  }
  .pad {
    position: relative;
    display: grid;
    grid-template-rows: auto 1fr auto;
    justify-items: start;
    gap: 10px;
    min-height: 148px;
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
    /* plate rim */
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
  .tallies {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 14px;
    padding-top: 4px;
    border-top: 1px solid var(--line-2);
    padding-top: 18px;
  }
  .list {
    display: grid;
    gap: 8px;
  }
  .empty {
    padding: 18px;
    border-radius: 12px;
    border: 1.5px dashed var(--line);
    font-size: 14px;
  }
  .empty p {
    margin: 0 0 4px;
  }
  .later {
    margin: 22px 0 8px;
    font-size: 13.5px;
    color: var(--ink-2);
  }
  .upcoming {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
  }
  .upcoming button {
    width: 100%;
    display: grid;
    grid-template-columns: 74px 1fr auto;
    gap: 12px;
    padding: 9px 4px;
    background: none;
    border: 0;
    border-bottom: 1px solid var(--line-2);
    text-align: left;
    font-size: 14px;
  }
  .upcoming li:last-child button {
    border-bottom: 0;
  }
  .upcoming button:hover .n {
    color: var(--blue);
  }
  .d {
    font-weight: 700;
    color: var(--ink-2);
  }
  .n {
    font-weight: 600;
  }
  .k {
    font-size: 12.5px;
  }
  .month {
    grid-column: 1 / -1;
  }
  .month-cols {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 20px;
  }
  .mcol {
    text-decoration: none;
    padding: 18px;
    border-radius: 12px;
    background: var(--raised);
    border: 1px solid var(--line-2);
    transition: border-color 0.15s;
  }
  .mcol:hover {
    border-color: var(--line);
  }
  .mcol h3 {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-bottom: 16px;
    color: var(--ink-2);
  }
  .mstats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 14px;
  }
  @media (max-width: 1180px) {
    .grid,
    .month-cols {
      grid-template-columns: 1fr;
    }
  }
  @media (max-width: 620px) {
    .pads {
      grid-template-columns: repeat(6, 1fr);
    }
    .pad {
      grid-column: span 2;
      min-height: 112px;
    }
    .pad:nth-child(4),
    .pad:nth-child(5) {
      grid-column: span 3;
    }
    .count {
      font-size: 38px;
    }
    .key {
      display: none;
    }
    .tallies,
    .mstats {
      grid-template-columns: repeat(2, 1fr);
    }
    .panel {
      padding: 16px;
    }
  }
</style>
