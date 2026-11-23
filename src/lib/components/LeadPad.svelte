<script>
  import { slide } from 'svelte/transition';
  import { invalidateAll } from '$app/navigation';
  import Icon from './Icon.svelte';
  import { SDR_OUTCOMES } from '$lib/stats.js';
  import { leadName, reasonOptions, calendarNote, DM_PAD } from '$lib/leads.js';
  import { dayLabel } from '$lib/fmt.js';
  import { addDays } from '$lib/time.js';
  import { toast } from '$lib/toast.svelte.js';

  /**
   * Note box, the five outcome pads (keys 1 to 5), then the reason (second disposition) for the
   * outcome you picked. A reason is required: nothing is logged until you pick one or type your
   * own. A callback also takes its date here.
   */
  let { lead, today, onlogged, reasons = {}, busy = $bindable(false), mode = 'sdr', canBook = true } = $props();
  // dialling offers get the five call outcomes; DM setting offers get the DM ones
  const PADS = $derived(mode === 'dm' ? DM_PAD : SDR_OUTCOMES);

  let note = $state('');
  let pending = $state(null); // outcome key waiting for its reason
  let cbDate = $state('');
  let cbTime = $state('');
  // pressing Booked: when the call is, so it goes on the calendar (unless it's already there)
  let bkDate = $state('');
  let bkTime = $state('');
  let bkSkip = $state(false);
  // the booking's meeting link and who to invite
  let bkMeeting = $state('');
  let bkLink = $state('');
  let bkGuests = $state([]);
  let bkNotify = $state(false);
  let meetOpts = $state(null); // { zoom, regular }
  async function loadMeetOpts() {
    if (meetOpts) return;
    try {
      const [z, g] = await Promise.all([fetch('/api/settings/zoom').then((r) => r.json()), fetch('/api/settings/guests').then((r) => r.json())]);
      meetOpts = { zoom: z.connected, regular: g.guests };
      if (!bkMeeting) bkMeeting = z.connected ? 'zoom' : 'meet';
    } catch {
      meetOpts = { zoom: false, regular: [] };
    }
  }
  const toggleGuest = (e) => (bkGuests = bkGuests.includes(e) ? bkGuests.filter((x) => x !== e) : [...bkGuests, e]);
  let timeBox = $state(null);
  const hasCall = $derived(!canBook || !!(lead.call && !lead.call.cancelled));
  let other = $state('');

  let lastId = null;
  $effect(() => {
    if (lead.id !== lastId) {
      lastId = lead.id;
      note = '';
      pending = null;
      other = '';
    }
  });

  const options = $derived(pending ? reasonOptions(pending, reasons).slice(0, 9) : []);
  const pendingLabel = $derived(PADS.find((o) => o.key === pending)?.label || '');

  async function log(outcome, reason) {
    if (busy || !String(reason || '').trim()) return;
    const followUp = outcome === 'callback' ? cbDate || addDays(today, 1) : null;
    const book = outcome === 'booked' && !hasCall && !bkSkip;
    if (outcome === 'callback' && !cbTime) {
      toast('Pick a time for the callback first', 'error');
      return timeBox?.focus();
    }
    if (book && (!bkDate || !bkTime)) {
      toast('Pick the date and time of the call first', 'error');
      return timeBox?.focus();
    }
    if (book && bkMeeting === 'link' && !/^https:\/\/\S+$/.test(bkLink.trim())) return toast('Paste a full https:// meeting link', 'error');
    busy = true;
    try {
      const r = await fetch(`/api/leads/${lead.id}/dials`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ outcome, followUp, followUpTime: followUp ? cbTime : '', bookDate: book ? bkDate : '', bookTime: book ? bkTime : '', bookSkip: outcome === 'booked' && !book, bookMeeting: book ? (bkMeeting === 'link' ? bkLink.trim() : bkMeeting || undefined) : undefined, bookGuests: book ? bkGuests : [], bookNotify: book && bkNotify, reason, note: note.trim() })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message || 'Could not save that dial');
      const label = PADS.find((o) => o.key === outcome).label.toLowerCase();
      toast(
        `${leadName(lead)}: ${label}${reason ? `, ${reason.toLowerCase()}` : ''}${followUp ? `, call back ${dayLabel(followUp, { weekday: 'short', day: 'numeric', month: 'short' })}${cbTime ? ` at ${cbTime}` : ''}` : ''}${calendarNote(j.calendar)}`,
        j.calendar?.error ? 'error' : undefined
      );
      note = '';
      pending = null;
      other = '';
      cbTime = '';
      bkTime = '';
      bkSkip = false;
      bkGuests = [];
      bkNotify = false;
      bkLink = '';
      const dialId = Math.max(...j.lead.dials.map((d) => d.id));
      await onlogged?.({ lead: j.lead, dialId, outcome, name: leadName(lead) });
      await invalidateAll();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      busy = false;
    }
  }

  function press(o) {
    if (pending === o.key) return (pending = null);
    pending = o.key;
    other = '';
    if (o.key === 'callback') cbDate = lead.followUp && lead.followUp > today ? lead.followUp : addDays(today, 1);
    if (o.key === 'booked' && !bkDate) bkDate = addDays(today, 1);
    if (o.key === 'booked') loadMeetOpts();
  }

  // keys: 1-5 pick an outcome; once picked, 1-9 pick its reason, Esc backs out
  function onkey(e) {
    if (e.target.closest('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.querySelector('[role="dialog"]')) return;
    if (pending) {
      const i = Number(e.key) - 1;
      if (i >= 0 && i < options.length) {
        e.preventDefault();
        log(pending, options[i]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        pending = null;
      }
      return;
    }
    const i = Number(e.key) - 1;
    if (i >= 0 && i < PADS.length) {
      e.preventDefault();
      press(PADS[i]);
    }
  }
  // the note wraps and grows as you type (field-sizing where the browser has it, this otherwise);
  // it also shrinks back once the note clears after logging
  function grow(el) {
    const fit = () => {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight + 2, window.innerHeight * 0.5) + 'px';
    };
    queueMicrotask(fit);
    el.addEventListener('input', fit);
    return { update: () => queueMicrotask(fit), destroy: () => el.removeEventListener('input', fit) };
  }
  const quick = [
    ['Tomorrow', 1],
    ['In 2 days', 2],
    ['Next week', 7]
  ];
</script>

<svelte:window onkeydown={onkey} />

<div class="pad-wrap">
  {#if mode === 'sdr' && lead.doNotContact?.includes('call')}
    <p class="warn"><Icon name="x" size={15} />They asked not to be called{lead.dncNote ? ` (${lead.dncNote})` : ''}. Only log a call here if they rang you.</p>
  {/if}
  <label class="field">
    <span class="sr-only">Note from this call</span>
    <textarea
      class="note"
      rows="1"
      use:grow={note}
      bind:value={note}
      placeholder={mode === 'dm' ? 'Note from this DM (optional), e.g. asked about pricing, follow up Friday' : 'Note from this call (optional), e.g. spoke to receptionist, owner back Friday'}
    ></textarea>
  </label>

  <div class="pads" style="--n: {PADS.length}">
    {#each PADS as o, i}
      <button class="pad t-{o.tone}" class:on={pending === o.key} class:dim={pending && pending !== o.key} onclick={() => press(o)} disabled={busy} aria-pressed={pending === o.key}>
        <span class="key">{i + 1}</span>{o.label}
      </button>
    {/each}
  </div>

  {#if pending}
    {@const tone = PADS.find((o) => o.key === pending)?.tone ?? 'none'}
    <div class="why t-{tone}" transition:slide={{ duration: 180 }}>
      {#if pending === 'callback'}
        <div class="cb">
          <span class="k">Call back on</span>
          {#each quick as [label, n]}
            <button class="btn small" class:primary={cbDate === addDays(today, n)} onclick={() => (cbDate = addDays(today, n))}>{label}</button>
          {/each}
          <input type="date" bind:value={cbDate} min={today} aria-label="Callback date" />
          <input type="time" bind:this={timeBox} bind:value={cbTime} required aria-label="Callback time" title="Goes on your calendar as a 15-minute slot" />
        </div>
      {:else if pending === 'booked' && !hasCall}
        <div class="cb">
          <span class="k">Call on</span>
          {#if !bkSkip}
            <input type="date" bind:value={bkDate} min={today} aria-label="Call date" />
            <input type="time" bind:this={timeBox} bind:value={bkTime} required aria-label="Call time" title="Goes on your calendar as a 1-hour call" />
          {/if}
          <label class="skip"><input type="checkbox" bind:checked={bkSkip} />Already on my calendar</label>
        </div>
        {#if !bkSkip && meetOpts}
          <div class="cb">
            <span class="k">Link</span>
            <select bind:value={bkMeeting} aria-label="Meeting link">
              <option value="zoom" disabled={!meetOpts.zoom}>Zoom{meetOpts.zoom ? '' : ' (connect in Settings)'}</option>
              <option value="meet">Google Meet</option>
              <option value="link">Paste a link</option>
            </select>
            {#if bkMeeting === 'link'}<input class="lnk" bind:value={bkLink} placeholder="https://…" aria-label="Meeting link" />{/if}
          </div>
          {#if lead.email || meetOpts.regular.length}
            <div class="cb">
              <span class="k">Invite</span>
              {#if lead.email}
                <label class="skip"><input type="checkbox" checked={bkGuests.includes(lead.email.toLowerCase())} onchange={() => toggleGuest(lead.email.toLowerCase())} />{lead.contact || lead.email}</label>
              {/if}
              {#each meetOpts.regular as g}
                <label class="skip"><input type="checkbox" checked={bkGuests.includes(g.email)} onchange={() => toggleGuest(g.email)} />{g.name || g.email}</label>
              {/each}
              {#if bkGuests.length}<label class="skip"><input type="checkbox" bind:checked={bkNotify} />Email them the invite</label>{/if}
            </div>
          {/if}
        {/if}
      {/if}
      <div class="wtop">
        <span class="k">{pendingLabel}: why?</span>
        <span class="faint hint">Pick a reason to log it. Keys 1 to {options.length}, Esc to go back</span>
      </div>
      <div class="chips">
        {#each options as r, i}
          <button class="rc" onclick={() => log(pending, r)} disabled={busy}><span class="n">{i + 1}</span>{r}</button>
        {/each}
      </div>
      <div class="foot">
        <form class="own" onsubmit={(e) => (e.preventDefault(), other.trim() && log(pending, other.trim()))}>
          <input bind:value={other} placeholder="Other reason" aria-label="Other reason" maxlength="80" />
          <button class="btn small primary" disabled={busy || !other.trim()}><Icon name="check" size={13} />Log with this</button>
        </form>
        <span class="spacer"></span>
        <button class="btn small ghost" onclick={() => (pending = null)} disabled={busy}>Cancel</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .pad-wrap {
    display: grid;
    gap: 14px;
  }
  .warn {
    margin: 0;
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--red-soft);
    color: var(--ink);
    font-size: 13.5px;
    font-weight: 600;
  }
  .field textarea.note {
    min-height: 0;
    max-height: 50vh;
    resize: none;
    overflow-y: auto;
    field-sizing: content;
    line-height: 1.45;
  }
  .pads {
    display: grid;
    grid-template-columns: repeat(var(--n, 5), 1fr);
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
  .pad.dim {
    opacity: 0.45;
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
  .why {
    display: grid;
    gap: 10px;
    padding: 12px 14px;
    border-radius: 14px;
    background: var(--tone-soft);
    border: 1px solid color-mix(in srgb, var(--tone) 40%, transparent);
  }
  .wtop {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    align-items: baseline;
  }
  .hint {
    font-size: 12px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .rc {
    height: 34px;
    padding: 0 12px 0 8px;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: var(--raised);
    font-size: 13.5px;
    font-weight: 600;
    color: var(--ink);
    display: inline-flex;
    align-items: center;
    gap: 7px;
    transition: border-color 0.12s, transform 0.12s var(--ease-spring);
  }
  .rc:hover {
    border-color: var(--tone);
  }
  .rc:active {
    transform: scale(0.96);
  }
  .rc .n {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 11px;
    background: var(--tone-soft);
    color: var(--ink-2);
  }
  .foot {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .spacer {
    flex: 1;
  }
  .own {
    display: flex;
    gap: 6px;
  }
  .own input {
    height: 32px;
    width: 180px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--raised);
    color: var(--ink);
    padding: 0 10px;
    font-size: 13px;
  }
  .cb {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    padding-bottom: 10px;
    border-bottom: 1px solid color-mix(in srgb, var(--tone) 30%, transparent);
  }
  .k {
    font-size: 11.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-3);
  }
  .skip {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    font-size: 13px;
    font-weight: 600;
    color: var(--ink-2);
  }
  .cb select,
  .lnk {
    height: 32px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--raised);
    color: var(--ink);
    padding: 0 8px;
  }
  .lnk {
    min-width: 220px;
  }
  .skip input {
    height: auto;
  }
  .cb input {
    height: 32px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--raised);
    color: var(--ink);
    padding: 0 8px;
  }
  @media (max-width: 760px) {
    .pads {
      grid-template-columns: repeat(2, 1fr);
    }
    .pads .pad:nth-child(odd):last-child {
      grid-column: span 2;
    }
  }
</style>
