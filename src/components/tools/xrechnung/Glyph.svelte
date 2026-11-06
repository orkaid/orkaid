<script lang="ts">
  // Status glyphs are decoration only: the adjacent word carries the meaning (never colour or shape alone).
  type Kind = 'ok' | 'error' | 'incomplete' | 'pending' | 'info';
  let { kind }: { kind: Kind } = $props();
</script>

<svg class={`glyph ${kind}`} viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
  {#if kind === 'ok'}
    <circle cx="8" cy="8" r="7.25" class="fill" /><path d="M4.5 8.4l2.4 2.4 4.6-5" fill="none" class="stroke" />
  {:else if kind === 'error'}
    <circle cx="8" cy="8" r="7.25" class="fill" /><path d="M5.3 5.3l5.4 5.4M10.7 5.3l-5.4 5.4" fill="none" class="stroke" />
  {:else if kind === 'incomplete'}
    <circle cx="8" cy="8" r="7.25" class="ring" /><path d="M8 8V1.5A6.5 6.5 0 0 1 14.5 8z" class="pie" />
  {:else if kind === 'info'}
    <circle cx="8" cy="8" r="7.25" class="ring" /><path d="M8 7.2v4M8 4.6v.1" fill="none" class="stroke dark" />
  {:else}
    <circle cx="8" cy="8" r="7.25" class="ring" />
  {/if}
</svg>

<style>
  .glyph { flex: none; vertical-align: -0.2em; }
  .ring { fill: none; stroke: var(--ink); stroke-width: 1.5; }
  .stroke { stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; stroke: var(--ink); }
  .ok .fill { fill: var(--accent); }
  .error .fill { fill: var(--danger); }
  .error .stroke { stroke: var(--paper); }
  .pie { fill: var(--ink); }
</style>
