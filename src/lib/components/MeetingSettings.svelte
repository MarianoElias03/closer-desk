<script>
  // Settings: the Zoom connection for booking links, and regular guests (e.g. a teammate) offered on bookings.
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import SignatureEditor from './SignatureEditor.svelte';
  import { toast } from '$lib/toast.svelte.js';

  let zoom = $state(null);
  let z = $state({ accountId: '', clientId: '', secret: '' });
  let zBusy = $state(false);
  let guests = $state([]);
  // email accounts to send from
  let mail = $state(null);
  let hint = $state('');
  let pasted = $state('');
  let connecting = $state(false);
  let video = $state('');
  async function loadMail() {
    mail = await fetch('/api/settings/mail').then((r) => r.json());
    video = mail.video;
  }
  async function mailAct(body) {
    const r = await fetch('/api/settings/mail', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.message || 'That did not work');
    return j;
  }
  // which calendar booked calls go on (for the open offer)
  let cal = $state(null);
  let calBusy = $state(false);
  const loadCal = async () => (cal = await fetch('/api/settings/calendar').then((r) => r.json()));
  async function saveCal(change) {
    calBusy = true;
    try {
      const r = await fetch('/api/settings/calendar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ book: cal.book, copy: cal.copy, ...change }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message || 'Could not save');
      cal = { ...cal, ...j };
      toast(j.book ? `Booked calls go on ${j.book}${j.copy ? ', with a copy on your personal calendar' : ''}` : 'Booked calls go on your personal calendar');
    } catch (e) {
      toast(e.message, 'error');
      loadCal();
    } finally {
      calBusy = false;
    }
  }
  let syncing = $state(false);
  async function syncNow() {
    syncing = true;
    try {
      const { result } = await mailAct({ action: 'syncMail' });
      const n = Object.values(result).reduce((t, v) => t + (typeof v === 'number' ? v : 0), 0);
      const err = Object.values(result).find((v) => v?.error);
      toast(err ? err.error : n ? `${n} new email${n === 1 ? '' : 's'} added to leads` : 'No new emails with leads', err ? 'error' : undefined);
      loadMail();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      syncing = false;
    }
  }
  async function refreshSig(a) {
    try {
      const { signature } = await mailAct({ action: 'signature', email: a.email });
      toast(signature ? 'Signature copied from Gmail' : 'Gmail has no signature set for that address', signature ? undefined : 'error');
      loadMail();
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  function reconnect(a) {
    hint = a.email;
    startConnect();
  }
  async function startConnect() {
    try {
      const { url } = await mailAct({ action: 'start', hint: hint.trim() });
      window.open(url, '_blank', 'noopener');
      connecting = true;
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  async function finishConnect(e) {
    e.preventDefault();
    try {
      const { account } = await mailAct({ action: 'finish', pasted });
      toast(`${account.email} connected${account.calendar ? ', with calendar access' : ". Calendar access wasn't ticked, so it can only send email"}`);
      connecting = false;
      pasted = '';
      hint = '';
      loadMail();
      loadCal();
    } catch (err) {
      toast(err.message, 'error');
    }
  }
  async function removeAcct(a) {
    if (!confirm(`Stop sending from ${a.email}?`)) return;
    await fetch(`/api/settings/mail?email=${encodeURIComponent(a.email)}`, { method: 'DELETE' });
    loadMail();
    loadCal();
  }
  async function saveVideo() {
    try {
      video = (await mailAct({ action: 'video', video })).video;
      toast('Video saved');
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  let g = $state({ name: '', email: '' });

  onMount(async () => {
    const [a, b] = await Promise.all([fetch('/api/settings/zoom').then((r) => r.json()), fetch('/api/settings/guests').then((r) => r.json())]);
    zoom = a;
    z = { accountId: a.accountId, clientId: a.clientId, secret: '' };
    guests = b.guests;
    loadMail();
    loadCal();
  });

  async function saveZoom(e) {
    e.preventDefault();
    zBusy = true;
    try {
      const r = await fetch('/api/settings/zoom', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(z) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message || 'Could not connect Zoom');
      toast(j.connected ? `Zoom connected (${j.account})` : 'Saved. Add all three to connect.');
      zoom = await fetch('/api/settings/zoom').then((r) => r.json());
      z.secret = '';
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      zBusy = false;
    }
  }
  async function disconnect() {
    if (!confirm('Disconnect Zoom? New bookings will use Google Meet.')) return;
    zoom = await fetch('/api/settings/zoom', { method: 'DELETE' }).then(() => fetch('/api/settings/zoom').then((r) => r.json()));
    z = { accountId: '', clientId: '', secret: '' };
    toast('Zoom disconnected');
  }

  async function saveGuests(list) {
    const r = await fetch('/api/settings/guests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ guests: list }) });
    guests = (await r.json()).guests;
  }
  async function addGuest(e) {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(g.email.trim())) return toast('That email looks wrong', 'error');
    await saveGuests([...guests, g]);
    toast(`${g.name || g.email} added`);
    g = { name: '', email: '' };
  }
</script>

<section class="panel settings-card">
  <h2>Meeting links</h2>
  {#if zoom}
    <p class="muted">
      {#if zoom.connected}
        <Icon name="check" size={14} /> Zoom is connected. Every booking you make from Closer Desk gets its own Zoom meeting, and you can switch any booking to Google Meet or another link.
      {:else}
        Connect Zoom and every booking you make from Closer Desk gets its own Zoom meeting. Until then, bookings use Google Meet.
      {/if}
    </p>
    <details open={!zoom.connected}>
      <summary>{zoom.connected ? 'Change the Zoom connection' : 'How to connect Zoom'}</summary>
      <ol class="steps">
        <li>Go to <a href="https://marketplace.zoom.us/" target="_blank" rel="noopener">marketplace.zoom.us</a>, Develop, Build App, and pick <b>Server-to-Server OAuth</b>.</li>
        <li>Name it (e.g. Closer Desk). Under Scopes add the ones to <b>create, update and delete meetings</b> (and view users).</li>
        <li>Activate it, then copy the Account ID, Client ID and Client secret here.</li>
      </ol>
      <form class="zf" onsubmit={saveZoom}>
        <label class="field">Account ID<input bind:value={z.accountId} autocomplete="off" /></label>
        <label class="field">Client ID<input bind:value={z.clientId} autocomplete="off" /></label>
        <label class="field">Client secret<input type="password" bind:value={z.secret} autocomplete="new-password" placeholder={zoom.hasSecret ? 'Saved (leave blank to keep)' : ''} /></label>
        <div class="row">
          {#if zoom.connected}<button type="button" class="btn small ghost" onclick={disconnect}>Disconnect</button>{/if}
          <button class="btn small primary" disabled={zBusy}>{zBusy ? 'Checking' : 'Save and test'}</button>
        </div>
      </form>
    </details>
  {/if}
</section>

<section class="panel settings-card" id="email">
  <h2>Email accounts</h2>
  <p class="muted">Accounts Closer Desk can send from, like the pre-call info before a booked call. Each one can send mail, put booked calls on its calendar and check it for clashes, and sync your emails with leads (sent or received anywhere) onto their history every two minutes.</p>
  {#if mail}
    <ul class="gl">
      {#each mail.accounts as a}
        <li><span><strong>{a.email}</strong>{#if a.name}<br /><span class="faint">{a.name}</span>{/if}<br /><span class="faint">{a.calendar ? 'Calendar on' : 'No calendar'} · {a.canRead ? (a.syncError ? `Email sync failed: ${a.syncError}` : a.syncedAt ? `Emails with leads synced ${new Date(a.syncedAt).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}` : 'Email sync starting') : 'Email sync off'} · {a.signature ? 'Has a signature' : 'No signature yet'}</span></span>
          <span class="row">
            {#if (!a.calendar || !a.canRead) && mail.ready && !connecting}<button class="btn small" onclick={() => reconnect(a)}>Reconnect for {!a.canRead && !a.calendar ? 'calendar and email sync' : !a.canRead ? 'email sync' : 'calendar'}</button>{/if}
            {#if a.canRead}<button class="btn small ghost" onclick={syncNow} disabled={syncing}>{syncing ? 'Checking' : 'Check now'}</button>{/if}
            {#if a.canReadSignature}<button class="btn small ghost" onclick={() => confirm('Replace this signature with the one set in Gmail?') && refreshSig(a)}>Copy from Gmail</button>{/if}
            <button class="btn small ghost" onclick={() => removeAcct(a)}>Remove</button>
          </span></li>
        <li class="sigrow">
          <details open={!a.signature}>
            <summary>Signature for {a.email}</summary>
            {#key a.email + (a.signature ? 1 : 0)}<SignatureEditor email={a.email} html={a.signature} onsaved={() => loadMail()} />{/key}
          </details>
        </li>
      {:else}
        <li class="faint">None yet.</li>
      {/each}
    </ul>
    {#if !mail.ready}
      <p class="warn">The server needs GOOGLE_REDIRECT_URI set before an account can be connected.</p>
    {:else if !connecting}
      <div class="gf">
        <input bind:value={hint} placeholder="The email to send from, e.g. you@company.com" inputmode="email" aria-label="Email to connect" />
        <button class="btn small primary" onclick={startConnect}><Icon name="plus" size={14} />Connect</button>
      </div>
    {:else}
      <form class="zf" onsubmit={finishConnect}>
        <ol class="steps">
          <li>In the Google tab that opened, sign in as {hint || 'the account'} and allow everything it asks: <b>send email</b>, <b>read your email</b> (only emails with your leads are kept, on their history) and <b>your calendar events</b> (for booking calls on it).</li>
          <li>Google then lands on a page that may not load. That's fine: copy the whole address from the address bar.</li>
          <li>Paste it here.</li>
        </ol>
        <input class="paste" bind:value={pasted} placeholder="Paste the address here" aria-label="Address Google sent you to" />
        <div class="row">
          <button type="button" class="btn small ghost" onclick={() => (connecting = false)}>Cancel</button>
          <button class="btn small primary" disabled={!pasted.trim()}>Finish connecting</button>
        </div>
      </form>
    {/if}
    <label class="field vid">Video in the pre-call email
      <span class="gf"><input bind:value={video} inputmode="url" /><button class="btn small" onclick={saveVideo}>Save</button></span>
    </label>
  {/if}
</section>

<section class="panel settings-card" id="calendar">
  <h2>Calendar for booked calls</h2>
  <p class="muted">Where a call goes when you press Booked on a lead{cal ? ` in ${cal.offer}` : ''}. Before it books, every connected calendar is checked for something at that time.</p>
  {#if cal}
    <label class="field">Book calls on
      <select value={cal.book} onchange={(e) => saveCal({ book: e.currentTarget.value })} disabled={calBusy}>
        <option value="">{cal.personal ? `Personal (${cal.personal})` : 'Personal'}</option>
        {#each cal.accounts as a}<option value={a.email} disabled={!a.calendar}>{a.email}{a.calendar ? '' : ' (add calendar access first)'}</option>{/each}
      </select>
    </label>
    {#if cal.book}
      <label class="skip"><input type="checkbox" checked={cal.copy} onchange={(e) => saveCal({ copy: e.currentTarget.checked })} disabled={calBusy || !cal.personal} />Also put a copy on my personal calendar</label>
      <p class="faint">The copy is private (no guests, shows you as free so it doesn't double up) and moves or goes away with the real booking.</p>
    {/if}
    {#if !cal.accounts.some((a) => a.calendar)}<p class="faint">To book on a work calendar, add calendar access to that address under Email accounts above.</p>{/if}
  {/if}
</section>

<section class="panel settings-card">
  <h2>Regular guests</h2>
  <p class="muted">People you often bring onto calls. They show as one-tap guests when you book or change a booking.</p>
  <ul class="gl">
    {#each guests as x, i}
      <li><span><strong>{x.name || x.email}</strong>{#if x.name}<br /><span class="faint">{x.email}</span>{/if}</span>
        <button class="btn small ghost" onclick={() => saveGuests(guests.filter((_, j) => j !== i))} aria-label="Remove {x.name || x.email}"><Icon name="x" size={14} /></button></li>
    {/each}
  </ul>
  <form class="gf" onsubmit={addGuest}>
    <input bind:value={g.name} placeholder="Name" aria-label="Guest name" />
    <input bind:value={g.email} placeholder="Email" inputmode="email" aria-label="Guest email" />
    <button class="btn small" disabled={!g.email.trim()}><Icon name="plus" size={14} />Add</button>
  </form>
</section>

<style>
  .steps {
    margin: 8px 0 12px;
    padding-left: 20px;
    font-size: 14px;
    display: grid;
    gap: 4px;
  }
  summary {
    cursor: pointer;
    font-weight: 700;
    font-size: 14px;
    margin: 6px 0;
  }
  .zf {
    display: grid;
    gap: 10px;
    max-width: 420px;
  }
  .sigrow {
    display: block !important;
    border-top: 0 !important;
    padding-top: 0 !important;
  }
  .sigrow summary {
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
  }
  .skip {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 14px;
    margin: 10px 0 4px;
  }
  .row {
    display: flex;
    gap: 8px;
  }
  .gl {
    list-style: none;
    padding: 0;
    margin: 12px 0;
    display: grid;
    gap: 8px;
  }
  .gl li {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .gf {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .paste {
    height: 36px;
    border-radius: 8px;
    border: 1px solid var(--line);
    padding: 0 10px;
  }
  .vid {
    margin-top: 14px;
  }
  .warn {
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--yellow-soft, #fff6d6);
  }
  .gf input {
    height: 36px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--raised);
    padding: 0 10px;
    font-size: 14px;
    flex: 1;
    min-width: 140px;
  }
</style>
