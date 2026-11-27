<script>
  import { invalidateAll } from '$app/navigation';
  import Icon from '$lib/components/Icon.svelte';
  import { toast } from '$lib/toast.svelte.js';
  import { relative } from '$lib/fmt.js';

  let { data } = $props();

  const UNITS = [
    ['minutes', 1],
    ['hours', 60],
    ['days', 1440]
  ];
  const STATUS = {
    queued: { label: 'Waiting', tone: 't-blue' },
    sending: { label: 'Sending', tone: 't-yellow' },
    sent: { label: 'Sent', tone: 't-green' },
    skipped: { label: 'Skipped', tone: 't-iron' },
    failed: { label: 'Failed', tone: 't-red' }
  };

  const trig = (k) => data.triggers.find((t) => t.key === k);
  const valueLabel = (k, v) => trig(k)?.values?.find(([x]) => x === v)?.[1] || v;
  const offerName = (id) => (id == null ? 'All offers' : data.allOffers.find((o) => o.id === id)?.name || 'Unknown offer');

  function waitWords(m) {
    if (!m) return '';
    const [unit, n] = m % 1440 === 0 ? ['day', m / 1440] : m % 60 === 0 ? ['hour', m / 60] : ['minute', m];
    return `${n} ${unit}${n === 1 ? '' : 's'}`;
  }
  function summary(a) {
    const t = trig(a.trigger);
    if (a.trigger === 'before_call') return `${waitWords(a.waitMinutes) || 'Right'} before a booked call`;
    let s =
      a.trigger === 'outcome'
        ? `When "${valueLabel(a.trigger, a.triggerValue)}" is logged on a lead`
        : a.trigger === 'call_outcome'
          ? `When a booked call is marked "${valueLabel(a.trigger, a.triggerValue)}"`
          : t?.label || a.trigger;
    return a.waitMinutes ? `${s}, wait ${waitWords(a.waitMinutes)}` : `${s}, send straight away`;
  }

  // ---------- the editor ----------
  let editing = $state(null);
  let saving = $state(false);
  let prev = $state(null);
  let prevLead = $state('');
  let prevBusy = $state(false);
  let bodyEl = $state();

  function blank() {
    return {
      id: null,
      name: '',
      enabled: false,
      channel: 'email',
      offerId: data.offer.id,
      trigger: 'outcome',
      triggerValue: 'no_answer',
      waitAmount: 1,
      waitUnit: 1440,
      conditions: { stopOnNewer: true, category: '', reason: '' },
      fromEmail: data.accounts[0]?.email || '',
      subject: 'Sorry I missed you, {firstName}',
      body: "Hi {firstName},\n\nI tried giving {business} a call today but couldn't get through. When's a good time to chat?\n\nThanks,\n{myName}"
    };
  }
  function edit(a) {
    const m = a.waitMinutes || 0;
    const unit = m && m % 1440 === 0 ? 1440 : m && m % 60 === 0 ? 60 : m ? 1 : a.trigger === 'before_call' ? 60 : 1440;
    editing = { ...structuredClone($state.snapshot(a)), waitAmount: m / unit, waitUnit: unit, conditions: { stopOnNewer: true, category: '', reason: '', ...a.conditions } };
    delete editing.runs;
    delete editing.counts;
    prev = null;
    queuePreview();
  }
  function startNew() {
    editing = blank();
    prev = null;
    queuePreview();
  }
  function payload(e, enabled = e.enabled) {
    return {
      id: e.id,
      name: e.name,
      enabled,
      channel: e.channel,
      offerId: e.offerId,
      trigger: e.trigger,
      triggerValue: trig(e.trigger)?.values ? e.triggerValue : '',
      waitMinutes: Math.round((Number(e.waitAmount) || 0) * e.waitUnit),
      conditions: e.conditions,
      fromEmail: e.fromEmail,
      subject: e.subject,
      body: e.body
    };
  }
  function pickTrigger(k) {
    editing.trigger = k;
    const t = trig(k);
    if (t?.values && !t.values.some(([v]) => v === editing.triggerValue)) editing.triggerValue = t.values[0][0];
    if (k === 'before_call' && !editing.waitAmount) {
      editing.waitAmount = 24;
      editing.waitUnit = 60;
    }
  }
  function insert(ph) {
    const el = bodyEl;
    if (!el) return (editing.body += ph);
    const [s, e] = [el.selectionStart ?? editing.body.length, el.selectionEnd ?? editing.body.length];
    editing.body = editing.body.slice(0, s) + ph + editing.body.slice(e);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = s + ph.length;
    });
  }

  async function api(body) {
    const r = await fetch('/api/automations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.message || 'Something went wrong');
    return j;
  }

  let pt;
  function queuePreview() {
    clearTimeout(pt);
    pt = setTimeout(runPreview, 350);
  }
  async function runPreview() {
    if (!editing) return;
    prevBusy = true;
    try {
      prev = (await api({ action: 'preview', automation: payload(editing), leadId: prevLead || null })).preview;
    } catch (e) {
      prev = { error: e.message };
    } finally {
      prevBusy = false;
    }
  }
  $effect(() => {
    if (!editing) return;
    // re-render the preview whenever the email or who it's for changes
    void [editing.subject, editing.body, editing.fromEmail, editing.offerId, editing.conditions.category, prevLead];
    queuePreview();
  });

  // the preview grows to fit the whole email (no scripts run inside it)
  function fitFrame(e) {
    const f = e.currentTarget;
    const fit = () => {
      try {
        f.style.height = f.contentDocument.documentElement.scrollHeight + 4 + 'px';
      } catch {}
    };
    fit();
    f.contentDocument?.querySelectorAll('img').forEach((i) => i.addEventListener('load', fit));
  }
  let testing = $state(false);
  async function testSend() {
    if (!confirm(`Send this email now to ${prev.to} as a test? It goes from ${editing.fromEmail} with [Test] in the subject.`)) return;
    testing = true;
    try {
      const t = (await api({ action: 'test', automation: payload(editing), leadId: prevLead })).test;
      toast(`Test sent to ${t.to}${t.exampleCall ? ' (with an example call time)' : ''}`);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      testing = false;
    }
  }
  async function save(enabled) {
    saving = true;
    try {
      const { automation } = await api({ action: 'save', automation: payload(editing, enabled) });
      toast(automation.enabled ? 'Saved and switched on' : 'Saved (switched off)');
      editing = null;
      await invalidateAll();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      saving = false;
    }
  }
  async function toggle(a) {
    try {
      await api({ action: 'toggle', id: a.id, enabled: !a.enabled });
      toast(a.enabled ? `${a.name || 'Automation'} switched off` : `${a.name || 'Automation'} switched on. Only new activity from now on counts.`);
      await invalidateAll();
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  async function remove(a) {
    if (!confirm(`Delete "${a.name || summary(a)}" and its history? Anything still waiting won't be sent.`)) return;
    await api({ action: 'delete', id: a.id }).catch((e) => toast(e.message, 'error'));
    if (editing?.id === a.id) editing = null;
    await invalidateAll();
  }
  async function cancel(run) {
    await api({ action: 'cancel', runId: run.id }).catch((e) => toast(e.message, 'error'));
    await invalidateAll();
  }
  let checking = $state(false);
  async function checkNow() {
    checking = true;
    try {
      const r = await api({ action: 'run' });
      toast(r.processed ? `Handled ${r.processed} due ${r.processed === 1 ? 'email' : 'emails'}` : 'Nothing due right now');
      await invalidateAll();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      checking = false;
    }
  }
  let open = $state({});
  const smsReady = $derived(data.channels.find((c) => c.key === 'sms')?.ready);
</script>

<svelte:head><title>Automations · Closer Desk</title></svelte:head>

<header class="top">
  <div>
    <h1>Automations</h1>
    <p class="muted">Send an email automatically when something happens to a lead. Checked every minute. Leads who asked not to be emailed are always skipped.</p>
  </div>
  <div class="acts">
    <button class="btn" onclick={checkNow} disabled={checking}><Icon name="refresh" size={16} />{checking ? 'Checking' : 'Check now'}</button>
    <button class="btn primary" onclick={startNew} disabled={!!editing && !editing.id}><Icon name="plus" size={16} />New automation</button>
  </div>
</header>

{#if !data.accounts.length}
  <div class="note panel">
    <Icon name="mail" size={18} />
    <p>Connect an email account in <a href="/settings">Settings</a> first. Automations send from one of your connected accounts.</p>
  </div>
{/if}

{#snippet editor()}
  <section class="panel editor" aria-label={editing.id ? 'Edit automation' : 'New automation'}>
    <div class="ed-head">
      <h2>{editing.id ? 'Edit automation' : 'New automation'}</h2>
      <button class="btn ghost small" onclick={() => (editing = null)}><Icon name="x" size={15} />Close</button>
    </div>
    <div class="cols">
      <div class="form">
        <label class="field">Name
          <input bind:value={editing.name} placeholder="e.g. No answer follow-up" maxlength="120" />
        </label>

        <fieldset class="field">
          <legend>Send by</legend>
          <div class="seg">
            {#each data.channels as c}
              <label class:on={editing.channel === c.key} class:off={!c.ready}>
                <input type="radio" name="channel" value={c.key} bind:group={editing.channel} disabled={!c.ready} />
                <Icon name={c.key === 'sms' ? 'chat' : 'mail'} size={16} />
                <span>{c.label}{#if !c.ready}<small>{c.note}. Coming soon.</small>{/if}</span>
              </label>
            {/each}
          </div>
        </fieldset>

        <div class="row2">
          <label class="field">When
            <select value={editing.trigger} onchange={(e) => pickTrigger(e.currentTarget.value)}>
              {#each data.triggers as t}<option value={t.key}>{t.label}</option>{/each}
            </select>
          </label>
          {#if trig(editing.trigger)?.values}
            <label class="field">Outcome
              <select bind:value={editing.triggerValue}>
                {#each trig(editing.trigger).values as [k, l]}<option value={k}>{l}</option>{/each}
              </select>
            </label>
          {/if}
        </div>

        <div class="row2">
          <div class="field">
            <span>{editing.trigger === 'before_call' ? 'How long before the call' : 'Then wait'}</span>
            <div class="wait">
              <input type="number" min="0" step="1" bind:value={editing.waitAmount} aria-label="Amount" />
              <select bind:value={editing.waitUnit} aria-label="Unit">
                {#each UNITS as [l, v]}<option value={v}>{l}</option>{/each}
              </select>
            </div>
            {#if editing.trigger !== 'before_call' && !Number(editing.waitAmount)}<small class="faint">0 sends within a minute</small>{/if}
          </div>
          <label class="field">Offer
            <select bind:value={editing.offerId}>
              {#each data.allOffers as o}<option value={o.id}>{o.name}</option>{/each}
              <option value={null}>All offers</option>
            </select>
          </label>
        </div>

        <details class="conds" open={!!(editing.conditions.category || editing.conditions.reason)}>
          <summary>Only if (optional)</summary>
          <div class="row2">
            <label class="field">Category contains
              <input bind:value={editing.conditions.category} placeholder="Any category" />
            </label>
            {#if editing.trigger === 'outcome'}
              <label class="field">Reason is
                <input bind:value={editing.conditions.reason} placeholder="Any reason" />
              </label>
            {/if}
          </div>
          {#if editing.trigger === 'outcome'}
            <label class="check">
              <input type="checkbox" bind:checked={editing.conditions.stopOnNewer} />
              Don't send if a newer outcome is logged while it waits (e.g. they picked up next time)
            </label>
          {/if}
          <p class="faint small">Always: the lead has an email, and hasn't asked not to be emailed. Checked again just before it sends.</p>
        </details>

        <label class="field">Send from
          <select bind:value={editing.fromEmail}>
            {#if !data.accounts.length}<option value="">No accounts connected</option>{/if}
            {#each data.accounts as acc}<option value={acc.email}>{acc.name ? `${acc.name} <${acc.email}>` : acc.email}</option>{/each}
          </select>
        </label>
        <label class="field">Subject
          <input bind:value={editing.subject} maxlength="300" />
        </label>
        <label class="field">Email
          <textarea bind:this={bodyEl} bind:value={editing.body} rows="9"></textarea>
        </label>
        <div class="phs" aria-label="Insert a placeholder">
          {#each data.placeholders as [ph, what]}
            <button type="button" class="ph" title={what} onclick={() => insert(ph)}>{ph}</button>
          {/each}
        </div>
      </div>

      <aside class="preview" aria-live="polite">
        <div class="pv-head">
          <strong>Preview</strong>
          <select bind:value={prevLead} aria-label="Preview for">
            <option value="">A sample lead</option>
            {#each data.leads as l}<option value={String(l.id)}>{l.name}{l.email ? '' : ' (no email)'}</option>{/each}
          </select>
        </div>
        {#if prev?.error}
          <p class="warn">{prev.error}</p>
        {:else if prev}
          {#if prev.skip}<p class="warn"><Icon name="skip" size={15} />Would be skipped: {prev.skip}</p>{/if}
          <dl class="mail" class:busy={prevBusy}>
            <dt>To</dt><dd>{prev.to || 'No email'}</dd>
            <dt>Subject</dt><dd><strong>{prev.subject}</strong></dd>
          </dl>
          {#if prev.noSignature}<p class="warn small">No Gmail signature saved for {editing.fromEmail} yet, so it ends with your name. Add one in Settings, under Email accounts.</p>{/if}
          <iframe class="body html" class:busy={prevBusy} title="Email preview" srcdoc={prev.html} sandbox="allow-same-origin" onload={fitFrame}></iframe>
          {#if prevLead}
            <button class="btn small" onclick={testSend} disabled={testing || (!!prev.skip && !/booked call|join link/.test(prev.skip)) || !editing.fromEmail}><Icon name="mail" size={14} />{testing ? 'Sending' : `Send a test to ${prev.to}`}</button>
          {/if}
          {#if prev.sample}<p class="faint small">Sample: Sam Taylor at Taylor Plumbing with a call in two days. Pick a lead to see it for real.</p>{/if}
        {:else}
          <p class="faint">Loading</p>
        {/if}
      </aside>
    </div>
    <div class="ed-foot">
      <button class="btn" onclick={() => save(false)} disabled={saving}>Save, switched off</button>
      <button class="btn primary" onclick={() => save(true)} disabled={saving || editing.channel !== 'email' || !data.accounts.length}><Icon name="bolt" size={16} />Save and switch on</button>
      <span class="faint small">Switching on only counts activity from then on. Nothing older is emailed.</span>
    </div>
  </section>
{/snippet}

{#if editing && !editing.id}{@render editor()}{/if}

<div class="list">
  {#if !data.automations.length && !editing}
    <section class="panel empty">
      <Icon name="bolt" size={22} />
      <div>
        <strong>No automations yet</strong>
        <p class="muted">For example: when a lead doesn't answer, email them the next day. Or remind a lead about their call 24 hours before.</p>
      </div>
    </section>
  {/if}

  <section class="panel soon">
    <Icon name="chat" size={18} />
    <p><strong>SMS automations</strong> {smsReady ? 'are ready.' : 'are coming. They need a phone integration to send texts, so for now automations send email only.'}</p>
  </section>

  {#each data.automations as a (a.id)}
    {#if editing?.id === a.id}
      {@render editor()}
    {:else}
      <section class="panel auto" class:dim={!a.enabled}>
        <div class="a-head">
          <span class="ico" class:on={a.enabled}><Icon name={a.channel === 'sms' ? 'chat' : 'mail'} size={18} /></span>
          <div class="a-title">
            <strong>{a.name || a.subject || 'Untitled automation'}</strong>
            <span class="muted">{summary(a)}</span>
            <span class="faint small">{offerName(a.offerId)} · from {a.fromEmail || 'no account'}{a.conditions?.category ? ` · category contains "${a.conditions.category}"` : ''}{a.conditions?.reason ? ` · reason "${a.conditions.reason}"` : ''}</span>
          </div>
          <label class="switch" title={a.enabled ? 'Switch off' : 'Switch on'}>
            <input type="checkbox" checked={a.enabled} onchange={() => toggle(a)} aria-label={a.enabled ? 'Switch off' : 'Switch on'} />
            <span></span>
          </label>
        </div>
        <div class="a-meta">
          {#each ['sent', 'queued', 'skipped', 'failed'] as s}
            {#if a.counts[s]}<span class="chip {STATUS[s].tone}"><span class="dot"></span>{a.counts[s]} {STATUS[s].label.toLowerCase()}</span>{/if}
          {/each}
          <span class="grow"></span>
          <button class="btn small" onclick={() => edit(a)} disabled={!!editing}><Icon name="edit" size={14} />Edit</button>
          <button class="btn small ghost" onclick={() => remove(a)} aria-label="Delete"><Icon name="x" size={14} />Delete</button>
        </div>
        {#if a.runs.length}
          <details class="runs" bind:open={open[a.id]}>
            <summary>Recent runs</summary>
            <ul>
              {#each a.runs as r (r.id)}
                <li>
                  <span class="chip {STATUS[r.status]?.tone || 't-none'}">{STATUS[r.status]?.label || r.status}</span>
                  <span class="who">
                    {#if r.leadId}<a href="/leads/{r.leadId}">{r.who || `Lead ${r.leadId}`}</a>{:else}{r.who || r.to || 'Unknown'}{/if}
                    {#if r.to}<small class="faint">{r.to}</small>{/if}
                  </span>
                  <span class="what">
                    {#if r.status === 'queued'}Sends {relative(r.dueAt)}{:else if r.reason}{r.reason}{:else if r.subject}{r.subject}{/if}
                  </span>
                  <span class="when faint">{r.status === 'queued' ? '' : relative(r.doneAt || r.dueAt)}</span>
                  {#if r.status === 'queued'}<button class="btn small ghost" onclick={() => cancel(r)}>Cancel</button>{/if}
                </li>
              {/each}
            </ul>
          </details>
        {:else}
          <p class="faint small none">Nothing yet. {a.enabled ? 'It will show here when it runs.' : 'Switch it on to start.'}</p>
        {/if}
      </section>
    {/if}
  {/each}
</div>

<style>
  .top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    flex-wrap: wrap;
    margin-bottom: 22px;
  }
  .top p {
    margin: 6px 0 0;
    max-width: 640px;
  }
  .acts {
    display: flex;
    gap: 8px;
  }
  .list {
    display: grid;
    gap: 14px;
    max-width: 1100px;
  }
  .note,
  .soon,
  .empty {
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 14px 18px;
    max-width: 1100px;
  }
  .note {
    margin-bottom: 14px;
    background: var(--yellow-soft);
  }
  .note p,
  .soon p,
  .empty p {
    margin: 0;
  }
  .soon {
    color: var(--ink-2);
    font-size: 14px;
    border-style: dashed;
    box-shadow: none;
  }
  .empty {
    padding: 22px;
  }
  .empty p {
    margin-top: 4px;
  }
  .editor {
    padding: 22px;
    max-width: 1100px;
    margin-bottom: 14px;
    border-color: var(--blue);
  }
  .list .editor {
    margin-bottom: 0;
  }
  .ed-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 14px;
  }
  .cols {
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
    gap: 22px;
  }
  .form {
    display: grid;
    gap: 14px;
    align-content: start;
  }
  fieldset.field {
    border: 0;
    padding: 0;
    margin: 0;
  }
  fieldset legend {
    padding: 0;
    margin-bottom: 6px;
  }
  .seg {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .seg label {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    padding: 10px 12px;
    border: 1px solid var(--line);
    border-radius: var(--r-ctl);
    background: var(--raised);
    font-weight: 600;
    color: var(--ink);
    cursor: pointer;
  }
  .seg label.on {
    border-color: var(--blue);
    box-shadow: 0 0 0 3px var(--blue-soft);
  }
  .seg label.off {
    cursor: not-allowed;
    color: var(--ink-3);
    background: var(--iron-soft);
  }
  .seg input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
  .seg span {
    display: grid;
  }
  .seg small {
    font-weight: 400;
    font-size: 12px;
  }
  .row2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .wait {
    display: grid;
    grid-template-columns: 90px 1fr;
    gap: 8px;
  }
  .conds {
    border: 1px solid var(--line-2);
    border-radius: var(--r-ctl);
    padding: 10px 12px;
    display: grid;
    gap: 10px;
  }
  .conds[open] {
    padding-bottom: 12px;
  }
  .conds summary {
    font-weight: 600;
    font-size: 13px;
    color: var(--ink-2);
    cursor: pointer;
  }
  .conds .row2 {
    margin-top: 10px;
  }
  .check {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    font-size: 14px;
    margin-top: 10px;
  }
  .conds p {
    margin: 10px 0 0;
  }
  .phs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: -6px;
  }
  .ph {
    font: 500 12.5px/1 ui-monospace, monospace;
    padding: 6px 8px;
    border-radius: 6px;
    border: 1px solid var(--line);
    background: var(--raised);
    cursor: pointer;
  }
  .ph:hover {
    border-color: var(--blue);
  }
  .body.html {
    width: 100%;
    min-height: 380px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: #fff;
  }
  .preview {
    background: var(--raised);
    border: 1px solid var(--line-2);
    border-radius: 12px;
    padding: 14px 16px;
    align-self: start;
    position: sticky;
    top: 16px;
    min-width: 0;
  }
  .pv-head {
    display: flex;
    gap: 10px;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }
  .pv-head select {
    min-width: 0;
    max-width: 65%;
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 5px 8px;
    background: var(--surface);
  }
  .warn {
    display: flex;
    gap: 6px;
    align-items: center;
    margin: 0 0 10px;
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--yellow-soft);
    font-size: 13.5px;
  }
  .mail {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 10px;
    margin: 0 0 10px;
    font-size: 14px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--line-2);
  }
  .mail dt {
    color: var(--ink-3);
  }
  .mail dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .body {
    white-space: pre-wrap;
    font-size: 14.5px;
    line-height: 1.55;
    overflow-wrap: anywhere;
  }
  .busy {
    opacity: 0.6;
  }
  .ed-foot {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    align-items: center;
    margin-top: 18px;
  }
  .auto {
    padding: 16px 18px;
  }
  .auto.dim .a-title strong {
    color: var(--ink-2);
  }
  .a-head {
    display: flex;
    gap: 12px;
    align-items: flex-start;
  }
  .ico {
    display: grid;
    place-items: center;
    flex: none;
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: var(--iron-soft);
    color: var(--ink-3);
  }
  .ico.on {
    background: var(--blue-soft);
    color: var(--blue);
  }
  .a-title {
    display: grid;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }
  .a-title span {
    font-size: 14px;
  }
  .switch {
    position: relative;
    flex: none;
    width: 44px;
    height: 26px;
    cursor: pointer;
  }
  .switch input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
    margin: 0;
  }
  .switch span {
    position: absolute;
    inset: 0;
    border-radius: 999px;
    background: var(--line);
    transition: background 0.15s;
    pointer-events: none;
  }
  .switch span::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
    transition: transform 0.15s var(--ease-out);
  }
  .switch input:checked + span {
    background: var(--green);
  }
  .switch input:checked + span::after {
    transform: translateX(18px);
  }
  .switch input:focus-visible + span {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }
  .a-meta {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
    margin: 12px 0 0 48px;
  }
  .grow {
    flex: 1;
  }
  .runs {
    margin: 12px 0 0 48px;
  }
  .runs summary {
    cursor: pointer;
    font-weight: 600;
    font-size: 13.5px;
    color: var(--ink-2);
  }
  .runs ul {
    list-style: none;
    padding: 0;
    margin: 8px 0 0;
    display: grid;
  }
  .runs li {
    display: grid;
    grid-template-columns: 90px minmax(0, 1.2fr) minmax(0, 2fr) 80px auto;
    gap: 10px;
    align-items: center;
    padding: 8px 0;
    border-top: 1px solid var(--line-2);
    font-size: 13.5px;
  }
  .runs .chip {
    justify-self: start;
  }
  .who {
    display: grid;
    min-width: 0;
  }
  .who a {
    font-weight: 600;
  }
  .who small,
  .what {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .when {
    font-size: 12.5px;
    text-align: right;
  }
  .none {
    margin: 10px 0 0 48px;
  }
  .small {
    font-size: 13px;
  }
  @media (max-width: 860px) {
    .cols,
    .row2 {
      grid-template-columns: 1fr;
    }
    .preview {
      position: static;
    }
    .a-meta,
    .runs,
    .none {
      margin-left: 0;
    }
    .runs li {
      grid-template-columns: auto minmax(0, 1fr) auto;
    }
    .runs li .what {
      grid-column: 1 / -1;
      white-space: normal;
    }
    .runs li .when {
      display: none;
    }
  }
</style>
