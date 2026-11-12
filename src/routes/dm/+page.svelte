<script>
  import { tick } from 'svelte';
  import MonthSwitch from '$lib/components/MonthSwitch.svelte';
  import Stat from '$lib/components/Stat.svelte';
  import DayChart from '$lib/components/DayChart.svelte';
  import LogTable from '$lib/components/LogTable.svelte';
  import DaysWorked from '$lib/components/DaysWorked.svelte';
  import { DM_OUTCOMES, dmSummary } from '$lib/stats.js';
  import { pct, num } from '$lib/fmt.js';
  import { monthBounds, addDays } from '$lib/time.js';

  let { data } = $props();

  const rows = $derived.by(() => {
    const { first, days } = monthBounds(data.month);
    const by = Object.fromEntries(data.days.map((d) => [d.date, d]));
    return Array.from({ length: days }, (_, i) => {
      const date = addDays(first, i);
      const d = by[date];
      return { date, values: d ? Object.fromEntries(DM_OUTCOMES.map((o) => [o.key, d[o.key]])) : {} };
    });
  });

  const s = $derived(dmSummary(data.days, data.meta.dm));
  const p = $derived(dmSummary(data.prevDays, data.prevMeta.dm));
  const delta = (a, b) => (a == null || b == null ? null : a - b);
  const deltaLabel = (d) => (d == null ? null : `${d >= 0 ? '+' : ''}${(d * 100).toFixed(1)} pts on last month`);

  const n = (v, k) => Number(v[k]) || 0;
  const computed = [
    {
      label: 'Conv. rate',
      fn: (v) => {
        const decided = n(v, 'converted') + n(v, 'not_converted');
        return decided ? pct(n(v, 'converted') / decided) : '';
      }
    }
  ];

  let highlight = $state(null);
  async function jump(date) {
    highlight = null;
    await tick();
    highlight = date;
    document.getElementById(`d-${date}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    document.querySelector(`#d-${date} input`)?.focus({ preventScroll: true });
  }
</script>

<svelte:head><title>DM Setting · Closer Desk</title></svelte:head>

<header class="top">
  <div>
    <h1>DM Setting</h1>
    <p class="muted">One row per day. Log how many leads contacted you, how many you booked, and how many converted or didn't.</p>
  </div>
  <MonthSwitch month={data.month} base="/dm" />
</header>

<section class="panel board">
  <div class="kpis">
    <Stat size="lg" label="Leads who contacted us" value={s.contacted} />
    <Stat size="lg" label="Calls booked" value={s.booked} tone="blue" />
    <Stat size="lg" label="Booking rate" value={s.bookingRate} format={(n) => pct(n, 1)} hint={deltaLabel(delta(s.bookingRate, p.bookingRate))} />
    <Stat size="lg" label="Converted" value={s.converted} tone="green" />
  </div>
  <div class="kpis small">
    <Stat size="sm" label="Not converted" value={s.not_converted} tone="red" />
    <Stat size="sm" label="Conversion rate" value={s.conversionRate} format={(n) => pct(n, 1)} hint={deltaLabel(delta(s.conversionRate, p.conversionRate))} />
    <Stat size="sm" label="Converted per contact" value={s.convertedPerContact} format={(n) => pct(n, 1)} />
    <Stat size="sm" label="Contacts per day" value={s.contactsPerDay} format={(n) => num(n, 1)} />
  </div>
  <p class="faint note">Conversion rate counts only leads you've logged as converted or not converted.</p>
  <DaysWorked month={data.month} kind="dm" override={data.meta.dm} active={s.activeDays} />
</section>

<section class="panel chart">
  <div class="head">
    <h2>Leads who contacted us, by day</h2>
    <p class="faint">Click a day to edit it</p>
  </div>
  <!-- The four columns overlap (booked leads also contacted us), so only contacts are stacked here. -->
  <DayChart days={rows} fields={DM_OUTCOMES.slice(0, 1)} today={data.today} onpick={jump} unit="leads" />
</section>

<LogTable {rows} fields={DM_OUTCOMES} {computed} endpoint="/api/dm" today={data.today} {highlight} />

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
  .note {
    margin: -10px 0 -12px;
    font-size: 12.5px;
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
  @media (max-width: 760px) {
    .kpis {
      grid-template-columns: repeat(2, 1fr);
    }
    .panel {
      padding: 16px;
    }
  }
</style>
