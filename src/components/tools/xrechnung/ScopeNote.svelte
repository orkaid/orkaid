<script lang="ts">
  // Two independent disclosures (what works / what does not yet), with the same list content as before.
  import { copy, scopeLists } from '../../../i18n/xrechnung.ts';
  import type { Locale } from '../../../i18n/ui.ts';

  let { locale }: { locale: Locale } = $props();
  const cannot = [
    { key: 'core', title: copy['sheet.scopeBuilt'] },
    { key: 'out', title: copy['sheet.scopeOut'] },
    { key: 'tool', title: copy['sheet.scopeTool'] },
  ] as const;
  // A group with nothing in it is not shown (the "prepared in the core" group is empty once every capability is operable).
  const groups = cannot.filter((group) => scopeLists[group.key][locale].length > 0);
</script>

<div class="scope">
  <details>
    <summary>{copy['sheet.scopeCan'][locale]}</summary>
    <ul>{#each scopeLists.now[locale] as item (item)}<li>{item}</li>{/each}</ul>
  </details>
  <details>
    <summary>{copy['sheet.scopeCannot'][locale]}</summary>
    <p class="lead">{copy['sheet.scopeCannotLead'][locale]}</p>
    {#each groups as group (group.key)}
      <h3>{group.title[locale]}</h3>
      <ul>{#each scopeLists[group.key][locale] as item (item)}<li>{item}</li>{/each}</ul>
    {/each}
    <p class="disclaimer">{copy['scope.disclaimer'][locale]}</p>
  </details>
</div>

<style>
  .scope { display: grid; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); gap: 0.5rem; align-items: start; font-size: 0.875rem; }
  details { border: 1px solid var(--rule); padding: 0.375rem 0.75rem; }
  summary { cursor: pointer; min-block-size: 1.5rem; font: 500 0.875rem/1.5 var(--sans); }
  .lead { margin: 0.5rem 0 0; max-inline-size: 70ch; }
  h3 { margin: 0.75rem 0 0.25rem; font: 500 0.8125rem/1.3 var(--sans); }
  ul { margin: 0.375rem 0 0.25rem; padding-inline-start: 1.25rem; max-inline-size: 70ch; }
  .disclaimer { margin: 0.75rem 0 0.25rem; max-inline-size: 70ch; color: var(--muted); font-size: 0.8125rem; }
  @media (pointer: coarse) { summary { min-block-size: 2.75rem; display: flex; align-items: center; } }
</style>
