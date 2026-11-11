<script>
  import { invalidateAll, goto } from '$app/navigation';
  import { page } from '$app/state';
  import Icon from '$lib/components/Icon.svelte';
  import { toast } from '$lib/toast.svelte.js';
  import { money } from '$lib/fmt.js';

  let { data } = $props();

  const blank = () => ({ name: '', industry: data.offer.industry, price: '', keywords: data.offer.keywords, notes: '' });
  let creating = $state(page.url.searchParams.has('new'));
  let draft = $state(blank());
  let editing = $state(null); // offer id
  let form = $state({});
  let saving = $state(false);

  $effect(() => {
    if (page.url.searchParams.has('new')) creating = true;
  });

  const industries = $derived([...new Set(data.offers.map((o) => o.industry).filter(Boolean))].sort());
  const active = $derived(data.offers.filter((o) => !o.archived));
  const archived = $derived(data.offers.filter((o) => o.archived));
  const c = (id) => data.counts[id] || { calls: 0, sdrDays: 0, closeDays: 0 };

  async function send(url, method, body) {
    saving = true;
    const r = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    saving = false;
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      toast(j.message || 'Something went wrong', 'error');
      return null;
    }
    return j;
  }

  async function create(e) {
    e.preventDefault();
    const j = await send('/api/offers', 'POST', draft);
    if (!j) return;
    toast(`${j.offer.name} created and opened`);
    creating = false;
    draft = blank();
    await invalidateAll();
    goto('/');
  }

  function startEdit(o) {
    editing = o.id;
    form = { name: o.name, industry: o.industry, price: o.price ?? '', keywords: o.keywords, notes: o.notes };
  }
  async function save(e, o) {
    e.preventDefault();
    if (!(await send(`/api/offers/${o.id}`, 'PATCH', form))) return;
    toast('Offer saved');
    editing = null;
    invalidateAll();
  }
  async function openIt(o) {
    if (!(await send(`/api/offers/${o.id}/open`, 'POST'))) return;
    toast(`Now on ${o.name}`);
    await invalidateAll();
  }
  async function setArchived(o, archived) {
    if (!(await send(`/api/offers/${o.id}`, 'PATCH', { archived }))) return;
    toast(archived ? `${o.name} archived. Its numbers stay in Overall.` : `${o.name} restored`);
    invalidateAll();
  }
</script>

<svelte:head><title>Offers · Closer Desk</title></svelte:head>

<datalist id="industries">
  {#each industries as i}<option value={i}></option>{/each}
</datalist>

{#snippet fields(f)}
  <div class="row2">
    <label class="field">Offer name<input bind:value={f.name} required maxlength="80" placeholder="12-week coaching program" /></label>
    <label class="field">Industry<input bind:value={f.industry} list="industries" maxlength="80" placeholder="Fitness" /></label>
  </div>
  <div class="row2">
    <label class="field">Price (AUD)<input type="number" min="0" step="1" inputmode="decimal" bind:value={f.price} placeholder="Optional" /></label>
    <label class="field">Calendar keywords
      <input bind:value={f.keywords} placeholder="GamePlan Call, Discovery Call" />
    </label>
  </div>
  <p class="faint hint">Calendar events whose title contains one of the keywords become this offer's calls. Separate them with commas. If two offers share a keyword, new calls go to the offer you have open.</p>
  <label class="field">Notes<textarea bind:value={f.notes} rows="3" placeholder="Pitch, payment plans, who you're dialling for…"></textarea></label>
{/snippet}

<header class="top">
  <div>
    <h1>Offers</h1>
    <p class="muted">Each offer keeps its own dialling, closing and calls. Switch offers from the menu at the top of the sidebar; the app opens on the last one you used.</p>
  </div>
  {#if !creating}
    <button class="btn primary" onclick={() => { draft = blank(); creating = true; }}><Icon name="plus" size={16} />New offer</button>
  {/if}
</header>

{#if creating}
  <form class="panel card new" onsubmit={create}>
    <h2>New offer</h2>
    {@render fields(draft)}
    <div class="acts">
      <button class="btn primary" disabled={saving}>Create and open</button>
      <button type="button" class="btn ghost" onclick={() => (creating = false)}>Cancel</button>
    </div>
  </form>
{/if}

<div class="list">
  {#each active as o (o.id)}
    <section class="panel card" class:current={o.id === data.offer.id}>
      {#if editing === o.id}
        <form onsubmit={(e) => save(e, o)}>
          {@render fields(form)}
          <div class="acts">
            <button class="btn primary" disabled={saving}>Save</button>
            <button type="button" class="btn ghost" onclick={() => (editing = null)}>Cancel</button>
          </div>
        </form>
      {:else}
        <div class="head">
          <div>
            <h2>{o.name}{#if o.id === data.offer.id}<span class="chip t-blue now">Open now</span>{/if}</h2>
            <p class="muted meta">
              {[o.industry || 'No industry set', o.price != null ? money(o.price) : null].filter(Boolean).join(' · ')}
            </p>
          </div>
          <div class="acts">
            {#if o.id !== data.offer.id}<button class="btn small" onclick={() => openIt(o)}>Open</button>{/if}
            <button class="btn small ghost" onclick={() => startEdit(o)}><Icon name="edit" size={15} />Edit</button>
            {#if active.length > 1}<button class="btn small ghost" onclick={() => setArchived(o, true)} title="Hide from the switcher. Numbers are kept."><Icon name="archive" size={15} />Archive</button>{/if}
          </div>
        </div>
        <dl class="facts">
          <div><dt>Calls</dt><dd class="num">{c(o.id).calls}</dd></div>
          <div><dt>Dialling days</dt><dd class="num">{c(o.id).sdrDays}</dd></div>
          <div><dt>Closing days</dt><dd class="num">{c(o.id).closeDays}</dd></div>
          <div class="wide"><dt>Calendar keywords</dt><dd>{o.keywords || 'None, so only calls you add by hand'}</dd></div>
        </dl>
        {#if o.notes}<p class="notes">{o.notes}</p>{/if}
      {/if}
    </section>
  {/each}
</div>

{#if archived.length}
  <h2 class="sub">Archived</h2>
  <div class="list">
    {#each archived as o (o.id)}
      <section class="panel card arch">
        <div class="head">
          <div>
            <h2>{o.name}</h2>
            <p class="muted meta">{o.industry || 'No industry set'} · {c(o.id).calls} calls · {c(o.id).sdrDays} dialling days</p>
          </div>
          <div class="acts">
            <button class="btn small" onclick={() => setArchived(o, false)}>Restore</button>
          </div>
        </div>
      </section>
    {/each}
  </div>
{/if}

<style>
  .top {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: end;
    gap: 16px;
    margin-bottom: 22px;
  }
  .top p {
    max-width: 640px;
    margin: 6px 0 0;
  }
  .list {
    display: grid;
    gap: 14px;
    max-width: 860px;
  }
  .card {
    padding: 20px 22px;
    display: grid;
    gap: 14px;
  }
  .card.current {
    border-color: color-mix(in srgb, var(--blue) 45%, var(--line-2));
  }
  .new {
    max-width: 860px;
    margin-bottom: 18px;
  }
  .card form {
    display: grid;
    gap: 14px;
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 12px;
    align-items: start;
  }
  h2 {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0;
  }
  .now {
    font-size: 11.5px;
  }
  .meta {
    margin: 4px 0 0;
    font-size: 14px;
  }
  .acts {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .row2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .hint {
    margin: -6px 0 0;
    font-size: 12.5px;
  }
  .facts {
    display: grid;
    grid-template-columns: repeat(3, auto) 1fr;
    gap: 6px 28px;
    margin: 0;
  }
  .facts dt {
    font-size: 12px;
    font-weight: 600;
    color: var(--ink-3);
  }
  .facts dd {
    margin: 2px 0 0;
    font-weight: 700;
    font-size: 15px;
  }
  .facts .wide dd {
    font-weight: 500;
    font-size: 14px;
    color: var(--ink-2);
  }
  .notes {
    margin: 0;
    white-space: pre-wrap;
    font-size: 14px;
    color: var(--ink-2);
  }
  .sub {
    margin: 30px 0 12px;
    font-size: 15px;
    color: var(--ink-2);
  }
  .arch {
    opacity: 0.8;
  }
  @media (max-width: 700px) {
    .row2 {
      grid-template-columns: 1fr;
    }
    .facts {
      grid-template-columns: repeat(3, 1fr);
    }
    .facts .wide {
      grid-column: 1 / -1;
    }
  }
</style>
