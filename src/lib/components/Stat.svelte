<script>
  import { Tween } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';

  /** value: number|null; format: (n)=>string */
  let { label, value, format = (n) => Math.round(n).toString(), tone = null, hint = null, size = 'md' } = $props();

  const tw = new Tween(0, { duration: 900, easing: cubicOut });
  $effect(() => {
    tw.target = value ?? 0;
  });
</script>

<div class="stat {size} {tone ? 't-' + tone : ''}" class:toned={!!tone}>
  <span class="value score">{value == null ? '–' : format(tw.current)}</span>
  <span class="label">{label}</span>
  {#if hint}<span class="hint faint">{hint}</span>{/if}
</div>

<style>
  .stat {
    display: grid;
    gap: 6px;
    align-content: start;
    min-width: 0;
  }
  .value {
    font-size: 34px;
  }
  .lg .value {
    font-size: clamp(34px, 3.6vw, 52px);
  }
  .sm .value {
    font-size: 24px;
  }
  .label {
    font-size: 13px;
    font-weight: 600;
    color: var(--ink-2);
  }
  .toned .label::before {
    content: '';
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 2px;
    margin-right: 7px;
    background: var(--tone);
    vertical-align: 1px;
  }
  .hint {
    font-size: 12px;
    margin-top: -2px;
  }
</style>
