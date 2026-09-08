<script lang="ts">
  let { locale }: { locale: 'de' | 'en' } = $props();
  let count = $state(0);
  let label = $derived(locale === 'de' ? 'Plattform-Hydrationsprüfung' : 'Platform hydration check');
</script>

<div class="proof">
  <button type="button" aria-label={label + ': ' + count} onclick={() => count += 1}>
    {label} · {count}
  </button>
  <p>
    {locale === 'de'
      ? 'Dieser Zähler prüft nur die Hydration der Plattform und ist keine Produktfunktion.'
      : 'This counter only checks platform hydration and is not a product feature.'}
  </p>
</div>

<style>
  .proof {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.75rem 1rem;
  }

  button {
    border: 1px solid var(--ink);
    background: transparent;
    color: var(--ink);
    cursor: pointer;
    font: 500 0.75rem/1.4 var(--mono);
    padding: 0.75rem 1rem;
  }

  p {
    max-width: 48ch;
    margin: 0;
    color: var(--muted);
    font-size: 0.85rem;
  }
</style>
