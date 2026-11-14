<script lang="ts">
  // Structured Skonto tiers of an invoice 380, edited where they stand in the payment block. Nothing here calculates or builds
  // BT-20: the tiers are text until the adapter converts them, the domain validates them and writes BT-20. Tiers keep the order
  // entered; a tier the user added stays until removed. Add, remove and undo follow the line editor's focus pattern.
  import { copy, fill } from '../../../i18n/xrechnung.ts';
  import type { Locale } from '../../../i18n/ui.ts';
  import Glyph from './Glyph.svelte';
  import { MAX_SKONTO_TIERS, type SkontoTierForm } from './form-state.ts';

  type Props = {
    tiers: SkontoTierForm[];
    locale: Locale;
    errorFor: (id: string) => string | undefined;
    isMissing: (id: string) => boolean;
    touch: (id: string) => void;
    /** Tiers were inserted or removed at `index`: the caller forgets what it knew about the tiers from there on. */
    onshift: (index: number) => void;
    /** The group's explanation, tied to every tier control. */
    describedById: string;
  };
  let { tiers = $bindable(), locale, errorFor, isMissing, touch, onshift, describedById }: Props = $props();

  const FIELDS = [['days', 'f.skontoDays', 'numeric'], ['percent', 'f.skontoPercent', 'decimal']] as const;
  const id = (i: number, field: string) => `payment.skonto[${i}].${field}`;
  const tierName = (i: number) => fill(copy['skonto.tier'][locale], { n: i + 1 });
  let removed = $state<{ index: number; tier: SkontoTierForm } | undefined>();

  const focusDays = (index: number) => queueMicrotask(() => document.getElementById(id(index, 'days'))?.focus());
  function add() {
    if (tiers.length >= MAX_SKONTO_TIERS) return;
    removed = undefined;
    tiers.push({ days: '', percent: '' });
    focusDays(tiers.length - 1);
  }
  function remove(index: number) {
    const [tier] = tiers.splice(index, 1);
    if (tier) removed = { index, tier };
    onshift(index);
    queueMicrotask(() => document.getElementById('skonto-undo')?.focus());
  }
  function undo() {
    if (!removed || tiers.length >= MAX_SKONTO_TIERS) return;
    tiers.splice(removed.index, 0, removed.tier);
    onshift(removed.index);
    focusDays(removed.index);
    removed = undefined;
  }
  const mark = (fid: string) => (errorFor(fid) === undefined ? '' : isMissing(fid) ? 'miss' : 'bad');
</script>

<div class="tiers" class:none={tiers.length === 0}>
  {#each tiers as tier, i (i)}
    <fieldset class="tier">
      <legend>{tierName(i)}</legend>
      <span class="num" aria-hidden="true">{tierName(i)}</span>
      {#each FIELDS as [field, key, mode] (field)}
        {@const fid = id(i, field)}
        <div class={`c c-${field} ${mark(fid)}`} class:empty={tier[field] === ''}>
          <label for={fid}><span class="sr">{tierName(i)}: </span>{copy[key][locale]}</label>
          <span class="ctl">
            <input id={fid} type="text" inputmode={mode} bind:value={tier[field]} autocomplete="off" spellcheck="false" aria-invalid={mark(fid) !== ''} aria-describedby={mark(fid) === '' ? describedById : `${describedById} ${fid}-error`} onblur={() => touch(fid)} />
            {#if field === 'percent'}<span class="unit" aria-hidden="true">%</span>{/if}
          </span>
        </div>
      {/each}
      <button type="button" class="remove" aria-label={fill(copy['skonto.remove'][locale], { n: i + 1 })} onclick={() => remove(i)}>×</button>
      {#each FIELDS as [field] (field)}
        {@const fid = id(i, field)}
        {@const text = errorFor(fid)}
        {#if text !== undefined}<p class={mark(fid) === 'miss' ? 'row-open' : 'row-err'} id={`${fid}-error`}><Glyph kind={mark(fid) === 'miss' ? 'incomplete' : 'error'} /> <span>{text}</span></p>{/if}
      {/each}
    </fieldset>
  {/each}
  <div class="foot">
    {#if tiers.length < MAX_SKONTO_TIERS}<button type="button" class="add" onclick={add}>+ {copy['skonto.add'][locale]}</button>
    {:else}<p class="limit">{copy['skonto.limit'][locale]}</p>{/if}
    {#if removed}<button type="button" class="undo" id="skonto-undo" onclick={undo}>{fill(copy['skonto.undo'][locale], { n: removed.index + 1 })}</button>{/if}
  </div>
</div>

<style>
  .tiers { display: flex; flex-direction: column; min-width: 0; }
  fieldset { margin: 0; padding: 0; border: 0; min-width: 0; }
  legend, .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .tier { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 0.375rem 0.75rem; padding-block: 0.5rem; border-top: 1px solid var(--rule); }
  .num { flex: 0 0 8.5rem; align-self: center; font: 500 0.75rem/1.3 var(--mono); letter-spacing: 0.02em; }
  .c { display: flex; flex-direction: column; gap: 0.125rem; min-width: 0; }
  label { color: var(--ink); font: 500 0.8125rem/1.3 var(--sans); }
  .ctl { display: flex; align-items: center; gap: 0.25rem; }
  input {
    inline-size: 6.5rem; min-height: 2rem; padding: 0.2rem 0.4rem; margin: 0; background: var(--paper); color: var(--ink); text-align: end;
    border: 1px solid var(--muted); border-radius: 0; font: 400 0.9375rem/1.4 var(--mono); font-variant-numeric: tabular-nums;
  }
  .unit { font: 400 0.9375rem var(--mono); }
  .bad input { border-color: var(--danger); border-width: 2px; }
  .miss input { border-color: var(--ink); }
  .remove, .add, .undo { font: 500 0.875rem var(--sans); color: var(--ink); background: var(--paper); border: 1px solid var(--ink); cursor: pointer; }
  .remove { inline-size: 2rem; block-size: 2rem; padding: 0; font-size: 1.125rem; line-height: 1; border-color: var(--muted); }
  .add, .undo { min-block-size: 2rem; padding: 0.2rem 0.7rem; }
  .row-err, .row-open { flex-basis: 100%; display: flex; gap: 0.375rem; align-items: flex-start; margin: 0; font: 500 0.8125rem/1.35 var(--sans); }
  .row-err { color: var(--danger); }
  .foot { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; padding-block-start: 0.5rem; }
  .tiers.none .foot { padding-block-start: 0; }
  .limit { margin: 0; color: var(--muted); font-size: 0.8125rem; }

  /* The resting block reads as the document: the values stay, the editing tools leave. */
  :global(.blk:not(.on)) .remove,
  :global(.blk:not(.on)) .foot { display: none; }
  :global(.blk:not(.on)) input { border-color: transparent; background: transparent; }
  :global(.blk:not(.on)) .empty input { border-bottom: 1px dotted var(--muted); }
  :global(.blk:not(.on)) .miss input { border-bottom: 1px solid var(--ink); }
  :global(.blk:not(.on)) .bad input { border-color: transparent; border-bottom: 2px solid var(--danger); }
  :global(.blk:not(.on)) label { color: var(--muted); font-weight: 400; }

  @media (pointer: coarse) { input { min-height: 2.75rem; } .remove { inline-size: 2.75rem; block-size: 2.75rem; } .add, .undo { min-block-size: 2.75rem; } }
  @media (max-width: 47.99rem) { input { font-size: 1rem; } .num { flex-basis: 100%; } }
</style>
