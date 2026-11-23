<script>
  import Icon from '$lib/components/Icon.svelte';

  let { data } = $props();
  let username = $state('');
  let password = $state('');
  let confirm = $state('');
  let busy = $state(false);
  let err = $state('');

  async function submit(e) {
    e.preventDefault();
    err = '';
    if (data.setup && password !== confirm) return (err = "The two passwords don't match");
    busy = true;
    try {
      const r = await fetch(data.setup ? '/api/auth/setup' : '/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password, device: browserName() })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || 'Could not sign in');
      const next = data.next.startsWith('/') && !data.next.startsWith('//') ? data.next : '/';
      location.href = next; // full load so every page starts signed in
    } catch (e) {
      err = e.message;
      busy = false;
    }
  }
  function browserName() {
    const ua = navigator.userAgent;
    const b = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
    const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
    return os ? `${b} on ${os}` : b;
  }
</script>

<svelte:head><title>Sign in · Closer Desk</title></svelte:head>

<div class="wrap">
  <form class="card panel" onsubmit={submit}>
    <div class="brand">
      <span class="mark" aria-hidden="true"><i class="t-red"></i><i class="t-blue"></i><i class="t-yellow"></i><i class="t-green"></i></span>
      <span class="name">Closer Desk<small>Sales tracker</small></span>
    </div>
    <h1>{data.setup ? 'Create your account' : 'Sign in'}</h1>
    <p class="muted">
      {data.setup
        ? 'Closer Desk now needs a sign-in. Pick the username and password you will use here and in the Android app.'
        : 'Use your Closer Desk username and password.'}
    </p>
    <label class="field">Username<input bind:value={username} autocomplete="username" autocapitalize="none" required /></label>
    <label class="field">Password<input type="password" bind:value={password} autocomplete={data.setup ? 'new-password' : 'current-password'} required minlength={data.setup ? 8 : undefined} /></label>
    {#if data.setup}
      <label class="field">Password again<input type="password" bind:value={confirm} autocomplete="new-password" required /></label>
    {/if}
    {#if err}<p class="err" role="alert"><Icon name="x" size={14} />{err}</p>{/if}
    <button class="btn primary" disabled={busy}>{busy ? 'One moment' : data.setup ? 'Create account' : 'Sign in'}</button>
  </form>
</div>

<style>
  .wrap {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 24px 16px;
    background: var(--chalk);
  }
  .card {
    width: min(400px, 100%);
    padding: 28px;
    display: grid;
    gap: 14px;
  }
  h1 {
    margin: 6px 0 0;
    font-size: 26px;
  }
  p {
    margin: 0;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .mark {
    display: inline-flex;
    gap: 3px;
    align-items: end;
    height: 26px;
  }
  .mark i {
    width: 6px;
    border-radius: 3px;
    background: var(--tone);
    height: 100%;
  }
  .mark i:nth-child(2) {
    height: 80%;
  }
  .mark i:nth-child(3) {
    height: 65%;
  }
  .mark i:nth-child(4) {
    height: 90%;
  }
  .name {
    font-weight: 800;
    font-size: 17px;
    display: grid;
    line-height: 1.1;
  }
  .name small {
    font-weight: 500;
    font-size: 12px;
    color: var(--ink-3);
  }
  .err {
    display: flex;
    gap: 6px;
    align-items: center;
    color: var(--red);
    font-weight: 600;
    font-size: 14px;
  }
  .btn {
    justify-content: center;
    height: 44px;
  }
</style>
