<script lang="ts">
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
    required?: boolean;
    optionalMark?: boolean;
    options?: readonly Option[];
    helpId?: HelpId;
    error?: string | undefined;
    hint?: string | undefined;
    /** Id of a description that lives outside the field and is shared with other fields. */
    describedById?: string;
    inputmode?: 'text' | 'decimal' | 'email' | 'tel';
    autocomplete?: string;
    rows?: number;
    onblur?: () => void;
    onmore?: (trigger: HTMLElement) => void;
  };
  let {
    id, label, locale, value = $bindable(), kind = 'text', required = false, optionalMark = false, options = [], helpId,
    error, hint, describedById, inputmode, autocomplete = 'off', rows = 3, onblur, onmore,
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
    // Progressive enhancement only: where the browser refuses or lacks it, the visible control above is the picker.
    try { nativeInput?.showPicker?.(); } catch { /* not allowed or unsupported */ }
  }
  function closePicker(): void {
    pickerOpen = false;
    calendarButton?.focus();
  }
  function picked(): void {
    const iso = nativeInput?.value ?? '';
    value = textFromNativeDate(iso);
    onblur?.();
  }
  let helpButton: HTMLButtonElement | undefined = $state();
  // The wide line-row layout hides this toggle (the column headers carry the help). A help left open at a narrower width
  // would then stay open with no way to close it, so the open state ends with the toggle's visibility.
  $effect(() => {
    const button = helpButton;
    if (!button) return;
    const observer = new ResizeObserver(() => {
      if (button.offsetParent !== null) return;
      // Focus inside the help (its "more", restored there when the drawer closed before this layout change) would fall to the
      // page when the help closes: it moves to this field's own control first.
      if (document.getElementById(`${id}-help`)?.contains(document.activeElement)) document.getElementById(id)?.focus();
      hintOpen = false;
    });
    observer.observe(button);
    return () => observer.disconnect();
  });
  const describedBy = $derived([hintOpen && helpId ? `${id}-help` : '', hint ? `${id}-hint` : '', kind === 'date' ? `${id}-date` : '', describedById ?? '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined);
</script>

<div class="field" class:invalid={error !== undefined} class:date={kind === 'date'}>
  <div class="label-row">
    <label for={id}>{label}{#if required}<span class="req" aria-hidden="true"> *</span><span class="sr"> ({copy.required[locale]})</span>{:else if optionalMark}<span class="opt"> ({copy.optional[locale]})</span>{/if}</label>
    {#if helpId}
      <button
        type="button" class="help" bind:this={helpButton}
        aria-expanded={hintOpen} aria-controls={`${id}-help`}
        aria-label={fill(copy.helpFor[locale], { field: label })}
        onclick={() => (hintOpen = !hintOpen)}
        onkeydown={(event) => { if (event.key === 'Escape' && hintOpen) { hintOpen = false; event.stopPropagation(); } }}
      >?</button>
    {/if}
  </div>
  {#if helpId && hintOpen}
    <div class="inline-help" id={`${id}-help`}>
      <p>{helpFor(helpId, locale).short}</p>
      {#if onmore}<button type="button" class="more" onclick={(event) => onmore?.(event.currentTarget)}>{copy.more[locale]}</button>{/if}
    </div>
  {/if}
  {#if kind === 'select'}
    <select {id} bind:value {onblur} aria-invalid={error !== undefined} aria-describedby={describedBy} {autocomplete}>
      <option value="">{copy.choose[locale]}</option>
      {#each options as option (option.value)}<option value={option.value}>{option.label}</option>{/each}
    </select>
  {:else if kind === 'textarea'}
    <textarea {id} bind:value {onblur} {rows} aria-invalid={error !== undefined} aria-describedby={describedBy}></textarea>
  {:else}
    {#if kind === 'date'}
      <div class="date-row">
        <input {id} type="text" bind:value {onblur} {autocomplete} spellcheck="false" aria-invalid={error !== undefined} aria-describedby={describedBy} />
        <button type="button" class="cal" bind:this={calendarButton} aria-expanded={pickerOpen} aria-controls={`${id}-picker`} aria-label={fill(copy['date.calendar'][locale], { field: label })} onclick={togglePicker}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><rect x="2" y="3" width="12" height="11" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2 6.5h12M5 1.5v3M11 1.5v3" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>
        </button>
      </div>
      {#if pickerOpen}
        <div class="picker" id={`${id}-picker`} role="group" aria-label={fill(copy['date.pick'][locale], { field: label })} onkeydown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); closePicker(); } }}>
          <input id={`${id}-native`} type="date" bind:this={nativeInput} value={pickerValue} min={NATIVE_DATE_MIN} max={NATIVE_DATE_MAX} onchange={picked} aria-label={fill(copy['date.pick'][locale], { field: label })} />
          <button type="button" class="done" onclick={closePicker}>{copy['date.done'][locale]}</button>
        </div>
      {/if}
    {:else}
      <input {id} type="text" bind:value {onblur} {inputmode} {autocomplete} spellcheck="false" aria-invalid={error !== undefined} aria-describedby={describedBy} />
    {/if}
  {/if}
  {#if hint}<p class="hint" id={`${id}-hint`}>{hint}</p>{/if}
  {#if kind === 'date'}<p class="hint" id={`${id}-date`}>{copy['date.format'][locale]}</p>{/if}
  {#if error}<p class="error" id={`${id}-error`}><Glyph kind="error" /> <span>{error}</span></p>{/if}
</div>

<style>
  .field { display: flex; flex-direction: column; gap: 0.25rem; min-width: 0; }
  .label-row { display: flex; align-items: center; gap: 0.375rem; min-block-size: 1.5rem; }
  label { font: 500 0.8125rem/1.3 var(--sans); }
  .req { font-family: var(--mono); margin-inline-start: 0.15em; }
  .opt { color: var(--muted); font-weight: 400; margin-inline-start: 0.3em; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  input, select, textarea {
    width: 100%; max-inline-size: 36rem; min-height: 2.25rem; padding: 0.3rem 0.5rem; background: var(--paper); color: var(--ink);
    border: 1px solid var(--muted); border-radius: 0; font: 400 0.9375rem/1.4 var(--sans);
  }
  textarea { resize: vertical; }
  .date-row { display: flex; align-items: center; gap: 0.25rem; max-inline-size: 36rem; }
  .date-row input { flex: 1 1 auto; min-width: 0; max-inline-size: 12rem; }
  .cal, .done { display: inline-flex; align-items: center; justify-content: center; min-block-size: 2.25rem; padding: 0 0.5rem; border: 1px solid var(--ink); background: var(--paper); color: var(--ink); font: 500 0.8125rem var(--sans); cursor: pointer; }
  .cal { inline-size: 2.25rem; padding: 0; }
  .cal[aria-expanded='true'] { background: var(--ink); color: var(--paper); }
  .picker { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; padding: 0.375rem 0.5rem; border-inline-start: 3px solid var(--accent); background: var(--paper); }
  .picker input { inline-size: auto; max-inline-size: 12rem; }
  .invalid input, .invalid select, .invalid textarea { border-color: var(--danger); border-width: 2px; }
  .help {
    inline-size: 1.5rem; block-size: 1.5rem; padding: 0; border: 1px solid var(--ink); border-radius: 50%; background: var(--paper); color: var(--ink);
    font: 500 0.75rem/1 var(--mono); cursor: pointer;
  }
  .help[aria-expanded='true'] { background: var(--ink); color: var(--paper); }
  .inline-help { border-inline-start: 3px solid var(--accent); padding: 0.25rem 0.5rem; background: var(--paper); font-size: 0.8125rem; }
  .inline-help p { margin: 0 0 0.25rem; max-inline-size: 60ch; }
  .more { padding: 0; border: 0; background: none; color: var(--ink); font: 500 0.8125rem var(--sans); text-decoration: underline; text-decoration-color: var(--accent); text-underline-offset: 0.2em; cursor: pointer; }
  .hint { margin: 0; color: var(--muted); font-size: 0.8125rem; }
  .error { display: flex; gap: 0.375rem; align-items: flex-start; margin: 0; color: var(--danger); font: 500 0.8125rem/1.35 var(--sans); }
  .error span { color: var(--danger); }
  @media (pointer: coarse) {
    input, select, textarea { min-height: 2.75rem; }
    .cal, .done { min-block-size: 2.75rem; }
    .cal { inline-size: 2.75rem; }
    .help { inline-size: 2.75rem; block-size: 2.75rem; }
  }
  @media (max-width: 47.99rem) { input, select, textarea { font-size: 1rem; } }
</style>
