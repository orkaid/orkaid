<script lang="ts">
  import { tick } from 'svelte';
  import { copy, describeError } from '../../../i18n/xrechnung.ts';
  import { helpEntries, helpFor, type HelpId, type HelpStatus } from '../../../i18n/xrechnung-help.ts';
  import type { Locale } from '../../../i18n/ui.ts';
  import Glyph from './Glyph.svelte';
  import { returnTarget } from './focus-return.ts';

  type Props = { locale: Locale; onjump: (fieldId: string) => void };
  let { locale, onjump }: Props = $props();

  let dialog: HTMLDialogElement | undefined = $state();
  let id: HelpId | undefined = $state();
  let trigger: HTMLElement | null = null;
  // The control of the field the trigger belongs to, noted at opening: a layout change can remove or hide the trigger itself.
  let fieldContext: string | undefined;

  /** Opens the drawer for one help entry; focus returns to `from` when it closes (to its field if `from` is gone by then). */
  export async function open(helpId: HelpId, from: HTMLElement | null): Promise<void> {
    id = helpId;
    trigger = from ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    fieldContext = trigger?.closest('.field')?.querySelector('input, select, textarea')?.id || undefined;
    // The content is rendered per open: wait for it, so the close button exists when focus is set (every opening alike).
    await tick();
    dialog?.showModal();
    dialog?.querySelector<HTMLElement>('.close')?.focus();
  }

  const entry = $derived(id ? helpEntries[id] : undefined);
  const text = $derived(id ? helpFor(id, locale) : undefined);
  const isSection = $derived(id !== undefined && id.startsWith('sec.'));
  const statusLabel = (status: HelpStatus) => copy[`help.${status}`][locale];

  function closed() {
    // The platform restores focus too; doing it explicitly keeps it deterministic when the trigger was re-rendered. If the
    // trigger is gone or hidden (the layout changed while the drawer was open), the field in the same context takes the focus.
    // No trigger (a jump) means no restoring: the jump moves focus itself.
    const shown = (element: HTMLElement) => element.isConnected && element.getClientRects().length > 0;
    // An inline help's "more" lives only as long as the field's help toggle shows: right after a layout change hides the toggle,
    // "more" is still on screen until the field's ResizeObserver closes the help, so it counts as gone already.
    const usable = (element: HTMLElement) => {
      const toggle = element.closest('.inline-help')?.closest('.field')?.querySelector<HTMLElement>('.help');
      return shown(element) && (!toggle || shown(toggle));
    };
    const byId = (fieldId: string | undefined) => (fieldId ? document.getElementById(fieldId) : null);
    if (trigger) returnTarget([trigger, byId(fieldContext), byId(entry?.fieldId)], usable)?.focus();
    trigger = null;
    fieldContext = undefined;
  }
  function backdrop(event: MouseEvent) {
    if (event.target === dialog) dialog?.close();
  }
  function jump() {
    const target = entry?.fieldId;
    trigger = null;
    fieldContext = undefined;
    dialog?.close();
    if (target) onjump(target);
  }
</script>

<dialog bind:this={dialog} class="drawer" aria-labelledby="help-title" onclose={closed} onclick={backdrop}>
  {#if entry && text}
    <div class="panel">
      <header>
        <p class="eyebrow">{isSection ? copy['help.headingSection'][locale] : copy['help.heading'][locale]}</p>
        <button type="button" class="close" onclick={() => dialog?.close()}>{copy.close[locale]}</button>
      </header>
      <h2 id="help-title">{text.title} <span class="bt">{entry.bt}</span></h2>

      <section>
        <h3>{copy['help.enter'][locale]}</h3>
        <p>{text.enter}</p>
      </section>
      <section>
        <h3>{copy['help.status'][locale]}</h3>
        <p><strong>{statusLabel(text.status)}</strong>{#if text.condition} — {text.condition}{/if}</p>
      </section>
      {#if text.fields}
        <section>
          <h3>{copy['help.fields'][locale]}</h3>
          <table>
            <thead><tr><th scope="col">{copy['help.colField'][locale]}</th><th scope="col">{copy['help.colStatus'][locale]}</th><th scope="col">{copy['help.colFormat'][locale]}</th></tr></thead>
            <tbody>{#each text.fields as row (row.name)}<tr><th scope="row">{row.name}</th><td>{statusLabel(row.status)}</td><td>{row.format}</td></tr>{/each}</tbody>
          </table>
        </section>
      {/if}
      {#if text.format}
        <section><h3>{copy['help.format'][locale]}</h3><p>{text.format}</p></section>
      {/if}
      {#if text.valid || text.invalid}
        <section>
          <h3>{copy['help.valid'][locale]}</h3>
          <ul class="examples">
            {#if text.valid}<li><Glyph kind="ok" /> <code>{text.valid}</code></li>{/if}
            {#each text.invalid ?? [] as bad (bad.value)}<li><Glyph kind="error" /> <code>{bad.value}</code> <span>{copy['help.invalid'][locale]}: {bad.note}</span></li>{/each}
          </ul>
        </section>
      {/if}
      {#if entry.mistakes && entry.mistakes.length > 0}
        <section>
          <h3>{copy['help.mistakes'][locale]}</h3>
          <ul>{#each entry.mistakes as code (code)}<li>{describeError(code, entry.fieldId ?? '', locale, text.title)}</li>{/each}</ul>
        </section>
      {/if}
      {#if text.external}
        <section><h3>{copy['help.external'][locale]}</h3><ul>{#each text.external as line (line)}<li>{line}</li>{/each}</ul></section>
      {/if}
      {#if text.profile}
        <section><h3>{copy['help.profile'][locale]}</h3><ul>{#each text.profile as line (line)}<li>{line}</li>{/each}</ul></section>
      {/if}
      {#if text.unverified}
        <section><h3>{copy['help.unverified'][locale]}</h3><ul>{#each text.unverified as line (line)}<li>{line}</li>{/each}</ul></section>
      {/if}
      <section class="sources">
        <h3>{copy['help.sources'][locale]}</h3>
        <ul>{#each entry.sources as source (source)}<li><code>{source}</code></li>{/each}</ul>
      </section>
      {#if entry.fieldId}
        <footer><button type="button" class="jump" onclick={jump}>{copy.jump[locale]}</button></footer>
      {/if}
    </div>
  {/if}
</dialog>

<style>
  .drawer {
    position: fixed; inset: 0 0 0 auto; margin: 0; padding: 0; width: min(28rem, 100vw); height: 100dvh; max-height: 100dvh;
    border: 0; border-inline-start: 1px solid var(--ink); background: var(--paper); color: var(--ink); overflow: hidden;
  }
  .drawer:not([open]) { display: none; }
  .drawer[open] { transform: none; transition: transform 0.2s ease-out; }
  @starting-style { .drawer[open] { transform: translateX(100%); } }
  .drawer::backdrop { background: color-mix(in srgb, var(--ink) 25%, transparent); }
  .panel { display: flex; flex-direction: column; gap: 0.75rem; height: 100%; padding: 1rem 1.25rem; overflow-y: auto; }
  header { display: flex; justify-content: space-between; align-items: center; gap: 1rem; }
  .eyebrow { margin: 0; font: 500 0.75rem/1.4 var(--mono); letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); }
  .close, .jump { padding: 0.4rem 0.75rem; min-height: 2.25rem; border: 1px solid var(--ink); background: var(--paper); color: var(--ink); font: 500 0.875rem var(--sans); cursor: pointer; }
  .jump { background: var(--ink); color: var(--paper); }
  h2 { margin: 0; font: 600 1.25rem/1.25 var(--serif); }
  .bt { margin-inline-start: 0.5rem; font: 500 0.75rem var(--mono); color: var(--muted); }
  section { border-top: 1px solid var(--rule); padding-block-start: 0.5rem; }
  h3 { margin: 0 0 0.25rem; font: 500 0.75rem/1.3 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
  p, li { font-size: 0.9375rem; line-height: 1.5; margin: 0; }
  ul { margin: 0; padding-inline-start: 1.1rem; display: flex; flex-direction: column; gap: 0.25rem; }
  .examples { list-style: none; padding: 0; }
  .examples li { display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: baseline; }
  code { font: 400 0.8125rem var(--mono); overflow-wrap: anywhere; }
  table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; }
  th, td { padding: 0.25rem 0.4rem 0.25rem 0; text-align: left; vertical-align: top; border-bottom: 1px solid var(--rule); font-weight: 400; }
  thead th { font: 500 0.75rem var(--mono); color: var(--muted); }
  tbody th { font-weight: 500; }
  .sources li { font-size: 0.8125rem; }
  footer { margin-top: auto; padding-block-start: 0.5rem; }
  @media (max-width: 47.99rem) {
    .drawer { inset: auto 0 0 0; width: 100%; height: auto; max-height: 85dvh; border-inline-start: 0; border-block-start: 1px solid var(--ink); }
    @starting-style { .drawer[open] { transform: translateY(100%); } }
  }
  @media (prefers-reduced-motion: reduce) { .drawer[open] { transition: none; } }
  :global(body:has(dialog[open])) { overflow: hidden; }
</style>
