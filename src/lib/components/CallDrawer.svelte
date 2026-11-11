<script>
  import { fly, fade } from 'svelte/transition';
  import { invalidateAll } from '$app/navigation';
  import Icon from './Icon.svelte';
  import OutcomePicker from './OutcomePicker.svelte';
  import { time, dayLabel, duration, money } from '$lib/fmt.js';
  import { dayKey } from '$lib/time.js';
  import { md } from '$lib/md.js';
  import { toast } from '$lib/toast.svelte.js';

  let { call, tz, recordings = [], onclose } = $props();

  let outcome = $state(call.outcome);
  let cash = $state(call.cash || '');
  let notes = $state(call.notes || '');
  let fathomUrl = $state(call.fathom && !call.fathom.id ? call.fathom.url : '');
  let pickRec = $state('');
  let saving = $state(false);

  async function patch(body, msg) {
    saving = true;
    try {
      const r = await fetch(`/api/calls/${encodeURIComponent(call.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!r.ok) throw new Error();
      if (msg) toast(msg);
      await invalidateAll();
    } catch {
      toast('Could not save. Try again.', 'error');
    } finally {
      saving = false;
    }
  }

  function setOutcome(o) {
    outcome = o;
    patch({ outcome: o }, o === 'pending' ? 'Outcome cleared' : 'Outcome saved');
  }
  const saveDetails = () => patch({ cash: Number(cash) || 0, notes, fathomManualUrl: fathomUrl || null }, 'Call saved');
  const linkRec = () => pickRec && patch({ fathomId: pickRec }, 'Recording linked');
  const unlink = () => patch({ fathomId: null, fathomManualUrl: null }, 'Recording unlinked');

  const isPast = $derived(new Date(call.end) < new Date());
  function onkey(e) {
    if (e.key === 'Escape') onclose();
  }
</script>

<svelte:window onkeydown={onkey} />

<div class="scrim" transition:fade={{ duration: 180 }} onclick={onclose} role="presentation"></div>
<div class="drawer" transition:fly={{ x: 420, duration: 340, opacity: 1 }} aria-label="Call details" role="dialog" aria-modal="true">
  <header>
    <div>
      <span class="kind">{call.kind}</span>
      <h2>{call.prospect}</h2>
      <p class="muted when">
        {dayLabel(dayKey(call.start, tz), { weekday: 'long', day: 'numeric', month: 'long' })}, {time(call.start, tz)} for {duration(call.start, call.end)}
      </p>
    </div>
    <button class="btn ghost small" onclick={onclose} aria-label="Close"><Icon name="x" /></button>
  </header>

  <div class="body">
    <div class="contact">
      {#if call.phone}<a class="btn small" href="tel:{call.phone.replace(/\s/g, '')}"><Icon name="phone" size={15} />{call.phone}</a>{/if}
      {#if call.email}<a class="btn small" href="mailto:{call.email}"><Icon name="mail" size={15} />{call.email}</a>{/if}
      {#if call.joinUrl && !isPast}<a class="btn small primary" href={call.joinUrl} target="_blank" rel="noopener"><Icon name="video" size={15} />Join call</a>{/if}
    </div>

    <section>
      <h3>Outcome</h3>
      <OutcomePicker value={outcome} onpick={setOutcome} disabled={saving} />
    </section>

    <section class="grid2">
      <label class="field">Cash collected (AUD)
        <input type="number" min="0" step="1" inputmode="decimal" bind:value={cash} placeholder="0" />
      </label>
    </section>

    <section>
      <label class="field">Notes
        <textarea bind:value={notes} placeholder="Objections, budget, next step"></textarea>
      </label>
    </section>

    <section class="fathom">
      <h3><Icon name="record" size={17} /> Fathom recording</h3>
      {#if call.fathom?.id}
        <div class="rec">
          <div class="rec-head">
            <strong>{call.fathom.title}</strong>
            <div class="rec-actions">
              <a class="btn small" href={call.fathom.url} target="_blank" rel="noopener"><Icon name="external" size={14} />Watch</a>
              <button class="btn small ghost" onclick={unlink}>Unlink</button>
            </div>
          </div>
          {#if call.fathom.summary}
            <div class="summary">{@html md(call.fathom.summary)}</div>
          {:else}
            <p class="faint">No summary yet. Fathom adds it a few minutes after the call ends.</p>
          {/if}
          {#if call.fathom.actionItems?.length}
            <h4>Action items</h4>
            <ul>{#each call.fathom.actionItems as a}<li>{a}</li>{/each}</ul>
          {/if}
        </div>
      {:else}
        {#if call.fathom?.url}
          <p><a href={call.fathom.url} target="_blank" rel="noopener">Open saved recording link</a></p>
        {/if}
        {#if recordings.length}
          <div class="linkrow">
            <label class="field grow">Pick from recent recordings
              <select bind:value={pickRec}>
                <option value="">Choose a recording</option>
                {#each recordings as r}<option value={r.id}>{r.title} ({dayLabel(dayKey(r.start, tz))})</option>{/each}
              </select>
            </label>
            <button class="btn" onclick={linkRec} disabled={!pickRec}>Link</button>
          </div>
        {/if}
        <label class="field">Or paste a Fathom link
          <input type="url" bind:value={fathomUrl} placeholder="https://fathom.video/calls/…" />
        </label>
      {/if}
    </section>
  </div>

  <footer>
    <button class="btn primary" onclick={saveDetails} disabled={saving}><Icon name="check" size={16} />Save call</button>
  </footer>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: color-mix(in srgb, var(--ink) 35%, transparent);
    z-index: 40;
  }
  .drawer {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(460px, 100vw);
    z-index: 41;
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border-left: 1px solid var(--line-2);
    box-shadow: -20px 0 60px -30px rgba(0, 0, 0, 0.45);
  }
  header {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 24px 22px 16px;
    border-bottom: 1px solid var(--line-2);
  }
  .kind {
    font-size: 12.5px;
    font-weight: 700;
    color: var(--blue);
  }
  h2 {
    font-size: 26px;
    margin: 4px 0 6px;
    font-variation-settings: 'wdth' 115;
    font-weight: 800;
  }
  .when {
    margin: 0;
    font-size: 14px;
  }
  .body {
    flex: 1;
    overflow-y: auto;
    padding: 18px 22px;
    display: grid;
    gap: 22px;
    align-content: start;
  }
  section h3 {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
    font-size: 14px;
  }
  .contact {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .contact .btn {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .fathom {
    display: grid;
    gap: 12px;
  }
  .rec {
    border: 1px solid var(--line-2);
    border-radius: 12px;
    background: var(--raised);
    padding: 14px;
  }
  .rec-head {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 10px;
    align-items: center;
    margin-bottom: 8px;
  }
  .rec-actions {
    display: flex;
    gap: 6px;
  }
  .summary {
    font-size: 14px;
    line-height: 1.55;
    color: var(--ink-2);
  }
  .summary :global(h4),
  .rec h4 {
    margin: 14px 0 4px;
    font-size: 13.5px;
    color: var(--ink);
  }
  .summary :global(p) {
    margin: 0 0 8px;
  }
  .summary :global(ul),
  .rec ul {
    margin: 0 0 8px;
    padding-left: 18px;
    font-size: 14px;
  }
  .summary :global(a) {
    color: inherit;
    text-decoration-color: var(--line);
    text-underline-offset: 3px;
  }
  .summary :global(a:hover) {
    color: var(--blue);
    text-decoration-color: currentColor;
  }
  .linkrow {
    display: flex;
    gap: 8px;
    align-items: end;
  }
  .grow {
    flex: 1;
  }
  footer {
    padding: 14px 22px calc(14px + env(safe-area-inset-bottom));
    border-top: 1px solid var(--line-2);
    display: flex;
    justify-content: flex-end;
  }
</style>
