<script lang="ts">
  // The line items are the table of the document, edited where they stand. Nothing here calculates:
  // every amount is the domain's answer, and a single line's net is never presented as part of an invoice total.
  import { UNIT_CODES } from '../../../lib/domain/xrechnung/document.ts';
  import { formatLocalizedDecimal } from '../../../lib/domain/xrechnung/number-notation.ts';
  import type { InvoiceTotals } from '../../../lib/domain/xrechnung/invoice.ts';
  import { copy, fill, unitLabels, vatBucketLabel } from '../../../i18n/xrechnung.ts';
  import type { Locale } from '../../../i18n/ui.ts';
  import Glyph from './Glyph.svelte';
  import { vatBucketKey } from './form-adapter.ts';
  import { emptyLine, type LineForm, type VatRegime } from './form-state.ts';

  type Props = {
    lines: LineForm[];
    locale: Locale;
    totals: InvoiceTotals | undefined;
    /** True when the totals come from a successful full build, false for the lines-only preview. */
    calculated: boolean;
    /** The domain's own net for one line on its own, shown only while invoice totals are unavailable. Never a total. */
    netFor: (index: number) => string | undefined;
    /** Why there are no totals yet (names the lines that block them). */
    totalsNote: string;
    errorFor: (id: string) => string | undefined;
    isMissing: (id: string) => boolean;
    touch: (id: string) => void;
    /** Lines were inserted or removed at `index`: the caller forgets what it knew about the rows from there on. */
    onshift: (index: number) => void;
    onmore: (id: 'unitCode' | 'quantityPrice' | 'vatRate', trigger: HTMLElement) => void;
    groupError: string | undefined;
    regime: VatRegime;
  };
  let { lines = $bindable(), locale, totals, calculated, netFor, totalsNote, errorFor, isMissing, touch, onshift, onmore, groupError, regime }: Props = $props();

  const unitOptions = UNIT_CODES.map((code) => ({ value: code, label: `${unitLabels[code]?.[locale] ?? code} (${code})` }));
  const vatOptions = [
    { value: '19', label: copy.vat19[locale] },
    { value: '7', label: copy.vat7[locale] },
    { value: 'reverse-charge', label: copy['vat.reverseCharge'][locale] },
  ];
  const COLS = [['name', 'f.lines.name'], ['quantity', 'f.lines.quantity'], ['unitCode', 'f.lines.unitCode'], ['unitPrice', 'f.lines.unitPrice'], ['vat.rate', 'f.lines.vat.rate']] as const;
  const L = (key: (typeof COLS)[number][1] | 'f.lines.net') => copy[key][locale];
  const money = (value: { units: bigint; scale: number }) => `${formatLocalizedDecimal(value, 'de')} EUR`;
  let removed = $state<{ index: number; line: LineForm } | undefined>();

  const focusName = (index: number) => queueMicrotask(() => document.getElementById(`lines[${index}].name`)?.focus());
  function add() {
    removed = undefined;
    lines.push(emptyLine(lines[lines.length - 1]));
    focusName(lines.length - 1);
  }
  function remove(index: number) {
    const [line] = lines.splice(index, 1);
    if (line) removed = { index, line };
    onshift(index);
    queueMicrotask(() => document.getElementById('lines-undo')?.focus());
  }
  function undo() {
    if (!removed) return;
    lines.splice(removed.index, 0, removed.line);
    onshift(removed.index);
    focusName(removed.index);
    removed = undefined;
  }
  const net = (index: number) => (totals?.lines[index] ? formatLocalizedDecimal(totals.lines[index].netAmount, 'de') : netFor(index));
  // While there is no invoice total, a line's net is that line's own figure and is labelled as such.
  const solo = $derived(!totals && lines.some((_, i) => netFor(i) !== undefined));
  const id = (i: number, field: string) => `lines[${i}].${field}`;
  const open = (i: number) => COLS.filter(([field]) => errorFor(id(i, field)) !== undefined && isMissing(id(i, field))).map(([, key]) => L(key));
  const wrong = (i: number) => COLS.filter(([field]) => errorFor(id(i, field)) !== undefined && !isMissing(id(i, field))).map(([field]) => ({ field, text: errorFor(id(i, field)) ?? '' }));
  const mark = (i: number, field: string) => (errorFor(id(i, field)) === undefined ? '' : isMissing(id(i, field)) ? 'miss' : 'bad');
  const described = (i: number, field: string, numeric = false) =>
    [numeric ? 'lines-number-hint' : '', mark(i, field) === 'miss' ? `lines[${i}]-open` : '', mark(i, field) === 'bad' ? `${id(i, field)}-error` : ''].filter(Boolean).join(' ') || undefined;
  const help = [
    { id: 'quantityPrice', label: `${L('f.lines.quantity')} / ${L('f.lines.unitPrice')}` },
    { id: 'unitCode', label: L('f.lines.unitCode') },
    { id: 'vatRate', label: L('f.lines.vat.rate') },
  ] as const;
</script>

<div class="lines">
  {#if groupError}<p class="group-error" role="alert"><Glyph kind="error" /> {groupError}</p>{/if}
  <div class="strip">
    <p class="number-hint" id="lines-number-hint">{copy['lines.numberHint'][locale]}</p>
    <p class="col-help">
      <span>{copy['sheet.colHelp'][locale]}:</span>
      {#each help as entry (entry.id)}
        <button type="button" class="help-link" aria-label={fill(copy.helpFor[locale], { field: entry.label })} onclick={(e) => onmore(entry.id, e.currentTarget)}>{entry.label}</button>
      {/each}
    </p>
  </div>
  <div class="head" aria-hidden="true">
    <span>{copy['sheet.pos'][locale]}</span><span class="h-name">{L('f.lines.name')}</span>
    <span class="h2 r">{L('f.lines.quantity')}</span><span class="h3">{L('f.lines.unitCode')}</span><span class="h4 r">{L('f.lines.unitPrice')}</span><span class="h5">{L('f.lines.vat.rate')}</span><span class="h6 r">{L('f.lines.net')}</span>
  </div>
  {#each lines as line, i (i)}
    {@const missing = open(i)}
    {@const invalid = wrong(i)}
    {@const value = net(i)}
    <fieldset class="row" class:has-errors={invalid.length > 0} class:has-open={missing.length > 0}>
      <legend>{fill(copy.lineLegend[locale], { n: i + 1 })}</legend>
      <span class="num" aria-hidden="true">{i + 1}</span>
      <div class={`c c-name ${mark(i, 'name')}`} class:empty={line.name === ''}>
        <label for={id(i, 'name')}>{L('f.lines.name')}</label>
        <!-- A text area so that a long description wraps and stays readable on the document; Enter keeps its native meaning here. -->
        <textarea id={id(i, 'name')} rows="1" bind:value={line.name} placeholder={L('f.lines.name')} autocomplete="off" spellcheck="false" aria-required="true" aria-invalid={mark(i, 'name') !== ''} aria-describedby={described(i, 'name')} onblur={() => touch(id(i, 'name'))}></textarea>
      </div>
      <div class={`c c-qty ${mark(i, 'quantity')}`} class:empty={line.quantity === ''}>
        <label for={id(i, 'quantity')}>{L('f.lines.quantity')}</label>
        <input id={id(i, 'quantity')} class="n" type="text" inputmode="decimal" bind:value={line.quantity} autocomplete="off" spellcheck="false" aria-required="true" aria-invalid={mark(i, 'quantity') !== ''} aria-describedby={described(i, 'quantity', true)} onblur={() => touch(id(i, 'quantity'))} />
      </div>
      <div class={`c c-unit ${mark(i, 'unitCode')}`} class:empty={line.unitCode === ''}>
        <label for={id(i, 'unitCode')}>{L('f.lines.unitCode')}</label>
        <select id={id(i, 'unitCode')} bind:value={line.unitCode} aria-required="true" aria-invalid={mark(i, 'unitCode') !== ''} aria-describedby={described(i, 'unitCode')} onblur={() => touch(id(i, 'unitCode'))}>
          <option value="">{copy.choose[locale]}</option>
          {#each unitOptions as option (option.value)}<option value={option.value}>{option.label}</option>{/each}
        </select>
      </div>
      <div class={`c c-price ${mark(i, 'unitPrice')}`} class:empty={line.unitPrice === ''}>
        <label for={id(i, 'unitPrice')}>{L('f.lines.unitPrice')}</label>
        <input id={id(i, 'unitPrice')} class="n" type="text" inputmode="decimal" bind:value={line.unitPrice} autocomplete="off" spellcheck="false" aria-required="true" aria-invalid={mark(i, 'unitPrice') !== ''} aria-describedby={described(i, 'unitPrice', true)} onblur={() => touch(id(i, 'unitPrice'))} />
      </div>
      <div class={`c c-vat ${regime === 'kleinunternehmer' ? '' : mark(i, 'vat.rate')}`} class:empty={regime !== 'kleinunternehmer' && line.vatRate === ''}>
        {#if regime === 'kleinunternehmer'}
          <span class="lbl">{L('f.lines.vat.rate')}</span><span class="fixed-vat">{copy['vat.fixedKu'][locale]}</span>
        {:else}
          <label for={id(i, 'vat.rate')}>{L('f.lines.vat.rate')}</label>
          <select id={id(i, 'vat.rate')} bind:value={line.vatRate} aria-required="true" aria-invalid={mark(i, 'vat.rate') !== ''} aria-describedby={described(i, 'vat.rate')} onblur={() => touch(id(i, 'vat.rate'))}>
            <option value="">{copy.choose[locale]}</option>
            {#each vatOptions as option (option.value)}<option value={option.value}>{option.label}</option>{/each}
          </select>
          <!-- The closed select can truncate the Reverse Charge label, so the full label is repeated visibly (hidden from the accessibility tree, where the select names it). -->
          {#if line.vatRate === 'reverse-charge'}<span class="vat-full" aria-hidden="true">{copy['vat.reverseCharge'][locale]}</span>{/if}
        {/if}
      </div>
      <div class="c c-net">
        <span class="lbl">{L('f.lines.net')}</span>
        <output class="net" class:solo={!totals && value !== undefined} for={`${id(i, 'quantity')} ${id(i, 'unitPrice')}`}>{value ?? '—'}{#if !totals && value !== undefined}<span class="solo-tag">{copy['sheet.soloNet'][locale]}</span>{/if}</output>
      </div>
      <div class="c-remove">
        {#if lines.length > 1}<button type="button" class="remove" aria-label={fill(copy.removeLine[locale], { n: i + 1 })} onclick={() => remove(i)}>×</button>{/if}
      </div>
      {#if missing.length > 0 || invalid.length > 0}
        <div class="row-notes">
          {#each invalid as entry (entry.field)}<p class="row-err" id={`${id(i, entry.field)}-error`}><Glyph kind="error" /> <span>{entry.text}</span></p>{/each}
          {#if missing.length > 0}<p class="row-open" id={`lines[${i}]-open`}><Glyph kind="incomplete" /> <span>{fill(copy['sheet.lineOpen'][locale], { list: missing.join(', ') })}</span></p>{/if}
        </div>
      {/if}
    </fieldset>
  {/each}
  <div class="foot">
    <div class="foot-actions">
      <button type="button" class="add" onclick={add}>+ {copy.addLine[locale]}</button>
      {#if removed}<button type="button" class="undo" id="lines-undo" onclick={undo}>{fill(copy['sheet.lineUndo'][locale], { n: removed.index + 1 })}</button>{/if}
    </div>
    <div class="totals" class:none={!totals}>
      <p class="totals-title">{copy['sheet.totalsTitle'][locale]} <span class="tag">{totals ? (calculated ? copy['rail.calculated'][locale] : copy['rail.preview'][locale]) : copy['sheet.totalsNone'][locale]}</span></p>
      {#if totals}
        <dl>
          <div><dt>{copy['rail.net'][locale]}</dt><dd>{money(totals.totalWithoutVat)}</dd></div>
          {#each totals.vatBreakdown as bucket (vatBucketKey(bucket))}
            <div class="sub"><dt>{vatBucketLabel(bucket, money(bucket.taxableAmount), locale)}</dt><dd>{money(bucket.taxAmount)}</dd></div>
          {/each}
          <div class="total"><dt>{copy['rail.gross'][locale]}</dt><dd>{money(totals.totalWithVat)}</dd></div>
          <div><dt>{copy['rail.due'][locale]}</dt><dd>{money(totals.amountDue)}</dd></div>
        </dl>
      {:else}
        <p class="muted">{totalsNote}</p>
        {#if solo}<p class="muted">{copy['sheet.soloNote'][locale]}</p>{/if}
      {/if}
    </div>
  </div>
</div>

<style>
  .lines { container: lines / inline-size; display: flex; flex-direction: column; }
  fieldset { margin: 0; padding: 0; border: 0; min-width: 0; }
  legend { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .strip { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.25rem 1.5rem; margin-block-end: 0.5rem; }
  .number-hint, .col-help { margin: 0; color: var(--muted); font-size: 0.8125rem; }
  .col-help { display: flex; flex-wrap: wrap; gap: 0.25rem 0.75rem; align-items: center; }
  .help-link { padding: 0.25rem 0; min-block-size: 1.5rem; border: 0; background: none; color: var(--ink); font: 500 0.8125rem var(--sans); text-decoration: underline; text-decoration-color: var(--accent); text-underline-offset: 0.2em; cursor: pointer; }
  .head { display: none; }
  .row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.375rem 0.75rem; padding-block: 0.625rem; border-top: 1px solid var(--rule); position: relative; }
  .row.has-open { box-shadow: inset 3px 0 0 var(--highlight); padding-inline-start: 0.625rem; }
  .row.has-errors { box-shadow: inset 3px 0 0 var(--danger); padding-inline-start: 0.625rem; }
  .num { display: none; }
  .c { display: flex; flex-direction: column; gap: 0.125rem; min-width: 0; }
  .c-name { grid-column: 1 / -1; padding-inline-end: 2.5rem; }
  .c-net { grid-column: 1 / -1; flex-direction: row; justify-content: space-between; align-items: baseline; }
  label, .lbl { color: var(--muted); font: 400 0.75rem/1.3 var(--sans); }
  input, select, textarea {
    width: 100%; min-width: 0; min-height: 2rem; padding: 0.2rem 0.4rem; margin: 0; background: var(--paper); color: var(--ink);
    border: 1px solid var(--muted); border-radius: 0; font: 400 0.9375rem/1.4 var(--sans); text-overflow: ellipsis; transition: border-color 0.15s;
  }
  .c-name textarea { display: block; font-weight: 500; resize: none; overflow-wrap: anywhere; field-sizing: content; }
  .vat-full { color: var(--muted); font: 400 0.75rem/1.3 var(--sans); }
  .n { font-family: var(--mono); font-variant-numeric: tabular-nums; }
  .bad :is(input, select, textarea) { border-color: var(--danger); border-width: 2px; }
  /* Marker-pen underline: says "open" together with the note under the line, never by colour alone. */
  .miss :is(input, select, textarea) { border-color: var(--ink); box-shadow: inset 0 -0.5rem 0 var(--highlight); }
  .fixed-vat { padding: 0.3rem 0; font: 400 0.9375rem/1.4 var(--sans); }
  .net { display: inline-flex; flex-direction: column; align-items: flex-end; padding-block: 0.3rem; font: 500 0.9375rem/1.4 var(--mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .net.solo { color: var(--muted); font-weight: 400; }
  .solo-tag { font: 500 0.625rem/1.3 var(--mono); letter-spacing: 0.04em; text-transform: uppercase; }
  .c-remove { position: absolute; inset-block-start: 0.5rem; inset-inline-end: 0; }
  .remove, .add, .undo { font: 500 0.875rem var(--sans); color: var(--ink); background: var(--paper); border: 1px solid var(--ink); cursor: pointer; }
  .remove { inline-size: 2rem; block-size: 2rem; padding: 0; font-size: 1.125rem; line-height: 1; border-color: var(--muted); }
  .add, .undo { padding: 0.35rem 0.75rem; min-height: 2.25rem; }
  .undo { border-style: dashed; }
  .row-notes { grid-column: 1 / -1; display: flex; flex-direction: column; gap: 0.125rem; }
  .row-err, .row-open { display: flex; gap: 0.375rem; align-items: flex-start; margin: 0; font: 500 0.8125rem/1.35 var(--sans); }
  .row-err { color: var(--danger); }
  .group-error { display: flex; gap: 0.375rem; margin: 0 0 0.5rem; color: var(--danger); font: 500 0.8125rem var(--sans); }
  .foot { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-start; gap: 1rem 2rem; padding-block-start: 0.75rem; border-top: 1px solid var(--ink); }
  .foot-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .totals { flex: 1 1 18rem; max-inline-size: 27rem; margin-inline-start: auto; }
  .totals-title { margin: 0 0 0.25rem; font: 500 0.8125rem/1.3 var(--sans); }
  .tag { margin-inline-start: 0.5rem; font: 500 0.75rem/1.3 var(--mono); color: var(--muted); letter-spacing: 0.04em; }
  .totals dl { margin: 0; }
  .totals dl div { display: flex; justify-content: space-between; gap: 1rem; padding-block: 0.2rem; border-bottom: 1px solid var(--rule); }
  .totals dt { font-size: 0.875rem; }
  .totals dd { margin: 0; font: 400 0.9375rem/1.4 var(--mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .totals .sub dt { color: var(--muted); font-size: 0.8125rem; }
  .totals .total { border-block: 2px solid var(--ink); border-top-width: 1px; }
  .totals .total dt { font: 600 1rem/1.5 var(--serif); }
  .totals .total dd { font: 500 1.25rem/1.4 var(--mono); }
  .totals.none { padding: 0.5rem 0.75rem; border: 1px dashed var(--muted); }
  .muted { margin: 0 0 0.25rem; color: var(--muted); font-size: 0.8125rem; }

  /* Resting block: the table of the document. Only the tools of editing leave; every value stays a field. */
  :global(.blk:not(.on)) .strip,
  :global(.blk:not(.on)) .c-remove,
  :global(.blk:not(.on)) .add { display: none; }
  :global(.blk:not(.on)) :is(input, select, textarea) { border-color: transparent; background: transparent; }
  :global(.blk:not(.on)) select { appearance: none; cursor: pointer; }
  :global(.blk:not(.on)) .empty :is(input, select, textarea) { border-bottom: 1px dotted var(--muted); color: var(--muted); }
  :global(.blk:not(.on)) .c:hover :is(input, select, textarea) { border-bottom: 1px solid var(--accent); }
  :global(.blk:not(.on)) .miss :is(input, select, textarea) { border-bottom: 1px solid var(--ink); }
  :global(.blk:not(.on)) .bad :is(input, select, textarea) { border-color: transparent; border-bottom: 2px solid var(--danger); }
  :global(.blk:not(.on)) .c-name { padding-inline-end: 0; }
  input::placeholder, textarea::placeholder { color: var(--muted); opacity: 1; }

  @container lines (min-width: 46rem) {
    .head, .row { display: grid; grid-template-columns: 1.75rem 5.5rem 9rem 10rem minmax(13.5rem, 1fr) 8rem 2rem; column-gap: 0.5rem; }
    .head { padding-block-end: 0.25rem; border-bottom: 1px solid var(--ink); color: var(--muted); font: 500 0.75rem/1.3 var(--mono); letter-spacing: 0.04em; }
    .head span { grid-row: 2; padding-inline: 0.4rem; white-space: nowrap; }
    .head .h2 { grid-column: 2; } .head .h3 { grid-column: 3; } .head .h4 { grid-column: 4; } .head .h5 { grid-column: 5; } .head .h6 { grid-column: 6; padding-inline-end: 0; }
    .head span:first-child { grid-row: 1; grid-column: 1; padding-inline: 0; }
    .head .h-name { grid-row: 1; grid-column: 2 / 7; color: var(--ink); }
    .head .r { text-align: right; }
    .row { row-gap: 0; padding-block: 0.375rem; border-top: 0; border-bottom: 1px solid var(--rule); }
    .row.has-open, .row.has-errors { padding-inline-start: 0; }
    .row label, .row .lbl { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    .num { display: block; grid-column: 1; grid-row: 1; padding: 0.4rem 0 0 0.375rem; font: 400 0.8125rem var(--mono); color: var(--muted); }
    .c-name { grid-column: 2 / 7; grid-row: 1; padding-inline-end: 0; }
    .c-remove { position: static; grid-column: 7; grid-row: 1; }
    .c-qty { grid-column: 2; } .c-unit { grid-column: 3; } .c-price { grid-column: 4; } .c-vat { grid-column: 5; }
    .c-net { grid-column: 6; justify-content: flex-end; }
    .c-qty, .c-unit, .c-price, .c-vat, .c-net { grid-row: 2; }
    .n { text-align: right; }
    .totals { margin-inline-end: 2.5rem; }
    .row-notes { grid-column: 2 / -1; grid-row: 3; padding: 0.125rem 0.4rem 0.25rem; }
  }
  @media (pointer: coarse) { input, select, textarea { min-height: 2.75rem; } .remove { inline-size: 2.75rem; block-size: 2.75rem; } .add, .undo { min-height: 2.75rem; } .help-link { min-block-size: 2.75rem; } }
  @media (max-width: 47.99rem) { input, select, textarea { font-size: 1rem; } }
  @media (prefers-reduced-motion: reduce) { input, select, textarea { transition: none; } }
</style>
