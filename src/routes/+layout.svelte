<script>
  import '../app.css';
  import { page, navigating } from '$app/state';
  import { invalidateAll } from '$app/navigation';
  import Icon from '$lib/components/Icon.svelte';
  import Toasts from '$lib/components/Toasts.svelte';
  import { toast } from '$lib/toast.svelte.js';
  import { relative } from '$lib/fmt.js';

  let { data, children } = $props();
  let syncing = $state(false);

  const nav = [
    { href: '/', label: 'Today', icon: 'today' },
    { href: '/sdr', label: 'Dialling', icon: 'phone' },
    { href: '/closing', label: 'Closing', icon: 'handshake' },
    { href: '/calls', label: 'Calls', icon: 'list' },
    { href: '/calendar', label: 'Calendar', icon: 'calendar' },
    { href: '/settings', label: 'Settings', icon: 'settings' }
  ];

  const active = (href) => (href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href));

  async function sync() {
    syncing = true;
    try {
      const r = await fetch('/api/sync', { method: 'POST' }).then((r) => r.json());
      if (r.errors?.length) toast(r.errors[0], 'error');
      else toast(`Synced ${r.calendar?.kept ?? 0} calls and ${r.fathom?.recordings ?? 0} recordings`);
      await invalidateAll();
    } catch {
      toast('Sync failed. Check the server is running.', 'error');
    } finally {
      syncing = false;
    }
  }
</script>

<div class="shell">
  <aside class="rail">
    <a class="brand" href="/" aria-label="Closer Desk home">
      <span class="mark" aria-hidden="true"><i class="t-red"></i><i class="t-blue"></i><i class="t-yellow"></i><i class="t-green"></i></span>
      <span class="name">Closer Desk<small>CB Fitness</small></span>
    </a>
    <nav>
      {#each nav as n}
        <a href={n.href} class:active={active(n.href)} aria-current={active(n.href) ? 'page' : undefined}>
          <Icon name={n.icon} size={19} />
          <span>{n.label}</span>
        </a>
      {/each}
    </nav>
    <button class="sync" onclick={sync} disabled={syncing} title="Pull calendar events and Fathom recordings now">
      <span class="spin" class:on={syncing}><Icon name="refresh" size={16} /></span>
      <span>
        {syncing ? 'Syncing' : 'Sync now'}
        <small>{data.lastSync ? `Last ${relative(data.lastSync.at)}` : 'Not synced yet'}</small>
      </span>
    </button>
  </aside>

  <main class:loading={!!navigating.to}>
    {@render children()}
  </main>
</div>

<Toasts />

<style>
  .shell {
    display: grid;
    grid-template-columns: var(--rail) 1fr;
    min-height: 100vh;
  }
  .rail {
    position: sticky;
    top: 0;
    height: 100vh;
    display: flex;
    flex-direction: column;
    gap: 22px;
    padding: 22px 14px 18px;
    border-right: 1px solid var(--line-2);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 8px;
    text-decoration: none;
  }
  .mark {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 30px;
  }
  .mark i {
    display: block;
    width: 6px;
    border-radius: 2px;
    background: var(--tone);
  }
  .mark i:nth-child(1) { height: 24px; }
  .mark i:nth-child(2) { height: 30px; }
  .mark i:nth-child(3) { height: 24px; }
  .mark i:nth-child(4) { height: 16px; width: 4px; }
  .name {
    display: grid;
    font-weight: 800;
    font-size: 17px;
    font-variation-settings: 'wdth' 115;
    letter-spacing: -0.01em;
    line-height: 1.1;
  }
  .name small {
    font-weight: 500;
    font-size: 12px;
    color: var(--ink-3);
    font-variation-settings: 'wdth' 100;
    letter-spacing: 0;
  }
  nav {
    display: grid;
    gap: 2px;
  }
  nav a {
    position: relative;
    display: flex;
    align-items: center;
    gap: 12px;
    height: 40px;
    padding: 0 12px;
    border-radius: 10px;
    text-decoration: none;
    font-weight: 600;
    color: var(--ink-2);
    transition: background 0.15s, color 0.15s;
  }
  nav a:hover {
    background: var(--iron-soft);
    color: var(--ink);
  }
  nav a.active {
    background: var(--raised);
    color: var(--ink);
    box-shadow: var(--shadow);
  }
  nav a.active::before {
    content: '';
    position: absolute;
    left: -14px;
    top: 9px;
    bottom: 9px;
    width: 4px;
    border-radius: 0 4px 4px 0;
    background: var(--blue);
  }
  .sync {
    margin-top: auto;
    display: flex;
    gap: 10px;
    align-items: center;
    text-align: left;
    padding: 10px 12px;
    border-radius: 12px;
    border: 1px dashed var(--line);
    background: transparent;
    font-weight: 600;
    font-size: 14px;
  }
  .sync:hover {
    border-style: solid;
  }
  .sync small {
    display: block;
    font-weight: 400;
    font-size: 12px;
    color: var(--ink-3);
  }
  .spin.on {
    display: inline-flex;
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  main {
    min-width: 0;
    padding: 30px clamp(16px, 3vw, 40px) 60px;
    transition: opacity 0.2s;
  }
  main.loading {
    opacity: 0.6;
  }

  @media (max-width: 860px) {
    .shell {
      grid-template-columns: 1fr;
    }
    .rail {
      position: fixed;
      inset: auto 0 0 0;
      top: auto;
      height: auto;
      z-index: 30;
      flex-direction: row;
      padding: 6px 8px calc(6px + env(safe-area-inset-bottom));
      background: color-mix(in srgb, var(--surface) 92%, transparent);
      backdrop-filter: blur(12px);
      border-right: 0;
      border-top: 1px solid var(--line-2);
    }
    .brand,
    .sync {
      display: none;
    }
    nav {
      grid-auto-flow: column;
      grid-auto-columns: 1fr;
      width: 100%;
    }
    nav a {
      flex-direction: column;
      height: 52px;
      gap: 3px;
      padding: 6px 0;
      font-size: 11px;
      justify-content: center;
    }
    nav a.active::before {
      left: 30%;
      right: 30%;
      top: -6px;
      bottom: auto;
      width: auto;
      height: 3px;
      border-radius: 0 0 3px 3px;
    }
    main {
      padding: 20px 16px 96px;
    }
  }
</style>
