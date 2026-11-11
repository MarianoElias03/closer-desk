<script>
  import { invalidateAll, goto } from '$app/navigation';
  import Icon from './Icon.svelte';
  import { toast } from '$lib/toast.svelte.js';
  import { money } from '$lib/fmt.js';

  let { offer, offers, compact = false } = $props();
  let open = $state(false);
  let busy = $state(false);
  let root;

  const active = $derived(offers.filter((o) => !o.archived));
  const sub = (o) => [o.industry, o.price != null ? money(o.price) : null].filter(Boolean).join(' · ');

  async function pick(o) {
    open = false;
    if (o.id === offer.id) return;
    busy = true;
    const r = await fetch(`/api/offers/${o.id}/open`, { method: 'POST' });
    busy = false;
    if (!r.ok) return toast('Could not switch offer', 'error');
    await invalidateAll();
    toast(`Now on ${o.name}`);
  }

  function onwindow(e) {
    if (open && root && !root.contains(e.target)) open = false;
  }
  function onkey(e) {
    if (e.key === 'Escape') open = false;
  }
</script>

<svelte:window onpointerdown={onwindow} onkeydown={onkey} />

<div class="sw" class:compact bind:this={root}>
  <button class="cur" onclick={() => (open = !open)} aria-haspopup="listbox" aria-expanded={open} disabled={busy}>
    <span class="ic"><Icon name="layers" size={16} /></span>
    <span class="txt">
      <small>Offer</small>
      <strong>{offer.name}</strong>
      {#if sub(offer) && !compact}<em>{sub(offer)}</em>{/if}
    </span>
    <span class="chev" class:up={open}><Icon name="down" size={16} /></span>
  </button>

  {#if open}
    <div class="menu" role="listbox" aria-label="Switch offer">
      {#each active as o (o.id)}
        <button role="option" aria-selected={o.id === offer.id} class:on={o.id === offer.id} onclick={() => pick(o)}>
          <span class="txt"><strong>{o.name}</strong>{#if sub(o)}<em>{sub(o)}</em>{/if}</span>
          {#if o.id === offer.id}<Icon name="check" size={16} />{/if}
        </button>
      {/each}
      <hr />
      <button class="act" onclick={() => { open = false; goto('/offers?new=1'); }}><Icon name="plus" size={16} />New offer</button>
      <button class="act" onclick={() => { open = false; goto('/offers'); }}><Icon name="edit" size={16} />Edit offers</button>
    </div>
  {/if}
</div>

<style>
  .sw {
    position: relative;
  }
  .cur {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 10px;
    border-radius: 12px;
    border: 1px solid var(--line-2);
    background: var(--raised);
    box-shadow: var(--shadow);
    text-align: left;
    cursor: pointer;
  }
  .cur:hover {
    border-color: var(--line);
  }
  .ic {
    flex: none;
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 8px;
    background: var(--blue-soft);
    color: var(--blue);
  }
  .txt {
    display: grid;
    min-width: 0;
    flex: 1;
    line-height: 1.2;
  }
  .txt small {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-3);
  }
  .txt strong {
    font-weight: 700;
    font-size: 14.5px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .txt em {
    font-style: normal;
    font-size: 12px;
    color: var(--ink-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chev {
    display: inline-flex;
    color: var(--ink-3);
    transition: transform 0.2s var(--ease-out);
  }
  .chev.up {
    transform: rotate(180deg);
  }
  .menu {
    position: absolute;
    z-index: 40;
    top: calc(100% + 6px);
    left: 0;
    right: 0;
    min-width: 220px;
    display: grid;
    gap: 2px;
    padding: 6px;
    border-radius: 12px;
    border: 1px solid var(--line-2);
    background: var(--raised);
    box-shadow: var(--shadow), 0 16px 40px -18px rgba(0, 0, 0, 0.35);
    max-height: 60vh;
    overflow: auto;
  }
  .menu button {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    text-align: left;
    color: var(--ink);
    cursor: pointer;
  }
  .menu button:hover {
    background: var(--iron-soft);
  }
  .menu button.on {
    color: var(--blue);
  }
  .menu .act {
    font-weight: 600;
    font-size: 13.5px;
    color: var(--ink-2);
  }
  hr {
    border: 0;
    border-top: 1px solid var(--line-2);
    margin: 4px 2px;
  }
  .compact .cur {
    padding: 7px 10px;
  }
  .compact .ic {
    width: 26px;
    height: 26px;
  }
</style>
