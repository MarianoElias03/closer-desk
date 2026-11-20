<script>
  import { page } from '$app/state';
  import Icon from '$lib/components/Icon.svelte';
  import Stat from '$lib/components/Stat.svelte';
  import LeadDialer from '$lib/components/LeadDialer.svelte';
  import ColdLeads from '$lib/components/ColdLeads.svelte';
  import LeadImport from '$lib/components/LeadImport.svelte';
  import { FILTERS, isDue } from '$lib/leads.js';
  import { money } from '$lib/fmt.js';

  let { data } = $props();

  let importing = $state(false);
  let dialId = $state(null);
  let expanded = $state(Number(page.url.searchParams.get('lead')) || null);

  const count = (key) => data.leads.filter((l) => FILTERS.find((f) => f.key === key).test(l, data.today)).length;
  const due = $derived(data.leads.filter((l) => isDue(l, data.today)).length);
  const dialledToday = $derived(data.leads.reduce((n, l) => n + l.dials.filter((d) => d.date === data.today).length, 0));
  const cash = $derived(data.leads.reduce((n, l) => n + (l.stage === 'call_closed' ? l.call?.cash || 0 : 0), 0));

  function dialNow(id) {
    dialId = id;
    document.querySelector('.dialer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
</script>

<svelte:head><title>Leads · Closer Desk</title></svelte:head>

<header class="top">
  <div>
    <h1>Leads</h1>
    <p class="muted">
      The call list for {data.offer.name}. Each outcome you log on a lead counts on Dialling the same as a tap, and a booking follows the lead
      through to its closing call.
    </p>
  </div>
  <button class="btn primary" onclick={() => (importing = true)}><Icon name="upload" size={17} />Import spreadsheet</button>
</header>

{#if data.leads.length}
  <section class="panel strip">
    <Stat label="To dial today" value={count('queue')} />
    <Stat label="Callbacks due" value={due} tone="yellow" />
    <Stat label="Dialled from the list today" value={dialledToday} />
    <Stat label="Booked" value={count('booked')} tone="blue" />
    <Stat label="Closed" value={count('closed')} tone="green" hint={cash ? `${money(cash)} cash` : null} />
    <Stat label="On the list" value={data.leads.length} />
  </section>
{/if}

<LeadDialer leads={data.leads} today={data.today} bind:currentId={dialId} onopen={(id) => (expanded = id)} />
<ColdLeads leads={data.leads} today={data.today} tz={data.tz} linkable={data.linkable} bind:expanded ondial={dialNow} />

{#if importing}
  <LeadImport offerName={data.offer.name} today={data.today} onclose={() => (importing = false)} />
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
    max-width: 64ch;
  }
  .strip {
    padding: 18px 22px;
    margin-bottom: 18px;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    gap: 16px 24px;
  }
</style>
