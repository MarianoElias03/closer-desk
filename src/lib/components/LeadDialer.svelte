<script>
  import { fly } from 'svelte/transition';
  import { invalidateAll } from '$app/navigation';
  import Icon from './Icon.svelte';
  import LeadSummary from './LeadSummary.svelte';
  import LeadPad from './LeadPad.svelte';
  import { SDR_OUTCOMES } from '$lib/stats.js';
  import { dialQueue, isDue, leadName } from '$lib/leads.js';
  import { toast } from '$lib/toast.svelte.js';

  let { leads, today, tz, reasons = {}, currentId = $bindable(null) } = $props();

  let skipped = $state([]);
  let last = $state(null);
  let busy = $state(false);

  const queue = $derived(dialQueue(leads, today).filter((l) => !skipped.includes(l.id)));
  const allQueued = $derived(dialQueue(leads, today));
  const current = $derived((currentId != null && leads.find((l) => l.id === currentId)) || queue[0] || null);
  const due = $derived(allQueued.filter((l) => isDue(l, today)).length);

  function logged(e) {
    last = { leadId: e.lead.id, dialId: e.dialId, outcome: e.outcome, name: e.name };
    currentId = null;
    skipped = skipped.filter((id) => id !== e.lead.id);
  }

  async function undo() {
    if (!last || busy) return;
    const u = last;
    busy = true;
    try {
      const r = await fetch(`/api/leads/${u.leadId}/dials/${u.dialId}`, { method: 'DELETE' });
      if (!r.ok) throw new Error();
      last = null;
      currentId = u.leadId;
      toast(`Took back the ${SDR_OUTCOMES.find((o) => o.key === u.outcome).label.toLowerCase()} on ${u.name}`);
      await invalidateAll();
    } catch {
      toast('Could not undo that dial', 'error');
    } finally {
      busy = false;
    }
  }

  function skip() {
    if (!current) return;
    skipped = [...skipped, current.id];
    currentId = null;
  }

  function onkey(e) {
    if (!current || e.target.closest('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.querySelector('[role="dialog"]')) return;
    if (e.key === 's' || e.key === 'S') {
      e.preventDefault();
      skip();
    } else if (e.key === 'z' || e.key === 'Z') {
      e.preventDefault();
      undo();
    }
  }
</script>

<svelte:window onkeydown={onkey} />

<section class="panel dialer">
  <div class="head">
    <div>
      <h2>Dial your list</h2>
      <p class="muted small">
        {#if allQueued.length}
          {allQueued.length} to ring today{due ? `, ${due} ${due === 1 ? 'callback' : 'callbacks'} due first` : ''}. Keys 1 to 5 pick the outcome, then a number picks the reason (Enter for none). S skips, Z undoes.
        {:else}
          Nobody left to ring today.
        {/if}
      </p>
    </div>
    <div class="hacts">
      {#if skipped.length}<button class="btn small ghost" onclick={() => (skipped = [])}>Bring back {skipped.length} skipped</button>{/if}
      <button class="btn small ghost" onclick={undo} disabled={!last || busy}><Icon name="undo" size={15} />Undo</button>
    </div>
  </div>

  {#if current}
    {#key current.id}
      <article class="lead" in:fly={{ x: 40, duration: 320 }}>
        <LeadSummary lead={current} {today} {tz} />
        <LeadPad lead={current} {today} {reasons} onlogged={logged} bind:busy />
        <div class="foot">
          <button class="btn small ghost" onclick={skip}><Icon name="skip" size={14} />Skip for now</button>
          <a class="btn small ghost" href="/leads/{current.id}">Open lead page</a>
          {#if queue.length > 1}<span class="faint small">Next up: {leadName(queue.find((l) => l.id !== current.id))}</span>{/if}
        </div>
      </article>
    {/key}
  {/if}

  {#if !current}
    <div class="empty">
      {#if !leads.length}
        <strong>No leads yet.</strong> Import your spreadsheet to start dialling from it.
      {:else if skipped.length}
        You skipped everyone left. Bring them back to keep going.
      {:else}
        <strong>That's the list done for today.</strong> Callbacks come back on their day, and no-answers come back tomorrow.
      {/if}
    </div>
  {/if}
</section>

<style>
  .dialer {
    padding: 22px;
    margin-bottom: 18px;
    display: grid;
    gap: 16px;
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 12px;
  }
  .head p {
    margin: 4px 0 0;
  }
  .hacts {
    display: flex;
    gap: 8px;
    align-items: start;
  }
  .small {
    font-size: 13px;
  }
  .lead {
    display: grid;
    gap: 14px;
  }
  .foot {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .foot span {
    margin-left: auto;
  }
  .empty {
    padding: 26px;
    text-align: center;
    color: var(--ink-2);
    border: 1px dashed var(--line);
    border-radius: 14px;
  }
  @media (max-width: 760px) {
    .dialer {
      padding: 16px;
    }
  }
</style>
