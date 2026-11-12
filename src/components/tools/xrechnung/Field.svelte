<script lang="ts">
  // One field, two looks. In a resting block (`.blk` without `.on`) it reads as a line of the
  // document; in the active block it is an ordinary boxed control. Same element either way: nothing is rendered twice.
  import { tick } from 'svelte';
  import { copy, fill } from '../../../i18n/xrechnung.ts';
  import { helpFor, type HelpId } from '../../../i18n/xrechnung-help.ts';
  import type { Locale } from '../../../i18n/ui.ts';
  import Glyph from './Glyph.svelte';
  import { isoForPicker, NATIVE_DATE_MAX, NATIVE_DATE_MIN, textFromNativeDate } from './input-format.ts';

  type Option = { value: string; label: string };
  type Props = {
    id: string;
    label: string;
    locale: Locale;
    value: string;
    kind?: 'text' | 'date' | 'select' | 'textarea';
    /** `row`: label beside the value (a line of facts). `stack`: label above. */
    layout?: 'row' | 'stack';
    /** Address-like line: the label is hidden while the block rests and the empty field shows it as its placeholder. */
    plain?: boolean;
    title?: boolean;
    required?: boolean;
    optionalMark?: boolean;
    /** Replaces the word "optional" where a group needs one of its fields. */
    markText?: string;
    /** An empty optional field leaves the resting document unless this is set (a group still needs one of its fields). */
    keep?: boolean;
    options?: readonly Option[];
    helpId?: HelpId;
    error?: string | undefined;
    /** The error is "nothing entered yet": shown as a short tag, the full text stays tied to the control. */
    missing?: boolean;
    hint?: string | undefined;
    describedById?: string;
    inputmode?: 'text' | 'decimal' | 'email' | 'tel';
    autocomplete?: string;
    rows?: number;
    onblur?: () => void;
    onmore?: (trigger: HTMLElement) => void;
  };
  let {
    id, label, locale, value = $bindable(), kind = 'text', layout = 'row', plain = false, title = false, required = false, optionalMark = false,
    markText, keep = false, options = [], helpId, error, missing = false, hint, describedById, inputmode, autocomplete = 'off', rows = 2, onblur, onmore,
  }: Props = $props();

  let hintOpen = $state(false);
  // Calendar (date fields only): a small panel with a visible native date control, opened on demand. The text field stays the
  // one source of truth; a chosen date is written into it as TT.MM.JJJJ, so manual entry and the calendar share one path.
  let pickerOpen = $state(false);
  let calendarButton: HTMLButtonElement | undefined = $state();
  let nativeInput: HTMLInputElement | undefined = $state();
  const pickerValue = $derived(kind === 'date' ? isoForPicker(value) : '');
  async function togglePicker(): Promise<void> {
    if (pickerOpen) return closePicker();
    pickerOpen = true;
    await tick();
    nativeInput?.focus();
    try { nativeInput?.showPicker?.(); } catch { /* not allowed or unsupported: the visible control is the picker */ }
  }
  function closePicker(): void {
    pickerOpen = false;
    calendarButton?.focus();
  }
  function picked(): void {
    value = textFromNativeDate(nativeInput?.value ?? '');
    onblur?.();
  }
  const describedBy = $derived([hintOpen && helpId ? `${id}-help` : '', hint ? `${id}-hint` : '', kind === 'date' ? `${id}-date` : '', describedById ?? '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined);
  const placeholder = $derived(plain ? label : undefined);
  // The "?" beside the label is in the tab sequence of the active block, so help never depends on F1 alone (MDR-46). F1 on
  // the field toggles the same help as a shortcut; Escape closes it before it closes anything else.
  function fieldKey(event: KeyboardEvent): void {
    if (!helpId) return;
    if (event.key === 'F1') { event.preventDefault(); hintOpen = !hintOpen; }
    else if (event.key === 'Escape' && hintOpen) { event.stopPropagation(); hintOpen = false; }
  }
</script>

<div
  class="field" class:stack={layout === 'stack' || plain} class:plain class:title class:date={kind === 'date'} class:empty={value === ''}
  class:invalid={error !== undefined && !missing} class:missing={error !== undefined && missing}
  class:vacant={optionalMark && value === '' && !keep && error === undefined}
>
  <div class="label-row">
    <label for={id}>{label}{#if required}<span class="req" aria-hidden="true"> *</span><span class="sr"> ({copy.required[locale]})</span>{:else if optionalMark}<span class="opt"> ({markText ?? copy.optional[locale]})</span>{/if}</label>
    {#if helpId}
      <button
        type="button" class="help" aria-expanded={hintOpen} aria-controls={`${id}-help`} aria-label={fill(copy.helpFor[locale], { field: label })}
        onclick={() => (hintOpen = !hintOpen)}
        onkeydown={(event) => { if (event.key === 'Escape' && hintOpen) { hintOpen = false; event.stopPropagation(); } }}
      >?</button>
    {/if}
  </div>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="ctl" onkeydown={fieldKey}>
    {#if kind === 'select'}
      <select {id} aria-keyshortcuts={helpId ? 'F1' : undefined} bind:value {onblur} aria-invalid={error !== undefined} aria-describedby={describedBy} {autocomplete}>
        <option value="">{copy.choose[locale]}</option>
        {#each options as option (option.value)}<option value={option.value}>{option.label}</option>{/each}
      </select>
    {:else if kind === 'textarea'}
      <textarea {id} aria-keyshortcuts={helpId ? 'F1' : undefined} bind:value {onblur} {rows} {placeholder} aria-invalid={error !== undefined} aria-describedby={describedBy}></textarea>
    {:else if kind === 'date'}
      <input {id} type="text" aria-keyshortcuts={helpId ? 'F1' : undefined} bind:value {onblur} {autocomplete} spellcheck="false" aria-invalid={error !== undefined} aria-describedby={describedBy} />
      <button type="button" class="cal" bind:this={calendarButton} aria-expanded={pickerOpen} aria-controls={`${id}-picker`} aria-label={fill(copy['date.calendar'][locale], { field: label })} onclick={togglePicker}>
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><rect x="2" y="3" width="12" height="11" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2 6.5h12M5 1.5v3M11 1.5v3" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>
      </button>
    {:else}
      <input {id} type="text" aria-keyshortcuts={helpId ? 'F1' : undefined} bind:value {onblur} {inputmode} {autocomplete} {placeholder} spellcheck="false" aria-invalid={error !== undefined} aria-describedby={describedBy} />
    {/if}
    {#if error !== undefined && missing}<span class="miss-tag" aria-hidden="true">{copy['sheet.missingShort'][locale]}</span>{/if}
  </div>
  {#if kind === 'date' && pickerOpen}
    <div class="picker" id={`${id}-picker`} role="group" aria-label={fill(copy['date.pick'][locale], { field: label })} onkeydown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); closePicker(); } }}>
      <input id={`${id}-native`} type="date" bind:this={nativeInput} value={pickerValue} min={NATIVE_DATE_MIN} max={NATIVE_DATE_MAX} onchange={picked} aria-label={fill(copy['date.pick'][locale], { field: label })} />
      <button type="button" class="done" onclick={closePicker}>{copy['date.done'][locale]}</button>
    </div>
  {/if}
  {#if helpId && hintOpen}
    <div class="inline-help" id={`${id}-help`}>
      <p>{helpFor(helpId, locale).short}</p>
      {#if onmore}<button type="button" class="more" onclick={(event) => onmore?.(event.currentTarget)}>{copy.more[locale]}</button>{/if}
    </div>
  {/if}
  {#if hint}<p class="hint" id={`${id}-hint`}>{hint}</p>{/if}
  {#if kind === 'date'}<p class="hint" id={`${id}-date`}>{copy['date.format'][locale]}</p>{/if}
  {#if error}<p class="error" id={`${id}-error`}><Glyph kind="error" /> <span>{error}</span></p>{/if}
</div>

<style>
  .field { display: grid; grid-template-columns: var(--label-w, 9.5rem) minmax(0, 1fr); gap: 0.125rem 0.75rem; align-items: start; min-width: 0; }
  .field > * { grid-column: 2; min-width: 0; }
  .field > .label-row { grid-column: 1; grid-row: 1; }
  .field.stack { grid-template-columns: minmax(0, 1fr); }
  .field.stack > * { grid-column: 1; }
  .field.stack > .label-row { grid-row: auto; }
  .label-row { display: flex; align-items: center; gap: 0.375rem; min-block-size: 2rem; }
  .stack > .label-row { min-block-size: 1.375rem; }
  label { color: var(--muted); font: 400 0.8125rem/1.3 var(--sans); transition: color 0.15s; }
  .req { font-family: var(--mono); margin-inline-start: 0.15em; }
  .opt { font-weight: 400; margin-inline-start: 0.3em; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .ctl { position: relative; display: flex; align-items: center; gap: 0.25rem; }
  input, select, textarea {
    flex: 1 1 auto; width: 100%; min-width: 0; min-height: 2rem; padding: 0.2rem 0.4rem; margin: 0; background: var(--paper); color: var(--ink);
    border: 1px solid var(--muted); border-radius: 0; font: 400 0.9375rem/1.4 var(--sans); text-overflow: ellipsis;
    transition: border-color 0.15s, background-color 0.15s;
  }
  textarea { resize: vertical; field-sizing: content; min-height: 2rem; }
  .title input { font: 600 1.125rem/1.3 var(--serif); }
  /* Address lines stand flush with the labels of the facts below them, boxed or not. */
  :global(.blk:not(.on)) .plain > .ctl { margin-inline-start: calc(-0.4rem - 1px); }
  .date .ctl input { max-inline-size: 9rem; }
  .cal, .done { flex: none; display: inline-flex; align-items: center; justify-content: center; min-block-size: 2rem; padding: 0 0.5rem; border: 1px solid var(--ink); background: var(--paper); color: var(--ink); font: 500 0.8125rem var(--sans); cursor: pointer; }
  .cal { inline-size: 2rem; padding: 0; }
  .cal[aria-expanded='true'] { background: var(--ink); color: var(--paper); }
  .picker { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; padding: 0.375rem 0.5rem; border-inline-start: 3px solid var(--accent); }
  .picker input { flex: none; inline-size: auto; max-inline-size: 12rem; }
  .invalid input, .invalid select, .invalid textarea { border-color: var(--danger); border-width: 2px; }
  .missing input, .missing select, .missing textarea { border-color: var(--ink); }
  .miss-tag { position: absolute; inset-inline-end: 0.375rem; inset-block-start: 50%; translate: 0 -50%; padding: 0 0.375rem; background: var(--highlight); color: var(--ink); font: 500 0.6875rem/1.5 var(--mono); letter-spacing: 0.04em; pointer-events: none; }
  .date .miss-tag { position: static; translate: none; }
  select ~ .miss-tag { inset-inline-end: 1.75rem; }
  .ctl:focus-within .miss-tag { display: none; }
  .help { flex: none; inline-size: 1.375rem; block-size: 1.375rem; padding: 0; border: 1px solid var(--muted); border-radius: 50%; background: var(--paper); color: var(--ink); font: 500 0.6875rem/1 var(--mono); cursor: pointer; }
  .help[aria-expanded='true'] { background: var(--ink); color: var(--paper); border-color: var(--ink); }
  .inline-help { border-inline-start: 3px solid var(--accent); padding: 0.25rem 0.5rem; font-size: 0.8125rem; }
  .inline-help p { margin: 0 0 0.25rem; max-inline-size: 60ch; }
  .more { padding: 0; border: 0; background: none; color: var(--ink); font: 500 0.8125rem var(--sans); text-decoration: underline; text-decoration-color: var(--accent); text-underline-offset: 0.2em; cursor: pointer; }
  .hint { margin: 0; color: var(--muted); font-size: 0.75rem; line-height: 1.4; }
  .error { display: flex; gap: 0.375rem; align-items: flex-start; margin: 0; color: var(--danger); font: 500 0.8125rem/1.35 var(--sans); }
  /* "Missing" is said by the tag in the field; the sentence stays for assistive technology (aria-describedby). */
  .missing > .error { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

  /* The active block: labels in ink, everything a form offers. */
  :global(.blk.on) label { color: var(--ink); font-weight: 500; }

  /* The resting block: the same controls read as lines of the document. */
  :global(.blk:not(.on)) .vacant,
  :global(.blk:not(.on)) .help,
  :global(.blk:not(.on)) .cal,
  :global(.blk:not(.on)) .hint,
  :global(.blk:not(.on)) .opt,
  :global(.blk:not(.on)) .req,
  :global(.blk:not(.on)) .picker,
  :global(.blk:not(.on)) .inline-help { display: none; }
  :global(.blk:not(.on)) .plain > .label-row { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  :global(.blk:not(.on)) input,
  :global(.blk:not(.on)) select,
  :global(.blk:not(.on)) textarea { border-color: transparent; background: transparent; resize: none; cursor: text; }
  :global(.blk:not(.on)) select { appearance: none; cursor: pointer; }
  :global(.blk:not(.on)) .empty input,
  :global(.blk:not(.on)) .empty select,
  :global(.blk:not(.on)) .empty textarea { border-bottom: 1px dotted var(--muted); color: var(--muted); }
  :global(.blk:not(.on)) .field:hover input,
  :global(.blk:not(.on)) .field:hover select,
  :global(.blk:not(.on)) .field:hover textarea { border-bottom: 1px solid var(--accent); }
  :global(.blk:not(.on)) .missing input,
  :global(.blk:not(.on)) .missing select,
  :global(.blk:not(.on)) .missing textarea { border-bottom: 1px solid var(--ink); }
  :global(.blk:not(.on)) .invalid input,
  :global(.blk:not(.on)) .invalid select,
  :global(.blk:not(.on)) .invalid textarea { border-color: transparent; border-bottom: 2px solid var(--danger); }
  input::placeholder, textarea::placeholder { color: var(--muted); opacity: 1; }

  @container blk (max-width: 23rem) {
    .field { grid-template-columns: minmax(0, 1fr); }
    .field > * { grid-column: 1; }
    .field > .label-row { grid-row: auto; min-block-size: 1.375rem; }
  }
  @media (pointer: coarse) {
    input, select, textarea { min-height: 2.75rem; }
    .cal, .done { min-block-size: 2.75rem; }
    .cal, .help { inline-size: 2.75rem; }
    .help { block-size: 2.75rem; }
  }
  @media (max-width: 47.99rem) { input, select, textarea { font-size: 1rem; } }
  @media (prefers-reduced-motion: reduce) { input, select, textarea, label { transition: none; } }
</style>
