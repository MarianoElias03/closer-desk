<script>
  import MonthSwitch from '$lib/components/MonthSwitch.svelte';
  import Stat from '$lib/components/Stat.svelte';
  import DayChart from '$lib/components/DayChart.svelte';
  import CallsBoard from '$lib/components/CallsBoard.svelte';
  import DaysWorked from '$lib/components/DaysWorked.svelte';
  import { CLOSE_OUTCOMES, closeSummary, closeCalls } from '$lib/stats.js';
  import { pct, num, money } from '$lib/fmt.js';
  import { monthBounds, addDays } from '$lib/time.js';

  let { data } = $props();
  const FIELDS = [...CLOSE_OUTCOMES, { key: 'cash', short: 'Cash collected', label: 'Cash collected', tone: 'green', money: true }];
  const KEYS = FIELDS.map((f) => f.key);

  const rows = $derived.by(() => {
    const { first, days } = monthBounds(data.month);
    const by = Object.fromEntries(data.days.map((d) => [d.date, d]));
    return Array.from({ length: days }, (_, i) => {
      const date = addDays(first, i);
      const d = by[date];
      return { date, values: d ? Object.fromEntries(KEYS.map((k) => [k, d[k]])) : {} };
    });
  });

  const s = $derived(closeSummary(data.days, data.meta.close));
  const p = $derived(closeSummary(data.prevDays, data.prevMeta.close));
  const deltaLabel = (a, b) => (a == null || b == null ? null : `${a - b >= 0 ? '+' : ''}${((a - b) * 100).toFixed(1)} pts on last month`);

  const chartFields = CLOSE_OUTCOMES;
</script>

<svelte:head><title>Closing · Closer Desk</title></svelte:head>

<header class="top">
  <div>
    <h1>Closing</h1>
    <p class="muted">Your closing numbers and every sales call. Log an outcome on a call and that day's numbers update on their own.</p>
  </div>
  <MonthSwitch month={data.month} base="/closing" />
</header>

<section class="panel board">
  <div class="kpis">
    <Stat size="lg" label="Cash collected" value={s.cash} format={(n) => money(n)} tone="green" />
    <Stat size="lg" label="Closed deals" value={s.closed} tone="green" />
    <Stat size="lg" label="Conversion" value={s.conversion} format={(n) => pct(n, 2)} hint={deltaLabel(s.conversion, p.conversion)} />
    <Stat size="lg" label="No-show rate" value={s.noShowRate} format={(n) => pct(n, 2)} tone="iron" hint={deltaLabel(s.noShowRate, p.noShowRate)} />
  </div>
  <div class="kpis small">
    <Stat size="sm" label="Calls" value={s.calls} />
    <Stat size="sm" label="Close rate on calls that showed" value={s.closeRateOnShows} format={(n) => pct(n, 1)} />
    <Stat size="sm" label="Cash per day" value={s.cashPerDay} format={(n) => money(n, true)} />
    <Stat size="sm" label="Sales per day" value={s.salesPerDay} format={(n) => num(n, 2)} />
  </div>
  <DaysWorked month={data.month} kind="close" override={data.meta.close} active={s.activeDays} />
</section>

<section class="panel chart">
  <div class="head">
    <h2>Calls by day</h2>
  </div>
  <DayChart days={rows} fields={chartFields} today={data.today} unit="calls" />
  <div class="legend">
    {#each chartFields as o}<span class="t-{o.tone}"><i></i>{o.label}</span>{/each}
  </div>
</section>

<CallsBoard {data} />

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
  .cal {
    display: inline-flex;
    gap: 10px;
    align-items: center;
    font-size: 12.5px;
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
