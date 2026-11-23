<script>
  // In the call drawer: move the booking, change its meeting link, choose guests, and (if you want)
  // have Google email them the invite or update. Reads the live event from Google when it opens.
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import Icon from './Icon.svelte';
  import { toast } from '$lib/toast.svelte.js';
  import { wallClock } from '$lib/leads.js';
  import { dayStartIso } from '$lib/time.js';

  let { call, tz } = $props();

  let info = $state(null);
  let err = $state('');
  let busy = $state(false);
  let date = $state('');
  let time = $state('');
  let mins = $state(60);
  let meeting = $state('keep');
  let link = $state('');
  let guests = $state([]);
  let newGuest = $state('');
  let notify = $state(false);

  function reset(i) {
    const w = wallClock(i.start, tz);
    date = w.date;
    time = w.time;
    mins = Math.round((Date.parse(i.end) - Date.parse(i.start)) / 60000);
    meeting = 'keep';
    link = '';
    guests = i.guests.map((g) => g.email);
    newGuest = '';
    notify = false;
  }
  async function load() {
    try {
      const r = await fetch(`/api/calls/${encodeURIComponent(call.id)}/booking`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.message);
      info = j;
      reset(j);
    } catch (e) {
      err = e.message || 'Could not read the booking';
    }
  }
  onMount(load);

  const startIso = $derived(date && /^\d{2}:\d{2}$/.test(time) ? new Date(Date.parse(dayStartIso(date, tz)) + (Number(time.slice(0, 2)) * 60 + Number(time.slice(3))) * 60000).toISOString() : null);
  const moved = $derived(!!info && !!startIso && (startIso !== new Date(info.start).toISOString() || mins !== Math.round((Date.parse(info.end) - Date.parse(info.start)) / 60000)));
  const guestsChanged = $derived(!!info && JSON.stringify([...guests].sort()) !== JSON.stringify(info.guests.map((g) => g.email).sort()));
  const meetingChanged = $derived(meeting !== 'keep');
  const dirty = $derived(moved || guestsChanged || meetingChanged);
  const prospectEmail = $derived(call.email?.toLowerCase() || '');

  function toggle(email) {
    const e = email.toLowerCase();
    guests = guests.includes(e) ? guests.filter((g) => g !== e) : [...guests, e];
  }
  function addGuest(e) {
    e.preventDefault();
    const v = newGuest.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return toast('That email looks wrong', 'error');
    if (!guests.includes(v)) guests = [...guests, v];
    newGuest = '';
  }

  async function save() {
    if (meeting === 'link' && !/^https:\/\/\S+$/.test(link.trim())) return toast('Paste a full https:// meeting link', 'error');
    busy = true;
    try {
      const body = { notify };
      if (moved) {
        body.start = startIso;
        body.end = new Date(Date.parse(startIso) + mins * 60000).toISOString();
      }
      if (meetingChanged) body.meeting = meeting === 'link' ? link.trim() : meeting === 'none' ? '' : meeting;
      if (guestsChanged) body.guests = guests;
      const r = await fetch(`/api/calls/${encodeURIComponent(call.id)}/booking`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message || 'Could not change the booking');
      const did = [moved && 'moved', meetingChanged && 'new meeting link', guestsChanged && 'guests updated'].filter(Boolean).join(', ');
      toast(`Booking ${did}${j.notified ? '. Guests emailed.' : ''}${j.warnings?.length ? ` (${j.warnings[0]})` : ''}`);
      await invalidateAll();
      await load();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      busy = false;
    }
  }
</script>

<section class="booking">
  <h3><Icon name="calendar" size={17} /> Booking</h3>
  {#if err}
    <p class="faint">{err}</p>
  {:else if !info}
    <p class="faint">Reading the booking from your calendar…</p>
  {:else}
    {#if info.problem}<p class="warn">{info.problem}</p>{/if}
    {#if info.onGoogle && !info.editable}
      <p class="warn">This booking was made on {info.organizer}'s calendar, so only they can move it or change its guests.</p>
    {/if}

    <div class="when">
      <label class="field">Date<input type="date" bind:value={date} /></label>
      <label class="field">Time<input type="time" bind:value={time} step="300" /></label>
      <label class="field">Length
        <select bind:value={mins}>
          {#each [15, 30, 45, 60, 75, 90, 120] as m}<option value={m}>{m < 60 ? `${m} min` : `${m / 60} h`.replace('.5 h', ' h 30')}</option>{/each}
          {#if ![15, 30, 45, 60, 75, 90, 120].includes(mins)}<option value={mins}>{mins} min</option>{/if}
        </select>
      </label>
    </div>

    <div class="meet">
      <span class="k">Meeting link</span>
      {#if info.joinUrl}
        <a class="cur" href={info.joinUrl} target="_blank" rel="noopener"><Icon name="video" size={14} />{info.joinUrl.replace(/^https:\/\//, '').slice(0, 48)}</a>
      {:else}
        <span class="faint">No link yet</span>
      {/if}
      <select bind:value={meeting} aria-label="Change the meeting link">
        <option value="keep">Keep this link</option>
        <option value="zoom" disabled={!info.zoom}>New Zoom meeting{info.zoom ? '' : ' (connect Zoom in Settings)'}</option>
        {#if info.onGoogle}<option value="meet">Google Meet</option>{/if}
        <option value="link">Paste another link</option>
        <option value="none">No link</option>
      </select>
      {#if meeting === 'link'}<input class="link" bind:value={link} placeholder="https://…" inputmode="url" />{/if}
    </div>

    {#if info.onGoogle}
      <div class="guests">
        <span class="k">Guests</span>
        <div class="chips">
          {#if prospectEmail}
            <label class="chip" class:on={guests.includes(prospectEmail)}><input type="checkbox" checked={guests.includes(prospectEmail)} onchange={() => toggle(prospectEmail)} />{call.prospect || prospectEmail} <span class="faint">(lead)</span></label>
          {/if}
          {#each info.regular as g}
            <label class="chip" class:on={guests.includes(g.email)}><input type="checkbox" checked={guests.includes(g.email)} onchange={() => toggle(g.email)} />{g.name || g.email}</label>
          {/each}
          {#each guests.filter((e) => e !== prospectEmail && !info.regular.some((g) => g.email === e)) as e}
            <label class="chip on"><input type="checkbox" checked onchange={() => toggle(e)} />{e}</label>
          {/each}
        </div>
        <form class="add" onsubmit={addGuest}>
          <input bind:value={newGuest} placeholder="Add a guest's email" inputmode="email" />
          <button class="btn small" disabled={!newGuest.trim()}><Icon name="plus" size={13} />Add</button>
        </form>
        {#if !info.regular.length}<p class="faint hint">Add people you often bring onto calls in Settings > Regular guests.</p>{/if}
      </div>
      <label class="notify"><input type="checkbox" bind:checked={notify} />Email the guests {moved ? 'the new time' : 'the invite'} (Google sends it from your calendar)</label>
    {:else}
      <p class="faint hint">This call isn't on your Google Calendar, so guests can't be invited from here.</p>
    {/if}

    <div class="acts">
      {#if dirty}<button class="btn small ghost" onclick={() => reset(info)} disabled={busy}>Undo changes</button>{/if}
      <button class="btn small primary" onclick={save} disabled={busy || !dirty || (info.onGoogle && !info.editable)}>
        <Icon name="check" size={14} />{busy ? 'Saving' : 'Save booking'}
      </button>
    </div>
  {/if}
</section>

<style>
  .booking {
    display: grid;
    gap: 12px;
  }
  h3 {
    display: flex;
    align-items: center;
    gap: 7px;
    margin: 0;
  }
  .when {
    display: grid;
    grid-template-columns: 1.4fr 1fr 1fr;
    gap: 8px;
  }
  .k {
    font-size: 11.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-3);
  }
  .meet,
  .guests {
    display: grid;
    gap: 6px;
  }
  .cur {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    word-break: break-all;
  }
  select,
  .link,
  .add input {
    height: 36px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--raised);
    color: var(--ink);
    padding: 0 10px;
    font-size: 14px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: var(--raised);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
  .chip.on {
    border-color: var(--blue);
    background: var(--blue-soft, var(--raised));
  }
  .add {
    display: flex;
    gap: 6px;
  }
  .add input {
    flex: 1;
    min-width: 0;
  }
  .notify {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 13.5px;
    font-weight: 600;
  }
  .hint {
    margin: 0;
    font-size: 12.5px;
  }
  .warn {
    margin: 0;
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--yellow-soft, #fff6d6);
    font-size: 13px;
  }
  .acts {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
</style>
