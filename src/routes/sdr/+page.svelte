<script>
  import { tick } from 'svelte';
  import MonthSwitch from '$lib/components/MonthSwitch.svelte';
  import Stat from '$lib/components/Stat.svelte';
  import DayChart from '$lib/components/DayChart.svelte';
  import LogTable from '$lib/components/LogTable.svelte';
  import DaysWorked from '$lib/components/DaysWorked.svelte';
  import { SDR_OUTCOMES, sdrSummary, sdrTotal, sdrSpoken } from '$lib/stats.js';
  import { pct, num } from '$lib/fmt.js';
  import { monthBounds, addDays } from '$lib/time.js';

  let { data } = $props();

  const rows = $derived.by(() => {
    const { first, days } = monthBounds(data.month);
    const by = Object.fromEntries(data.days.map((d) => [d.date, d]));
    return Array.from({ length: days }, (_, i) => {
      const date = addDays(first, i);
      const d = by[date];
      return { date, values: d ? Object.fromEntries(SDR_OUTCOMES.map((o) => [o.key, d[o.key]])) : {} };
    });
  });

  const s = $derived(sdrSummary(data.days, data.meta.sdr));
  const p = $derived(sdrSummary(data.prevDays, data.prevMeta.sdr));
  const delta = (a, b) => (a == null || b == null ? null : a - b);
  const deltaLabel = (d) => (d == null ? null : `${d >= 0 ? '+' : ''}${(d * 100).toFixed(1)} pts on last month`);

  const computed = [
    { label: 'Total leads', fn: (v) => sdrTotal(fill(v)) || '' },
    { label: 'Spoken with', fn: (v) => sdrSpoken(fill(v)) || '' }
  ];
  function fill(v) {
    return Object.fromEntries(SDR_OUTCOMES.map((o) => [o.key, Number(v[o.key]) || 0]));
  }

  let highlight = $state(null);
  async function jump(date) {
    highlight = null;
    await tick();
    highlight = date;
    document.getElementById(`d-${date}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    document.querySelector(`#d-${date} input`)?.focus({ preventScroll: true });
  }
</script>

<svelte:head><title>Dialling · Closer Desk</title></svelte:head>

<header class="top">
  <div>
    <h1>Dialling</h1>
    <p class="muted">Your SDR - Oct and SDR - Nov tabs, one row per day. Enter the outcomes and the totals add up for you.</p>
  </div>
  <MonthSwitch month={data.month} base="/sdr" />
</header>

<section class="panel board">
  <div class="kpis">
    <Stat size="lg" label="Total leads dialled" value={s.total} />
    <Stat size="lg" label="Pick-up rate" value={s.pickupRate} format={(n) => pct(n, 2)} hint={deltaLabel(delta(s.pickupRate, p.pickupRate))} />
    <Stat size="lg" label="Calls booked" value={s.booked} tone="blue" />
    <Stat size="lg" label="Booking rate per call" value={s.bookingRate} format={(n) => pct(n, 2)} hint={deltaLabel(delta(s.bookingRate, p.bookingRate))} />
  </div>
  <div class="kpis small">
    <Stat size="sm" label="Spoken with" value={s.spoken} />
    <Stat size="sm" label="Bookings per lead spoken to" value={s.bookedPerSpoken} format={(n) => pct(n, 1)} />
    <Stat size="sm" label="Bookings per day" value={s.bookingsPerDay} format={(n) => num(n, 2)} />
    <Stat size="sm" label="Dials per day" value={s.dialsPerDay} format={(n) => num(n, 1)} />
  </div>
  <DaysWorked month={data.month} kind="sdr" override={data.meta.sdr} active={s.activeDays} />
</section>

<section class="panel chart">
  <div class="head">
    <h2>Dials by day</h2>
    <p class="faint">Click a day to edit it</p>
  </div>
  <DayChart days={rows} fields={SDR_OUTCOMES} today={data.today} onpick={jump} unit="dials" />
  <div class="legend">
    {#each SDR_OUTCOMES as o}<span class="t-{o.tone}"><i></i>{o.label}</span>{/each}
  </div>
</section>

<LogTable {rows} fields={SDR_OUTCOMES} {computed} endpoint="/api/sdr" today={data.today} {highlight} />

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
    max-width: 60ch;
  }
  .panel {
    padding: 22px;
    margin-bottom: 18px;
  }
  .board {
    display: grid;
    gap: 22px;
  }
  .kpis {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 18px 28px;
  }
  .kpis.small {
    padding-top: 18px;
    border-top: 1px solid var(--line-2);
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 18px;
  }
  .head p {
    margin: 0;
    font-size: 13px;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    margin-top: 14px;
    font-size: 12.5px;
    color: var(--ink-2);
  }
  .legend i {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 2px;
    background: var(--tone);
    margin-right: 6px;
  }
  @media (max-width: 760px) {
    .kpis {
      grid-template-columns: repeat(2, 1fr);
    }
    .panel {
      padding: 16px;
    }
  }
</style>
