<script>
  import { invalidateAll } from '$app/navigation';
  import { toast } from '$lib/toast.svelte.js';
  let { month, kind, override, active } = $props();
  let editing = $state(false);
  let v = $state('');
  async function save(value) {
    const r = await fetch('/api/meta', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ month, kind, days: value })
    });
    editing = false;
    if (r.ok) invalidateAll();
    else toast('Could not save days worked', 'error');
  }
</script>

<div class="dw">
  {#if editing}
    <form onsubmit={(e) => (e.preventDefault(), save(v === '' ? null : Number(v)))}>
      <input type="number" min="0" max="31" bind:value={v} aria-label="Days worked this month" />
      <button class="btn small primary">Save</button>
      {#if override != null}<button type="button" class="btn small ghost" onclick={() => save(null)}>Count automatically</button>{/if}
    </form>
  {:else}
    <button class="link" onclick={() => ((v = override ?? active), (editing = true))}>
      Per-day figures use <strong>{override ?? active}</strong> days worked
      {override != null ? '(set by you)' : '(days with something logged)'}. Change
    </button>
  {/if}
</div>

<style>
  .dw {
    font-size: 13px;
    color: var(--ink-2);
  }
  .link {
    background: none;
    border: 0;
    padding: 0;
    color: inherit;
    text-align: left;
  }
  .link:hover {
    color: var(--ink);
    text-decoration: underline;
  }
  form {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  input {
    width: 70px;
    height: 30px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--raised);
    padding: 0 8px;
  }
</style>
