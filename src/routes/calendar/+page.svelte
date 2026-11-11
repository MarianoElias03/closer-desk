<script>
  import { fade, scale } from 'svelte/transition';
  import Icon from '$lib/components/Icon.svelte';
  import CallDrawer from '$lib/components/CallDrawer.svelte';
  import CallRow from '$lib/components/CallRow.svelte';
  import { CALL_OUTCOMES } from '$lib/stats.js';
  import { dayLabel, time } from '$lib/fmt.js';
  import { addDays, dayKey, tzOffset } from '$lib/time.js';

  let { data } = $props();
  const tz = $derived(data.tz);
  const days = $derived(Array.from({ length: 7 }, (_, i) => addDays(data.week, i)));

  const minutesOf = (iso) => {
    const d = new Date(iso);
    const local = new Date(d.getTime() + tzOffset(d, tz) * 60000);
    return local.getUTCHours() * 60 + local.getUTCMinutes();
  };

  const byDay = $derived.by(() => {
    const m = Object.fromEntries(days.map((d) => [d, []]));
    const laneOf = {};
    const lanesOf = {};
    for (const c of data.calls) m[dayKey(c.start, tz)]?.push(c);
    // side-by-side lanes for overlapping calls
    for (const list of Object.values(m)) {
      const lanes = [];
      for (const c of list) {
        const s = minutesOf(c.start);
        let lane = lanes.findIndex((end) => end <= s);
        if (lane < 0) lane = lanes.push(0) - 1;
        lanes[lane] = s + Math.max(30, (new Date(c.end) - new Date(c.start)) / 60000);
        laneOf[c.id] = lane;
      }
      for (const c of list) lanesOf[c.id] = lanes.length;
    }
    return { m, laneOf, lanesOf };
  });

  const range = $derived.by(() => {
    let lo = 8 * 60,
      hi = 20 * 60;
    for (const c of data.calls) {
      lo = Math.min(lo, Math.floor(minutesOf(c.start) / 60) * 60);
      hi = Math.max(hi, Math.ceil((minutesOf(c.start) + 60) / 60) * 60);
    }
    return { lo, hi: Math.min(hi, 24 * 60) };
  });
  const hours = $derived(Array.from({ length: (range.hi - range.lo) / 60 }, (_, i) => range.lo / 60 + i));
  const PX = 1.5; // px per minute

  const tone = (c) => CALL_OUTCOMES.find((o) => o.key === c.outcome)?.tone || 'none';
  const nowMin = $derived(minutesOf(new Date().toISOString()));

  let openId = $state(null);
  const openCall = $derived(openId ? data.calls.find((c) => c.id === openId) : null);
  const weekLabel = $derived(`${dayLabel(days[0], { day: 'numeric', month: 'short' })} to ${dayLabel(days[6], { day: 'numeric', month: 'short', year: 'numeric' })}`);
</script>

<svelte:head><title>Calendar · Closer Desk</title></svelte:head>

<header class="top">
  <div>
    <h1>Calendar</h1>
    <p class="muted">{data.calls.length} sales {data.calls.length === 1 ? 'call' : 'calls'}, {weekLabel}</p>
  </div>
  <div class="nav">
    <a class="btn small" href="/calendar?w={addDays(data.week, -7)}" aria-label="Previous week" data-sveltekit-noscroll><Icon name="left" size={16} /></a>
    <a class="btn small" href="/calendar" data-sveltekit-noscroll>This week</a>
    <a class="btn small" href="/calendar?w={addDays(data.week, 7)}" aria-label="Next week" data-sveltekit-noscroll><Icon name="right" size={16} /></a>
  </div>
</header>

<div class="legend">
  {#each CALL_OUTCOMES as o}<span class="t-{o.tone}"><i></i>{o.label}</span>{/each}
</div>

{#key data.week}
  <div class="panel week" in:fade={{ duration: 220 }}>
    <div class="heads">
      <span></span>
      {#each days as d}
        <span class="dh" class:today={d === data.today}>
          <small>{dayLabel(d, { weekday: 'short' })}</small>
          <b class="num">{Number(d.slice(8))}</b>
        </span>
      {/each}
    </div>
    <div class="body" style:height="{(range.hi - range.lo) * PX}px">
      <div class="gutter">
        {#each hours as h}
          <span style:top="{(h * 60 - range.lo) * PX}px">{h === 12 ? '12pm' : h > 12 ? `${h - 12}pm` : `${h}am`}</span>
        {/each}
      </div>
      {#each days as d, di}
        <div class="daycol" class:today={d === data.today}>
          {#each hours as h}<span class="hl" style:top="{(h * 60 - range.lo) * PX}px"></span>{/each}
          {#if d === data.today && nowMin >= range.lo && nowMin <= range.hi}
            <span class="now" style:top="{(nowMin - range.lo) * PX}px"></span>
          {/if}
          {#each byDay.m[d] as c, i (c.id)}
            {@const top = (minutesOf(c.start) - range.lo) * PX}
            {@const h = Math.max(26, ((new Date(c.end) - new Date(c.start)) / 60000) * PX - 2)}
            <button
              class="ev t-{tone(c)}"
              class:pending={c.outcome === 'pending'}
              class:short={h < 46}
              style:top="{top}px"
              style:height="{h}px"
              style:left="calc({(byDay.laneOf[c.id] / byDay.lanesOf[c.id]) * 100}% + 2px)"
              style:width="calc({100 / byDay.lanesOf[c.id]}% - 4px)"
              onclick={() => (openId = c.id)}
              in:scale={{ start: 0.85, duration: 260, delay: di * 30 + i * 20 }}
            >
              <b>{c.prospect}</b>
              <span class="num">{time(c.start, tz)}</span>
              {#if c.fathom}<span class="r" title="Recording linked"><Icon name="record" size={12} /></span>{/if}
            </button>
          {/each}
        </div>
      {/each}
    </div>
  </div>
{/key}

<div class="agenda">
  {#each days as d}
    {#if byDay.m[d].length}
      <h3 class:today={d === data.today}>{dayLabel(d, { weekday: 'long', day: 'numeric', month: 'short' })}</h3>
      <div class="alist">
        {#each byDay.m[d] as c (c.id)}<CallRow call={c} {tz} onopen={(x) => (openId = x.id)} />{/each}
      </div>
    {/if}
  {/each}
</div>

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
    margin-bottom: 16px;
  }
  .top p {
    margin: 8px 0 0;
  }
  .nav {
    display: flex;
    gap: 6px;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    margin-bottom: 14px;
    font-size: 12.5px;
    color: var(--ink-2);
  }
  .legend i {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 3px;
    background: var(--tone-soft);
    border: 1.5px solid var(--tone);
    margin-right: 6px;
    vertical-align: -1px;
  }
  .week {
    padding: 0 0 12px;
    overflow: hidden;
  }
  .heads,
  .body {
    display: grid;
    grid-template-columns: 56px repeat(7, 1fr);
  }
  .heads {
    border-bottom: 1px solid var(--line-2);
  }
  .dh {
    display: grid;
    justify-items: center;
    padding: 12px 0 10px;
    gap: 2px;
  }
  .dh small {
    font-size: 12px;
    color: var(--ink-3);
    font-weight: 600;
  }
  .dh b {
    font-size: 20px;
    font-variation-settings: 'wdth' 115;
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    border-radius: 50%;
  }
  .dh.today b {
    background: var(--blue);
    color: #fff;
  }
  .body {
    position: relative;
    margin-top: 10px;
  }
  .gutter {
    position: relative;
  }
  .gutter span {
    position: absolute;
    right: 8px;
    transform: translateY(-50%);
    font-size: 11px;
    color: var(--ink-3);
  }
  .daycol {
    position: relative;
    border-left: 1px solid var(--line-2);
  }
  .daycol.today {
    background: color-mix(in srgb, var(--blue-soft) 40%, transparent);
  }
  .hl {
    position: absolute;
    left: 0;
    right: 0;
    border-top: 1px dashed var(--line-2);
  }
  .now {
    position: absolute;
    left: -4px;
    right: 0;
    height: 2px;
    background: var(--red);
    z-index: 2;
  }
  .now::before {
    content: '';
    position: absolute;
    left: 0;
    top: -3px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--red);
  }
  .ev {
    position: absolute;
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 1px;
    padding: 4px 7px;
    border-radius: 8px;
    border: 0;
    border-left: 4px solid var(--tone);
    background: var(--tone-soft);
    text-align: left;
    font-size: 12px;
    overflow: hidden;
    transition: transform 0.15s var(--ease-out), box-shadow 0.15s;
  }
  .ev.pending {
    background: var(--raised);
    border-left-color: var(--blue);
    box-shadow: inset 0 0 0 1px var(--line);
  }
  .ev:hover {
    transform: scale(1.03);
    box-shadow: var(--shadow);
    z-index: 3;
  }
  .ev.short {
    flex-direction: row;
    align-items: center;
    gap: 6px;
    padding: 2px 7px;
  }
  .ev.short span.num {
    flex: none;
    font-size: 11px;
  }
  .ev b {
    font-size: 12.5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
  .ev span {
    color: var(--ink-2);
  }
  .ev .r {
    position: absolute;
    right: 5px;
    top: 5px;
    color: var(--red);
  }
  .agenda {
    display: none;
  }
  @media (max-width: 900px) {
    .week,
    .legend {
      display: none;
    }
    .agenda {
      display: block;
    }
    .agenda h3 {
      font-size: 14px;
      color: var(--ink-2);
      margin: 18px 0 8px;
    }
    .agenda h3.today {
      color: var(--blue);
    }
    .alist {
      display: grid;
      gap: 8px;
    }
  }
</style>
