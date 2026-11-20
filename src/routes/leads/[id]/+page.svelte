<script>
  import { fly } from 'svelte/transition';
  import { goto, invalidateAll, beforeNavigate } from '$app/navigation';
  import Icon from '$lib/components/Icon.svelte';
  import LeadSummary from '$lib/components/LeadSummary.svelte';
  import LeadPad from '$lib/components/LeadPad.svelte';
  import LeadHistory from '$lib/components/LeadHistory.svelte';
  import { CALL_OUTCOMES } from '$lib/stats.js';
  import { FILTERS, leadName, linkFor, viewQuery } from '$lib/leads.js';
  import { money } from '$lib/fmt.js';
  import { toast } from '$lib/toast.svelte.js';

  let { data } = $props();
  const lead = $derived(data.lead);
  const tz = $derived(data.tz);
  const query = $derived(viewQuery(data.view));
  const listLabel = $derived(FILTERS.find((f) => f.key === data.view.filter).label);
  const href = (id) => `/leads/${id}${query}`;

  // ---- editable details ----
  const FIELDS = ['business', 'contact', 'phone', 'email', 'suburb', 'category', 'score', 'followUp', 'notes'];
  const fromLead = (l) => ({ ...Object.fromEntries(FIELDS.map((k) => [k, l[k] ?? ''])) });
  let form = $state({});
  let formFor = $state(null);
  $effect(() => {
    if (lead.id !== formFor) {
      formFor = lead.id;
      form = fromLead(lead);
      pickCall = '';
    }
  });
  const dirty = $derived(formFor === lead.id && FIELDS.some((k) => String(form[k] ?? '') !== String(lead[k] ?? '')));
  let saving = $state(false);

  async function api(path, method, body) {
    const r = await fetch(path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.message || 'Could not save');
    return j;
  }
  async function save() {
    saving = true;
    try {
      await api(`/api/leads/${lead.id}`, 'PATCH', form);
      toast(`${leadName({ ...lead, ...form })} saved`);
      await invalidateAll();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      saving = false;
    }
  }
  async function remove() {
    const n = lead.dials.filter((d) => d.counted).length;
    if (!confirm(`Delete ${leadName(lead)}?${n ? ` Its ${n} counted ${n === 1 ? 'dial comes' : 'dials come'} off your Dialling numbers too.` : ''}`)) return;
    try {
      await api(`/api/leads/${lead.id}`, 'DELETE');
      toast(`Deleted ${leadName(lead)}`);
      formFor = null;
      goto(data.nav.next ? href(data.nav.next) : `/leads${query}`, { invalidateAll: true });
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // ---- booked call ----
  let pickCall = $state('');
  async function link(callId) {
    try {
      await api(`/api/leads/${lead.id}`, 'PATCH', { callId });
      toast(callId ? 'Call linked to this lead' : 'Call unlinked');
      await invalidateAll();
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  const callOutcome = (k) => CALL_OUTCOMES.find((o) => o.key === k) || CALL_OUTCOMES[0];
  const when = (iso) =>
    new Intl.DateTimeFormat('en-AU', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));

  // ---- previous / next ----
  let dir = $state(1);
  function step(to, d) {
    if (!to) return;
    dir = d;
    goto(href(to), { noScroll: false, keepFocus: false });
  }
  beforeNavigate((nav) => {
    if (dirty && !saving && nav.type !== 'leave' && !confirm(`You've changed ${leadName(lead)}'s details without saving. Leave anyway?`)) nav.cancel();
  });
  function onkey(e) {
    if (e.target.closest('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.querySelector('[role="dialog"]')) return;
    if (e.key === 'ArrowLeft' || e.key === '[') {
      e.preventDefault();
      step(data.nav.prev, -1);
    } else if (e.key === 'ArrowRight' || e.key === ']') {
      e.preventDefault();
      step(data.nav.next, 1);
    }
  }
</script>

<svelte:window onkeydown={onkey} />
<svelte:head><title>{leadName(lead)} · Leads · Closer Desk</title></svelte:head>

<nav class="stepper panel" aria-label="Lead navigation">
  <a class="btn small ghost back" href="/leads{query}"><Icon name="left" size={15} />Lead list</a>
  <span class="pos">
    {#if data.nav.position}
      <strong class="num">{data.nav.position}</strong> of <span class="num">{data.nav.total}</span> in {listLabel}
    {:else}
      Not in {listLabel} any more<span class="faint">, {data.nav.total} left there</span>
    {/if}
    {#if data.view.q}<span class="faint">, matching "{data.view.q}"</span>{/if}
  </span>
  <div class="arrows">
    <button class="btn small" onclick={() => step(data.nav.prev, -1)} disabled={!data.nav.prev} title="Previous lead (left arrow)">
      <Icon name="left" size={16} />Previous
    </button>
    <button class="btn small primary" onclick={() => step(data.nav.next, 1)} disabled={!data.nav.next} title="Next lead (right arrow)">
      Next<Icon name="right" size={16} />
    </button>
  </div>
</nav>

{#key lead.id}
  <div class="layout" in:fly={{ x: 36 * dir, duration: 280 }}>
    <div class="main">
      <section class="panel card">
        <LeadSummary {lead} today={data.today} {tz} title="h1" chips={false} />
        <div class="log">
          <span class="k">Log this call</span>
          <LeadPad {lead} today={data.today} />
          <p class="faint small">Keys 1 to 5 log an outcome, the arrow keys go to the previous or next lead.</p>
        </div>
      </section>

      <section class="panel">
        <LeadHistory {lead} {tz} today={data.today} />
      </section>
    </div>

    <aside class="side">
      <section class="panel details">
        <div class="shead">
          <h2>Details</h2>
          {#if dirty}<span class="chip t-yellow"><span class="dot"></span>Unsaved</span>{/if}
        </div>
        <form onsubmit={(e) => (e.preventDefault(), save())}>
          <label class="field">Business<input bind:value={form.business} /></label>
          <div class="two">
            <label class="field">Contact name<input bind:value={form.contact} /></label>
            <label class="field">Mobile<input bind:value={form.phone} inputmode="tel" /></label>
          </div>
          <label class="field">Email<input bind:value={form.email} type="email" /></label>
          <div class="two">
            <label class="field">Suburb<input bind:value={form.suburb} /></label>
            <label class="field">Category<input bind:value={form.category} /></label>
          </div>
          <div class="two">
            <label class="field">Prospect score<input bind:value={form.score} inputmode="decimal" /></label>
            <label class="field">Follow-up date<input bind:value={form.followUp} type="date" /></label>
          </div>
          <label class="field">Notes<textarea bind:value={form.notes} rows="4" placeholder="Who you spoke to, objections, best time to call"></textarea></label>
          <div class="acts">
            {#if dirty}<button type="button" class="btn small ghost" onclick={() => (form = fromLead(lead))}>Undo changes</button>{/if}
            <button class="btn small primary" disabled={!dirty || saving}><Icon name="check" size={14} />{saving ? 'Saving' : 'Save'}</button>
          </div>
        </form>
      </section>

      {#if lead.extra.length}
        <section class="panel">
          <h2>From your sheet</h2>
          <dl class="facts">
            {#each lead.extra as [k, v]}
              <div>
                <dt>{k}</dt>
                <dd>{#if linkFor(v)}<a href={linkFor(v)} target="_blank" rel="noopener">{v}</a>{:else}{v}{/if}</dd>
              </div>
            {/each}
          </dl>
        </section>
      {/if}

      <section class="panel">
        <h2>Booked call</h2>
        {#if lead.call}
          {@const co = callOutcome(lead.call.outcome)}
          <div class="call t-{co.tone}">
            <span><strong>{lead.call.title}</strong><br /><span class="muted">{when(lead.call.start)}{lead.call.cancelled ? ' (cancelled)' : ''}</span></span>
            <span class="chip"><span class="dot"></span>{co.key === 'pending' ? 'Outcome not logged' : co.label}{lead.call.cash ? `, ${money(lead.call.cash)}` : ''}</span>
            <div class="acts">
              <button class="btn small ghost" onclick={() => link(null)}>Unlink</button>
              <a class="btn small" href="/calls?open={encodeURIComponent(lead.call.id)}">Open call</a>
            </div>
          </div>
        {:else}
          <p class="faint small">
            {lead.stage === 'booked'
              ? 'Waiting for the booking to show up on your calendar. It links by mobile, email or business name on the next sync.'
              : 'Book them and the calendar event links here, with its closing outcome.'}
          </p>
          {#if data.linkable.length}
            <div class="pick">
              <select bind:value={pickCall} aria-label="Pick a call to link">
                <option value="">Link a calendar call by hand</option>
                {#each data.linkable as c}<option value={c.id}>{c.prospect || c.title}, {when(c.start)}</option>{/each}
              </select>
              <button class="btn small" disabled={!pickCall} onclick={() => link(pickCall)}><Icon name="link" size={14} />Link</button>
            </div>
          {/if}
        {/if}
      </section>

      <button class="btn small ghost danger" onclick={remove}>Delete this lead</button>
    </aside>
  </div>
{/key}

<style>
  .stepper {
    position: sticky;
    top: 12px;
    z-index: 20;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 16px;
    padding: 10px 12px;
    margin-bottom: 18px;
    background: color-mix(in srgb, var(--surface) 92%, transparent);
    backdrop-filter: blur(10px);
  }
  .pos {
    flex: 1;
    text-align: center;
    font-size: 14px;
    color: var(--ink-2);
  }
  .pos strong {
    color: var(--ink);
  }
  .arrows {
    display: flex;
    gap: 8px;
  }
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 360px;
    gap: 18px;
    align-items: start;
  }
  .main,
  .side {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 18px;
    min-width: 0;
  }
  .panel {
    padding: 22px;
  }
  .card {
    display: grid;
    gap: 22px;
  }
  .card :global(.name) {
    font-size: clamp(26px, 3vw, 34px);
  }
  .log {
    display: grid;
    gap: 10px;
    padding-top: 18px;
    border-top: 1px solid var(--line-2);
  }
  .log p {
    margin: 0;
  }
  .k {
    font-size: 11.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-3);
  }
  .small {
    font-size: 13px;
  }
  h2 {
    font-size: 17px;
    margin: 0 0 12px;
  }
  .shead {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }
  .shead h2 {
    margin: 0;
  }
  form {
    display: grid;
    gap: 10px;
  }
  .two {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }
  form :global(.field),
  form :global(.field input) {
    min-width: 0;
    width: 100%;
  }
  .acts {
    display: flex;
    gap: 8px;
    justify-content: end;
    flex-wrap: wrap;
  }
  .facts {
    margin: 0;
    display: grid;
    gap: 10px;
  }
  .facts dt {
    font-size: 12px;
    color: var(--ink-3);
  }
  .facts dd {
    margin: 2px 0 0;
    font-size: 14px;
    overflow-wrap: anywhere;
  }
  .call {
    display: grid;
    gap: 10px;
    font-size: 14px;
    justify-items: start;
  }
  .call .acts {
    justify-self: stretch;
  }
  .pick {
    display: flex;
    gap: 8px;
    margin-top: 10px;
  }
  .pick select {
    flex: 1;
    min-width: 0;
    height: 36px;
    border-radius: 10px;
    border: 1px solid var(--line-2);
    background: var(--raised);
    color: var(--ink);
    padding: 0 10px;
  }
  .danger {
    color: var(--red);
    justify-self: start;
  }
  @media (max-width: 1100px) {
    .layout {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  @media (max-width: 760px) {
    .panel {
      padding: 16px;
    }
    .stepper {
      top: 8px;
    }
    .pos {
      order: 3;
      flex-basis: 100%;
      font-size: 13px;
    }
    .back {
      margin-right: auto;
    }
  }
</style>
