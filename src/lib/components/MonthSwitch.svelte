<script>
  import Icon from './Icon.svelte';
  import { monthLabel } from '$lib/fmt.js';
  import { shiftMonth } from '$lib/time.js';
  let { month, base } = $props();
</script>

<div class="ms">
  <a class="btn small ghost" href="{base}?m={shiftMonth(month, -1)}" aria-label="Previous month" data-sveltekit-noscroll><Icon name="left" size={16} /></a>
  <span class="label">{monthLabel(month)}</span>
  <a class="btn small ghost" href="{base}?m={shiftMonth(month, 1)}" aria-label="Next month" data-sveltekit-noscroll><Icon name="right" size={16} /></a>
</div>

<style>
  .ms {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px;
    border-radius: 12px;
    background: var(--surface);
    border: 1px solid var(--line-2);
  }
  .label {
    min-width: 128px;
    text-align: center;
    font-weight: 700;
    font-size: 14px;
  }
</style>
