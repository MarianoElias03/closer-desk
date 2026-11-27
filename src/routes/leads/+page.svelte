<script>
  import Icon from '$lib/components/Icon.svelte';
  import Stat from '$lib/components/Stat.svelte';
  import LeadDialer from '$lib/components/LeadDialer.svelte';
  import ColdLeads from '$lib/components/ColdLeads.svelte';
  import LeadImport from '$lib/components/LeadImport.svelte';
  import { FILTERS, isDue, leadMode } from '$lib/leads.js';
  import { money } from '$lib/fmt.js';
  import { forgetOrder } from '$lib/leadOrder.js';

  let { data } = $props();
  // back on the list: the next lead you open starts a fresh snapshot of it
  forgetOrder();

  const mode = $derived(leadMode(data.offer));
  let importing = $state(false);
  let dialId = $state(null);

  const count = (key) => data.leads.filter((l) => FILTERS.find((f) => f.key === key).test(l, data.today)).length;
  const due = $derived(data.leads.filter((l) => isDue(l, data.today)).length);
  // leads with any call, SMS or email today, each counted once (opt-out changes aren't contact)
  const contactedToday = $derived(data.leads.filter((l) => l.dials.some((d) => d.date === data.today && !(d.label && d.date))).length);
  const cash = $derived(data.leads.reduce((n, l) => n + (l.stage === 'call_closed' ? l.call?.cash || 0 : 0), 0));
</script>

<svelte:head><title>Leads · Closer Desk</title></svelte:head>

<header class="top">
  <div>
    <h1>Leads</h1>
    <p class="muted">
      {#if mode === 'sdr'}
        The call list for {data.offer.name}. Each outcome you log on a lead counts on Dialling the same as a tap, and a booking follows the lead
        through to its closing call.
      {:else if mode === 'dm'}
        Everyone you've DM'd for {data.offer.name}. Each outcome you log on a lead counts on DM Setting, the same as a tap there.
      {:else}
        Everyone you've spoken to for {data.offer.name}, with their history, consent and booked calls.
      {/if}
    </p>
  </div>
  <button class="btn primary" onclick={() => (importing = true)}><Icon name="upload" size={17} />Import spreadsheet</button>
</header>

{#if data.leads.length}
  <section class="panel strip">
    {#if mode === 'sdr'}
      <Stat label="To dial today" value={count('queue')} />
      <Stat label="Callbacks due" value={due} tone="yellow" />
    {/if}
    <Stat label="Contacted from the list today" value={contactedToday} />
    <Stat label="Booked" value={count('booked')} tone="blue" />
    <Stat label={mode === 'dm' ? 'Converted' : 'Closed'} value={count('closed')} tone="green" hint={cash ? `${money(cash)} cash` : null} />
    <Stat label="On the list" value={data.leads.length} />
  </section>
{/if}

{#if mode === 'sdr'}
  <LeadDialer leads={data.leads} today={data.today} tz={data.tz} reasons={data.reasons} bind:currentId={dialId} />
{/if}
<ColdLeads leads={data.leads} today={data.today} tz={data.tz} {mode} />

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
