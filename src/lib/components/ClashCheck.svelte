<script>
  // Under a booking's date and time: anything already on your calendars then (all connected ones).
  // A warning only; booking still goes ahead.
  import Icon from './Icon.svelte';

  // either date + time (the lead's Booked form) or start (ISO, the booking editor); ignore: event ids
  let { date = '', time = '', start = '', minutes = 60, ignore = [] } = $props();

  let res = $state(null);
  let timer;
  const q = $derived(
    start ? `start=${encodeURIComponent(start)}` : date && /^\d{2}:\d{2}/.test(time) ? `date=${date}&time=${time}` : ''
  );
  $effect(() => {
    const query = q && `${q}&minutes=${minutes}&ignore=${encodeURIComponent(ignore.filter(Boolean).join(','))}`;
    clearTimeout(timer);
    res = null;
    if (!query) return;
    timer = setTimeout(async () => {
      try {
        const r = await fetch(`/api/calendar/conflicts?${query}`);
        if (r.ok) res = await r.json();
      } catch {}
    }, 400);
    return () => clearTimeout(timer);
  });
</script>

{#if res?.clashes.length}
  <p class="clash"><Icon name="calendar" size={14} />{res.note}</p>
{:else if res && !res.unchecked.length}
  <p class="clash ok"><Icon name="check" size={14} />Free on your calendars</p>
{/if}
{#if res?.unchecked.length}<p class="clash faint">Couldn't check {res.unchecked.join(', ')}</p>{/if}

<style>
  .clash {
    margin: 0;
    display: flex;
    gap: 6px;
    align-items: center;
    font-size: 13px;
    font-weight: 600;
    color: var(--red);
  }
  .clash.ok {
    color: var(--green, #1f8a4c);
    font-weight: 500;
  }
  .clash.faint {
    color: var(--ink-3);
    font-weight: 400;
  }
</style>
