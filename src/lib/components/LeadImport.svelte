<script>
  import { fly, fade } from 'svelte/transition';
  import { invalidateAll } from '$app/navigation';
  import Icon from './Icon.svelte';
  import { FIELDS, guessField, toLeads, parseDelimited, readXlsx } from '$lib/leads.js';
  import { toast } from '$lib/toast.svelte.js';

  let { offerName, today, onclose } = $props();

  let paste = $state('');
  let table = $state(null); // { headers, rows }
  let mapping = $state([]);
  let book = $state(null);
  let sheet = $state('');
  let busy = $state(false);
  let over = $state(false);
  let fileName = $state('');

  function load(rows) {
    // the header is the fullest of the first few rows (sheets often have a stray title row above it)
    const filled = (r) => r.filter((c) => String(c ?? '').trim()).length;
    let at = 0;
    rows.slice(0, 10).forEach((r, i) => filled(r) > filled(rows[at]) && (at = i));
    if (rows.length - at < 2) throw new Error('Need a header row and at least one lead');
    const headers = rows[at].map((h) => String(h ?? '').trim());
    table = { headers, rows: rows.slice(at + 1) };
    mapping = headers.map(guessField);
  }

  async function pick(file) {
    if (!file) return;
    fileName = file.name;
    try {
      if (/\.xlsx$/i.test(file.name)) {
        book = await readXlsx(await file.arrayBuffer());
        sheet = book.sheets[0];
        load(await book.read(sheet));
      } else if (/\.xls$/i.test(file.name)) {
        throw new Error('Old .xls files are not supported. Save it as .xlsx or CSV, or copy and paste the cells.');
      } else {
        book = null;
        load(parseDelimited(await file.text()));
      }
    } catch (e) {
      table = null;
      toast(e.message || 'Could not read that file', 'error');
    }
  }
  async function changeSheet() {
    try {
      load(await book.read(sheet));
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  function fromPaste() {
    try {
      fileName = '';
      book = null;
      load(parseDelimited(paste));
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  const leads = $derived(table ? toLeads(table.headers, table.rows, mapping, today) : []);
  const has = (k) => mapping.includes(k);
  const sample = (i) => table.rows.map((r) => String(r[i] ?? '').trim()).find(Boolean) || '';

  async function run() {
    busy = true;
    try {
      const r = await fetch('/api/leads/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rows: leads })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message || 'Import failed');
      const parts = [`${j.added} new`, j.updated && `${j.updated} already on the list, updated`, j.skipped && `${j.skipped} skipped`].filter(Boolean);
      toast(`Imported: ${parts.join(', ')}`);
      await invalidateAll();
      onclose();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      busy = false;
    }
  }
  const onkey = (e) => e.key === 'Escape' && !busy && onclose();
</script>

<svelte:window onkeydown={onkey} />

<div class="scrim" transition:fade={{ duration: 160 }} onclick={() => !busy && onclose()} role="presentation"></div>
<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="imp-title" transition:fly={{ y: 30, duration: 300 }}>
  <header>
    <div>
      <h2 id="imp-title">Import leads into {offerName}</h2>
      <p class="muted small">Upload your .xlsx or CSV, or copy the cells in Excel (header row included) and paste them here.</p>
    </div>
    <button class="btn ghost small" onclick={onclose} aria-label="Close" disabled={busy}><Icon name="x" /></button>
  </header>

  <div class="body">
    {#if !table}
      <label
        class="drop"
        class:over
        ondragover={(e) => (e.preventDefault(), (over = true))}
        ondragleave={() => (over = false)}
        ondrop={(e) => (e.preventDefault(), (over = false), pick(e.dataTransfer.files[0]))}
      >
        <Icon name="upload" size={26} />
        <strong>Drop a spreadsheet here, or click to choose one</strong>
        <span class="faint">.xlsx, .csv or .tsv</span>
        <input type="file" accept=".xlsx,.xls,.csv,.tsv,.txt" class="sr-only" onchange={(e) => pick(e.currentTarget.files[0])} />
      </label>
      <div class="or faint"><span>or paste</span></div>
      <label class="field">
        <span class="sr-only">Pasted cells</span>
        <textarea bind:value={paste} rows="5" placeholder="Prospect Score	Business	Mobile	..."></textarea>
      </label>
      <div class="acts"><button class="btn primary" onclick={fromPaste} disabled={!paste.trim()}>Read pasted cells</button></div>
    {:else}
      <div class="src">
        <span><strong>{fileName || 'Pasted cells'}</strong>, {table.rows.length} rows</span>
        {#if book && book.sheets.length > 1}
          <label class="inline">Sheet
            <select bind:value={sheet} onchange={changeSheet}>{#each book.sheets as s}<option>{s}</option>{/each}</select>
          </label>
        {/if}
        <button class="btn small ghost" onclick={() => ((table = null), (book = null))}>Use a different file</button>
      </div>

      <p class="muted small">Check where each column goes. Research columns (pitch angle, reviews, website) show on the lead while you dial.</p>
      <div class="map">
        {#each table.headers as h, i}
          <label class="col" class:off={mapping[i] === 'skip'}>
            <span class="h">{h || `Column ${i + 1}`}</span>
            <span class="eg faint">{sample(i) || 'empty'}</span>
            <select bind:value={mapping[i]} aria-label="Where {h} goes">
              {#each FIELDS as f}<option value={f.key}>{f.label}</option>{/each}
            </select>
          </label>
        {/each}
      </div>

      {#if !has('business') && !has('contact') && !has('phone')}
        <p class="warn">Pick a Business, Contact name or Mobile column so each lead has a name.</p>
      {/if}
      {#if has('history')}
        <p class="note small">Past calls from your sheet are kept on each lead as history. They don't add to your dial numbers, since you've already counted those.</p>
      {/if}
      <p class="small muted">Leads already on the list (same mobile, email or business) get their research columns refreshed. Their dials, notes and follow-ups stay as they are.</p>
    {/if}
  </div>

  {#if table}
    <footer>
      <span class="muted small">{leads.length} {leads.length === 1 ? 'lead' : 'leads'} ready{table.rows.length - leads.length > 0 ? `, ${table.rows.length - leads.length} empty rows left out` : ''}</span>
      <button class="btn primary" onclick={run} disabled={busy || !leads.length}><Icon name="upload" size={16} />{busy ? 'Importing' : `Import ${leads.length}`}</button>
    </footer>
  {/if}
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: rgba(16, 21, 29, 0.45);
    z-index: 50;
  }
  .sheet {
    position: fixed;
    z-index: 51;
    left: 50%;
    top: 50%;
    translate: -50% -50%;
    width: min(860px, calc(100vw - 24px));
    max-height: calc(100vh - 40px);
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border: 1px solid var(--line-2);
    border-radius: var(--r-panel);
    box-shadow: var(--shadow);
  }
  header,
  footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 18px 22px;
  }
  header {
    align-items: start;
    border-bottom: 1px solid var(--line-2);
  }
  header p {
    margin: 4px 0 0;
  }
  footer {
    border-top: 1px solid var(--line-2);
  }
  .body {
    padding: 18px 22px;
    overflow: auto;
    display: grid;
    gap: 14px;
  }
  .small {
    font-size: 13px;
  }
  .drop {
    display: grid;
    justify-items: center;
    gap: 6px;
    padding: 34px 16px;
    border: 2px dashed var(--line);
    border-radius: 14px;
    cursor: pointer;
    color: var(--ink-2);
    text-align: center;
    transition: border-color 0.15s, background 0.15s;
  }
  .drop:hover,
  .drop.over,
  .drop:focus-within {
    border-color: var(--blue);
    background: var(--blue-soft);
  }
  .or {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 12.5px;
  }
  .or::before,
  .or::after {
    content: '';
    flex: 1;
    border-top: 1px solid var(--line-2);
  }
  textarea {
    font-family: ui-monospace, monospace;
    font-size: 12.5px;
  }
  .acts {
    display: flex;
    justify-content: end;
  }
  .src {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 16px;
  }
  .src > span {
    margin-right: auto;
  }
  .inline {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 13px;
  }
  .map {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: 10px;
  }
  .col {
    display: grid;
    gap: 4px;
    padding: 10px 12px;
    border-radius: 12px;
    background: var(--raised);
    border: 1px solid var(--line-2);
    min-width: 0;
  }
  .col.off {
    opacity: 0.55;
  }
  .h {
    font-weight: 700;
    font-size: 13.5px;
  }
  .eg {
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  select {
    height: 34px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--ink);
    padding: 0 8px;
  }
  .warn {
    margin: 0;
    color: var(--red);
    font-weight: 600;
  }
  .note {
    margin: 0;
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--yellow-soft);
  }
  p {
    margin: 0;
  }
</style>
