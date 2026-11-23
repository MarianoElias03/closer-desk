<script>
  // "I'm working" timer with a pace target. Lives in the sidebar (and the top bar on a phone).
  // While it runs it checks your pace every 30 seconds and tells you when you fall behind:
  // a red line here, a toast, and a desktop notification (at most every 15 minutes, across tabs).
  import { onMount, untrack } from 'svelte';
  import { page } from '$app/state';
  import { slide } from 'svelte/transition';
  import Icon from './Icon.svelte';
  import { toast } from '$lib/toast.svelte.js';

  let { offerId, compact = false } = $props();

  let st = $state(null);
  let now = $state(Date.now());
  let busy = $state(false);
  let editing = $state(false);
  let form = $state({ mode: 'hour', perHour: 0, perDay: 0, dayHours: 4 });

  async function load() {
    try {
      const r = await fetch('/api/work');
      if (r.ok) {
        st = await r.json();
        check();
      }
    } catch {}
  }
  async function act(action, extra = {}) {
    busy = true;
    try {
      const r = await fetch('/api/work', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, ...extra }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message || 'Could not do that');
      st = j;
      return true;
    } catch (e) {
      toast(e.message, 'error');
      return false;
    } finally {
      busy = false;
    }
  }
  async function start() {
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
    if (await act('start')) toast(st.perHour ? `Working. Pace: ${paceText(st)}` : 'Working. Set a target to get pace alerts.');
  }
  async function stop() {
    const s = st?.running;
    if (await act('stop')) toast(`Stopped after ${clock(s ? Date.now() - Date.parse(s.since) : 0)}, ${s?.done ?? 0} ${st.label || 'done'}`);
  }
  function openTarget() {
    form = { ...st.target };
    editing = !editing;
  }
  async function saveTarget(e) {
    e.preventDefault();
    if (await act('target', { target: form })) {
      editing = false;
      toast(st.perHour ? `Target set: ${paceText(st)}` : 'Target cleared');
    }
  }

  // ---- behind alerts ----
  const KEY = 'closer.behindAt';
  let wasBehind = false;
  function check() {
    if (!st?.running) return (wasBehind = false);
    if (st.behind > 0) {
      let last = 0;
      try {
        last = Number(localStorage.getItem(KEY)) || 0;
      } catch {}
      // first time behind, or still behind 15 minutes after the last nudge
      if (!wasBehind || Date.now() - last > 15 * 60_000) {
        if (Date.now() - last > 60_000) {
          try {
            localStorage.setItem(KEY, String(Date.now()));
          } catch {}
          const msg = `You're ${st.behind} ${st.label} behind. ${st.counted} done, ${st.expected} by now for ${paceText(st)}.`;
          toast(msg, 'error');
          if ('Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
            try {
              new Notification('Closer Desk: behind pace', { body: msg, tag: 'closer-pace' });
            } catch {}
          }
        }
      }
      wasBehind = true;
    } else {
      if (wasBehind) toast("Back on pace. Keep going.");
      wasBehind = false;
    }
  }

  onMount(() => {
    load();
    const tick = setInterval(() => (now = Date.now()), 1000);
    const poll = setInterval(() => st?.running && load(), 30_000);
    const focus = () => load();
    window.addEventListener('focus', focus);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
      window.removeEventListener('focus', focus);
    };
  });
  // anything you log (a dial, a lead outcome) refreshes the page data: update the count straight away
  $effect(() => {
    page.data;
    untrack(() => st?.running && load());
  });
  // a different offer opened: its own clock and target
  let seen = null;
  $effect(() => {
    if (offerId !== seen) {
      if (seen !== null) load();
      seen = offerId;
      editing = false;
    }
  });

  function clock(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
  }
  function paceText(s) {
    if (!s?.perHour) return 'no target';
    return s.target.mode === 'day' ? `${s.target.perDay} ${s.label} a day over ${s.target.dayHours} h` : `${s.target.perHour} ${s.label} an hour`;
  }
  const sessionMs = $derived(st?.running ? now - Date.parse(st.running.since) : 0);
  // worked today = finished sessions + the live one (the server's figure was as of its own clock)
  const todayMs = $derived(st ? st.workedMs + (st.running ? now - Date.parse(st.at) : 0) : 0);
  const tone = $derived(!st?.running || !st.perHour ? 'none' : st.behind > 0 ? 'red' : 'green');
</script>

{#if st}
  <div class="wt t-{tone}" class:compact class:on={!!st.running}>
    {#if st.running}
      <div class="row">
        <span class="dot" aria-hidden="true"></span>
        <span class="clock num" title="This session">{clock(sessionMs)}</span>
        <button class="btn small ghost stop" onclick={stop} disabled={busy} title="Stop working"><Icon name="x" size={14} />Stop</button>
      </div>
      {#if st.label}
        <p class="line">
          <strong>{st.running.done}</strong> {st.label} this session{#if !compact}, {clock(todayMs)} worked today{/if}
        </p>
        {#if st.perHour}
          <p class="pace">
            {#if st.behind > 0}
              <Icon name="x" size={13} />{st.behind} behind ({st.counted} of {st.expected})
            {:else}
              <Icon name="check" size={13} />On pace ({st.counted} of {st.expected})
            {/if}
          </p>
        {/if}
      {/if}
    {:else if st.elsewhere}
      <p class="line">Working on <strong>{st.elsewhere.name}</strong></p>
      <div class="row">
        <button class="btn small" onclick={start} disabled={busy}><Icon name="today" size={14} />Switch here</button>
        <button class="btn small ghost" onclick={stop} disabled={busy}>Stop</button>
      </div>
    {:else}
      <button class="btn small primary go" onclick={start} disabled={busy}><Icon name="today" size={15} />Start working</button>
      {#if !compact && st.workedMs > 0}<p class="line faint">{clock(st.workedMs)} worked today, {st.today} {st.label}</p>{/if}
    {/if}
    {#if st.label && !compact}
      <button class="target" onclick={openTarget} aria-expanded={editing}>
        <Icon name="settings" size={13} />{st.perHour ? paceText(st) : 'Set a target'}
      </button>
    {/if}
    {#if editing}
      <form class="edit" onsubmit={saveTarget} transition:slide={{ duration: 160 }}>
        <label class="opt"><input type="radio" bind:group={form.mode} value="hour" />Per hour</label>
        <label class="opt"><input type="radio" bind:group={form.mode} value="day" />Per day</label>
        {#if form.mode === 'hour'}
          <label class="field">{st.label} an hour<input type="number" min="0" max="500" bind:value={form.perHour} /></label>
        {:else}
          <label class="field">{st.label} a day<input type="number" min="0" max="5000" bind:value={form.perDay} /></label>
          <label class="field">over how many hours<input type="number" min="0.5" max="16" step="0.5" bind:value={form.dayHours} /></label>
        {/if}
        <p class="faint hint">You're behind when you've done fewer than that pace for the time the clock has run. 0 turns alerts off.</p>
        <div class="row">
          <button type="button" class="btn small ghost" onclick={() => (editing = false)}>Cancel</button>
          <button class="btn small primary">Save</button>
        </div>
      </form>
    {/if}
  </div>
{/if}

<style>
  .wt {
    display: grid;
    gap: 6px;
    padding: 10px 12px;
    border-radius: 14px;
    background: var(--raised);
    border: 1px solid var(--line);
    font-size: 13px;
  }
  .wt.on {
    border-color: color-mix(in srgb, var(--tone, var(--line)) 55%, var(--line));
    background: color-mix(in srgb, var(--tone-soft, var(--raised)) 60%, var(--raised));
  }
  .wt.t-none.on {
    border-color: var(--line);
    background: var(--raised);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--red);
    animation: blink 1.6s ease-in-out infinite;
  }
  @keyframes blink {
    50% {
      opacity: 0.25;
    }
  }
  .clock {
    font-size: 22px;
    font-weight: 800;
    flex: 1;
    letter-spacing: 0.01em;
  }
  .stop {
    padding: 0 8px;
  }
  .line {
    margin: 0;
    color: var(--ink-2);
    line-height: 1.35;
  }
  .pace {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 5px;
    font-weight: 700;
    color: var(--tone, var(--ink));
  }
  .t-none .pace {
    color: var(--ink-2);
  }
  .go {
    width: 100%;
    justify-content: center;
  }
  .target {
    border: 0;
    background: none;
    padding: 0;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--ink-3);
    font-size: 12px;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
  }
  .target:hover {
    color: var(--ink);
  }
  .edit {
    display: grid;
    gap: 8px;
    padding-top: 6px;
    border-top: 1px solid var(--line-2);
  }
  .edit .field {
    font-size: 12px;
    text-transform: none;
  }
  .edit input[type='number'] {
    padding: 6px 8px;
    font-size: 14px;
  }
  .opt {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    font-weight: 600;
    margin-right: 10px;
  }
  .hint {
    margin: 0;
    font-size: 11.5px;
  }
  .compact {
    padding: 6px 10px;
  }
  .compact .clock {
    font-size: 17px;
  }
</style>
