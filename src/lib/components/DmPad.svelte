<script>
  // Tap pad for DM setting, same feel as the dial session: one tap per lead, keys 1 to 4, Z undoes.
  import { fly } from 'svelte/transition';
  import Icon from '$lib/components/Icon.svelte';
  import Stat from '$lib/components/Stat.svelte';
  import { DM_OUTCOMES } from '$lib/stats.js';
  import { pct } from '$lib/fmt.js';
  import { toast } from '$lib/toast.svelte.js';
  import { invalidateAll } from '$app/navigation';

  let { today, day, title = "Today's DMs" } = $props();

  const blank = () => Object.fromEntries(DM_OUTCOMES.map((o) => [o.key, 0]));
  let counts = $state(blank());
  let history = $state([]);
  let pending = 0;
  $effect(() => {
    const src = day;
    if (pending === 0) counts = { ...blank(), ...(src ? Object.fromEntries(DM_OUTCOMES.map((o) => [o.key, src[o.key]])) : {}) };
  });

  async function tap(key, delta = 1) {
    if (delta < 0 && counts[key] === 0) return;
    counts[key] += delta;
    if (delta > 0) history = [...history.slice(-30), key];
    pending++;
    try {
      const r = await fetch('/api/dm/tap', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ date: today, key, delta })
      });
      if (!r.ok) throw new Error();
    } catch {
      counts[key] -= delta;
      toast('That tap did not save. Check your connection.', 'error');
    } finally {
      pending--;
      if (pending === 0) invalidateAll();
    }
  }
  function undo() {
    const key = history.at(-1);
    if (!key) return;
    history = history.slice(0, -1);
    tap(key, -1);
    toast(`Removed one ${DM_OUTCOMES.find((o) => o.key === key).label.toLowerCase()}`);
  }
  function onkey(e) {
    if (e.target.closest('input, textarea, select, dialog, [role="dialog"]') || e.metaKey || e.ctrlKey || e.altKey) return;
    const i = Number(e.key) - 1;
    if (i >= 0 && i < DM_OUTCOMES.length) {
      e.preventDefault();
      tap(DM_OUTCOMES[i].key);
    } else if (e.key === 'z' || e.key === 'Backspace') {
      e.preventDefault();
      undo();
    }
  }

  const decided = $derived(counts.converted + counts.not_converted);
</script>

<svelte:window onkeydown={onkey} />

<section class="panel dmpad">
  <div class="head">
    <div>
      <h2>{title}</h2>
      <p class="muted small">Tap as each lead comes in. Keys 1 to 4 work too, Z undoes.</p>
    </div>
    <button class="btn small ghost" onclick={undo} disabled={!history.length}><Icon name="undo" size={15} />Undo</button>
  </div>

  <div class="pads">
    {#each DM_OUTCOMES as o, i}
      <div class="padwrap">
        <button class="pad t-{o.tone}" onclick={() => tap(o.key)} aria-label="Add one {o.label}, now {counts[o.key]}">
          <span class="key">{i + 1}</span>
          <span class="count score">
            {#key counts[o.key]}
              <span in:fly={{ y: -18, duration: 320 }}>{counts[o.key]}</span>
            {/key}
          </span>
          <span class="plabel">{o.label}</span>
        </button>
        <button class="minus" onclick={() => tap(o.key, -1)} disabled={!counts[o.key]} aria-label="Take one off {o.label}">
          <Icon name="minus" size={14} />
        </button>
      </div>
    {/each}
  </div>

  <div class="tallies">
    <Stat label="Booking rate" value={counts.contacted ? counts.booked / counts.contacted : null} format={(n) => pct(n)} size="sm" />
    <Stat label="Conversion rate" value={decided ? counts.converted / decided : null} format={(n) => pct(n)} size="sm" />
  </div>
</section>

<style>
  .dmpad {
    display: grid;
    gap: 20px;
    padding: 22px;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: start;
    gap: 12px;
  }
  .head h2,
  .head p {
    margin: 0;
  }
  .head p {
    margin-top: 4px;
  }
  .small {
    font-size: 13px;
  }
  .pads {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 10px;
  }
  .padwrap {
    position: relative;
    display: grid;
  }
  .pad {
    position: relative;
    display: grid;
    grid-template-rows: auto 1fr auto;
    justify-items: start;
    gap: 10px;
    min-height: 140px;
    padding: 14px 14px 13px;
    border-radius: 14px;
    border: 0;
    text-align: left;
    background: var(--tone);
    color: var(--on-tone);
    box-shadow: inset 0 -5px 0 rgba(0, 0, 0, 0.16), 0 6px 16px -10px var(--tone);
    transition: transform 0.18s var(--ease-spring), box-shadow 0.18s;
    overflow: hidden;
  }
  .pad::after {
    content: '';
    position: absolute;
    inset: 6px;
    border-radius: 10px;
    border: 1.5px solid rgba(255, 255, 255, 0.18);
    pointer-events: none;
  }
  .pad:hover {
    transform: translateY(-2px);
  }
  .pad:active {
    transform: translateY(2px) scale(0.97);
    box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.16);
  }
  .minus {
    position: absolute;
    top: 10px;
    right: 10px;
    z-index: 1;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    border: 0;
    background: rgba(0, 0, 0, 0.18);
    color: var(--on-tone);
    opacity: 0.85;
  }
  .minus:hover:not(:disabled) {
    opacity: 1;
    background: rgba(0, 0, 0, 0.3);
  }
  .minus:disabled {
    opacity: 0.3;
  }
  .key {
    font-size: 11.5px;
    font-weight: 700;
    opacity: 0.7;
    border: 1.5px solid currentColor;
    border-radius: 5px;
    padding: 0 5px;
    line-height: 17px;
  }
  .count {
    font-size: 46px;
    display: grid;
  }
  .count > span {
    grid-area: 1 / 1;
  }
  .plabel {
    font-weight: 700;
    font-size: 13.5px;
    line-height: 1.15;
  }
  .tallies {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 14px;
    border-top: 1px solid var(--line-2);
    padding-top: 18px;
  }
  @media (max-width: 620px) {
    .dmpad {
      padding: 16px;
    }
    .pads {
      grid-template-columns: repeat(2, 1fr);
    }
    .pad {
      min-height: 108px;
    }
    .count {
      font-size: 38px;
    }
    .key {
      display: none;
    }
    .tallies {
      grid-template-columns: repeat(2, 1fr);
    }
  }
</style>
