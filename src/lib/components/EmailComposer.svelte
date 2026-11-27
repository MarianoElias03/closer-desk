<script>
  // Write an email to a lead without leaving Closer Desk. Sends from a connected account with your
  // signature for it underneath, and the email goes on the lead's history.
  import { fade, fly } from 'svelte/transition';
  import { invalidateAll } from '$app/navigation';
  import Icon from './Icon.svelte';
  import { toast } from '$lib/toast.svelte.js';

  // automation: an id to start from straight away (e.g. 'Send an automation')
  let { lead, onclose, automation = null } = $props();

  let info = $state(null);
  let m = $state({ from: '', to: lead.email || '', cc: [], subject: '', message: '', signature: true, automationId: null });

  let extraCc = $state('');
  let sending = $state(false);

  $effect(() => {
    fetch(`/api/leads/${lead.id}/email`)
      .then((r) => r.json())
      .then((j) => {
        info = j;
        m.from = j.accounts[0]?.email || '';
        m.to = j.to || m.to;
        if (automation != null) useAutomation(String(automation));
        queueMicrotask(() => document.querySelector('.compose input[name="subject"]')?.focus());
      })
      .catch(() => (info = { accounts: [], guests: [] }));
  });

  // start from one of your automations, filled in for this lead (you can still change anything)
  let picked = $state('');
  const pickedA = $derived(info?.automations?.find((a) => String(a.id) === picked));
  function useAutomation(id) {
    if (id && dirty && picked !== id && !confirm('Replace what you wrote with this automation?')) return (picked = picked);
    picked = id;
    const a = info?.automations?.find((x) => String(x.id) === id);
    if (!a) {
      m.automationId = null;
      return;
    }
    m.subject = a.subject;
    m.message = a.message;
    m.automationId = a.id;
    if (a.fromEmail && info.accounts.some((x) => x.email === a.fromEmail)) m.from = a.fromEmail;
    queueMicrotask(() => document.querySelectorAll('.compose textarea').forEach((t) => t.dispatchEvent(new Event('input'))));
  }
  const acct = $derived(info?.accounts.find((a) => a.email === m.from));
  const dirty = $derived(!!(m.subject.trim() || m.message.trim()));
  const toggleCc = (e) => (m.cc = m.cc.includes(e) ? m.cc.filter((x) => x !== e) : [...m.cc, e]);
  function addCc(e) {
    e.preventDefault();
    const v = extraCc.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return toast('That email looks wrong', 'error');
    if (!m.cc.includes(v)) m.cc = [...m.cc, v];
    extraCc = '';
  }
  function close() {
    if (sending) return;
    if (dirty && !confirm('Close without sending? What you wrote will be lost.')) return;
    onclose();
  }
  async function send() {
    sending = true;
    try {
      const r = await fetch(`/api/leads/${lead.id}/email`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(m) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message || 'Could not send it');
      toast(`Email sent to ${j.to}${j.cc.length ? `, cc ${j.cc.length}` : ''}`);
      onclose();
      await invalidateAll();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      sending = false;
    }
  }
  function onkey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !sending) {
      e.preventDefault();
      send();
    }
  }
  const grow = (el) => {
    const fit = () => ((el.style.height = 'auto'), (el.style.height = Math.min(el.scrollHeight + 2, window.innerHeight * 0.45) + 'px'));
    queueMicrotask(fit);
    el.addEventListener('input', fit);
  };
</script>

<svelte:window onkeydown={onkey} />

<div class="scrim" transition:fade={{ duration: 150 }} role="presentation" onclick={close}></div>
<div class="dialog panel compose" role="dialog" aria-modal="true" aria-label="Email {lead.business || lead.contact || 'this lead'}" transition:fly={{ y: 20, duration: 200 }}>
  <h3><Icon name="mail" size={18} />Email {lead.contact || lead.business || 'this lead'}</h3>
  {#if !info}
    <p class="faint">Loading</p>
  {:else if !info.accounts.length}
    <p class="warn">No email account is connected yet. Connect the one you send from in <a href="/settings#email">Settings > Email accounts</a>.</p>
  {:else}
    {#if info.automations?.length}
      <label class="field">Start from
        <select value={picked} onchange={(e) => useAutomation(e.currentTarget.value)}>
          <option value="">A blank email</option>
          {#each info.automations as a}<option value={String(a.id)}>{a.name}{a.enabled ? '' : ' (switched off)'}</option>{/each}
        </select>
      </label>
      {#if pickedA?.problem}<p class="warn small">On its own this automation wouldn't send to them: {pickedA.problem}. Check the message before sending.</p>{/if}
    {/if}
    <div class="two">
      <label class="field">From
        <select bind:value={m.from}>{#each info.accounts as a}<option value={a.email}>{a.name ? `${a.name} <${a.email}>` : a.email}</option>{/each}</select>
      </label>
      <label class="field">To<input type="email" bind:value={m.to} placeholder="their email" /></label>
    </div>
    {#if info.guests.length || m.cc.length}
      <div class="field">CC
        <div class="chips">
          {#each info.guests as g}
            <label class="chip" class:on={m.cc.includes(g.email)}><input type="checkbox" checked={m.cc.includes(g.email)} onchange={() => toggleCc(g.email)} />{g.name || g.email}</label>
          {/each}
          {#each m.cc.filter((e) => !info.guests.some((g) => g.email === e)) as e}
            <label class="chip on"><input type="checkbox" checked onchange={() => toggleCc(e)} />{e}</label>
          {/each}
          <form class="addcc" onsubmit={addCc}><input bind:value={extraCc} placeholder="Add an email" /><button class="btn small" disabled={!extraCc.trim()}>Add</button></form>
        </div>
      </div>
    {:else}
      <form class="addcc solo" onsubmit={addCc}><span class="k">CC</span><input bind:value={extraCc} placeholder="Add someone (optional)" /><button class="btn small" disabled={!extraCc.trim()}>Add</button></form>
    {/if}
    <label class="field">Subject<input name="subject" bind:value={m.subject} placeholder="What it's about" /></label>
    <label class="field">Message<textarea bind:value={m.message} use:grow rows="7" placeholder="Hi {(lead.contact || '').split(' ')[0] || 'there'}, …"></textarea></label>
    {#if acct?.signature}
      <label class="sigon"><input type="checkbox" bind:checked={m.signature} />Add my signature</label>
      {#if m.signature}<div class="sig">{@html acct.signature}</div>{/if}
    {:else}
      <p class="faint small">No signature for {m.from} yet. Add one in <a href="/settings#email">Settings > Email accounts</a>.</p>
    {/if}
    <p class="faint small">Links can be written as [words](https://…). It goes on {lead.business || 'the lead'}'s history once sent.</p>
  {/if}
  <div class="dacts">
    <span class="faint small keys">Ctrl+Enter sends, Esc closes</span>
    <button class="btn small ghost" onclick={close} disabled={sending}>Cancel</button>
    <button class="btn small primary" onclick={send} disabled={sending || !info?.accounts.length || !m.from || !m.to.trim() || !m.subject.trim() || !m.message.trim()}><Icon name="mail" size={14} />{sending ? 'Sending' : 'Send'}</button>
  </div>
</div>

<style>
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
    width: min(680px, calc(100% - 24px));
    max-height: 92vh;
    overflow: auto;
    padding: 22px;
    display: grid;
    gap: 12px;
  }
  h3 {
    margin: 0;
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .two {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  @media (max-width: 560px) {
    .two {
      grid-template-columns: 1fr;
    }
  }
  textarea {
    resize: vertical;
    line-height: 1.5;
    min-height: 150px;
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
    align-items: center;
  }
  .addcc input {
    height: 32px;
    border-radius: 8px;
    border: 1px solid var(--line);
    padding: 0 8px;
    font-size: 13px;
  }
  .addcc.solo input {
    flex: 1;
  }
  .k {
    font-size: 13px;
    font-weight: 600;
  }
  .sigon {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 14px;
  }
  .sig {
    padding: 12px 14px;
    border: 1px dashed var(--line);
    border-radius: 10px;
    background: #fff;
    color: #1a2433;
    font-family: Helvetica, Arial, sans-serif;
    font-size: 13px;
    max-height: 220px;
    overflow: auto;
  }
  .sig :global(img) {
    max-width: 100%;
    height: auto;
  }
  .sig :global(p) {
    margin: 0;
  }
  .small {
    font-size: 13px;
    margin: 0;
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
    align-items: center;
    gap: 8px;
  }
  .keys {
    margin-right: auto;
  }
</style>
