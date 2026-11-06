// Mounts the workspace from an external script: Astro's own island loader is inline, which the site's CSP
// (script-src 'self') forbids. The page renders the component statically and this script hydrates it.
import { hydrate } from 'svelte';
import XRechnungWorkspace from './XRechnungWorkspace.svelte';

const root = document.getElementById('xr-root');
if (root) hydrate(XRechnungWorkspace, { target: root, props: { locale: root.dataset.locale === 'en' ? 'en' : 'de' } });
