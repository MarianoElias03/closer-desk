<script>
  // Settings > Account: who you're signed in as, every device signed in, change password, sign out.
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { toast } from '$lib/toast.svelte.js';
  import { relative } from '$lib/fmt.js';

  let { username } = $props();
  let sessions = $state([]);
  let pw = $state({ current: '', next: '', again: '' });
  let changing = $state(false);

  async function load() {
    const r = await fetch('/api/auth/sessions');
    if (r.ok) sessions = (await r.json()).sessions;
  }
  onMount(load);

  async function revoke(s) {
    if (!confirm(`Sign out ${s.device}?`)) return;
    const r = await fetch(`/api/auth/sessions?id=${s.id}`, { method: 'DELETE' });
    if (r.ok) toast(`Signed out ${s.device}`);
    load();
  }
  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    location.href = '/login';
  }
  async function change(e) {
    e.preventDefault();
    if (pw.next !== pw.again) return toast("The new passwords don't match", 'error');
    const r = await fetch('/api/auth/password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(pw) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return toast(j.message || 'Could not change it', 'error');
    toast('Password changed. Your other devices are signed out.');
    pw = { current: '', next: '', again: '' };
    changing = false;
    load();
  }
</script>

<section class="panel">
  <h2>Account</h2>
  <p class="muted">Signed in as <strong>{username}</strong>. The same sign-in works in the Android app.</p>
  <ul class="devs">
    {#each sessions as s}
      <li>
        <Icon name={/Android|app/i.test(s.device) ? 'phone' : 'today'} size={16} />
        <span><strong>{s.device}</strong>{#if s.current} <span class="faint">(this one)</span>{/if}<br /><span class="faint small">Last used {relative(s.lastSeen)}</span></span>
        {#if !s.current}<button class="btn small ghost" onclick={() => revoke(s)}>Sign out</button>{/if}
      </li>
    {/each}
  </ul>
  {#if changing}
    <form class="pw" onsubmit={change}>
      <label class="field">Current password<input type="password" bind:value={pw.current} autocomplete="current-password" required /></label>
      <label class="field">New password<input type="password" bind:value={pw.next} autocomplete="new-password" minlength="8" required /></label>
      <label class="field">New password again<input type="password" bind:value={pw.again} autocomplete="new-password" required /></label>
      <div class="acts"><button type="button" class="btn small ghost" onclick={() => (changing = false)}>Cancel</button><button class="btn small primary">Change password</button></div>
    </form>
  {/if}
  <div class="acts">
    {#if !changing}<button class="btn small" onclick={() => (changing = true)}>Change password</button>{/if}
    <button class="btn small ghost" onclick={signOut}>Sign out here</button>
  </div>
</section>

<style>
  .devs {
    list-style: none;
    margin: 14px 0;
    padding: 0;
    display: grid;
    gap: 10px;
  }
  .devs li {
    display: flex;
    gap: 10px;
    align-items: center;
  }
  .devs li > span {
    flex: 1;
  }
  .small {
    font-size: 12.5px;
  }
  .pw {
    display: grid;
    gap: 10px;
    max-width: 360px;
    margin-bottom: 12px;
  }
  .acts {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
</style>
