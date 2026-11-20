<script>
  import { fly, slide } from 'svelte/transition';
  import { invalidateAll } from '$app/navigation';
  import Icon from './Icon.svelte';
  import { SDR_OUTCOMES } from '$lib/stats.js';
  import { dialQueue, isDue, leadName, pickExtra, linkFor, stageOf } from '$lib/leads.js';
  import { dayLabel, ddmm } from '$lib/fmt.js';
  import { addDays } from '$lib/time.js';
  import { toast } from '$lib/toast.svelte.js';

  let { leads, today, currentId = $bindable(null), onopen } = $props();

  let skipped = $state([]);
  let last = $state(null);
  let note = $state('');
  let cbOpen = $state(false);
  let cbDate = $state('');
  let busy = $state(false);

  const queue = $derived(dialQueue(leads, today).filter((l) => !skipped.includes(l.id)));
  const allQueued = $derived(dialQueue(leads, today));
  const current = $derived((currentId != null && leads.find((l) => l.id === currentId)) || queue[0] || null);
  const due = $derived(allQueued.filter((l) => isDue(l, today)).length);

  const PITCH = /pitch|angle/i;
  const WHY = /why/i;
  const shownExtra = $derived(current ? current.extra.filter(([k]) => !PITCH.test(k) && !WHY.test(k)) : []);

  let lastId = null;
  $effect(() => {
    // fresh note and closed callback picker whenever the lead on screen changes
    if (current?.id !== lastId) {
      lastId = current?.id ?? null;
      note = '';
      cbOpen = false;
    }
  });

  async function log(outcome, followUp = null) {
    if (!current || busy) return;
    const lead = current;
    busy = true;
    try {
      const r = await fetch(`/api/leads/${lead.id}/dials`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ outcome, followUp, note: note.trim() })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message || 'Could not save that dial');
      last = { leadId: lead.id, dialId: j.lead.dials.at(-1).id, outcome, name: leadName(lead) };
      const label = SDR_OUTCOMES.find((o) => o.key === outcome).label.toLowerCase();
      toast(`${leadName(lead)}: ${label}${followUp ? `, call back ${dayLabel(followUp, { weekday: 'short', day: 'numeric', month: 'short' })}` : ''}`);
      currentId = null;
      skipped = skipped.filter((id) => id !== lead.id);
      await invalidateAll();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      busy = false;
    }
  }

  function press(o) {
    if (o.key === 'callback') {
      cbOpen = !cbOpen;
      cbDate = current?.followUp && current.followUp > today ? current.followUp : addDays(today, 1);
    } else log(o.key);
  }

  async function undo() {
    if (!last || busy) return;
    const u = last;
    busy = true;
    try {
      const r = await fetch(`/api/leads/${u.leadId}/dials/${u.dialId}`, { method: 'DELETE' });
      if (!r.ok) throw new Error();
      last = null;
      currentId = u.leadId;
      toast(`Took back the ${SDR_OUTCOMES.find((o) => o.key === u.outcome).label.toLowerCase()} on ${u.name}`);
      await invalidateAll();
    } catch {
      toast('Could not undo that dial', 'error');
    } finally {
      busy = false;
    }
  }

  function skip() {
    if (!current) return;
    skipped = [...skipped, current.id];
    currentId = null;
  }

  function onkey(e) {
    if (!current || e.target.closest('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.querySelector('[role="dialog"]')) return;
    const i = Number(e.key) - 1;
    if (i >= 0 && i < SDR_OUTCOMES.length) {
      e.preventDefault();
      press(SDR_OUTCOMES[i]);
    } else if (e.key === 's' || e.key === 'S') {
      e.preventDefault();
      skip();
    } else if (e.key === 'z' || e.key === 'Z') {
      e.preventDefault();
      undo();
    }
  }
  const tel = (p) => p.replace(/[^\d+]/g, '');
  const quick = [
    ['Tomorrow', 1],
    ['In 2 days', 2],
    ['Next week', 7]
  ];
</script>

<svelte:window onkeydown={onkey} />

<section class="panel dialer">
  <div class="head">
    <div>
      <h2>Dial your list</h2>
      <p class="muted small">
        {#if allQueued.length}
          {allQueued.length} to ring today{due ? `, ${due} ${due === 1 ? 'callback' : 'callbacks'} due first` : ''}. Keys 1 to 5 log the outcome, S skips, Z undoes.
        {:else}
          Nobody left to ring today.
        {/if}
      </p>
    </div>
    <div class="hacts">
      {#if skipped.length}<button class="btn small ghost" onclick={() => (skipped = [])}>Bring back {skipped.length} skipped</button>{/if}
      <button class="btn small ghost" onclick={undo} disabled={!last || busy}><Icon name="undo" size={15} />Undo</button>
    </div>
  </div>

  {#if current}
    {#key current.id}
      <article class="lead" in:fly={{ x: 40, duration: 320 }}>
        <div class="who">
          <div class="plate" class:none={current.score == null} title="Prospect score">
            <span class="score">{current.score ?? '–'}</span>
            <small>score</small>
          </div>
          <div class="names">
            <h3>{leadName(current)}</h3>
            <p class="muted">
              {[current.business && current.contact, current.suburb, current.category].filter(Boolean).join(', ')}
            </p>
            <div class="tags">
              {#if isDue(current, today)}
                <span class="chip t-yellow"><Icon name="clock" size={13} />{current.stage === 'callback' ? 'Callback' : 'Follow-up'} {current.followUp === today ? 'due today' : `due ${ddmm(current.followUp)}`}</span>
              {:else}
                <span class="chip t-{stageOf(current).tone}"><span class="dot"></span>{stageOf(current).label}</span>
              {/if}
              {#if current.attempts}<span class="faint small">{current.attempts} {current.attempts === 1 ? 'dial' : 'dials'} so far</span>{/if}
            </div>
          </div>
        </div>

        <div class="contact">
          {#if current.phone}<a class="btn primary call" href="tel:{tel(current.phone)}"><Icon name="phone" size={17} /><span class="num">{current.phone}</span></a>{/if}
          {#if current.email}<a class="btn small" href="mailto:{current.email}"><Icon name="mail" size={15} />Email</a>{/if}
          {#each current.extra.filter(([, v]) => linkFor(v)) as [k, v]}
            <a class="btn small" href={linkFor(v)} target="_blank" rel="noopener"><Icon name="external" size={14} />{k}</a>
          {/each}
        </div>

        {#if pickExtra(current, PITCH)}
          <div class="pitch">
            <span class="k">Pitch angle</span>
            <p>{pickExtra(current, PITCH)}</p>
            {#if pickExtra(current, WHY)}<p class="why muted">{pickExtra(current, WHY)}</p>{/if}
          </div>
        {:else if pickExtra(current, WHY)}
          <div class="pitch"><span class="k">Why this score</span><p>{pickExtra(current, WHY)}</p></div>
        {/if}

        {#if shownExtra.filter(([, v]) => !linkFor(v)).length}
          <dl class="facts">
            {#each shownExtra.filter(([, v]) => !linkFor(v)) as [k, v]}
              <div><dt>{k}</dt><dd>{v}</dd></div>
            {/each}
          </dl>
        {/if}

        {#if current.notes}<p class="notes"><Icon name="edit" size={14} />{current.notes}</p>{/if}

        {#if current.dials.length}
          <ol class="hist" aria-label="Past dials">
            {#each current.dials as d}
              <li class="t-{d.outcome ? SDR_OUTCOMES.find((o) => o.key === d.outcome).tone : 'none'}">
                <i></i>{d.date ? `${ddmm(d.date)}: ${SDR_OUTCOMES.find((o) => o.key === d.outcome)?.label}` : d.label}{d.note ? `, "${d.note}"` : ''}
              </li>
            {/each}
          </ol>
        {/if}

        <label class="field">
          <span class="sr-only">Note from this call</span>
          <input bind:value={note} placeholder="Note from this call (optional), e.g. spoke to receptionist, owner back Friday" />
        </label>

        <div class="pads">
          {#each SDR_OUTCOMES as o, i}
            <button class="pad t-{o.tone}" class:on={o.key === 'callback' && cbOpen} onclick={() => press(o)} disabled={busy}>
              <span class="key">{i + 1}</span>{o.label}
            </button>
          {/each}
        </div>

        {#if cbOpen}
          <div class="cb" transition:slide={{ duration: 180 }}>
            <span class="k">Call back on</span>
            {#each quick as [label, n]}
              <button class="btn small" class:primary={cbDate === addDays(today, n)} onclick={() => (cbDate = addDays(today, n))}>{label}</button>
            {/each}
            <input type="date" bind:value={cbDate} min={today} aria-label="Callback date" />
            <button class="btn small primary" onclick={() => log('callback', cbDate || addDays(today, 1))} disabled={busy}><Icon name="check" size={14} />Save callback</button>
          </div>
        {/if}

        <div class="foot">
          <button class="btn small ghost" onclick={skip}><Icon name="skip" size={14} />Skip for now</button>
          <button class="btn small ghost" onclick={() => onopen?.(current.id)}>Edit lead</button>
          {#if queue.length > 1}<span class="faint small">Next up: {leadName(queue.find((l) => l.id !== current.id))}</span>{/if}
        </div>
      </article>
    {/key}
  {:else}
    <div class="empty">
      {#if !leads.length}
        <strong>No leads yet.</strong> Import your spreadsheet to start dialling from it.
      {:else if skipped.length}
        You skipped everyone left. Bring them back to keep going.
      {:else}
        <strong>That's the list done for today.</strong> Callbacks come back on their day, and no-answers come back tomorrow.
      {/if}
    </div>
  {/if}
</section>

<style>
  .dialer {
    padding: 22px;
    margin-bottom: 18px;
    display: grid;
    gap: 16px;
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 12px;
  }
  .head p {
    margin: 4px 0 0;
  }
  .hacts {
    display: flex;
    gap: 8px;
    align-items: start;
  }
  .small {
    font-size: 13px;
  }
  .lead {
    display: grid;
    gap: 14px;
  }
  .who {
    display: flex;
    gap: 16px;
    align-items: center;
  }
  .plate {
    flex: none;
    width: 68px;
    height: 68px;
    border-radius: 50%;
    display: grid;
    place-content: center;
    text-align: center;
    background: var(--blue);
    color: #fff;
    box-shadow: inset 0 0 0 5px color-mix(in srgb, #000 14%, transparent), inset 0 0 0 7px color-mix(in srgb, #fff 18%, transparent);
  }
  .plate.none {
    background: var(--iron);
  }
  .plate .score {
    font-size: 24px;
    line-height: 1;
  }
  .plate small {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    opacity: 0.85;
  }
  .names {
    min-width: 0;
  }
  h3 {
    margin: 0;
    font-size: 24px;
    font-variation-settings: 'wdth' 110;
    letter-spacing: -0.01em;
  }
  .names p {
    margin: 2px 0 6px;
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 10px;
    align-items: center;
  }
  .contact {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .call {
    height: 46px;
    padding: 0 18px;
    font-size: 17px;
  }
  .pitch {
    padding: 14px 16px;
    border-radius: 12px;
    background: var(--blue-soft);
    border-left: 4px solid var(--blue);
  }
  .k {
    font-size: 11.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-3);
  }
  .pitch p {
    margin: 4px 0 0;
    font-size: 16px;
    font-weight: 600;
  }
  .pitch p.why {
    font-size: 14px;
    font-weight: 400;
  }
  .facts {
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 10px 18px;
  }
  .facts dt {
    font-size: 12px;
    color: var(--ink-3);
  }
  .facts dd {
    margin: 2px 0 0;
    font-weight: 600;
    font-size: 14px;
  }
  .notes {
    margin: 0;
    display: flex;
    gap: 8px;
    align-items: baseline;
    color: var(--ink-2);
    white-space: pre-wrap;
  }
  .hist {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .hist li {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
    border-radius: 999px;
    background: var(--iron-soft);
    font-size: 12.5px;
  }
  .hist i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--tone, var(--line));
  }
  .pads {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 10px;
  }
  .pad {
    position: relative;
    height: 62px;
    border-radius: 14px;
    border: 0;
    font-weight: 700;
    font-size: 15px;
    background: var(--tone-soft);
    color: var(--ink);
    box-shadow: inset 0 -4px 0 var(--tone);
    transition: transform 0.12s var(--ease-spring), box-shadow 0.15s;
  }
  .pad:hover {
    transform: translateY(-2px);
  }
  .pad:active {
    transform: translateY(1px) scale(0.98);
  }
  .pad.on {
    box-shadow: inset 0 0 0 2px var(--tone), inset 0 -4px 0 var(--tone);
  }
  .key {
    position: absolute;
    top: 6px;
    left: 9px;
    font-size: 11px;
    color: var(--ink-3);
  }
  .cb {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    padding: 12px 14px;
    border-radius: 12px;
    background: var(--yellow-soft);
  }
  .cb input {
    height: 32px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--raised);
    color: var(--ink);
    padding: 0 8px;
  }
  .foot {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .foot span {
    margin-left: auto;
  }
  .empty {
    padding: 26px;
    text-align: center;
    color: var(--ink-2);
    border: 1px dashed var(--line);
    border-radius: 14px;
  }
  @media (max-width: 760px) {
    .dialer {
      padding: 16px;
    }
    .pads {
      grid-template-columns: repeat(2, 1fr);
    }
    .pads .pad:last-child {
      grid-column: span 2;
    }
  }
</style>
