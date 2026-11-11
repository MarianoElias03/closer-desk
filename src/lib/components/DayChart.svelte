<script>
  import { ddmm, dayLabel } from '$lib/fmt.js';
  /** days: [{date, values:{key:n}}]; fields: [{key,label,tone}] */
  let { days, fields, today, onpick = null, unit = '' } = $props();
  const max = $derived(Math.max(1, ...days.map((d) => fields.reduce((a, f) => a + (d.values[f.key] || 0), 0))));
  let hover = $state(null);
  let mounted = $state(false);
  $effect(() => {
    const t = requestAnimationFrame(() => (mounted = true));
    return () => cancelAnimationFrame(t);
  });
</script>

<div class="chart" class:mounted>
  <div class="cols" style:--n={days.length}>
    {#each days as d, i (d.date)}
      {@const tot = fields.reduce((a, f) => a + (d.values[f.key] || 0), 0)}
      <button
        class="col"
        class:today={d.date === today}
        class:future={d.date > today}
        style:--i={i}
        onmouseenter={() => (hover = d)}
        onmouseleave={() => (hover = null)}
        onfocus={() => (hover = d)}
        onblur={() => (hover = null)}
        onclick={() => onpick?.(d.date)}
        aria-label="{dayLabel(d.date)}: {tot} {unit}"
      >
        <span class="stack" style:height="{(tot / max) * 100}%">
          {#each fields as f}
            {#if d.values[f.key]}
              <span class="seg t-{f.tone}" style:flex-grow={d.values[f.key]}></span>
            {/if}
          {/each}
        </span>
        <span class="lbl num">{Number(d.date.slice(8))}</span>
      </button>
    {/each}
  </div>
  <div class="tip" class:show={!!hover} aria-hidden="true">
    {#if hover}
      <strong>{dayLabel(hover.date)}</strong>
      {#each fields as f}
        {#if hover.values[f.key]}<span class="t-{f.tone}"><i></i>{f.label} <b class="num">{hover.values[f.key]}</b></span>{/if}
      {/each}
      {#if !fields.some((f) => hover.values[f.key])}<span class="faint">Nothing logged</span>{/if}
    {/if}
  </div>
</div>

<style>
  .chart {
    position: relative;
  }
  .cols {
    display: grid;
    grid-template-columns: repeat(var(--n), 1fr);
    gap: 4px;
    height: 150px;
    align-items: end;
  }
  .col {
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: stretch;
    gap: 6px;
    padding: 0;
    border: 0;
    background: none;
    border-radius: 6px;
    min-width: 0;
  }
  .stack {
    display: flex;
    flex-direction: column-reverse;
    gap: 2px;
    min-height: 0;
    transform-origin: bottom;
    transform: scaleY(0);
    transition: transform 0.7s var(--ease-out);
    transition-delay: calc(var(--i) * 18ms);
  }
  .mounted .stack {
    transform: scaleY(1);
  }
  .seg {
    background: var(--tone);
    border-radius: 3px;
    min-height: 3px;
  }
  .col:hover .stack,
  .col:focus-visible .stack {
    filter: brightness(1.1);
  }
  .lbl {
    font-size: 10.5px;
    color: var(--ink-3);
    text-align: center;
    line-height: 1;
    padding-top: 6px;
    border-top: 2px solid var(--line-2);
  }
  .today .lbl {
    color: var(--blue);
    font-weight: 800;
    border-top-color: var(--blue);
  }
  .future .lbl {
    opacity: 0.5;
  }
  .tip {
    position: absolute;
    top: -6px;
    right: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    align-items: center;
    padding: 8px 12px;
    border-radius: 10px;
    background: var(--ink);
    color: var(--chalk);
    font-size: 12.5px;
    opacity: 0;
    transform: translateY(4px);
    transition: opacity 0.15s, transform 0.15s;
    pointer-events: none;
    max-width: 100%;
  }
  .tip.show {
    opacity: 1;
    transform: none;
  }
  .tip i {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 2px;
    background: var(--tone);
    margin-right: 5px;
  }
  @media (max-width: 620px) {
    .cols {
      gap: 2px;
      height: 120px;
    }
    .lbl {
      font-size: 9px;
    }
    .col:nth-child(even) .lbl {
      color: transparent;
    }
  }
</style>
