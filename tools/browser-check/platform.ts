// Browser checks for the platform shell (PR-07 to PR-16). Development and testing only, like rechnungsblatt.ts: it needs a
// local Chrome or Chromium and is NOT part of `npm test`.
//
//   npm run build && node tools/browser-check/platform.ts        (ORKAID_CHROME=/path/to/chrome to choose the browser)
//
// Serves dist/ with the global block of public/_headers (the production CSP included) and measures the rendered pages with
// the real fonts: heading line breaks, overflow, header geometry, navigation state, the narrow command bar, footer clearance
// with hit-testing, and the leave guard. Fails on any console error, page exception or CSP report. No dependency.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const DIST = join(ROOT, 'dist');
if (!existsSync(join(DIST, 'tools/xrechnung/index.html'))) throw new Error('build first: npm run build');

const headerLines = readFileSync(join(ROOT, 'public/_headers'), 'utf8').split('\n');
const headers: Record<string, string> = {};
for (const line of headerLines.slice(headerLines.indexOf('/*') + 1)) {
  if (!/^\s+\S/.test(line)) break;
  const at = line.indexOf(':');
  headers[line.slice(0, at).trim()] = line.slice(at + 1).trim();
}
if (!headers['Content-Security-Policy']?.includes("script-src 'self'")) throw new Error('no strict CSP found in public/_headers');
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.xml': 'application/xml', '.txt': 'text/plain' };
const requests: string[] = [];
const server = createServer((request, response) => {
  requests.push(`${request.method} ${request.url}`);
  const path = normalize(decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(DIST, path);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  // Like Cloudflare Pages: an unknown path gets the root 404.html with status 404.
  if (!file.startsWith(DIST) || !existsSync(file)) { response.writeHead(404, { ...headers, 'Content-Type': TYPES['.html']! }); response.end(readFileSync(join(DIST, '404.html'))); return; }
  response.writeHead(200, { ...headers, 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
  response.end(readFileSync(file));
});
await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
const address = server.address();
if (address === null || typeof address === 'string') throw new Error('no server port');
const ORIGIN = `http://127.0.0.1:${address.port}`;

const profile = mkdtempSync(join(tmpdir(), 'orkaid-platform-check-'));
const chrome = spawn(process.env.ORKAID_CHROME ?? 'google-chrome', ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank'], { stdio: 'ignore' });
let port: string | undefined;
for (let i = 0; i < 100 && port === undefined; i++) {
  await sleep(100);
  const file = join(profile, 'DevToolsActivePort');
  if (existsSync(file)) port = readFileSync(file, 'utf8').split('\n')[0];
}
if (port === undefined) throw new Error('the browser did not start');
const target = (await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json()) as { webSocketDebuggerUrl: string };
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((done, fail) => { socket.onopen = done; socket.onerror = fail; });
let nextId = 0;
const pending = new Map<number, { done: (value: unknown) => void; fail: (error: Error) => void }>();
const listeners: ((method: string, params: Record<string, unknown>) => void)[] = [];
socket.onmessage = (message) => {
  const data = JSON.parse(String(message.data)) as { id?: number; result?: unknown; error?: { message: string }; method?: string; params?: Record<string, unknown> };
  if (data.id !== undefined) {
    const call = pending.get(data.id);
    pending.delete(data.id);
    if (data.error) call?.fail(new Error(data.error.message)); else call?.done(data.result);
  } else if (data.method) for (const listener of listeners) listener(data.method, data.params ?? {});
};
function cdp<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  const id = ++nextId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise<T>((done, fail) => pending.set(id, { done: done as (value: unknown) => void, fail }));
}
function sleep(ms: number): Promise<void> { return new Promise((done) => setTimeout(done, ms)); }

const pageErrors: string[] = [];
const beforeUnload: string[] = [];
listeners.push((method, params) => {
  if (method === 'Runtime.exceptionThrown') pageErrors.push(`exception: ${JSON.stringify(params).slice(0, 300)}`);
  if (method === 'Runtime.consoleAPICalled' && (params.type === 'error' || params.type === 'warning')) pageErrors.push(`console ${String(params.type)}: ${JSON.stringify(params.args).slice(0, 300)}`);
  if (method === 'Log.entryAdded') {
    const entry = params.entry as { level: string; text: string; url?: string };
    // The deliberate 404 navigations (PR-18) log their own document status; any other failed load still counts.
    const deliberate = entry.url !== undefined && /\/gibt-es-nicht\/$/.test(entry.url) && entry.text.includes('status of 404');
    if ((entry.level === 'error' || entry.level === 'warning') && !deliberate) pageErrors.push(`log ${entry.level}: ${entry.text} ${entry.url ?? ''}`);
  }
  // A beforeunload prompt is recorded and confirmed, so a deliberate reload never hangs the run.
  if (method === 'Page.javascriptDialogOpening') { beforeUnload.push(String(params.type)); void cdp('Page.handleJavaScriptDialog', { accept: true }); }
});
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Log.enable');
await cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
await cdp('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => undefined);

async function viewport(width: number, height = width < 800 ? 844 : 900): Promise<void> {
  const mobile = width < 800;
  await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: mobile });
  for (let i = 0; i < 40 && (await page<number>('innerWidth').catch(() => -1)) !== width; i++) await sleep(50);
  await settle();
}
async function settle(): Promise<void> {
  await page('document.fonts.ready.then(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))').catch(() => undefined);
  await sleep(120);
}
async function open(path: string): Promise<void> {
  const loaded = new Promise<void>((done) => { const listener = (method: string) => { if (method === 'Page.loadEventFired') { listeners.splice(listeners.indexOf(listener), 1); done(); } }; listeners.push(listener); });
  await cdp('Page.navigate', { url: `${ORIGIN}${path}` });
  await loaded;
  if (path.includes('/tools/xrechnung/')) for (let i = 0; i < 50 && !(await page<boolean>('!!document.getElementById("lines[0].name")')); i++) await sleep(50);
  await page(HELPERS);
  await settle();
}
async function page<T>(expression: string): Promise<T> {
  const result = await cdp<{ result: { value: T }; exceptionDetails?: unknown }>('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(`page script failed: ${JSON.stringify(result.exceptionDetails).slice(0, 400)}`);
  return result.result.value;
}
async function press(key: 'Tab' | 'Escape' | 'Enter', shift = false): Promise<void> {
  const k = { Tab: { code: 'Tab', keyCode: 9 }, Escape: { code: 'Escape', keyCode: 27 }, Enter: { code: 'Enter', keyCode: 13, text: '\r' } }[key];
  const base = { key, code: k.code, windowsVirtualKeyCode: k.keyCode, nativeVirtualKeyCode: k.keyCode, modifiers: shift ? 8 : 0 };
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...('text' in k ? { text: k.text } : {}) });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  await sleep(120);
}
async function clickAt(x: number, y: number): Promise<void> {
  for (const type of ['mousePressed', 'mouseReleased']) await cdp('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  await sleep(150);
}

const HELPERS = `
window.__r = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; };
window.__set = (id, value) => {
  const el = document.getElementById(id);
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  el.dispatchEvent(new Event('blur'));
};
window.__fill = async () => {
  const fields = ${JSON.stringify({
    invoiceNumber: 'PF-CHECK-1', issueDate: '10.11.2026', deliveryDate: '31.10.2026', buyerReference: 'Kostenstelle 4410',
    'seller.name': 'Musterwerk Beratung GmbH', 'seller.address.street': 'Beispielstraße 12', 'seller.address.postCode': '50667', 'seller.address.city': 'Köln',
    'seller.electronicAddress.schemeId': 'EM', 'seller.electronicAddress.value': 'rechnung@musterwerk.example',
    'seller.contact.name': 'Erika Mustermann', 'seller.contact.telephone': '+49 221 5550100', 'seller.contact.email': 'erika.mustermann@musterwerk.example', 'seller.vatId': 'DE123456789',
    'buyer.name': 'Beispiel Handel AG', 'buyer.address.street': 'Musterallee 5', 'buyer.address.postCode': '20095', 'buyer.address.city': 'Hamburg',
    'buyer.electronicAddress.schemeId': 'EM', 'buyer.electronicAddress.value': 'eingang@beispiel-handel.example',
    'payment.means.code': '58', 'payment.means.account.id.value': 'DE89370400440532013000', 'payment.dueDate': '24.11.2026',
    'lines[0].name': 'Beratung', 'lines[0].unitCode': 'HUR', 'lines[0].quantity': '8', 'lines[0].unitPrice': '120,00', 'lines[0].vat.rate': '19',
  })};
  for (const [id, value] of Object.entries(fields)) window.__set(id, value);
  await new Promise((done) => setTimeout(done, 80));
};
// Every line break inside a heading must fall at a space, a soft hyphen or a hyphen; returns the offending breaks.
window.__breaks = (el) => {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  const chars = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    // A <br> is a deliberate line break; it counts as a break opportunity like a space.
    if (node.nodeType === 1) { if (node.tagName === 'BR') chars.push({ c: '\\n', top: null }); continue; }
    for (let i = 0; i < node.data.length; i++) {
    const range = document.createRange(); range.setStart(node, i); range.setEnd(node, i + 1);
    // A character right after a taken soft hyphen also reports the hyphen glyph on the line above; its own box is the last one.
    const rect = [...range.getClientRects()].filter((r) => r.width > 0).at(-1);
    chars.push({ c: node.data[i], top: rect ? Math.round(rect.top) : null });
    }
  }
  const visible = chars.filter((c) => c.top !== null);
  const bad = []; let lines = 1;
  for (let i = 1; i < chars.length; i++) {
    if (chars[i].top === null) continue;
    let j = i - 1; while (j >= 0 && chars[j].top === null) j--;
    if (j < 0 || chars[i].top <= chars[j].top) continue;
    lines++;
    const before = chars.slice(j, i).map((c) => c.c).join('');
    if (!/[\\s\\u00ad-]/.test(before)) bad.push(chars.slice(Math.max(0, j - 6), j + 1).map((c) => c.c).join('') + '|' + chars.slice(i, i + 6).map((c) => c.c).join(''));
  }
  return { lines, bad, chars: visible.length };
};
window.__clip = (el) => el.scrollWidth - el.clientWidth;
window.__hit = (el) => { const r = el.getBoundingClientRect(); const x = r.left + Math.min(r.width / 2, 24), y = r.top + r.height / 2; const at = document.elementFromPoint(x, y); return !!at && (el === at || el.contains(at)); };
`;

const failures: string[] = [];
const passes: string[] = [];
function expect(name: string, ok: boolean, detail: unknown): void {
  (ok ? passes : failures).push(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` — ${JSON.stringify(detail)}`}`);
}
const WIDTHS = [1920, 1440, 1024, 820, 768, 720, 390, 320];
const GUIDES = ['/knowledge/e-rechnung/', '/knowledge/xrechnung-erstellen/', '/knowledge/xrechnung-pruefen/'];
const PAGES = ['/', '/tools/', '/knowledge/', ...GUIDES, '/impressum/', '/datenschutz/', '/tools/xrechnung/'];
const prefix = (locale: string) => (locale === 'en' ? '/en' : '');

// ------------------------------------------------------------------ PR-07/08/09/10/12/14: every page, both locales, every width
for (const locale of ['de', 'en']) {
  for (const width of WIDTHS) {
    await viewport(width);
    for (const path of PAGES) {
      await open(prefix(locale) + path);
      const tag = `${locale} ${path} ${width}px`;
      const m = await page<{ overflow: number; breaks: { lines: number; bad: string[] }; h1clip: number; fonts: string[]; brand: { link: { l: number; r: number; w: number }; img: { l: number; w: number }; content: number }; header: { name: string; r: { l: number; r: number; t: number; b: number } }[]; current: string[]; section: string[] }>(`(() => {
        const h1 = document.querySelector('main h1');
        const brand = document.querySelector('.brand'), img = brand.querySelector('img'), main = document.querySelector('.site-main');
        const parts = [['brand', '.brand img'], ['nav', '.site-nav'], ['lang', '.lang-switch ul'], ['desc', '.brand-descriptor']].map(([name, sel]) => ({ name, r: __r(document.querySelector(sel)) }));
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          breaks: __breaks(h1), h1clip: __clip(h1),
          fonts: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family + ' ' + f.weight),
          brand: { link: __r(brand), img: __r(img), content: main.getBoundingClientRect().left },
          header: parts,
          current: [...document.querySelectorAll('[aria-current="page"]')].map((a) => a.getAttribute('href') ?? a.textContent.trim()),
          section: [...document.querySelectorAll('.site-nav .is-section')].map((a) => a.getAttribute('href')),
        };
      })()`);
      expect(`${tag} no horizontal overflow`, m.overflow <= 0, m.overflow);
      expect(`${tag} h1 breaks only at spaces or soft hyphens, not clipped`, m.breaks.bad.length === 0 && m.h1clip <= 0, m.breaks);
      if (path === '/datenschutz/' && locale === 'de' && width >= 720) expect(`${tag} Datenschutzerklärung stays one word on one line`, m.breaks.lines === 1, m.breaks);
      if (width === 1440 && path === '/') expect(`${tag} the brand fonts are loaded`, ['Source Serif 4', 'IBM Plex Sans', 'IBM Plex Mono'].every((f) => m.fonts.some((x) => x.startsWith(f))), m.fonts);
      // PR-09: the link hugs the image; the visible mark (65 of 600 px in) meets the content edge within 2 px.
      const mark = m.brand.img.l + (65 / 600) * m.brand.img.w;
      expect(`${tag} logo link hugs the image and the mark aligns with the content edge`, Math.abs(m.brand.link.w - m.brand.img.w) <= 1 && Math.abs(mark - m.brand.content) <= 2, { ...m.brand, mark });
      const overlap = m.header.flatMap((a, i) => m.header.slice(i + 1).filter((b) => a.r.l < b.r.r - 0.5 && b.r.l < a.r.r - 0.5 && a.r.t < b.r.b - 0.5 && b.r.t < a.r.b - 0.5).map((b) => `${a.name}/${b.name}`));
      expect(`${tag} header parts do not overlap and stay inside the viewport`, overlap.length === 0 && m.header.every((p) => p.r.r <= width + 0.5 && p.r.l >= -0.5 - (p.name === 'brand' ? 20 : 0)), { overlap, header: m.header });
      const exact = path === '/' ? '/' : prefix(locale) + path;
      const expectedCurrent = path === '/tools/xrechnung/' || GUIDES.includes(path) ? [] : [path === '/' ? prefix(locale) + '/' : exact];
      expect(`${tag} aria-current="page" only on links to this page`, m.current.filter((h) => h.startsWith('/')).every((h) => h === (path === '/' ? prefix(locale) + '/' : exact)) && expectedCurrent.every((h) => m.current.includes(h)), m.current);
      const section = path === '/tools/xrechnung/' ? '/tools/' : GUIDES.includes(path) ? '/knowledge/' : null;
      expect(`${tag} parent section marked only below it`, section ? m.section.length === 1 && m.section[0] === prefix(locale) + section : m.section.length === 0, m.section);
    }
  }
}

// PR-08: eyebrow and lead keep their own type; the lead stands clear of the heading.
for (const locale of ['de', 'en']) for (const width of [1440, 390]) {
  await viewport(width);
  await open(prefix(locale) + '/tools/');
  const t = await page<{ eyebrow: number; lead: number; gap: number }>(`(() => { const e = document.querySelector('.page-head .eyebrow'), h = document.querySelector('.page-head h1'), l = document.querySelector('.page-head .lead'); return { eyebrow: parseFloat(getComputedStyle(e).fontSize), lead: parseFloat(getComputedStyle(l).fontSize), gap: l.getBoundingClientRect().top - h.getBoundingClientRect().bottom }; })()`);
  expect(`${locale} /tools/ ${width}px eyebrow 12 px label, lead larger, gap ≥ 12 px`, t.eyebrow === 12 && t.lead > t.eyebrow && t.gap >= 12, t);
}

// PR-12: header stays compact; primary navigation targets are at least 44 px high.
for (const width of [1440, 390]) {
  await viewport(width);
  await open('/');
  const h = await page<{ header: number; nav: number[] }>(`({ header: document.querySelector('.site-header').getBoundingClientRect().height, nav: [...document.querySelectorAll('.nav-primary a, .nav-secondary a')].map((a) => a.getBoundingClientRect().height) })`);
  // Budget: one row on desktop; on phones three short rows (the M3 header measured about 200 px at 320 px).
  expect(`de / ${width}px header height (${Math.round(h.header)} px) within budget and nav targets ≥ 44 px`, h.header <= (width > 800 ? 80 : 150) && h.nav.every((x) => x >= 44), h);
}

// Keyboard: skip link first, then the logo, with a visible focus box that hugs the logo.
await viewport(1440);
await open('/tools/');
await press('Tab');
const skip = await page<{ cls: string; visible: boolean }>(`({ cls: document.activeElement.className, visible: document.activeElement.getBoundingClientRect().top >= 0 })`);
await press('Tab');
const logo = await page<{ cls: string; w: number; outline: string }>(`({ cls: document.activeElement.className, w: document.activeElement.getBoundingClientRect().width, outline: getComputedStyle(document.activeElement).outlineStyle })`);
expect('de keyboard: skip link, then the logo; focus box hugs the logo', skip.cls === 'skip-link' && skip.visible && logo.cls === 'brand' && logo.w < 160 && logo.outline !== 'none', { skip, logo });

// ------------------------------------------------------------------ PR-15/16: narrow command bar and footer clearance
type Bar = { status: { l: number; r: number; t: number; b: number }; next: { l: number; r: number; t: number; b: number }; menu: { l: number; r: number; t: number; b: number }; statusClip: number; nextClip: number; menuClip: number; fixed: boolean };
const barState = () => page<Bar>(`(() => { const s = document.querySelector('.bar-status'), n = document.querySelector('.act.next'), m = document.querySelector('.act.menu'); return { status: __r(s), next: __r(n), menu: __r(m), statusClip: __clip(s), nextClip: __clip(n), menuClip: __clip(m), fixed: getComputedStyle(document.querySelector('.bar')).position === 'fixed' }; })()`);
const disjoint = (a: { l: number; r: number; t: number; b: number }, b: { l: number; r: number; t: number; b: number }) => a.r <= b.l + 0.5 || b.r <= a.l + 0.5 || a.b <= b.t + 0.5 || b.b <= a.t + 0.5;
for (const locale of ['de', 'en']) {
  for (const width of [320, 360, 390, 480, 575, 576, 640, 720, 767]) {
    await viewport(width);
    await open(prefix(locale) + '/tools/xrechnung/');
    for (const state of ['initial', 'edited', 'invalid', 'validated', 'menu']) {
      if (state === 'edited') await page(`__set('invoiceNumber', 'PF-1')`);
      if (state === 'invalid') await page(`__set('payment.means.account.id.value', 'DE00'), document.querySelector('.bar-actions .act.check').click()`);
      if (state === 'validated') await page(`__fill().then(() => document.querySelector('.bar-actions .act.check').click())`);
      if (state === 'menu') await page(`document.querySelector('.act.menu').click()`);
      await settle();
      const tag = `${locale} tool ${width}px ${state}`;
      const b = await barState();
      const inside = [b.status, b.next, b.menu].every((r) => r.l >= -0.5 && r.r <= width + 0.5);
      expect(`${tag} bar: status and both actions visible, inside the viewport, not overlapping, not clipped`, b.fixed && inside && disjoint(b.status, b.next) && disjoint(b.status, b.menu) && disjoint(b.next, b.menu) && b.statusClip <= 1 && b.nextClip <= 1 && b.menuClip <= 1, b);
      if (state === 'menu') {
        const drawer = await page<{ actions: { l: number; r: number }[]; open: string | null }>(`({ actions: [...document.querySelectorAll('.bar-actions .act')].map(__r), open: document.querySelector('.act.menu').getAttribute('aria-expanded') })`);
        expect(`${tag} export drawer: check and both export actions inside the viewport`, drawer.open === 'true' && drawer.actions.length === 3 && drawer.actions.every((r) => r.l >= -0.5 && r.r <= width + 0.5), drawer);
      }
      // Footer at maximum scroll: every link and the disclaimer stand ≥ 8 px above the bar and receive the click themselves.
      await page(`window.scrollTo(0, document.documentElement.scrollHeight)`);
      await settle();
      const f = await page<{ barTop: number; items: { t: string; top: number; b: number; hit: boolean }[] }>(`({ barTop: document.querySelector('.bar').getBoundingClientRect().top, items: [...document.querySelectorAll('.site-footer a, .site-footer .footer-disclaimer')].map((el) => ({ t: el.textContent.trim().slice(0, 24), top: el.getBoundingClientRect().top, b: el.getBoundingClientRect().bottom, hit: __hit(el) })) })`);
      // With the drawer open (up to 70vh) the top of the footer may sit above the viewport, reachable by scrolling; nothing may sit under the bar.
      const shown = f.items.filter((i) => i.top >= 0);
      expect(`${tag} footer at max scroll: all ${f.items.length} links and the disclaimer clear the bar by ≥ 8 px; those on screen are hit-testable`, f.items.length >= 10 && f.items.every((i) => i.b <= f.barTop - 8) && shown.every((i) => i.hit) && (state === 'menu' || shown.length === f.items.length), f);
      if (state === 'menu') await page(`document.querySelector('.act.menu').click()`);
    }
    if (width === 390) {
      // Keyboard and real pointer: the last footer link (the language link) is focusable unobscured, and a real click activates it.
      await open(prefix(locale) + '/tools/xrechnung/');
      await page(`window.scrollTo(0, document.documentElement.scrollHeight)`);
      await page(`document.querySelector('.footer-base a').focus()`);
      await settle();
      const k = await page<{ b: number; barTop: number; visible: string }>(`({ b: document.activeElement.getBoundingClientRect().bottom, barTop: document.querySelector('.bar').getBoundingClientRect().top, visible: getComputedStyle(document.activeElement).outlineStyle })`);
      expect(`${locale} tool 390px keyboard focus on the footer language link is above the bar`, k.b <= k.barTop - 8, k);
      const target = await page<{ x: number; y: number; href: string }>(`(() => { const a = document.querySelector('.site-footer nav a[href$="/impressum/"]'); const r = a.getBoundingClientRect(); return { x: r.left + 10, y: r.top + r.height / 2, href: a.href }; })()`);
      const navigated = new Promise<void>((done) => { const listener = (method: string) => { if (method === 'Page.loadEventFired') { listeners.splice(listeners.indexOf(listener), 1); done(); } }; listeners.push(listener); });
      await clickAt(target.x, target.y);
      await Promise.race([navigated, sleep(3000)]);
      expect(`${locale} tool 390px a real click on the footer Impressum link navigates (pristine form)`, (await page<string>('location.href')) === target.href, { target });
    }
  }
}

// ------------------------------------------------------------------ PR-11: leave guard
const dialogState = () => page<{ open: boolean; focus: string; language: boolean; url: string }>(`(() => { const d = document.querySelector('dialog.leave-dialog'); return { open: !!d?.open, focus: document.activeElement?.className ?? '', language: !!d && !d.querySelector('p:nth-of-type(2)').hidden, url: location.pathname }; })()`);
const dirtyAttr = () => page<string | null>(`document.querySelector('form.desk').getAttribute('data-dirty')`);
for (const locale of ['de', 'en']) {
  const tool = prefix(locale) + '/tools/xrechnung/';
  const other = (locale === 'de' ? '/en' : '') + '/tools/xrechnung/';
  await viewport(1440);

  // Pristine: navigation is not interrupted.
  await open(tool);
  beforeUnload.length = 0;
  await page(`document.querySelector('.lang-switch a').click()`);
  await sleep(600);
  expect(`${locale} guard: pristine form, the language switch navigates without a dialog or prompt`, (await page<string>('location.pathname')) === other && beforeUnload.length === 0, { url: await page<string>('location.pathname'), beforeUnload });

  // Each mutation path marks the document dirty: text, a new line, the document type, a removed line after an addition.
  await open(tool);
  const paths: [string, string][] = [
    ['text input', `__set('seller.name', 'Musterwerk')`],
    ['adding a line', `document.querySelector('button.add').click()`],
    ['document type', `document.getElementById('documentType.381').click()`],
    ['payment select', `__set('payment.means.code', '30')`],
  ];
  for (const [name, action] of paths) {
    await open(tool);
    const before = await dirtyAttr();
    await page(action);
    await settle();
    expect(`${locale} guard: ${name} marks the form dirty`, before === 'false' && (await dirtyAttr()) === 'true', { before, after: await dirtyAttr() });
  }
  await open(tool);
  await page(`__set('seller.name', 'x')`); await page(`__set('seller.name', '')`); await settle();
  expect(`${locale} guard: undoing the only change returns to pristine`, (await dirtyAttr()) === 'false', await dirtyAttr());

  // Dirty: the language switch asks; Escape and Stay keep URL, value and focus; the language note is shown.
  await open(tool);
  await page(`__set('seller.name', 'Musterwerk Beratung GmbH')`);
  await settle();
  await page(`document.querySelector('.lang-switch a').focus()`);
  await press('Enter');
  await settle();
  const asked = await dialogState();
  expect(`${locale} guard: dirty form, the language switch opens the dialog with focus on Stay and the language note`, asked.open && asked.focus === 'leave-stay' && asked.language && asked.url === tool, asked);
  await press('Escape');
  await settle();
  const esc = await page<{ open: boolean; url: string; value: string; focus: string }>(`({ open: document.querySelector('dialog.leave-dialog').open, url: location.pathname, value: document.getElementById('seller.name').value, focus: document.activeElement.getAttribute('href') ?? '' })`);
  expect(`${locale} guard: Escape keeps the page, the value and returns focus to the language link`, !esc.open && esc.url === tool && esc.value === 'Musterwerk Beratung GmbH' && esc.focus === other, esc);

  // Internal navigation (header Tools, footer legal) asks without the language note; Stay keeps everything.
  for (const selector of ['.nav-primary a', '.site-footer nav a[href$="/datenschutz/"]']) {
    await page(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await settle();
    const s = await dialogState();
    expect(`${locale} guard: ${selector} asks first, without the language note`, s.open && !s.language && s.focus === 'leave-stay', s);
    await page(`document.querySelector('.leave-stay').click()`);
    await settle();
    expect(`${locale} guard: Stay after ${selector} keeps the page`, (await page<string>('location.pathname')) === tool && !(await dialogState()).open, await dialogState());
  }

  // External same-tab navigation asks too; new-tab links (target=_blank) and mailto do not.
  const external = await page<boolean>(`(() => { const a = Object.assign(document.createElement('a'), { href: 'https://example.invalid/' }); document.body.append(a); a.click(); a.remove(); return document.querySelector('dialog.leave-dialog').open; })()`);
  await page(`document.querySelector('dialog.leave-dialog').close()`);
  const blank = await page<{ dialog: boolean; prevented: boolean }>(`(() => { const a = Object.assign(document.createElement('a'), { href: '/tools/', target: '_blank' }); document.body.append(a); let prevented = null; document.addEventListener('click', (e) => { prevented = e.defaultPrevented; e.preventDefault(); }, { once: true }); a.click(); a.remove(); return { dialog: document.querySelector('dialog.leave-dialog').open, prevented }; })()`);
  const mail = await page<boolean>(`(() => { const a = document.querySelector('a[href^="mailto:"]'); let prevented = null; document.addEventListener('click', (e) => { prevented = e.defaultPrevented; e.preventDefault(); }, { once: true }); a.click(); return document.querySelector('dialog.leave-dialog').open || prevented; })()`);
  expect(`${locale} guard: same-tab external link asks; new-tab and mailto links are left alone`, external && !blank.dialog && !blank.prevented && !mail, { external, blank, mail });

  // An export is not a save: after a real export the form stays dirty, the download link is not intercepted.
  await open(tool);
  await page(`__fill()`);
  await page(`document.querySelector('.bar-actions .act.check').click()`);
  await settle();
  await page(`document.querySelectorAll('.bar-actions .act.primary')[0].click()`);
  await settle();
  const afterExport = await page<{ dialog: boolean; dirty: string | null; note: string }>(`({ dialog: document.querySelector('dialog.leave-dialog').open, dirty: document.querySelector('form.desk').getAttribute('data-dirty'), note: document.querySelector('.bar-note')?.textContent.trim() ?? '' })`);
  expect(`${locale} guard: an export downloads without a dialog and the form stays protected`, !afterExport.dialog && afterExport.dirty === 'true' && afterExport.note.length > 0, afterExport);

  // Reload while dirty raises the browser's beforeunload prompt; after a pristine load it does not. Browsers allow the prompt
  // only after a user gesture, so a real pointer click on a field comes first (the scripted entry above is not one).
  const field = await page<{ x: number; y: number }>(`(() => { const el = document.getElementById('seller.name'); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + 10, y: r.top + r.height / 2 }; })()`);
  await clickAt(field.x, field.y);
  beforeUnload.length = 0;
  const reloaded = new Promise<void>((done) => { const listener = (method: string) => { if (method === 'Page.loadEventFired') { listeners.splice(listeners.indexOf(listener), 1); done(); } }; listeners.push(listener); });
  await cdp('Page.reload');
  await Promise.race([reloaded, sleep(4000)]);
  await sleep(300);
  expect(`${locale} guard: reload of a dirty form raises the beforeunload prompt`, beforeUnload.includes('beforeunload'), beforeUnload);
  await page(HELPERS);
  for (let i = 0; i < 50 && !(await page<boolean>('!!document.getElementById("lines[0].name")')); i++) await sleep(50);
  expect(`${locale} guard: nothing survives the reload (no persistence)`, (await page<string>(`document.getElementById('seller.name').value`)) === '' && (await dirtyAttr()) === 'false', await dirtyAttr());

  // Confirmed departure: the other locale opens with an empty form (no cross-locale transfer).
  await page(`__set('seller.name', 'Musterwerk Beratung GmbH')`);
  await settle();
  await page(`document.querySelector('.lang-switch a').click()`);
  await settle();
  beforeUnload.length = 0;
  const left = new Promise<void>((done) => { const listener = (method: string) => { if (method === 'Page.loadEventFired') { listeners.splice(listeners.indexOf(listener), 1); done(); } }; listeners.push(listener); });
  await page(`document.querySelector('.leave-go').click()`);
  await Promise.race([left, sleep(4000)]);
  for (let i = 0; i < 50 && !(await page<boolean>('!!document.getElementById("seller.name")')); i++) await sleep(50);
  const arrived = await page<{ url: string; value: string; storage: number }>(`({ url: location.pathname, value: document.getElementById('seller.name').value, storage: localStorage.length + sessionStorage.length })`);
  expect(`${locale} guard: Leave goes to the other locale with an empty form, no second prompt, no storage`, arrived.url === other && arrived.value === '' && arrived.storage === 0 && beforeUnload.length === 0, { arrived, beforeUnload });
}

// PR-18: unknown paths in both locales and a mistyped tool path get the recovery page with status 404; it reads well at every width.
for (const path of ['/gibt-es-nicht/', '/en/does-not-exist/', '/tools/xrechnung-tippfehler/']) {
  const response = await fetch(ORIGIN + path);
  const body = await response.text();
  expect(`404 ${path}: status 404 with the recovery page`, response.status === 404 && body.includes('Seite nicht gefunden') && body.includes('Page not found'), response.status);
}
for (const width of WIDTHS) {
  await viewport(width);
  await open('/gibt-es-nicht/');
  const n = await page<{ overflow: number; breaks: { bad: string[] }; links: number; current: number; title: string; jump: boolean; headsAligned: boolean }>(`({ overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, breaks: __breaks(document.querySelector('main h1')), links: [...document.querySelectorAll('main section a')].filter((a) => a.getBoundingClientRect().height >= 44).length, jump: getComputedStyle(document.querySelector('.jump')).display !== 'none', headsAligned: Math.abs(document.getElementById('nf-de').getBoundingClientRect().top - document.getElementById('nf-en').getBoundingClientRect().top) <= 1, current: document.querySelectorAll('[aria-current="page"], .is-section').length, title: document.title })`);
  // Side by side the two headings align; stacked, a link at the top leads to the English section.
  expect(`404 page ${width}px: no overflow, clean heading breaks, 8 recovery links with 44 px targets, no current state, balanced or reachable English section`, n.overflow <= 0 && n.breaks.bad.length === 0 && n.links === 8 && n.current === 0 && (width > 832 ? n.headsAligned && !n.jump : n.jump), n);
}

// PR-11 follow-up: after a confirmed departure, a page restored from the back/forward cache must not show the dialog and must
// protect its still-dirty document again (beforeunload after a gesture). Chrome may flush the cache on some navigations, so the
// sequence is tried twice; if the page is never restored from the cache, the check fails rather than passing unverified.
{
  await viewport(1440);
  let result: { restored: boolean; dialogOpen?: boolean; dirty?: string; value?: string; prompt?: boolean; reason?: string } = { restored: false };
  for (let attempt = 0; attempt < 2 && !result.restored; attempt++) {
    await open('/tools/xrechnung/');
    await page(`window.__bfcacheMarker = 'kept'; 1`);
    const field = await page<{ x: number; y: number }>(`(() => { const el = document.getElementById('seller.name'); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + 10, y: r.top + r.height / 2 }; })()`);
    await clickAt(field.x, field.y);
    await cdp('Input.insertText', { text: 'Musterwerk' });
    await settle();
    await page(`document.querySelector('.lang-switch a').click()`);
    await settle();
    const arrived = new Promise<void>((done) => { const listener = (method: string) => { if (method === 'Page.loadEventFired') { listeners.splice(listeners.indexOf(listener), 1); done(); } }; listeners.push(listener); });
    await page(`document.querySelector('.leave-go').click()`);
    await Promise.race([arrived, sleep(4000)]);
    await sleep(300);
    const reasons: string[] = [];
    const reasonListener = (method: string, params: Record<string, unknown>) => { if (method === 'Page.backForwardCacheNotUsed') reasons.push(JSON.stringify((params.notRestoredExplanations as { reason: string }[] | undefined)?.map((e) => e.reason))); };
    listeners.push(reasonListener);
    const history = await cdp<{ currentIndex: number; entries: { id: number }[] }>('Page.getNavigationHistory');
    await cdp('Page.navigateToHistoryEntry', { entryId: history.entries[history.currentIndex - 1]!.id });
    await sleep(1500);
    listeners.splice(listeners.indexOf(reasonListener), 1);
    const restored = (await page<string | null>('window.__bfcacheMarker ?? null')) === 'kept';
    if (!restored) { result = { restored, reason: reasons.join(' ') }; continue; }
    const state = await page<{ dialogOpen: boolean; dirty: string; value: string }>(`({ dialogOpen: document.querySelector('dialog.leave-dialog').open, dirty: document.querySelector('form.desk').getAttribute('data-dirty'), value: document.getElementById('seller.name').value })`);
    const again = await page<{ x: number; y: number }>(`(() => { const el = document.getElementById('seller.name'); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + 10, y: r.top + r.height / 2 }; })()`);
    await clickAt(again.x, again.y);
    beforeUnload.length = 0;
    const reloaded = new Promise<void>((done) => { const listener = (method: string) => { if (method === 'Page.loadEventFired') { listeners.splice(listeners.indexOf(listener), 1); done(); } }; listeners.push(listener); });
    await cdp('Page.reload');
    await Promise.race([reloaded, sleep(4000)]);
    result = { restored, ...state, prompt: beforeUnload.includes('beforeunload') };
  }
  expect('de guard: page restored from the back/forward cache after a confirmed departure shows no dialog and protects its dirty document again', result.restored && result.dialogOpen === false && result.dirty === 'true' && result.value === 'Musterwerk' && result.prompt === true, result);
}

// No invoice data in any request: every request the server saw is a static GET; none carries the fictional values.
const leaked = requests.filter((line) => !line.startsWith('GET ') || /Musterwerk|PF-CHECK|DE89370400440532013000|Beratung/.test(decodeURIComponent(line)));
expect(`network: ${requests.length} requests, all static GETs without invoice data`, leaked.length === 0, leaked.slice(0, 5));
expect('no console error, page exception or CSP report', pageErrors.length === 0, pageErrors.slice(0, 5));

for (const line of [...passes, ...failures]) console.log(line);
console.log(`platform-check: ${passes.length} passed, ${failures.length} failed (${ORIGIN}, ${process.env.ORKAID_CHROME ?? 'google-chrome'})`);
socket.close();
chrome.kill();
server.close();
try { rmSync(profile, { recursive: true, force: true }); } catch { /* the browser may still hold files */ }
process.exit(failures.length === 0 ? 0 : 1);
