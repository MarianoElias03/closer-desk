<script>
  import { invalidateAll } from '$app/navigation';
  import Icon from '$lib/components/Icon.svelte';
  import { toast } from '$lib/toast.svelte.js';
  import { relative } from '$lib/fmt.js';

  let { data } = $props();
  let syncing = $state(false);
  async function sync() {
    syncing = true;
    const r = await fetch('/api/sync', { method: 'POST' }).then((r) => r.json()).catch(() => null);
    syncing = false;
    if (!r) return toast('Sync failed. Check the server is running.', 'error');
    if (r.errors?.length) toast(r.errors[0], 'error');
    else toast(`Synced ${r.calendar?.kept ?? 0} calls and ${r.fathom?.recordings ?? 0} recordings`);
    invalidateAll();
  }
  const ls = $derived(data.lastSync);
</script>

<svelte:head><title>Settings · Closer Desk</title></svelte:head>

<header class="top">
  <h1>Settings</h1>
</header>

<div class="grid">
  <section class="panel">
    <h2>Connections</h2>
    <ul class="conn">
      <li>
        <span class="st" class:ok={data.connections.calendar}></span>
        <div>
          <strong>Google Calendar</strong>
          <p class="muted">{data.connections.calendar ? 'Connected to your primary calendar, read only. Checked every 10 minutes.' : 'Not connected. Add the Google credentials to the server .env file.'}</p>
        </div>
      </li>
      <li>
        <span class="st" class:ok={data.connections.fathom}></span>
        <div>
          <strong>Fathom</strong>
          <p class="muted">{data.connections.fathom ? 'Connected with your API key. Recordings are linked to calls by meeting link, title or guest email.' : 'Not connected. Add FATHOM_API_KEY to the server .env file.'}</p>
        </div>
      </li>
    </ul>
    <div class="syncrow">
      <button class="btn primary" onclick={sync} disabled={syncing}><Icon name="refresh" size={16} />{syncing ? 'Syncing' : 'Sync now'}</button>
      {#if ls}
        <span class="muted">Last sync {relative(ls.at)}: {ls.calendar?.kept ?? 0} calls, {ls.fathom?.recordings ?? 0} recordings, {ls.linked} newly linked</span>
      {/if}
    </div>
    {#if ls?.errors?.length}
      <div class="err">{#each ls.errors as e}<p>{e}</p>{/each}</div>
    {/if}
  </section>

  <section class="panel">
    <h2>Which calendar events count as calls</h2>
    <p class="muted">Each offer has its own calendar keywords now. An event becomes a call for <strong>{data.offer.name}</strong> when its title contains one of: <strong>{data.offer.keywords || 'no keywords yet'}</strong>.</p>
    <a class="btn" href="/offers"><Icon name="layers" size={16} />Edit offers and keywords</a>
  </section>

  <section class="panel">
    <h2>What's stored</h2>
    <dl class="counts">
      <div><dt>Sales calls</dt><dd class="score">{data.counts.calls}</dd></div>
      <div><dt>Fathom recordings</dt><dd class="score">{data.counts.recordings}</dd></div>
      <div><dt>Calls with a recording</dt><dd class="score">{data.counts.linked}</dd></div>
      <div><dt>Dialling days</dt><dd class="score">{data.counts.sdrDays}</dd></div>
      <div><dt>Closing days</dt><dd class="score">{data.counts.closeDays}</dd></div>
    </dl>
    <p class="muted small">Totals across every offer. Your October and November rows were imported from the CB Fitness sheet. The sheet itself is not changed.</p>
  </section>
</div>

<style>
  .top {
    margin-bottom: 22px;
  }
  .grid {
    display: grid;
    gap: 18px;
    max-width: 820px;
  }
  .panel {
    padding: 22px;
  }
  h2 {
    margin-bottom: 12px;
  }
  .conn {
    list-style: none;
    padding: 0;
    margin: 0 0 18px;
    display: grid;
    gap: 14px;
  }
  .conn li {
    display: flex;
    gap: 12px;
  }
  .conn p {
    margin: 2px 0 0;
    font-size: 14px;
  }
  .st {
    flex: none;
    width: 12px;
    height: 12px;
    margin-top: 5px;
    border-radius: 50%;
    background: var(--red);
    box-shadow: 0 0 0 4px var(--red-soft);
  }
  .st.ok {
    background: var(--green);
    box-shadow: 0 0 0 4px var(--green-soft);
  }
  .syncrow {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
    font-size: 13.5px;
  }
  .err {
    margin-top: 14px;
    padding: 10px 14px;
    border-radius: 10px;
    background: var(--red-soft);
    font-size: 13.5px;
  }
  .err p {
    margin: 0;
  }
  .kw {
    display: flex;
    gap: 10px;
    align-items: end;
  }
  .kw .field {
    flex: 1;
  }
  .counts {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 14px;
    margin: 0 0 12px;
  }
  .counts dt {
    font-size: 12.5px;
    color: var(--ink-2);
    font-weight: 600;
  }
  .counts dd {
    margin: 6px 0 0;
    font-size: 28px;
  }
  .small {
    font-size: 13px;
  }
  @media (max-width: 700px) {
    .counts {
      grid-template-columns: repeat(2, 1fr);
    }
    .kw {
      flex-direction: column;
      align-items: stretch;
    }
  }
</style>
