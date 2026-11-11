<script>
  import { ICONS } from '$lib/icons.js';
  let { name, size = 18, stroke = 2, label = null } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width={stroke}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden={label ? undefined : 'true'}
  aria-label={label}
  role={label ? 'img' : undefined}
  style="flex:none"
>
  {@html ICONS[name] || ''}
</svg>
