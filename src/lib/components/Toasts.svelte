<script>
  import { fly } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { toasts } from '$lib/toast.svelte.js';
  import Icon from './Icon.svelte';
</script>

<div class="toasts" role="status" aria-live="polite">
  {#each toasts as t (t.id)}
    <div class="toast" class:error={t.kind === 'error'} in:fly={{ y: 16, duration: 260 }} out:fly={{ y: 8, duration: 180 }} animate:flip={{ duration: 220 }}>
      <Icon name={t.kind === 'error' ? 'x' : 'check'} size={16} />
      {t.text}
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    right: 20px;
    bottom: 20px;
    z-index: 100;
    display: grid;
    gap: 8px;
    justify-items: end;
    pointer-events: none;
  }
  .toast {
    display: flex;
    gap: 10px;
    align-items: center;
    max-width: 380px;
    padding: 11px 14px;
    border-radius: 12px;
    background: var(--ink);
    color: var(--chalk);
    font-size: 14px;
    font-weight: 500;
    box-shadow: var(--shadow);
  }
  .toast.error {
    background: var(--red);
    color: #fff;
  }
  @media (max-width: 860px) {
    .toasts {
      left: 16px;
      right: 16px;
      bottom: 84px;
      justify-items: stretch;
    }
  }
</style>
