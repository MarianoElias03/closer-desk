<script>
  // Settings: the Zoom connection for booking links, and regular guests (e.g. a teammate) offered on bookings.
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
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
      toast(`${account.email} connected`);
      connecting = false;
      pasted = '';
      hint = '';
      loadMail();
    } catch (err) {
      toast(err.message, 'error');
    }
  }
  async function removeAcct(a) {
    if (!confirm(`Stop sending from ${a.email}?`)) return;
    await fetch(`/api/settings/mail?email=${encodeURIComponent(a.email)}`, { method: 'DELETE' });
    loadMail();
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
  <p class="muted">Accounts Closer Desk can send from, like the pre-call info before a booked call. Each one is connected with permission to send mail only.</p>
  {#if mail}
    <ul class="gl">
      {#each mail.accounts as a}
        <li><span><strong>{a.email}</strong>{#if a.name}<br /><span class="faint">{a.name}</span>{/if}</span>
          <button class="btn small ghost" onclick={() => removeAcct(a)}>Remove</button></li>
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
          <li>In the Google tab that opened, sign in as {hint || 'the account'} and allow <b>Send email on your behalf</b>.</li>
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
