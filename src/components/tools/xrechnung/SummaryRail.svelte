<script lang="ts">
  import { formatLocalizedDecimal } from '../../../lib/domain/xrechnung/number-notation.ts';
  import type { InvoiceTotals } from '../../../lib/domain/xrechnung/invoice.ts';
  import { copy, describeError, fill, openCountText } from '../../../i18n/xrechnung.ts';
  import type { Locale } from '../../../i18n/ui.ts';
  import Glyph from './Glyph.svelte';
  import { SECTION_IDS, type DiagnosticItem, type ErrorKind, type ExportFormat, type SectionId } from './form-adapter.ts';

  export type RailStatus = 'pristine' | 'incomplete' | 'invalid' | 'local';
  type Props = {
    locale: Locale;
    status: RailStatus;
    /** Totals and whether they come from a successful build ("Calculated") or the lines-only preview. */
    totals: InvoiceTotals | undefined;
    calculated: boolean;
    items: readonly DiagnosticItem[];
    truncated: boolean;
    counts: { missing: number; invalid: number; internal: number };
    generated: { format: ExportFormat; time: string } | undefined;
    changedSinceExport: boolean;
    exportReady: boolean;
    announcement: string;
    exportFailure: string | undefined;
    onexport: (format: ExportFormat) => void;
    ongoto: (fieldId: string) => void;
    headingEl: HTMLElement | undefined;
  };
  let { locale, status, totals, calculated, items, truncated, counts, generated, changedSinceExport, exportReady, announcement, exportFailure, onexport, ongoto, headingEl = $bindable() }: Props = $props();

  const money = (value: { units: bigint; scale: number }) => `${formatLocalizedDecimal(value, locale)} EUR`;
  const statusLine = $derived(
    status === 'pristine' ? copy['status.pristine'][locale]
    : status === 'local' ? copy['status.local'][locale]
    : openCountText(counts.missing, counts.invalid + counts.internal, locale),
  );
  const statusGlyph = $derived(status === 'local' ? 'ok' : status === 'invalid' ? 'error' : status === 'incomplete' ? 'incomplete' : 'pending');
  const bySection = $derived(
    ([...SECTION_IDS, 'general'] as (SectionId | 'general')[])
      .map((id) => ({ id, entries: items.filter((item) => item.section === id) }))
      .filter((group) => group.entries.length > 0),
  );
  const kindGlyph = (kind: ErrorKind) => (kind === 'missing' ? 'incomplete' : 'error');
  const text = (item: DiagnosticItem) => (item.kind === 'internal' ? fill(copy['diag.internal'][locale], { code: item.code }) : describeError(item.code, item.path, locale));
</script>

<div class="rail-body">
  <section aria-labelledby="rail-amounts">
    <h2 id="rail-amounts">{copy['rail.amounts'][locale]} <span class="tag">{calculated ? copy['rail.calculated'][locale] : copy['rail.preview'][locale]}</span></h2>
    {#if totals}
      <dl class="amounts">
        {#each totals.vatBreakdown as bucket (bucket.rate)}
          <div class="row sub"><dt>{fill(copy['rail.vatLine'][locale], { rate: bucket.rate, base: money(bucket.taxableAmount) })}</dt><dd>{money(bucket.taxAmount)}</dd></div>
        {/each}
        <div class="row"><dt>{copy['rail.net'][locale]}</dt><dd>{money(totals.totalWithoutVat)}</dd></div>
        <div class="row"><dt>{copy['rail.vat'][locale]}</dt><dd>{money(totals.totalVat)}</dd></div>
        <div class="row total"><dt>{copy['rail.gross'][locale]}</dt><dd>{money(totals.totalWithVat)}</dd></div>
        <div class="row"><dt>{copy['rail.due'][locale]}</dt><dd>{money(totals.amountDue)}</dd></div>
      </dl>
    {:else}
      <p class="muted">{copy['rail.noAmounts'][locale]}</p>
    {/if}
  </section>

  <section aria-labelledby="rail-status">
    <h2 id="rail-status" tabindex="-1" bind:this={headingEl}>{copy['rail.status'][locale]}</h2>
    <p class="status" class:local={status === 'local'} class:invalid={status === 'invalid'} class:incomplete={status === 'incomplete'}><Glyph kind={statusGlyph} /> <strong>{statusLine}</strong></p>
    <button type="submit" class="check">{copy.check[locale]}</button>
    {#if generated && !changedSinceExport}<p class="line"><Glyph kind="ok" /> {fill(copy['status.generated'][locale], { format: generated.format.toUpperCase(), time: generated.time })}</p>{/if}
    {#if generated && changedSinceExport}<p class="line"><Glyph kind="info" /> {copy['status.changed'][locale]}</p>{/if}

    <ol class="ladder">
      <li><span>{copy['ladder.input'][locale]}</span> <strong>{status === 'local' || (status !== 'pristine' && counts.missing === 0) ? copy['state.yes'][locale] : copy['state.no'][locale]}</strong></li>
      <li><span>{copy['ladder.local'][locale]}</span> <strong>{status === 'local' ? copy['state.yes'][locale] : status === 'pristine' ? copy['state.notChecked'][locale] : copy['state.no'][locale]}</strong></li>
      <li><span>{copy['ladder.xml'][locale]}</span> <strong>{generated && !changedSinceExport ? copy['state.yes'][locale] : copy['state.no'][locale]}</strong></li>
      <li><span>{copy['ladder.external'][locale]}</span> <strong>{copy['ladder.external.state'][locale]}</strong></li>
    </ol>
    <p class="notice"><Glyph kind="info" /> {copy['notice.external'][locale]}</p>

    <h3 class="sr-only">{copy['diag.heading'][locale]}</h3>
    {#if items.length === 0}
      <p class="muted">{copy['diag.none'][locale]}</p>
    {:else}
      <div class="diags">
        {#each bySection as group (group.id)}
          <h3>{copy[`sec.${group.id}`][locale]}</h3>
          <ul>
            {#each group.entries as item, index (`${item.path}-${item.code}-${index}`)}
              <li class={item.kind}>
                <Glyph kind={kindGlyph(item.kind)} />
                <span class="msg">{text(item)}</span>
                {#if item.fieldId}<button type="button" class="goto" onclick={() => ongoto(item.fieldId ?? '')}>{copy.jump[locale]}</button>{/if}
              </li>
            {/each}
          </ul>
        {/each}
        {#if truncated}<p class="muted">{copy['diag.truncated'][locale]}</p>{/if}
      </div>
    {/if}
  </section>

  <section aria-labelledby="rail-export">
    <h2 id="rail-export">{copy['export.heading'][locale]}</h2>
    <div class="buttons">
      <button type="button" class="primary" aria-disabled={!exportReady} onclick={() => onexport('ubl')}>{copy['export.ubl'][locale]}</button>
      <button type="button" class="primary" aria-disabled={!exportReady} onclick={() => onexport('cii')}>{copy['export.cii'][locale]}</button>
    </div>
    <p class="muted">{exportReady ? copy['export.hint'][locale] : copy['export.blocked'][locale]}</p>
    {#if exportFailure}<p class="export-failure"><Glyph kind="error" /> {fill(copy['diag.internal'][locale], { code: exportFailure })}</p>{/if}
  </section>

  <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>
</div>

<style>
  .rail-body { display: flex; flex-direction: column; gap: 1.25rem; }
  section { border-top: 1px solid var(--ink); padding-block-start: 0.5rem; }
  h2 { margin: 0 0 0.5rem; font: 600 1.0625rem/1.3 var(--serif); }
  h2:focus { outline-offset: 0.2rem; }
  h3 { margin: 0.75rem 0 0.25rem; font: 500 0.75rem/1.3 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
  .tag { margin-inline-start: 0.5rem; font: 500 0.75rem/1.3 var(--mono); color: var(--muted); letter-spacing: 0.04em; }
  .amounts { margin: 0; }
  .row { display: flex; justify-content: space-between; gap: 1rem; padding-block: 0.2rem; border-bottom: 1px solid var(--rule); }
  .row dt { font-size: 0.875rem; }
  .row dd { margin: 0; font: 400 0.9375rem/1.4 var(--mono); font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
  .row.sub dt { color: var(--muted); font-size: 0.8125rem; }
  .row.total dd { font: 500 1.25rem/1.3 var(--mono); }
  .row.total dt { font-weight: 500; }
  .muted { margin: 0; color: var(--muted); font-size: 0.8125rem; }
  .status { display: flex; gap: 0.5rem; align-items: flex-start; margin: 0 0 0.5rem; padding: 0.25rem 0.5rem; border-inline-start: 3px solid var(--ink); }
  .status.incomplete { background: var(--highlight); }
  .status.invalid { border-inline-start-color: var(--danger); }
  .status.local { border-inline-start-color: var(--accent); }
  .line { display: flex; gap: 0.5rem; margin: 0 0 0.5rem; font-size: 0.875rem; }
  .ladder { margin: 0 0 0.5rem; padding: 0; list-style: none; font-size: 0.8125rem; }
  .ladder li { display: flex; justify-content: space-between; gap: 0.75rem; padding-block: 0.15rem; border-bottom: 1px solid var(--rule); }
  .ladder strong { font-weight: 500; text-align: right; }
  .notice { display: flex; gap: 0.5rem; margin: 0.5rem 0; font-size: 0.8125rem; }
  .diags ul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 0.35rem; }
  .diags li { display: grid; grid-template-columns: auto 1fr auto; gap: 0.5rem; align-items: start; font-size: 0.8125rem; line-height: 1.35; }
  .diags li.invalid .msg, .diags li.internal .msg { color: var(--danger); font-weight: 500; }
  .goto { padding: 0.1rem 0.4rem; border: 1px solid var(--ink); background: var(--paper); color: var(--ink); font: 500 0.75rem var(--sans); cursor: pointer; white-space: nowrap; }
  .check { margin: 0 0 0.5rem; padding: 0.3rem 0.75rem; min-height: 2.25rem; border: 1px solid var(--ink); background: var(--paper); color: var(--ink); font: 500 0.875rem var(--sans); cursor: pointer; }
  .export-failure { display: flex; gap: 0.5rem; margin: 0.5rem 0 0; color: var(--danger); font: 500 0.8125rem var(--sans); }
  .buttons { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 0.5rem; }
  .primary { min-height: 2.5rem; padding: 0.4rem 0.75rem; border: 1px solid var(--ink); background: var(--ink); color: var(--paper); font: 500 0.875rem var(--sans); cursor: pointer; text-align: left; }
  .primary[aria-disabled='true'] { background: var(--paper); color: var(--muted); border-style: dashed; border-color: var(--muted); }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
</style>
