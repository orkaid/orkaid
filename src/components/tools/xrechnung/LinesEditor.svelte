<script lang="ts">
  import { UNIT_CODES } from '../../../lib/domain/xrechnung/document.ts';
  import { formatLocalizedDecimal } from '../../../lib/domain/xrechnung/number-notation.ts';
  import type { InvoiceTotals } from '../../../lib/domain/xrechnung/invoice.ts';
  import { copy, fill, unitLabels } from '../../../i18n/xrechnung.ts';
  import type { Locale } from '../../../i18n/ui.ts';
  import Field from './Field.svelte';
  import { emptyLine, type LineForm, type VatRegime } from './form-state.ts';

  type Props = {
    lines: LineForm[];
    locale: Locale;
    totals: InvoiceTotals | undefined;
    errorFor: (id: string) => string | undefined;
    touch: (id: string) => void;
    onmore: (id: 'unitCode' | 'quantityPrice' | 'vatRate', trigger: HTMLElement) => void;
    groupError: string | undefined;
    /** While `kleinunternehmer` every line is E/0 and shows fixed text instead of a choice; the lines' own choices stay untouched. */
    regime: VatRegime;
  };
  let { lines = $bindable(), locale, totals, errorFor, touch, onmore, groupError, regime }: Props = $props();

  const unitOptions = UNIT_CODES.map((code) => ({ value: code, label: `${unitLabels[code]?.[locale] ?? code} (${code})` }));
  const vatOptions = [
    { value: '19', label: copy.vat19[locale] },
    { value: '7', label: copy.vat7[locale] },
    { value: 'reverse-charge', label: copy['vat.reverseCharge'][locale] },
  ];

  function add() {
    lines.push(emptyLine(lines[lines.length - 1]));
    queueMicrotask(() => document.getElementById(`lines[${lines.length - 1}].name`)?.focus());
  }
  function remove(index: number) {
    lines.splice(index, 1);
    queueMicrotask(() => document.getElementById(`lines[${Math.min(index, lines.length - 1)}].name`)?.focus());
  }
  const net = (index: number) => (totals?.lines[index] ? formatLocalizedDecimal(totals.lines[index].netAmount, 'de') : '—');
</script>

<div class="lines">
  {#if groupError}<p class="group-error" role="alert">{groupError}</p>{/if}
  <p class="number-hint" id="lines-number-hint">{copy['lines.numberHint'][locale]}</p>
  <div class="head">
    <span aria-hidden="true">#</span><span>{copy['f.lines.name'][locale]}</span>
    <span class="h">{copy['f.lines.quantity'][locale]}<button type="button" class="help-head" aria-label={fill(copy.helpFor[locale], { field: copy['f.lines.quantity'][locale] })} onclick={(e) => onmore('quantityPrice', e.currentTarget)}>?</button></span>
    <span class="h">{copy['f.lines.unitCode'][locale]}<button type="button" class="help-head" aria-label={fill(copy.helpFor[locale], { field: copy['f.lines.unitCode'][locale] })} onclick={(e) => onmore('unitCode', e.currentTarget)}>?</button></span>
    <span class="h">{copy['f.lines.unitPrice'][locale]}<button type="button" class="help-head" aria-label={fill(copy.helpFor[locale], { field: copy['f.lines.unitPrice'][locale] })} onclick={(e) => onmore('quantityPrice', e.currentTarget)}>?</button></span>
    <span class="h">{copy['f.lines.vat.rate'][locale]}<button type="button" class="help-head" aria-label={fill(copy.helpFor[locale], { field: copy['f.lines.vat.rate'][locale] })} onclick={(e) => onmore('vatRate', e.currentTarget)}>?</button></span>
    <span class="h">{copy['f.lines.net'][locale]}</span><span></span>
  </div>
  {#each lines as line, i (i)}
    <fieldset class="row">
      <legend>{fill(copy.lineLegend[locale], { n: i + 1 })}</legend>
      <span class="num" aria-hidden="true">{i + 1}</span>
      <div class="c-name"><Field id={`lines[${i}].name`} {locale} label={copy['f.lines.name'][locale]} required bind:value={line.name} error={errorFor(`lines[${i}].name`)} onblur={() => touch(`lines[${i}].name`)} /></div>
      <div class="c-qty"><Field id={`lines[${i}].quantity`} {locale} label={copy['f.lines.quantity'][locale]} required inputmode="decimal" describedById="lines-number-hint" bind:value={line.quantity} helpId="quantityPrice" error={errorFor(`lines[${i}].quantity`)} onblur={() => touch(`lines[${i}].quantity`)} onmore={(el) => onmore('quantityPrice', el)} /></div>
      <div class="c-unit"><Field id={`lines[${i}].unitCode`} {locale} label={copy['f.lines.unitCode'][locale]} required kind="select" options={unitOptions} bind:value={line.unitCode} helpId="unitCode" error={errorFor(`lines[${i}].unitCode`)} onblur={() => touch(`lines[${i}].unitCode`)} onmore={(el) => onmore('unitCode', el)} /></div>
      <div class="c-price"><Field id={`lines[${i}].unitPrice`} {locale} label={copy['f.lines.unitPrice'][locale]} required inputmode="decimal" describedById="lines-number-hint" bind:value={line.unitPrice} helpId="quantityPrice" error={errorFor(`lines[${i}].unitPrice`)} onblur={() => touch(`lines[${i}].unitPrice`)} onmore={(el) => onmore('quantityPrice', el)} /></div>
      <div class="c-vat">
        {#if regime === 'kleinunternehmer'}
          <span class="net-label">{copy['f.lines.vat.rate'][locale]}</span><span class="fixed-vat">{copy['vat.fixedKu'][locale]}</span>
        {:else}
          <Field id={`lines[${i}].vat.rate`} {locale} label={copy['f.lines.vat.rate'][locale]} required kind="select" options={vatOptions} bind:value={line.vatRate} helpId="vatRate" error={errorFor(`lines[${i}].vat.rate`)} onblur={() => touch(`lines[${i}].vat.rate`)} onmore={(el) => onmore('vatRate', el)} />
          <!-- The closed select is too narrow to show this label in full in either layout; the select itself still names it. -->
          {#if line.vatRate === 'reverse-charge'}<span class="vat-full" aria-hidden="true">{copy['vat.reverseCharge'][locale]}</span>{/if}
        {/if}
      </div>
      <div class="c-net"><span class="net-label">{copy['f.lines.net'][locale]}</span><output class="net" for={regime === 'kleinunternehmer' ? `lines[${i}].quantity lines[${i}].unitPrice` : `lines[${i}].quantity lines[${i}].unitPrice lines[${i}].vat.rate`}>{net(i)}</output></div>
      <div class="c-remove">
        {#if lines.length > 1}
          <button type="button" class="remove" aria-label={fill(copy.removeLine[locale], { n: i + 1 })} onclick={() => remove(i)}>×</button>
        {/if}
      </div>
    </fieldset>
  {/each}
  <button type="button" class="add" onclick={add}>+ {copy.addLine[locale]}</button>
</div>

<style>
  .lines { container-type: inline-size; display: flex; flex-direction: column; gap: 0.75rem; }
  fieldset { margin: 0; padding: 0; border: 0; min-width: 0; }
  legend { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .head { display: none; }
  .h { display: inline-flex; align-items: center; gap: 0.25rem; }
  .help-head { inline-size: 1.25rem; block-size: 1.25rem; padding: 0; border: 1px solid var(--ink); border-radius: 50%; background: var(--paper); color: var(--ink); font: 500 0.6875rem/1 var(--mono); cursor: pointer; }
  .row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.5rem 0.75rem; padding-block: 0.75rem; border-top: 1px solid var(--rule); }
  .num { display: none; }
  .c-name { grid-column: 1 / -1; }
  .c-net { display: flex; flex-direction: column; gap: 0.25rem; }
  .net-label { font: 500 0.8125rem/1.3 var(--sans); }
  .c-vat { display: flex; flex-direction: column; gap: 0.25rem; }
  .fixed-vat { font: 400 0.9375rem/1.4 var(--sans); }
  .vat-full { color: var(--muted); font: 400 0.75rem/1.3 var(--sans); }
  .net { font: 500 0.9375rem/1.4 var(--mono); font-variant-numeric: tabular-nums; }
  .c-remove { display: flex; align-items: flex-end; }
  .remove, .add { font: 500 0.875rem var(--sans); color: var(--ink); background: var(--paper); border: 1px solid var(--ink); cursor: pointer; }
  .remove { inline-size: 2.25rem; block-size: 2.25rem; padding: 0; font-size: 1.25rem; line-height: 1; }
  .add { align-self: flex-start; padding: 0.4rem 0.75rem; min-height: 2.25rem; }
  .group-error { margin: 0; color: var(--danger); font: 500 0.8125rem var(--sans); }
  @container (min-width: 51rem) {
    .head, .row { display: grid; grid-template-columns: 1.75rem minmax(8rem, 1fr) 5.5rem 7rem 8rem 8rem 7rem 2.25rem; gap: 0.5rem; align-items: start; }
    .head { padding-block-end: 0.25rem; font: 500 0.75rem/1.3 var(--mono); letter-spacing: 0.04em; color: var(--muted); }
    .head > :nth-child(7) { justify-self: end; }
    .num { display: block; padding-block-start: 0.5rem; font: 400 0.8125rem var(--mono); color: var(--muted); }
    .c-name { grid-column: auto; }
    .c-net { padding-block-start: 0; }
    .net-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
    .fixed-vat { padding-block-start: 0.45rem; }
    .net { display: block; padding-block-start: 0.45rem; text-align: right; }
    .c-remove { align-items: flex-start; }
    .row :global(.label-row) { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
    .row :global(.help) { display: none; }
  }
  .number-hint { margin: 0 0 0.5rem; color: var(--muted); font-size: 0.8125rem; }
</style>
