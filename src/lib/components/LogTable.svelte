<script>
  import { ddmm, dayLabel, money } from '$lib/fmt.js';
  import { toast } from '$lib/toast.svelte.js';
  import { invalidateAll } from '$app/navigation';

  /**
   * rows: [{ date, values }]
   * fields: editable [{ key, short, tone, money? }]
   * computed: [{ label, fn(values) -> string }] shown before the fields
   * endpoint: '/api/sdr' | '/api/closing'
   * extra: optional snippet(row) rendered in the last column
   */
  let { rows, fields, computed, endpoint, today, extra = null, highlight = null } = $props();

  let saved = $state({});
  let drafts = $state({});
  const timers = {};

  $effect(() => {
    // drop drafts the server has caught up with (keeps anything still being typed)
    const byDate = Object.fromEntries(rows.map((r) => [r.date, r.values]));
    for (const d of Object.keys(drafts)) {
      const srv = byDate[d];
      if (!srv || fields.every((f) => (srv[f.key] || 0) === (drafts[d][f.key] || 0))) delete drafts[d];
    }
  });

  const val = (r, k) => drafts[r.date]?.[k] ?? r.values[k] ?? 0;

  function edit(r, key, v) {
    drafts[r.date] = { ...r.values, ...drafts[r.date], [key]: v === '' ? 0 : Number(v) };
    clearTimeout(timers[r.date]);
    timers[r.date] = setTimeout(() => save(r.date), 500);
  }

  async function save(date) {
    const values = drafts[date];
    if (!values) return;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ date, values })
      });
      if (!res.ok) throw new Error();
      saved[date] = Date.now();
      setTimeout(() => {
        if (Date.now() - saved[date] >= 1400) delete saved[date];
      }, 1500);
      await invalidateAll();
    } catch {
      toast(`Could not save ${ddmm(date)}`, 'error');
    }
  }

  const merged = (r) => ({ ...r.values, ...drafts[r.date] });
  const isEmpty = (r) => fields.every((f) => !val(r, f.key));
</script>

<div class="scroller">
  <table>
    <thead>
      <tr>
        <th class="date">Date</th>
        {#each computed as c}<th class="calc">{c.label}</th>{/each}
        {#each fields as f}<th class="t-{f.tone}"><i></i>{f.short}</th>{/each}
        {#if extra}<th class="x"></th>{/if}
      </tr>
    </thead>
    <tbody>
      {#each rows as r (r.date)}
        <tr
          id="d-{r.date}"
          class:empty={isEmpty(r)}
          class:today={r.date === today}
          class:future={r.date > today}
          class:flash={highlight === r.date}
        >
          <td class="date">
            <span class="dd num">{ddmm(r.date)}</span>
            <span class="wd">{dayLabel(r.date, { weekday: 'short' })}</span>
            {#if saved[r.date]}<span class="tick" aria-label="Saved"></span>{/if}
          </td>
          {#each computed as c}<td class="calc num">{c.fn(merged(r))}</td>{/each}
          {#each fields as f}
            <td class="in">
              <input
                type="number"
                min="0"
                step={f.money ? '0.01' : '1'}
                inputmode={f.money ? 'decimal' : 'numeric'}
                class="num"
                class:money={f.money}
                value={val(r, f.key) || ''}
                placeholder="0"
                aria-label="{f.short} on {ddmm(r.date)}"
                oninput={(e) => edit(r, f.key, e.currentTarget.value)}
                onfocus={(e) => e.currentTarget.select()}
              />
            </td>
          {/each}
          {#if extra}<td class="x">{@render extra(r)}</td>{/if}
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .scroller {
    overflow-x: auto;
    border-radius: 12px;
    border: 1px solid var(--line-2);
    background: var(--raised);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
    font-variation-settings: 'wdth' 92;
  }
  th {
    position: sticky;
    top: 0;
    background: var(--surface);
    text-align: right;
    font-size: 12.5px;
    font-weight: 700;
    color: var(--ink-2);
    padding: 10px 10px;
    border-bottom: 1px solid var(--line);
    white-space: nowrap;
  }
  th i {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 2px;
    background: var(--tone);
    margin-right: 6px;
  }
  th.date {
    text-align: left;
  }
  td {
    padding: 0 10px;
    height: 40px;
    border-bottom: 1px solid var(--line-2);
    text-align: right;
    white-space: nowrap;
  }
  tr:last-child td {
    border-bottom: 0;
  }
  td.date {
    text-align: left;
    position: relative;
    min-width: 96px;
  }
  .dd {
    font-weight: 700;
  }
  .wd {
    color: var(--ink-3);
    font-size: 12px;
    margin-left: 6px;
  }
  td.calc {
    font-weight: 700;
    color: var(--ink);
    background: color-mix(in srgb, var(--iron-soft) 45%, transparent);
  }
  td.in {
    padding: 0 4px;
  }
  input {
    width: 64px;
    height: 32px;
    text-align: right;
    padding: 0 8px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: transparent;
    font-size: 14px;
    font-weight: 600;
    -moz-appearance: textfield;
  }
  input.money {
    width: 92px;
  }
  input::-webkit-outer-spin-button,
  input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  input::placeholder {
    color: var(--line);
  }
  input:hover {
    border-color: var(--line);
  }
  input:focus {
    outline: none;
    border-color: var(--focus);
    background: var(--surface);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--focus) 20%, transparent);
  }
  tr.empty td.calc {
    color: var(--ink-3);
    font-weight: 400;
  }
  tr.future {
    opacity: 0.55;
  }
  tr.today td {
    background: color-mix(in srgb, var(--blue-soft) 70%, transparent);
  }
  tr.today .dd {
    color: var(--blue);
  }
  tr.flash td {
    animation: flash 1.4s var(--ease-out);
  }
  @keyframes flash {
    0%, 30% { background: color-mix(in srgb, var(--yellow) 35%, transparent); }
  }
  .tick {
    position: absolute;
    right: 4px;
    top: 50%;
    width: 8px;
    height: 8px;
    margin-top: -4px;
    border-radius: 50%;
    background: var(--green);
    animation: pop 0.4s var(--ease-spring);
  }
  @keyframes pop {
    from { transform: scale(0); }
  }
  td.x {
    text-align: left;
  }
</style>
