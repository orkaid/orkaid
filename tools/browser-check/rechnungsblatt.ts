// Browser regression checks for the Rechnungsblatt workspace (MDR-46, MDR-47). Development and testing only, like the KoSIT
// harness: it needs a local Chrome or Chromium, which does not belong to the repository, so it is NOT part of `npm test`.
//
//   npm run build && node tools/browser-check/rechnungsblatt.ts        (ORKAID_CHROME=/path/to/chrome to choose the browser)
//
// It serves dist/ with the global block of public/_headers (the production CSP included), drives a headless browser through
// the DevTools protocol with real key events where the check is about the keyboard, and fails on any console error, page
// exception or CSP report. It covers what source-level tests cannot: diagnostics actually rendered, focus after layout
// changes, Enter in line descriptions, block-to-block navigation and the line table inside its container at many widths.
// No dependency: Node's own http server, child_process and WebSocket.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const DIST = join(ROOT, 'dist');
if (!existsSync(join(DIST, 'tools/xrechnung/index.html'))) throw new Error('build first: npm run build');

// ---------------------------------------------------------------------------------------------- static server with CSP

const headerLines = readFileSync(join(ROOT, 'public/_headers'), 'utf8').split('\n');
const headers: Record<string, string> = {};
for (const line of headerLines.slice(headerLines.indexOf('/*') + 1)) {
  if (!/^\s+\S/.test(line)) break;
  const at = line.indexOf(':');
  headers[line.slice(0, at).trim()] = line.slice(at + 1).trim();
}
if (!headers['Content-Security-Policy']?.includes("script-src 'self'")) throw new Error('no strict CSP found in public/_headers');
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.xml': 'application/xml', '.txt': 'text/plain', '.ico': 'image/x-icon' };
const server = createServer((request, response) => {
  const path = normalize(decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(DIST, path);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!file.startsWith(DIST) || !existsSync(file)) { response.writeHead(404, headers); response.end('not found'); return; }
  response.writeHead(200, { ...headers, 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
  response.end(readFileSync(file));
});
await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
const address = server.address();
if (address === null || typeof address === 'string') throw new Error('no server port');
const ORIGIN = `http://127.0.0.1:${address.port}`;

// ---------------------------------------------------------------------------------------------- browser and protocol

const profile = mkdtempSync(join(tmpdir(), 'orkaid-browser-check-'));
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
listeners.push((method, params) => {
  if (method === 'Runtime.exceptionThrown') pageErrors.push(`exception: ${JSON.stringify(params).slice(0, 300)}`);
  if (method === 'Runtime.consoleAPICalled' && (params.type === 'error' || params.type === 'warning')) pageErrors.push(`console ${String(params.type)}: ${JSON.stringify(params.args).slice(0, 300)}`);
  if (method === 'Log.entryAdded') { const entry = params.entry as { level: string; text: string }; if (entry.level === 'error' || entry.level === 'warning') pageErrors.push(`log ${entry.level}: ${entry.text}`); }
});
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Log.enable');
// A headless page is not focused by default; without this, focus events and :focus behave as in a background window.
await cdp('Emulation.setFocusEmulationEnabled', { enabled: true });

async function viewport(width: number, mobile = false): Promise<void> {
  await cdp('Emulation.setDeviceMetricsOverride', { width, height: mobile ? 844 : 900, deviceScaleFactor: 1, mobile });
  // Wait until the page itself sees the new width (a headless page may apply it a frame later), then let handlers settle.
  for (let i = 0; i < 40 && (await page<number>('innerWidth').catch(() => -1)) !== width; i++) await sleep(50);
  await page('new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))').catch(() => undefined);
  await sleep(150);
}
async function open(path: string): Promise<void> {
  const loaded = new Promise<void>((done) => { const listener = (method: string) => { if (method === 'Page.loadEventFired') { listeners.splice(listeners.indexOf(listener), 1); done(); } }; listeners.push(listener); });
  await cdp('Page.navigate', { url: `${ORIGIN}${path}` });
  await loaded;
  for (let i = 0; i < 50 && !(await page<boolean>('!!document.querySelector(".sheet") && !!document.getElementById("lines[0].name")')); i++) await sleep(50);
  await page(PAGE_HELPERS);
}
async function page<T>(expression: string): Promise<T> {
  const result = await cdp<{ result: { value: T }; exceptionDetails?: unknown }>('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(`page script failed: ${JSON.stringify(result.exceptionDetails).slice(0, 400)}`);
  return result.result.value;
}
const KEYS: Record<string, { code: string; keyCode: number; text?: string }> = { Enter: { code: 'Enter', keyCode: 13, text: '\r' }, Tab: { code: 'Tab', keyCode: 9 }, F1: { code: 'F1', keyCode: 112 }, Escape: { code: 'Escape', keyCode: 27 } };
/** A real key press through the browser's input pipeline (not a page-dispatched event). `shift` sets the modifier. */
async function press(key: keyof typeof KEYS, shift = false): Promise<void> {
  const k = KEYS[key]!;
  const base = { key, code: k.code, windowsVirtualKeyCode: k.keyCode, nativeVirtualKeyCode: k.keyCode, modifiers: shift ? 8 : 0 };
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...(k.text && !shift ? { text: k.text, unmodifiedText: k.text } : {}), ...(k.text && shift ? { text: k.text } : {}) });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  await sleep(120);
}

// Scripted entry of the fictional state: native setters and the events typing fires (the value path, not the keyboard path).
const PAGE_HELPERS = `
window.__set = (id, value) => {
  const el = document.getElementById(id);
  if (!el) throw new Error('no field ' + id);
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  el.dispatchEvent(new Event('blur'));
};
window.__wait = (ms) => new Promise((done) => setTimeout(done, ms));
window.__fill = async (lines) => {
  const fields = ${JSON.stringify({
    invoiceNumber: 'RB-CHECK-1', issueDate: '10.11.2026', deliveryDate: '31.10.2026', buyerReference: 'Kostenstelle 4410',
    'seller.name': 'Musterwerk Beratung GmbH', 'seller.address.street': 'Beispielstraße 12', 'seller.address.postCode': '50667', 'seller.address.city': 'Köln',
    'seller.electronicAddress.schemeId': 'EM', 'seller.electronicAddress.value': 'rechnung@musterwerk.example',
    'seller.contact.name': 'Erika Mustermann', 'seller.contact.telephone': '+49 221 5550100', 'seller.contact.email': 'erika.mustermann@musterwerk.example', 'seller.vatId': 'DE123456789',
    'buyer.name': 'Beispiel Handel AG', 'buyer.address.street': 'Musterallee 5', 'buyer.address.postCode': '20095', 'buyer.address.city': 'Hamburg',
    'buyer.electronicAddress.schemeId': 'EM', 'buyer.electronicAddress.value': 'eingang@beispiel-handel.example',
    'payment.means.code': '58', 'payment.means.account.id.value': 'DE89370400440532013000', 'payment.dueDate': '24.11.2026',
  })};
  for (const [id, value] of Object.entries(fields)) window.__set(id, value);
  for (let i = 1; i < lines.length; i++) { document.querySelector('button.add').click(); await window.__wait(30); }
  lines.forEach(([name, unit, quantity, price, vat], i) => { window.__set('lines[' + i + '].name', name); window.__set('lines[' + i + '].unitCode', unit); window.__set('lines[' + i + '].quantity', quantity); window.__set('lines[' + i + '].unitPrice', price); window.__set('lines[' + i + '].vat.rate', vat); });
  await window.__wait(60);
};
window.__active = () => { const a = document.activeElement; return { tag: a?.tagName ?? null, id: a?.id ?? '', cls: typeof a?.className === 'string' ? a.className : '', visible: !!a && a !== document.body && a.getClientRects().length > 0, block: a?.closest?.('.blk')?.id ?? null }; };
`;
const active = () => page<{ tag: string | null; id: string; cls: string; visible: boolean; block: string | null }>('window.__active()');

// ---------------------------------------------------------------------------------------------- checks

const failures: string[] = [];
const passes: string[] = [];
function expect(name: string, ok: boolean, detail: unknown): void {
  (ok ? passes : failures).push(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` — ${JSON.stringify(detail)}`}`);
}
const ROUTES = [{ locale: 'de', path: '/tools/xrechnung/' }, { locale: 'en', path: '/en/tools/xrechnung/' }] as const;
const DICT = { de: { limit: 'Grenze dieses Werkzeugs', lineBreak: 'Zeilenumbruch', allDone: 'Keine offenen Punkte' }, en: { limit: 'tool’s limit', lineBreak: 'line break', allDone: 'No open points' } } as const;

for (const { locale, path } of ROUTES) {
  const d = DICT[locale];
  await viewport(1366);

  // F01: a line whose calculated net reaches the ceiling, and an amount over all lines at the ceiling.
  await open(path);
  await page(`window.__fill([['Leistung', 'C62', '100000', '100000', '19']])`);
  await page(`document.querySelector('.bar-actions .act.check').click(), window.__wait(150)`);
  const line = await page<{ rowErr: string[]; next: string; nextDisabled: string | null; ubl: string | null; status: string }>(`({
    rowErr: [...document.querySelectorAll('#section-lines .row-err')].map((p) => p.textContent.trim()),
    next: document.querySelector('.act.next').textContent.trim(), nextDisabled: document.querySelector('.act.next').getAttribute('aria-disabled'),
    ubl: document.querySelector('.bar-actions .act.primary').getAttribute('aria-disabled'), status: document.querySelector('.bar-status').textContent.trim() })`);
  expect(`${locale} F01 line ceiling shown on the line`, line.rowErr.some((text) => text.includes(d.limit)), line);
  expect(`${locale} F01 line ceiling: navigation does not claim completion`, !line.next.includes(d.allDone) && line.nextDisabled === 'false', line);
  expect(`${locale} F01 line ceiling: export stays refused`, line.ubl === 'true', line);
  await page(`document.querySelector('.act.next').focus()`);
  await press('Enter');
  const lineTarget = await active();
  expect(`${locale} F01 line ceiling: next open point is the line's quantity`, lineTarget.id === 'lines[0].quantity' && lineTarget.visible, lineTarget);

  await open(path);
  await page(`window.__fill([['Leistung A', 'C62', '60000', '100000', '19'], ['Leistung B', 'C62', '60000', '100000', '19']])`);
  await page(`document.querySelector('.bar-actions .act.check').click(), window.__wait(150)`);
  const all = await page<{ group: string[]; next: string; ubl: string | null }>(`({
    group: [...document.querySelectorAll('#section-lines .lines > .group-error')].map((p) => p.textContent.trim()),
    next: document.querySelector('.act.next').textContent.trim(), ubl: document.querySelector('.bar-actions .act.primary').getAttribute('aria-disabled') })`);
  expect(`${locale} F01 aggregate ceiling shown at the line table`, all.group.some((text) => text.includes(d.limit)), all);
  expect(`${locale} F01 aggregate ceiling: no false completion, export refused`, !all.next.includes(d.allDone) && all.ubl === 'true', all);
  await page(`document.querySelector('.act.next').focus()`);
  await press('Enter');
  const allTarget = await active();
  expect(`${locale} F01 aggregate ceiling: navigation lands on a visible control in the lines`, allTarget.visible && allTarget.block === 'section-lines', allTarget);

  // F02: focus survives the switch between the wide and the narrow command bar, both ways; focus elsewhere is never taken.
  await open(path);
  await page(`document.querySelector('.bar-actions .act.primary').focus()`);
  await viewport(390, true);
  const toNarrow = await active();
  expect(`${locale} F02 desktop export → narrow: menu button`, toNarrow.id === 'bar-menu' && toNarrow.visible, toNarrow);
  await viewport(1366);
  const toWide = await active();
  expect(`${locale} F02 narrow menu button → desktop: check action`, toWide.cls.includes('check') && toWide.visible, toWide);
  await viewport(390, true);
  await page(`document.getElementById('bar-menu').focus()`);
  await press('Enter');
  await page(`document.querySelector('.bar-actions .act.primary').focus()`);
  const inDrawer = await active();
  await viewport(1366);
  const drawerToWide = await active();
  expect(`${locale} F02 open drawer export → desktop: focus kept`, inDrawer.visible && drawerToWide.cls === inDrawer.cls && drawerToWide.visible, { inDrawer, drawerToWide });
  await viewport(390, true);
  const wideToOpenDrawer = await active();
  expect(`${locale} F02 desktop export with drawer state open → narrow: focus kept`, wideToOpenDrawer.cls === inDrawer.cls && wideToOpenDrawer.visible, wideToOpenDrawer);
  await page(`document.getElementById('seller.name').focus()`);
  await viewport(1366);
  await viewport(390, true);
  const field = await active();
  expect(`${locale} F02 a focused field is never taken`, field.id === 'seller.name', field);
  await viewport(1366);

  // F03 / MDR-47: Enter in a description goes on to the quantity, Shift+Enter does nothing, composition is left alone.
  await open(path);
  await page(`(window.__set('lines[0].name', 'Wartungspauschale Oktober 2026'), document.getElementById('lines[0].name').focus(), document.getElementById('lines[0].name').setSelectionRange(9, 9))`);
  await press('Enter');
  const afterEnter = await page<{ value: string; active: string }>(`({ value: document.getElementById('lines[0].name').value, active: document.activeElement.id })`);
  expect(`${locale} F03 Enter: no line break, focus on the quantity`, afterEnter.value === 'Wartungspauschale Oktober 2026' && afterEnter.active === 'lines[0].quantity', afterEnter);
  await page(`(document.getElementById('lines[0].name').focus(), document.getElementById('lines[0].name').setSelectionRange(9, 9))`);
  await press('Enter', true);
  const afterShift = await page<{ value: string; active: string }>(`({ value: document.getElementById('lines[0].name').value, active: document.activeElement.id })`);
  expect(`${locale} F03 Shift+Enter: no line break, no move`, afterShift.value === 'Wartungspauschale Oktober 2026' && afterShift.active === 'lines[0].name', afterShift);
  const composing = await page<{ prevented: boolean; active: string; value: string }>(`(() => { const el = document.getElementById('lines[0].name'); el.focus();
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: true, keyCode: 229 }); el.dispatchEvent(event);
    return { prevented: event.defaultPrevented, active: document.activeElement.id, value: el.value }; })()`);
  expect(`${locale} F03 composition Enter (synthetic): not prevented, no move`, !composing.prevented && composing.active === 'lines[0].name', composing);
  const breakInsert = await page<{ prevented: boolean[] }>(`(() => { const el = document.getElementById('lines[0].name');
    return { prevented: ['insertLineBreak', 'insertParagraph', 'insertText'].map((inputType) => { const event = new InputEvent('beforeinput', { inputType, data: inputType === 'insertText' ? 'x' : null, bubbles: true, cancelable: true }); el.dispatchEvent(event); return event.defaultPrevented; }) }; })()`);
  expect(`${locale} F03 line-break insertion refused, ordinary text not`, JSON.stringify(breakInsert.prevented) === '[true,true,false]', breakInsert);
  await page(`(window.__set('lines[0].name', 'Wartung\\nOktober'), window.__wait(100))`);
  const pasted = await page<{ value: string; error: string }>(`({ value: document.getElementById('lines[0].name').value, error: [...document.querySelectorAll('#section-lines .row-err')].map((p) => p.textContent).join(' ') })`);
  expect(`${locale} F03 a pasted line break is kept as typed and explained`, pasted.value === 'Wartung\nOktober' && pasted.error.includes(d.lineBreak), pasted);

  // F04: every "Next: …" footer action activates the next block and focuses a visible control there (real Enter).
  await open(path);
  const order = ['seller', 'document', 'buyer', 'lines', 'payment', 'notes'];
  for (let i = 0; i < order.length - 1; i++) {
    const from = order[i]!; const to = order[i + 1]!;
    await page(`(document.getElementById('h-${from}').closest('section').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })), window.__wait(80))`);
    await page(`[...document.querySelectorAll('#section-${from} .blk-foot .btn')].at(-1).focus()`);
    await press('Enter');
    const landed = await active();
    const openBlock = await page<string | null>(`document.querySelector('.blk.on')?.id ?? null`);
    expect(`${locale} F04 next from ${from} to ${to}`, landed.visible && landed.block === `section-${to}` && openBlock === `section-${to}`, { landed, openBlock });
  }

  // F06: the line block's legend promises no F1; the other legends still do, and F1 works on a field with help.
  await page(`(document.getElementById('lines[0].quantity').focus(), window.__wait(80))`);
  const legend = await page<string>(`document.querySelector('#section-lines .keys').textContent`);
  expect(`${locale} F06 line legend without F1`, !legend.includes('F1'), legend);
  await page(`(document.getElementById('buyerReference').focus(), window.__wait(80))`);
  const otherLegend = await page<string>(`document.querySelector('#section-document .keys').textContent`);
  await press('F1');
  const help = await page<string | null>(`document.querySelector('[aria-controls="buyerReference-help"]').getAttribute('aria-expanded')`);
  expect(`${locale} F06 F1 still opens field help where it is promised`, otherLegend.includes('F1') && help === 'true', { otherLegend, help });

  // F05: the line table stays inside its container, at rest and while editing, across the widths and the breakpoint.
  await open(path);
  await page(`window.__fill([['Beratungsleistung Oktober 2026 – Prozessanalyse Kreditorenbuchhaltung, Abstimmung der Eingangsrechnungsprüfung und Dokumentation der Freigabewege', 'HUR', '12,5', '140,00', '19'], ['Bauleistung: Trockenbau', 'HUR', '10', '62,50', 'reverse-charge']])`);
  const widths = [390, 768, 820, 860, 900, 940, 980, 1024, 1100, 1366, 1920];
  for (const width of widths) {
    await viewport(width, width < 768);
    for (const state of ['active', 'rest'] as const) {
      if (state === 'active') await page(`(document.getElementById('lines[0].quantity').focus(), window.__wait(120))`);
      else await page(`(document.getElementById('h-lines').focus(), document.querySelector('.sheet').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })), window.__wait(120))`);
      const fit = await page<{ lines: number; scroll: number; sheetRight: number; maxRight: number; page: number; description: [number, number] }>(`(() => {
        const lines = document.querySelector('.lines'); const sheet = document.querySelector('.sheet').getBoundingClientRect();
        const rights = [...lines.querySelectorAll('.row, .row *, .head')].filter((e) => e.getClientRects().length).map((e) => e.getBoundingClientRect().right);
        const t = document.getElementById('lines[0].name');
        return { lines: lines.clientWidth, scroll: lines.scrollWidth, sheetRight: sheet.right, maxRight: Math.max(...rights), page: document.documentElement.scrollWidth - document.documentElement.clientWidth, description: [t.scrollHeight, t.clientHeight] }; })()`);
      expect(`${locale} F05 ${width}px ${state}: line table inside its container`, fit.scroll <= fit.lines + 1 && fit.maxRight <= fit.sheetRight + 1 && fit.page <= 0, fit);
      expect(`${locale} F05 ${width}px ${state}: long description fully visible`, fit.description[0] <= fit.description[1] + 1, fit.description);
    }
  }
  await viewport(1366);
}

expect('no console error, page exception or CSP report', pageErrors.length === 0, pageErrors);
for (const line of [...passes, ...failures]) console.log(line);
console.log(`browser-check: ${passes.length} passed, ${failures.length} failed (${ORIGIN}, ${process.env.ORKAID_CHROME ?? 'google-chrome'})`);
socket.close();
// The browser writes into its profile until it has exited; remove the profile only then.
const exited = new Promise((done) => { if (chrome.exitCode !== null) done(undefined); else chrome.once('exit', done); });
chrome.kill();
await exited;
server.close();
rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
process.exit(failures.length === 0 ? 0 : 1);
