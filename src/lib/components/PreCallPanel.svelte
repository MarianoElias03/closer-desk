<script>
  // On a lead: the pre-call numbers (what missed calls could be costing them), the PDF to download,
  // and "Send pre-call info": the email with the numbers, the call, the video and the PDF attached.
  import { onMount } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import Icon from './Icon.svelte';
  import { toast } from '$lib/toast.svelte.js';

  let { lead } = $props();

  let data = $state(null);
  let n = $state({ calls: '', value: '', rate: 30 });
  let saving = $state(false);
  let savedAt = $state(null);
  let open = $state(false);
  let mail = $state({ from: '', to: '', cc: [], subject: '', message: '' });
  let extraCc = $state('');
  let sending = $state(false);

  async function load() {
    const r = await fetch(`/api/leads/${lead.id}/precall`);
    if (!r.ok) return;
    data = await r.json();
    n = { calls: data.numbers.calls ?? '', value: data.numbers.value ?? '', rate: data.numbers.rate ?? 30 };
  }
  onMount(async () => {
    await load();
    // /leads/12?precall=1 (from a booking) opens the send box straight away
    if (page.url.searchParams.get('precall') === '1') startSend();
  });

  const num = (v) => {
    const x = parseFloat(String(v ?? '').replace(/[^\d.]/g, ''));
    return Number.isFinite(x) ? x : null;
  };
  const f = $derived.by(() => {
    const c = num(n.calls), v = num(n.value), r = Math.min(100, Math.max(1, num(n.rate) || 30));
    const ready = c > 0 && v > 0;
    const week = ready ? c * (r / 100) * v : 0;
    return { ready, week, month: (week * 52) / 12, year: week * 52, rate: r };
  });
  const aud = (v) => '$' + Math.round(v).toLocaleString('en-AU');
  const dirty = $derived(!!data && (String(n.calls) !== String(data.numbers.calls ?? '') || String(n.value) !== String(data.numbers.value ?? '') || Number(n.rate) !== Number(data.numbers.rate ?? 30)));

  // save a moment after you stop typing
  let timer;
  $effect(() => {
    if (!dirty) return;
    clearTimeout(timer);
    timer = setTimeout(save, 700);
    return () => clearTimeout(timer);
  });
  async function save() {
    saving = true;
    try {
      const r = await fetch(`/api/leads/${lead.id}/precall`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(n) });
      if (r.ok) {
        data.numbers = (await r.json()).numbers;
        savedAt = Date.now();
      }
    } finally {
      saving = false;
    }
  }

  async function startSend() {
    if (dirty) await save();
    await load();
    if (!data.numbers.ready) return toast('Add the missed calls a week and the average job first', 'error');
    const regular = data.guests.map((g) => g.email);
    mail = { from: data.accounts[0]?.email || '', to: data.draft.to, cc: [], subject: data.draft.subject, message: data.draft.message, regular };
    extraCc = '';
    open = true;
  }
  const toggleCc = (e) => (mail.cc = mail.cc.includes(e) ? mail.cc.filter((x) => x !== e) : [...mail.cc, e]);
  function addCc(e) {
    e.preventDefault();
    const v = extraCc.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return toast('That email looks wrong', 'error');
    if (!mail.cc.includes(v)) mail.cc = [...mail.cc, v];
    extraCc = '';
  }
  async function send() {
    sending = true;
    try {
      const r = await fetch(`/api/leads/${lead.id}/precall/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from: mail.from, to: mail.to, cc: mail.cc, subject: mail.subject, message: mail.message })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message || 'Could not send it');
      toast(`Pre-call info sent to ${j.to}${j.cc.length ? `, cc ${j.cc.length}` : ''}`);
      open = false;
      await invalidateAll();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      sending = false;
    }
  }
  const lastSent = $derived(
    [...lead.dials].reverse().find((d) => d.channel === 'email' && /^gmail:/.test(d.extId || '') && /pre-call|before our call/i.test(d.subject || ''))
  );
  const growMessage = (el) => {
    const fit = () => ((el.style.height = 'auto'), (el.style.height = Math.min(el.scrollHeight + 2, 420) + 'px'));
    queueMicrotask(fit);
    el.addEventListener('input', fit);
  };
</script>

<section class="panel pre" id="precall">
  <h2>Pre-call info</h2>
  <p class="muted small">What missed calls could be costing them. It goes in the PDF and the email you send before the call.</p>
  {#if data}
    <div class="ins">
      <label class="field">Missed calls a week<input type="number" min="0" inputmode="decimal" bind:value={n.calls} placeholder="e.g. 10" /></label>
      <label class="field">Average job ($)<input type="number" min="0" inputmode="decimal" bind:value={n.value} placeholder="e.g. 850" /></label>
      <label class="field">Callers who become customers: {f.rate}%<input type="range" min="1" max="100" bind:value={n.rate} /></label>
    </div>
    <div class="out" class:empty={!f.ready}>
      <div class="yr"><small>Lost each year</small><b>{aud(f.year)}</b></div>
      <div class="sm"><span>{aud(f.month)} <small>a month</small></span><span>{aud(f.week)} <small>a week</small></span></div>
    </div>
    <p class="faint small state">{saving ? 'Saving' : savedAt ? 'Saved' : ''}{lastSent ? `${saving || savedAt ? ' · ' : ''}Last sent ${new Date(lastSent.at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}` : ''}</p>
    <div class="acts">
      <a class="btn small" class:disabled={!f.ready} href={f.ready ? `/api/leads/${lead.id}/precall.pdf` : undefined} download aria-disabled={!f.ready}><Icon name="upload" size={14} />Download PDF</a>
      <a class="btn small ghost" class:disabled={!f.ready} href={f.ready ? `/api/leads/${lead.id}/precall.pdf?inline=1` : undefined} target="_blank" rel="noopener">Preview</a>
      <button class="btn small primary" onclick={startSend} disabled={!f.ready}><Icon name="mail" size={14} />Send pre-call info</button>
    </div>
  {/if}
</section>

{#if open}
  <div class="scrim" transition:fade={{ duration: 150 }} role="presentation" onclick={() => !sending && (open = false)}></div>
  <div class="dialog panel" role="dialog" aria-modal="true" aria-label="Send pre-call info" transition:fly={{ y: 20, duration: 200 }}>
    <h3>Send pre-call info</h3>
    {#if !data.accounts.length}
      <p class="warn">No email account is connected yet. Connect the one you send from (e.g. your work address) in <a href="/settings#email">Settings > Email accounts</a>.</p>
    {:else}
      <label class="field">From
        <select bind:value={mail.from}>{#each data.accounts as a}<option value={a.email}>{a.name ? `${a.name} <${a.email}>` : a.email}</option>{/each}</select>
      </label>
      <label class="field">To<input type="email" bind:value={mail.to} placeholder="their email" /></label>
      <div class="field">CC
        <div class="chips">
          {#each data.guests as g}
            <label class="chip" class:on={mail.cc.includes(g.email)}><input type="checkbox" checked={mail.cc.includes(g.email)} onchange={() => toggleCc(g.email)} />{g.name || g.email}</label>
          {/each}
          {#each mail.cc.filter((e) => !data.guests.some((g) => g.email === e)) as e}
            <label class="chip on"><input type="checkbox" checked onchange={() => toggleCc(e)} />{e}</label>
          {/each}
          <form class="addcc" onsubmit={addCc}><input bind:value={extraCc} placeholder="Add an email" /><button class="btn small" disabled={!extraCc.trim()}>Add</button></form>
        </div>
      </div>
      <label class="field">Subject<input bind:value={mail.subject} /></label>
      <label class="field">Message<textarea bind:value={mail.message} use:growMessage rows="8"></textarea></label>
      <p class="faint small">
        Under your message: the numbers ({aud(f.year)} a year){data.draft.when ? `, the call on ${data.draft.when} with its link` : ''} and the video, with the PDF attached.
        <a href="/api/leads/{lead.id}/precall.pdf?inline=1" target="_blank" rel="noopener">See the PDF</a>
      </p>
    {/if}
    <div class="dacts">
      <button class="btn small ghost" onclick={() => (open = false)} disabled={sending}>Cancel</button>
      <button class="btn small primary" onclick={send} disabled={sending || !data.accounts.length || !mail.from || !mail.to}><Icon name="mail" size={14} />{sending ? 'Sending' : 'Send'}</button>
    </div>
  </div>
{/if}

<style>
  .pre {
    padding: 20px;
    display: grid;
    gap: 12px;
  }
  .pre h2 {
    margin: 0;
  }
  .small {
    font-size: 13px;
    margin: 0;
  }
  .ins {
    display: grid;
    gap: 10px;
  }
  .ins input[type='range'] {
    accent-color: var(--blue);
  }
  .out {
    border-radius: 12px;
    padding: 12px 14px;
    background: var(--red-soft);
    display: grid;
    gap: 4px;
  }
  .out.empty {
    background: var(--surface);
    opacity: 0.6;
  }
  .yr small,
  .sm small {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--ink-3);
  }
  .yr {
    display: grid;
  }
  .yr b {
    font-size: 28px;
    color: var(--red);
    font-variant-numeric: tabular-nums;
  }
  .sm {
    display: flex;
    gap: 16px;
    font-weight: 700;
  }
  .state {
    min-height: 16px;
  }
  .acts {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .btn.disabled {
    opacity: 0.45;
    pointer-events: none;
  }
  .scrim {
    position: fixed;
    inset: 0;
    background: rgba(20, 30, 50, 0.4);
    z-index: 60;
  }
  .dialog {
    position: fixed;
    z-index: 61;
    left: 50%;
    top: 4vh;
    transform: translateX(-50%);
    width: min(620px, calc(100% - 24px));
    max-height: 92vh;
    overflow: auto;
    padding: 22px;
    display: grid;
    gap: 12px;
  }
  .dialog h3 {
    margin: 0;
  }
  .dialog textarea {
    resize: vertical;
    line-height: 1.5;
    min-height: 140px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    font-weight: 400;
  }
  .chip {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    padding: 5px 10px;
    border-radius: 999px;
    border: 1px solid var(--line);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
  .chip.on {
    border-color: var(--blue);
  }
  .addcc {
    display: flex;
    gap: 6px;
  }
  .addcc input {
    height: 32px;
    border-radius: 8px;
    border: 1px solid var(--line);
    padding: 0 8px;
    font-size: 13px;
  }
  .warn {
    margin: 0;
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--yellow-soft, #fff6d6);
  }
  .dacts {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
</style>
