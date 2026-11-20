<script>
  import { slide } from 'svelte/transition';
  import { invalidateAll } from '$app/navigation';
  import Icon from './Icon.svelte';
  import { SDR_OUTCOMES } from '$lib/stats.js';
  import { leadName } from '$lib/leads.js';
  import { dayLabel } from '$lib/fmt.js';
  import { addDays } from '$lib/time.js';
  import { toast } from '$lib/toast.svelte.js';

  /** Note box, the five outcome pads (keys 1 to 5) and the callback date picker for one lead. */
  let { lead, today, onlogged, busy = $bindable(false) } = $props();

  let note = $state('');
  let cbOpen = $state(false);
  let cbDate = $state('');

  let lastId = null;
  $effect(() => {
    if (lead.id !== lastId) {
      lastId = lead.id;
      note = '';
      cbOpen = false;
    }
  });

  async function log(outcome, followUp = null) {
    if (busy) return;
    busy = true;
    try {
      const r = await fetch(`/api/leads/${lead.id}/dials`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ outcome, followUp, note: note.trim() })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message || 'Could not save that dial');
      const label = SDR_OUTCOMES.find((o) => o.key === outcome).label.toLowerCase();
      toast(`${leadName(lead)}: ${label}${followUp ? `, call back ${dayLabel(followUp, { weekday: 'short', day: 'numeric', month: 'short' })}` : ''}`);
      note = '';
      cbOpen = false;
      const dialId = Math.max(...j.lead.dials.map((d) => d.id));
      await onlogged?.({ lead: j.lead, dialId, outcome, name: leadName(lead) });
      await invalidateAll();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      busy = false;
    }
  }

  function press(o) {
    if (o.key === 'callback') {
      cbOpen = !cbOpen;
      cbDate = lead.followUp && lead.followUp > today ? lead.followUp : addDays(today, 1);
    } else log(o.key);
  }

  function onkey(e) {
    if (e.target.closest('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.querySelector('[role="dialog"]')) return;
    const i = Number(e.key) - 1;
    if (i >= 0 && i < SDR_OUTCOMES.length) {
      e.preventDefault();
      press(SDR_OUTCOMES[i]);
    }
  }
  const quick = [
    ['Tomorrow', 1],
    ['In 2 days', 2],
    ['Next week', 7]
  ];
</script>

<svelte:window onkeydown={onkey} />

<div class="pad-wrap">
  {#if lead.doNotContact?.includes('call')}
    <p class="warn"><Icon name="x" size={15} />They asked not to be called{lead.dncNote ? ` (${lead.dncNote})` : ''}. Only log a call here if they rang you.</p>
  {/if}
  <label class="field">
    <span class="sr-only">Note from this call</span>
    <input bind:value={note} placeholder="Note from this call (optional), e.g. spoke to receptionist, owner back Friday" />
  </label>

  <div class="pads">
    {#each SDR_OUTCOMES as o, i}
      <button class="pad t-{o.tone}" class:on={o.key === 'callback' && cbOpen} onclick={() => press(o)} disabled={busy}>
        <span class="key">{i + 1}</span>{o.label}
      </button>
    {/each}
  </div>

  {#if cbOpen}
    <div class="cb" transition:slide={{ duration: 180 }}>
      <span class="k">Call back on</span>
      {#each quick as [label, n]}
        <button class="btn small" class:primary={cbDate === addDays(today, n)} onclick={() => (cbDate = addDays(today, n))}>{label}</button>
      {/each}
      <input type="date" bind:value={cbDate} min={today} aria-label="Callback date" />
      <button class="btn small primary" onclick={() => log('callback', cbDate || addDays(today, 1))} disabled={busy}><Icon name="check" size={14} />Save callback</button>
    </div>
  {/if}
</div>

<style>
  .pad-wrap {
    display: grid;
    gap: 14px;
  }
  .warn {
    margin: 0;
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--red-soft);
    color: var(--ink);
    font-size: 13.5px;
    font-weight: 600;
  }
  .pads {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 10px;
  }
  .pad {
    position: relative;
    height: 62px;
    border-radius: 14px;
    border: 0;
    font-weight: 700;
    font-size: 15px;
    background: var(--tone-soft);
    color: var(--ink);
    box-shadow: inset 0 -4px 0 var(--tone);
    transition: transform 0.12s var(--ease-spring), box-shadow 0.15s;
  }
  .pad:hover {
    transform: translateY(-2px);
  }
  .pad:active {
    transform: translateY(1px) scale(0.98);
  }
  .pad.on {
    box-shadow: inset 0 0 0 2px var(--tone), inset 0 -4px 0 var(--tone);
  }
  .key {
    position: absolute;
    top: 6px;
    left: 9px;
    font-size: 11px;
    color: var(--ink-3);
  }
  .cb {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    padding: 12px 14px;
    border-radius: 12px;
    background: var(--yellow-soft);
  }
  .k {
    font-size: 11.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-3);
  }
  .cb input {
    height: 32px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--raised);
    color: var(--ink);
    padding: 0 8px;
  }
  @media (max-width: 760px) {
    .pads {
      grid-template-columns: repeat(2, 1fr);
    }
    .pads .pad:last-child {
      grid-column: span 2;
    }
  }
</style>
