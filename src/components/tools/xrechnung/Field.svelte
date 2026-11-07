<script lang="ts">
  import { copy, fill } from '../../../i18n/xrechnung.ts';
  import { helpFor, type HelpId } from '../../../i18n/xrechnung-help.ts';
  import type { Locale } from '../../../i18n/ui.ts';
  import Glyph from './Glyph.svelte';

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
  let helpButton: HTMLButtonElement | undefined = $state();
  // The wide line-row layout hides this toggle (the column headers carry the help). A help left open at a narrower width
  // would then stay open with no way to close it, so the open state ends with the toggle's visibility.
  $effect(() => {
    const button = helpButton;
    if (!button) return;
    const observer = new ResizeObserver(() => { if (button.offsetParent === null) hintOpen = false; });
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
    <input {id} type="text" bind:value {onblur} inputmode={kind === 'date' ? undefined : inputmode} {autocomplete} spellcheck="false" aria-invalid={error !== undefined} aria-describedby={describedBy} />
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
  .date input { max-inline-size: 12rem; }
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
    .help { inline-size: 2.75rem; block-size: 2.75rem; }
  }
  @media (max-width: 47.99rem) { input, select, textarea { font-size: 1rem; } }
</style>
