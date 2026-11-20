<script>
  import Icon from './Icon.svelte';
  import { isDue, leadName, pickExtra, linkFor, stageOf, whenLabel, sinceLabel, entryType } from '$lib/leads.js';
  import { ddmm } from '$lib/fmt.js';

  /** The top of a lead: score, name, status, call button, pitch angle and research, past calls. */
  let { lead, today, tz, title = 'h3', chips = true } = $props();

  const PITCH = /pitch|angle/i;
  const WHY = /why/i;
  const shownExtra = $derived(lead.extra.filter(([k, v]) => !PITCH.test(k) && !WHY.test(k) && !linkFor(v)));
  const tel = (p) => p.replace(/[^\d+]/g, '');
</script>

<div class="summary">
  <div class="who">
    <div class="plate" class:none={lead.score == null} title="Prospect score">
      <span class="score">{lead.score ?? '–'}</span>
      <small>score</small>
    </div>
    <div class="names">
      <svelte:element this={title} class="name">{leadName(lead)}</svelte:element>
      <p class="muted">
        {[lead.business && lead.contact, lead.suburb, lead.category].filter(Boolean).join(', ')}
      </p>
      <div class="tags">
        {#if isDue(lead, today)}
          <span class="chip t-yellow"><Icon name="clock" size={13} />{lead.stage === 'callback' ? 'Callback' : 'Follow-up'} {lead.followUp === today ? 'due today' : `due ${ddmm(lead.followUp)}`}</span>
        {:else}
          <span class="chip t-{stageOf(lead).tone}"><span class="dot"></span>{stageOf(lead).label}</span>
        {/if}
        {#if lead.lastContactAt}
          <span class="faint small">Last contacted {sinceLabel(lead.lastContactAt, today, tz)}, {whenLabel(lead.lastContactAt, tz)}</span>
        {:else if lead.attempts}
          <span class="faint small">{lead.dials.length} {lead.dials.length === 1 ? 'call' : 'calls'} on your sheet, no dates</span>
        {/if}
      </div>
    </div>
  </div>

  <div class="contact">
    {#if lead.phone}<a class="btn primary call" href="tel:{tel(lead.phone)}"><Icon name="phone" size={17} /><span class="num">{lead.phone}</span></a>{/if}
    {#if lead.email}<a class="btn small" href="mailto:{lead.email}"><Icon name="mail" size={15} />Email</a>{/if}
    {#each lead.extra.filter(([, v]) => linkFor(v)) as [k, v]}
      <a class="btn small" href={linkFor(v)} target="_blank" rel="noopener"><Icon name="external" size={14} />{k}</a>
    {/each}
  </div>

  {#if pickExtra(lead, PITCH)}
    <div class="pitch">
      <span class="k">Pitch angle</span>
      <p>{pickExtra(lead, PITCH)}</p>
      {#if pickExtra(lead, WHY)}<p class="why muted">{pickExtra(lead, WHY)}</p>{/if}
    </div>
  {:else if pickExtra(lead, WHY)}
    <div class="pitch"><span class="k">Why this score</span><p>{pickExtra(lead, WHY)}</p></div>
  {/if}

  {#if shownExtra.length}
    <dl class="facts">
      {#each shownExtra as [k, v]}
        <div><dt>{k}</dt><dd>{v}</dd></div>
      {/each}
    </dl>
  {/if}

  {#if lead.notes}<p class="notes"><Icon name="edit" size={14} />{lead.notes}</p>{/if}

  {#if chips && lead.dials.length}
    <ol class="hist" aria-label="Past dials">
      {#each lead.dials as d}
        <li class="t-{entryType(d.outcome)?.tone || 'none'}">
          <i></i>{d.date ? `${whenLabel(d.at, tz, false)}: ${entryType(d.outcome)?.label || 'Note'}` : d.label}{d.note ? `, "${d.note}"` : ''}
        </li>
      {/each}
    </ol>
  {/if}
</div>

<style>
  .summary {
    display: grid;
    gap: 14px;
  }
  .who {
    display: flex;
    gap: 16px;
    align-items: center;
  }
  .plate {
    flex: none;
    width: 68px;
    height: 68px;
    border-radius: 50%;
    display: grid;
    place-content: center;
    text-align: center;
    background: var(--blue);
    color: #fff;
    box-shadow: inset 0 0 0 5px color-mix(in srgb, #000 14%, transparent), inset 0 0 0 7px color-mix(in srgb, #fff 18%, transparent);
  }
  .plate.none {
    background: var(--iron);
  }
  .plate .score {
    font-size: 24px;
    line-height: 1;
  }
  .plate small {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    opacity: 0.85;
  }
  .names {
    min-width: 0;
  }
  .summary :global(.name) {
    margin: 0;
    font-size: 24px;
    font-variation-settings: 'wdth' 110;
    letter-spacing: -0.01em;
  }
  .names p {
    margin: 2px 0 6px;
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 10px;
    align-items: center;
  }
  .contact {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .call {
    height: 46px;
    padding: 0 18px;
    font-size: 17px;
  }
  .pitch {
    padding: 14px 16px;
    border-radius: 12px;
    background: var(--blue-soft);
    border-left: 4px solid var(--blue);
  }
  .k {
    font-size: 11.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-3);
  }
  .pitch p {
    margin: 4px 0 0;
    font-size: 16px;
    font-weight: 600;
  }
  .pitch p.why {
    font-size: 14px;
    font-weight: 400;
  }
  .facts {
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 10px 18px;
  }
  .facts dt {
    font-size: 12px;
    color: var(--ink-3);
  }
  .facts dd {
    margin: 2px 0 0;
    font-weight: 600;
    font-size: 14px;
  }
  .notes {
    margin: 0;
    display: flex;
    gap: 8px;
    align-items: baseline;
    color: var(--ink-2);
    white-space: pre-wrap;
  }
  .hist {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .hist li {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
    border-radius: 999px;
    background: var(--iron-soft);
    font-size: 12.5px;
  }
  .hist i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--tone, var(--line));
  }
  .small {
    font-size: 13px;
  }
</style>
