<script>
  /** segments: [{ key, label, tone, value }] */
  let { segments, height = 14, pulse = null, showLegend = true } = $props();
  const total = $derived(segments.reduce((a, s) => a + s.value, 0));
</script>

<div class="wrap">
  <div class="bar" style:height="{height}px" role="img" aria-label={segments.map((s) => `${s.label} ${s.value}`).join(', ')}>
    {#if total === 0}
      <span class="empty"></span>
    {:else}
      {#each segments as s (s.key)}
        <span
          class="seg t-{s.tone}"
          class:pulse={pulse && pulse.key === s.key}
          style:flex-grow={s.value}
          style:min-width={s.value ? '6px' : '0'}
          data-pulse={pulse?.n}
        ></span>
      {/each}
    {/if}
  </div>
  {#if showLegend}
    <div class="legend">
      {#each segments as s (s.key)}
        <span class="t-{s.tone}"><i></i>{s.label} <b class="num">{s.value}</b></span>
      {/each}
    </div>
  {/if}
</div>

<style>
  .bar {
    display: flex;
    gap: 3px;
    width: 100%;
  }
  .seg {
    flex: 0 1 0;
    background: var(--tone);
    border-radius: 4px;
    transition: flex-grow 0.6s var(--ease-spring), min-width 0.3s;
  }
  .seg.pulse {
    animation: drop 0.5s var(--ease-out);
  }
  @keyframes drop {
    0% { transform: scaleY(1.9); filter: brightness(1.25); }
    100% { transform: scaleY(1); filter: none; }
  }
  .empty {
    flex: 1;
    border-radius: 4px;
    background: repeating-linear-gradient(90deg, var(--line) 0 6px, transparent 6px 10px);
    opacity: 0.6;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    margin-top: 10px;
    font-size: 13px;
    color: var(--ink-2);
  }
  .legend i {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 2px;
    background: var(--tone);
    margin-right: 6px;
  }
  .legend b {
    color: var(--ink);
    margin-left: 2px;
  }
</style>
