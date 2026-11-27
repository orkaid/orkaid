// PR-11: asks before a navigation would discard the in-memory invoice. External module, so the strict CSP holds.
// The dirty signal is the workspace's own: the form state differs from its empty state (form.desk[data-dirty]), which covers
// every mutation path (typing, lines, document type, programmatic changes). An export does not clear it: a downloaded XML
// file is not an editable copy of the form. Nothing is stored or transferred; leaving still discards the document.
import { copy } from '../../../i18n/xrechnung';

const root = document.getElementById('xr-root');
if (root) install(root, root.dataset.locale === 'en' ? 'en' : 'de');

function install(root: HTMLElement, locale: 'de' | 'en'): void {
  const dirty = () => root.querySelector('form.desk')?.getAttribute('data-dirty') === 'true';
  let leaving = false;
  // Reload, tab closure, typed URLs and history steps: only the browser's own generic prompt is possible there. Browsers show
  // it only after a user gesture on the page; without one there is nothing typed to lose and the request would just be refused.
  addEventListener('beforeunload', (event) => {
    if (dirty() && !leaving && (navigator.userActivation?.hasBeenActive ?? true)) event.preventDefault();
  });

  const dialog = document.createElement('dialog');
  dialog.className = 'leave-dialog';
  dialog.setAttribute('aria-labelledby', 'leave-title');
  dialog.setAttribute('aria-describedby', 'leave-body');
  const title = Object.assign(document.createElement('h2'), { id: 'leave-title', textContent: copy['leave.title'][locale] });
  const body = Object.assign(document.createElement('p'), { id: 'leave-body', textContent: copy['leave.body'][locale] });
  const language = Object.assign(document.createElement('p'), { textContent: copy['leave.language'][locale] });
  const actions = Object.assign(document.createElement('div'), { className: 'leave-actions' });
  const stay = Object.assign(document.createElement('button'), { type: 'button', className: 'leave-stay', textContent: copy['leave.stay'][locale] });
  const go = Object.assign(document.createElement('button'), { type: 'button', className: 'leave-go', textContent: copy['leave.go'][locale] });
  actions.append(stay, go);
  dialog.append(title, body, language, actions);
  document.body.append(dialog);

  let target: { url: string; link: HTMLAnchorElement } | undefined;
  stay.addEventListener('click', () => dialog.close());
  go.addEventListener('click', () => {
    if (!target) return;
    leaving = true;
    dialog.close(); // a page restored from the back/forward cache must not come back with the dialog open
    location.assign(target.url);
  });
  // Back/forward cache: the page returns with its document and script state; the departure it confirmed no longer applies.
  addEventListener('pageshow', (event) => {
    if (event.persisted) leaving = false;
  });
  // Stay, Escape or any other close keeps the document, the URL and puts focus back on the link that was activated.
  dialog.addEventListener('close', () => {
    if (!leaving && target) {
      const link = target.link;
      requestAnimationFrame(() => link.focus());
    }
  });

  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
    // The export's own download link, new-tab links and non-web schemes (mailto:, blob:) do not unload the page.
    if (!link || link.hasAttribute('download') || (link.target !== '' && link.target !== '_self') || !dirty()) return;
    const url = new URL(link.href, location.href);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    if (url.origin === location.origin && url.pathname === location.pathname && url.search === location.search && url.hash !== '') return;
    event.preventDefault();
    target = { url: url.href, link };
    language.hidden = !link.hasAttribute('data-locale-switch');
    dialog.showModal();
    stay.focus();
  });
}
