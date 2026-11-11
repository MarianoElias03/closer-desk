<script>
  import { invalidateAll } from '$app/navigation';
  import MonthSwitch from '$lib/components/MonthSwitch.svelte';
  import Stat from '$lib/components/Stat.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { toast } from '$lib/toast.svelte.js';
  import { pct, num, money } from '$lib/fmt.js';

  let { data } = $props();
  let group = $state('offer');

  const t = $derived(data.total);
  const rows = $derived(group === 'offer' ? data.byOffer : data.byIndustry);
  const isAll = $derived(data.period === 'all');

  async function openOffer(r) {
    const res = await fetch(`/api/offers/${r.id}/open`, { method: 'POST' });
    if (!res.ok) return toast('Could not switch offer', 'error');
    await invalidateAll();
    toast(`Now on ${r.name}`);
  }
</script>

<svelte:head><title>Overall · Closer Desk</title></svelte:head>

<header class="top">
  <div>
    <h1>Overall</h1>
    <p class="muted">Every offer added together, with your dialling and closing numbers split out per offer or per industry.</p>
  </div>
  <div class="period">
    <div class="seg" role="group" aria-label="Period">
      <a href="/overall?m={data.month}" class:on={!isAll} data-sveltekit-noscroll>Month</a>
      <a href="/overall?m=all" class:on={isAll} data-sveltekit-noscroll>All time</a>
    </div>
    {#if !isAll}<MonthSwitch month={data.month} base="/overall" />{/if}
  </div>
</header>

<div class="pair">
  <section class="panel side">
    <h2><span class="tag t-blue"><Icon name="phone" size={15} /></span>Dialling (SDR)</h2>
    <div class="kpis">
      <Stat size="lg" label="Dials" value={t.sdr.total} />
      <Stat size="lg" label="Booked" value={t.sdr.booked} tone="blue" />
    </div>
    <div class="kpis small">
      <Stat size="sm" label="Booking rate" value={t.sdr.bookingRate} format={(n) => pct(n, 1)} />
      <Stat size="sm" label="Pickup rate" value={t.sdr.pickupRate} format={(n) => pct(n, 1)} />
      <Stat size="sm" label="Dials per day" value={t.sdr.dialsPerDay} format={(n) => num(n, 1)} />
      <Stat size="sm" label="Days dialling" value={t.sdr.daysWorked} />
    </div>
  </section>

  <section class="panel side">
    <h2><span class="tag t-green"><Icon name="handshake" size={15} /></span>Closing</h2>
    <div class="kpis">
      <Stat size="lg" label="Cash collected" value={t.close.cash} format={(n) => money(n)} tone="green" />
      <Stat size="lg" label="Closed deals" value={t.close.closed} tone="green" />
    </div>
    <div class="kpis small">
      <Stat size="sm" label="Calls" value={t.close.calls} />
      <Stat size="sm" label="Conversion" value={t.close.conversion} format={(n) => pct(n, 1)} />
      <Stat size="sm" label="No-show rate" value={t.close.noShowRate} format={(n) => pct(n, 1)} />
      <Stat size="sm" label="Cash per call" value={t.close.cashPerCall} format={(n) => money(n)} />
    </div>
  </section>
</div>

<section class="panel breakdown">
  <div class="head">
    <h2>Breakdown</h2>
    <div class="seg" role="group" aria-label="Group by">
      <button class:on={group === 'offer'} onclick={() => (group = 'offer')}>By offer</button>
      <button class:on={group === 'industry'} onclick={() => (group = 'industry')}>By industry</button>
    </div>
  </div>

  {#if rows.length}
    <div class="scroll">
      <table>
        <thead>
          <tr class="groups">
            <th></th>
            <th colspan="4" class="g sdr">Dialling</th>
            <th colspan="5" class="g close">Closing</th>
          </tr>
          <tr>
            <th class="name">{group === 'offer' ? 'Offer' : 'Industry'}</th>
            <th class="sdr first">Dials</th>
            <th>Spoken</th>
            <th>Booked</th>
            <th>Book rate</th>
            <th class="close first">Calls</th>
            <th>Showed</th>
            <th>Closed</th>
            <th>Conv.</th>
            <th>Cash</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as r (r.key)}
            <tr>
              <td class="name">
                {#if group === 'offer'}
                  <button class="link" onclick={() => openOffer(r)} title="Open this offer">{r.name}</button>
                  <small>{r.industry || 'No industry'}{r.archived ? ' · archived' : ''}</small>
                {:else}
                  <strong>{r.name}</strong>
                  <small>{r.count} offer{r.count === 1 ? '' : 's'}: {r.offers.join(', ')}</small>
                {/if}
              </td>
              <td class="num first">{r.sdr.total}</td>
              <td class="num">{r.sdr.spoken}</td>
              <td class="num">{r.sdr.booked}</td>
              <td class="num">{pct(r.sdr.bookingRate, 1)}</td>
              <td class="num first">{r.close.calls}</td>
              <td class="num">{r.close.showed}</td>
              <td class="num">{r.close.closed}</td>
              <td class="num">{pct(r.close.conversion, 1)}</td>
              <td class="num cash">{money(r.close.cash)}</td>
            </tr>
          {/each}
        </tbody>
        <tfoot>
          <tr>
            <td class="name"><strong>All offers</strong></td>
            <td class="num first">{t.sdr.total}</td>
            <td class="num">{t.sdr.spoken}</td>
            <td class="num">{t.sdr.booked}</td>
            <td class="num">{pct(t.sdr.bookingRate, 1)}</td>
            <td class="num first">{t.close.calls}</td>
            <td class="num">{t.close.showed}</td>
            <td class="num">{t.close.closed}</td>
            <td class="num">{pct(t.close.conversion, 1)}</td>
            <td class="num cash">{money(t.close.cash)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
    <p class="faint foot">Numbers come from the Dialling and Closing day rows of each offer. Click an offer to open it.</p>
  {:else}
    <p class="muted empty">Nothing logged {isAll ? 'yet' : 'this month'}.</p>
  {/if}
</section>

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
  .period {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
  }
  .seg {
    display: inline-flex;
    padding: 3px;
    gap: 2px;
    border-radius: 12px;
    background: var(--surface);
    border: 1px solid var(--line-2);
  }
  .seg a,
  .seg button {
    height: 30px;
    display: inline-flex;
    align-items: center;
    padding: 0 12px;
    border-radius: 9px;
    border: 0;
    background: transparent;
    font-weight: 600;
    font-size: 13.5px;
    color: var(--ink-2);
    text-decoration: none;
    cursor: pointer;
  }
  .seg .on {
    background: var(--raised);
    color: var(--ink);
    box-shadow: var(--shadow);
  }
  .pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 18px;
    margin-bottom: 18px;
  }
  .panel {
    padding: 22px;
  }
  .side {
    display: grid;
    gap: 20px;
    align-content: start;
  }
  h2 {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0;
  }
  .tag {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    background: var(--tone-soft);
    color: var(--tone);
  }
  .kpis {
    display: grid;
    grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr);
    gap: 18px 24px;
  }
  .kpis :global(.lg .value) {
    font-size: clamp(30px, 3vw, 46px);
  }
  .kpis.small {
    grid-template-columns: repeat(4, 1fr);
    padding-top: 18px;
    border-top: 1px solid var(--line-2);
  }
  .breakdown .head {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    margin-bottom: 14px;
  }
  .scroll {
    overflow-x: auto;
    margin: 0 -22px;
    padding: 0 22px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
    min-width: 760px;
  }
  th {
    font-size: 12px;
    font-weight: 600;
    color: var(--ink-3);
    text-align: right;
    padding: 6px 10px;
    white-space: nowrap;
  }
  th.name,
  td.name {
    text-align: left;
    padding-left: 0;
  }
  .groups th {
    padding-bottom: 2px;
  }
  .g {
    text-align: left;
    font-size: 11.5px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    border-bottom: 2px solid var(--tone, var(--line));
  }
  .g.sdr {
    --tone: var(--blue);
  }
  .g.close {
    --tone: var(--green);
  }
  td {
    padding: 11px 10px;
    border-top: 1px solid var(--line-2);
    text-align: right;
    white-space: nowrap;
  }
  .first {
    border-left: 1px solid var(--line-2);
  }
  td.name {
    white-space: normal;
    min-width: 180px;
  }
  td.name small {
    display: block;
    font-size: 12px;
    color: var(--ink-3);
    margin-top: 2px;
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    font-weight: 700;
    color: var(--ink);
    cursor: pointer;
    text-align: left;
  }
  .link:hover {
    color: var(--blue);
    text-decoration: underline;
  }
  .cash {
    font-weight: 700;
    color: var(--green);
  }
  tfoot td {
    border-top: 2px solid var(--line);
    font-weight: 700;
  }
  .foot {
    margin: 12px 0 0;
    font-size: 12.5px;
  }
  .empty {
    margin: 8px 0;
  }
  @media (max-width: 1100px) {
    .pair {
      grid-template-columns: 1fr;
    }
  }
  @media (max-width: 600px) {
    .kpis.small {
      grid-template-columns: repeat(2, 1fr);
    }
    .panel {
      padding: 16px;
    }
    .scroll {
      margin: 0 -16px;
      padding: 0 16px;
    }
  }
</style>
