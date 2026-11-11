<script>
  import Icon from './Icon.svelte';
  import OutcomePicker from './OutcomePicker.svelte';
  import { CALL_OUTCOMES } from '$lib/stats.js';
  import { time, relative, money } from '$lib/fmt.js';
  import { invalidateAll } from '$app/navigation';
  import { toast } from '$lib/toast.svelte.js';

  let { call, tz, onopen, next = false } = $props();
  const o = $derived(CALL_OUTCOMES.find((x) => x.key === call.outcome) || CALL_OUTCOMES[0]);
  const past = $derived(new Date(call.start) < new Date());
  const live = $derived(new Date(call.start) <= new Date() && new Date(call.end) >= new Date());

  async function quick(outcome) {
    const r = await fetch(`/api/calls/${encodeURIComponent(call.id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outcome })
    });
    if (r.ok) {
      toast(`${call.prospect}: ${CALL_OUTCOMES.find((x) => x.key === outcome).label.toLowerCase()}`);
      invalidateAll();
    } else toast('Could not save the outcome', 'error');
  }
</script>

<div class="row t-{o.tone}" class:next class:live role="button" tabindex="0" onclick={() => onopen(call)} onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onopen(call))}>
  <div class="when">
    <span class="t num">{time(call.start, tz)}</span>
    {#if live}<span class="badge live-b">On now</span>{:else if next}<span class="badge">{relative(call.start)}</span>{/if}
  </div>
  <div class="who">
    <strong>{call.prospect}</strong>
    <span class="meta">
      <span>{call.kind}</span>
      {#if call.fathom}<span class="rec" title="Fathom recording linked"><Icon name="record" size={13} />Recording</span>{/if}
      {#if call.cash > 0}<span class="cash num">{money(call.cash)}</span>{/if}
    </span>
  </div>
  <div class="right">
    {#if past && call.outcome === 'pending'}
      <OutcomePicker value={call.outcome} onpick={quick} compact />
    {:else if call.outcome !== 'pending'}
      <span class="chip"><span class="dot"></span>{o.label}</span>
    {:else if call.joinUrl}
      <a class="btn small" href={call.joinUrl} target="_blank" rel="noopener" onclick={(e) => e.stopPropagation()}><Icon name="video" size={15} />Join</a>
    {/if}
  </div>
</div>

<style>
  .row {
    position: relative;
    display: grid;
    grid-template-columns: 86px minmax(0, 1fr) auto;
    gap: 14px;
    align-items: center;
    padding: 12px 14px 12px 18px;
    border-radius: 12px;
    background: var(--raised);
    border: 1px solid var(--line-2);
    cursor: pointer;
    transition: border-color 0.15s, transform 0.2s var(--ease-out);
  }
  .row::before {
    content: '';
    position: absolute;
    left: 0;
    top: 10px;
    bottom: 10px;
    width: 4px;
    border-radius: 0 4px 4px 0;
    background: var(--tone);
  }
  .row:hover {
    border-color: var(--line);
    transform: translateX(2px);
  }
  .row.next {
    border-color: color-mix(in srgb, var(--blue) 50%, transparent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--blue) 12%, transparent);
  }
  .row.live::before {
    background: var(--blue);
    animation: beat 1.6s ease-in-out infinite;
  }
  @keyframes beat {
    50% { opacity: 0.35; }
  }
  .when {
    display: grid;
    gap: 3px;
  }
  .t {
    font-weight: 700;
    font-variation-settings: 'wdth' 110;
  }
  .badge {
    font-size: 11.5px;
    font-weight: 600;
    color: var(--blue);
  }
  .live-b {
    color: var(--red);
  }
  .who {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .who strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    font-size: 12.5px;
    color: var(--ink-3);
  }
  .rec {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--red);
    font-weight: 600;
  }
  .cash {
    color: var(--green);
    font-weight: 700;
  }
  .right {
    display: flex;
    justify-content: flex-end;
  }
  @media (max-width: 1100px) {
    .row {
      grid-template-columns: 70px minmax(0, 1fr);
    }
    .right {
      grid-column: 1 / -1;
      justify-content: flex-start;
    }
  }
</style>
