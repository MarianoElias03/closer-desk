<script>
  import { slide } from 'svelte/transition';
  import { invalidateAll } from '$app/navigation';
  import Icon from './Icon.svelte';
  import { SDR_OUTCOMES } from '$lib/stats.js';
  import { reasonOptions } from '$lib/leads.js';
  import { toast } from '$lib/toast.svelte.js';

  /**
   * After an outcome is logged: one tap adds a second, more specific disposition to that entry
   * ("Not interested" -> "Too expensive"). Optional, so dialling never waits on it.
   * `last` = { leadId, dialId, outcome, name, reason? }
   */
  let { last = $bindable(null), reasons = {} } = $props();

  let other = $state('');
  let saving = $state(false);
  const options = $derived(last ? reasonOptions(last.outcome, reasons) : []);
  const label = $derived(last ? SDR_OUTCOMES.find((o) => o.key === last.outcome)?.label : '');

  async function pick(reason) {
    const r = String(reason || '').trim();
    if (!r || !last || saving) return;
    saving = true;
    try {
      const res = await fetch(`/api/leads/${last.leadId}/dials/${last.dialId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: r })
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || 'Could not save the reason');
      last = { ...last, reason: r };
      other = '';
      toast(`${last.name}: ${label.toLowerCase()}, ${r.toLowerCase()}`);
      await invalidateAll();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      saving = false;
    }
  }
</script>

{#if last && options.length}
  <div class="why" transition:slide={{ duration: 180 }}>
    <div class="top">
      <span class="what"><strong>{last.name}</strong>: {label}{#if last.reason}, <em>{last.reason.toLowerCase()}</em>{/if}</span>
      <button class="x" onclick={() => (last = null)} aria-label="Hide reasons"><Icon name="x" size={14} /></button>
    </div>
    {#if !last.reason}
      <div class="chips" role="group" aria-label="Why? (optional)">
        <span class="k">Why?</span>
        {#each options as r}
          <button class="rc" onclick={() => pick(r)} disabled={saving}>{r}</button>
        {/each}
        <form class="own" onsubmit={(e) => (e.preventDefault(), pick(other))}>
          <input bind:value={other} placeholder="Other reason" aria-label="Other reason" maxlength="80" />
          {#if other.trim()}<button class="rc save" disabled={saving}><Icon name="check" size={13} />Add</button>{/if}
        </form>
      </div>
    {:else}
      <button class="change" onclick={() => (last = { ...last, reason: '' })}>Change reason</button>
    {/if}
  </div>
{/if}

<style>
  .why {
    display: grid;
    gap: 8px;
    padding: 10px 12px;
    border-radius: 12px;
    background: var(--surface);
    border: 1px dashed var(--line);
  }
  .top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    font-size: 13.5px;
    color: var(--ink-2);
  }
  .top em {
    font-style: normal;
    font-weight: 700;
    color: var(--ink);
  }
  .x {
    border: 0;
    background: transparent;
    color: var(--ink-3);
    padding: 3px;
    border-radius: 6px;
    display: inline-flex;
  }
  .x:hover {
    color: var(--ink);
    background: var(--iron-soft);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }
  .k {
    font-size: 11.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-3);
    margin-right: 2px;
  }
  .rc {
    height: 30px;
    padding: 0 12px;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: var(--raised);
    font-size: 13px;
    font-weight: 600;
    color: var(--ink);
    display: inline-flex;
    align-items: center;
    gap: 5px;
    transition: border-color 0.12s, background 0.12s, transform 0.12s var(--ease-spring);
  }
  .rc:hover {
    border-color: var(--blue);
    background: var(--blue-soft);
  }
  .rc:active {
    transform: scale(0.96);
  }
  .rc.save {
    background: var(--ink);
    color: var(--surface);
    border-color: var(--ink);
  }
  .own {
    display: inline-flex;
    gap: 6px;
  }
  .own input {
    height: 30px;
    width: 150px;
    border-radius: 999px;
    border: 1px dashed var(--line);
    background: transparent;
    color: var(--ink);
    padding: 0 12px;
    font-size: 13px;
  }
  .own input:focus {
    outline: none;
    border-style: solid;
    border-color: var(--focus);
  }
  .change {
    justify-self: start;
    border: 0;
    background: transparent;
    padding: 0;
    font-size: 12.5px;
    font-weight: 700;
    color: var(--blue);
  }
</style>
