<script>
  // Your email signature for one sending account: type it, or paste it straight from Gmail or Outlook
  // (formatting and images come with it), add your logo, and save. Used at the end of automatic emails
  // ({signature}) and the pre-call email.
  import { onMount } from 'svelte';
  import { toast } from '$lib/toast.svelte.js';

  let { email, html = '', onsaved = () => {} } = $props();

  let box = $state(null);
  let saved = $state(html);
  let dirty = $state(false);
  let busy = $state(false);
  let img = $state(null); // the image you clicked, to resize
  let imgW = $state(0);
  let fileIn = $state(null);

  onMount(() => {
    box.innerHTML = html || '';
  });

  const cmd = (c, v = null) => {
    box.focus();
    document.execCommand('styleWithCSS', false, true);
    document.execCommand(c, false, v);
    dirty = true;
  };
  function link() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return toast('Select the words to link first', 'error');
    let u = prompt('Link to (website, or mailto:you@company.com)', 'https://');
    if (!u || u === 'https://') return;
    if (!/^(https?:|mailto:|tel:)/i.test(u)) u = `https://${u}`;
    cmd('createLink', u);
  }
  async function upload(e) {
    const f = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!f) return;
    const fd = new FormData();
    fd.append('file', f);
    busy = true;
    try {
      const r = await fetch('/api/settings/mail/image', { method: 'POST', body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message || 'Could not upload that');
      box.focus();
      document.execCommand('insertHTML', false, `<img src="${j.url}" alt="" width="180" style="max-width:100%;height:auto">`);
      dirty = true;
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      busy = false;
    }
  }
  function pick(e) {
    if (e.target.tagName === 'IMG') {
      img = e.target;
      imgW = img.width || 180;
    } else img = null;
  }
  function sizeImg() {
    if (!img) return;
    img.setAttribute('width', String(imgW));
    img.style.width = '';
    img.style.height = 'auto';
    dirty = true;
  }
  function removeImg() {
    img?.remove();
    img = null;
    dirty = true;
  }
  async function save() {
    busy = true;
    try {
      const r = await fetch('/api/settings/mail', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'setSignature', email, html: box.innerHTML }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message || 'Could not save it');
      box.innerHTML = j.signature;
      saved = j.signature;
      dirty = false;
      img = null;
      toast('Signature saved');
      onsaved(j.signature);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      busy = false;
    }
  }
  function undo() {
    box.innerHTML = saved || '';
    dirty = false;
    img = null;
  }
</script>

<div class="sig">
  <div class="bar" role="toolbar" aria-label="Signature formatting">
    <button type="button" onclick={() => cmd('bold')} title="Bold"><b>B</b></button>
    <button type="button" onclick={() => cmd('italic')} title="Italic"><i>I</i></button>
    <button type="button" onclick={() => cmd('underline')} title="Underline"><u>U</u></button>
    <select onchange={(e) => (cmd('fontSize', e.currentTarget.value), (e.currentTarget.value = ''))} aria-label="Text size">
      <option value="">Size</option>
      <option value="1">Small</option>
      <option value="3">Normal</option>
      <option value="4">Large</option>
      <option value="5">Larger</option>
    </select>
    <label class="color" title="Text colour">A<input type="color" onchange={(e) => cmd('foreColor', e.currentTarget.value)} aria-label="Text colour" /></label>
    <button type="button" onclick={link} title="Link the selected words">Link</button>
    <button type="button" onclick={() => fileIn.click()} disabled={busy} title="Add your logo or a photo">Image</button>
    <button type="button" onclick={() => cmd('removeFormat')} title="Clear formatting on the selection">Clear</button>
    <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" bind:this={fileIn} onchange={upload} hidden />
  </div>
  <div
    class="ed"
    contenteditable="true"
    role="textbox"
    aria-multiline="true"
    aria-label="Signature for {email}"
    tabindex="0"
    bind:this={box}
    oninput={() => (dirty = true)}
    onclick={pick}
    onkeydown={() => {}}
    data-empty="Type your signature, or paste it from Gmail or Outlook"
  ></div>
  {#if img}
    <div class="imgbar">
      <span class="faint">Image width</span>
      <input type="range" min="40" max="560" bind:value={imgW} oninput={sizeImg} aria-label="Image width" />
      <span class="num">{imgW}px</span>
      <button type="button" class="btn small ghost" onclick={removeImg}>Remove image</button>
    </div>
  {/if}
  <div class="acts">
    <span class="faint small">Pasting from Gmail or Outlook keeps the formatting and images.</span>
    {#if dirty}<button type="button" class="btn small ghost" onclick={undo} disabled={busy}>Undo changes</button>{/if}
    <button type="button" class="btn small primary" onclick={save} disabled={busy || !dirty}>{busy ? 'Saving' : 'Save signature'}</button>
  </div>
</div>

<style>
  .sig {
    display: grid;
    gap: 8px;
    margin-top: 10px;
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
  }
  .bar button,
  .bar select,
  .color {
    height: 30px;
    min-width: 32px;
    padding: 0 8px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--surface, #fff);
    color: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .color {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-weight: 700;
  }
  .color input {
    width: 20px;
    height: 20px;
    padding: 0;
    border: 0;
    background: none;
    cursor: pointer;
  }
  .ed {
    min-height: 120px;
    padding: 12px 14px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: #fff;
    color: #1a2433;
    font-family: Helvetica, Arial, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
  .ed:empty::before {
    content: attr(data-empty);
    color: #8a92a6;
  }
  .ed :global(img) {
    max-width: 100%;
    height: auto;
    cursor: pointer;
  }
  .imgbar {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 13px;
  }
  .imgbar input {
    flex: 1;
    max-width: 240px;
  }
  .acts {
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: flex-end;
    flex-wrap: wrap;
  }
  .acts .small {
    margin-right: auto;
    font-size: 12px;
  }
</style>
