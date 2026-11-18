<script>
  // An IG handle (starts with @) links to the profile; a plain name is just text.
  let { handle, link = true } = $props();
  const ig = $derived(/^@[A-Za-z0-9._]{1,30}$/.test(handle) ? handle.slice(1) : null);
</script>

{#if ig && link}
  <a class="h" href="https://instagram.com/{ig}" target="_blank" rel="noopener" onclick={(e) => e.stopPropagation()}>{handle}</a>
{:else}
  <span class="h">{handle}</span>
{/if}

<style>
  .h {
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  a.h {
    text-decoration: none;
  }
  a.h:hover {
    color: var(--blue);
    text-decoration: underline;
  }
</style>
