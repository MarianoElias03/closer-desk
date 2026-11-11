<script>
  import { CALL_OUTCOMES } from '$lib/stats.js';
  let { value, onpick, compact = false, disabled = false } = $props();
</script>

<div class="op" class:compact role="radiogroup" aria-label="Call outcome">
  {#each CALL_OUTCOMES.filter((o) => o.key !== 'pending') as o}
    <button
      type="button"
      role="radio"
      aria-checked={value === o.key}
      class="t-{o.tone}"
      class:on={value === o.key}
      {disabled}
      onclick={(e) => { e.stopPropagation(); onpick(value === o.key ? 'pending' : o.key); }}
    >
      <i></i>{o.label}
    </button>
  {/each}
</div>

<style>
  .op {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  button {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 32px;
    padding: 0 12px;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: var(--raised);
    font-size: 13px;
    font-weight: 600;
    transition: background 0.18s, border-color 0.18s, color 0.18s, transform 0.25s var(--ease-spring);
  }
  .compact button {
    height: 28px;
    padding: 0 10px;
    font-size: 12.5px;
  }
  i {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--tone);
    transition: transform 0.25s var(--ease-spring);
  }
  button:hover {
    border-color: var(--tone);
  }
  button.on {
    background: var(--tone);
    border-color: var(--tone);
    color: var(--on-tone);
    transform: scale(1.04);
  }
  button.on i {
    background: currentColor;
    transform: scale(0.7);
  }
</style>
