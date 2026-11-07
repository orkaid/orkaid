<script lang="ts">
  import { copy, scopeLists } from '../../../i18n/xrechnung.ts';
  import type { Locale } from '../../../i18n/ui.ts';

  let { locale }: { locale: Locale } = $props();
  const groups = [
    { key: 'now', title: 'scope.nowTitle' },
    { key: 'core', title: 'scope.coreTitle' },
    { key: 'out', title: 'scope.outTitle' },
  ] as const;
</script>

<details class="scope">
  <summary>{copy['scope.title'][locale]}</summary>
  <p class="lead">{copy['scope.summary'][locale]}</p>
  {#each groups as group (group.key)}
    <h3>{copy[group.title][locale]}</h3>
    <ul>{#each scopeLists[group.key][locale] as item (item)}<li>{item}</li>{/each}</ul>
  {/each}
  <p class="disclaimer">{copy['scope.disclaimer'][locale]}</p>
</details>

<style>
  .scope { border: 1px solid var(--rule); padding: 0.375rem 0.75rem; font-size: 0.875rem; }
  summary { cursor: pointer; font: 500 0.875rem/1.5 var(--sans); }
  .lead { margin: 0.5rem 0 0; max-inline-size: 70ch; }
  h3 { margin: 0.75rem 0 0.25rem; font: 500 0.8125rem/1.3 var(--mono); }
  ul { margin: 0; padding-inline-start: 1.25rem; max-inline-size: 70ch; }
  .disclaimer { margin: 0.75rem 0 0.25rem; max-inline-size: 70ch; color: var(--muted); font-size: 0.8125rem; }
</style>
