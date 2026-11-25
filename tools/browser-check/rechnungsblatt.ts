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
const KEYS: Record<string, { code: string; keyCode: number; text?: string }> = {
  Enter: { code: 'Enter', keyCode: 13, text: '\r' }, Tab: { code: 'Tab', keyCode: 9 }, F1: { code: 'F1', keyCode: 112 }, Escape: { code: 'Escape', keyCode: 27 },
  ArrowRight: { code: 'ArrowRight', keyCode: 39 }, ArrowLeft: { code: 'ArrowLeft', keyCode: 37 }, ' ': { code: 'Space', keyCode: 32, text: ' ' },
};
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
const DICT = {
  de: { limit: 'Grenze dieses Werkzeugs', lineBreak: 'Zeilenumbruch', allDone: 'Keine offenen Punkte', padding: 'Leerzeichen am Anfang oder Ende', invoice: 'Rechnung', credit: 'Kaufmännische Gutschrift', confirm: 'Bestätigen Sie die Verrechnung' },
  en: { limit: 'tool’s limit', lineBreak: 'line break', allDone: 'No open points', padding: 'spaces at the start or end', invoice: 'Invoice', credit: 'Credit note', confirm: 'Confirm the clearing' },
} as const;
const CLEARING = 'payment.settlement.reciprocalObligationConfirmed';

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

  // R01: payment terms (BT-20) and notes (BT-22) admit an internal LF; a refusal there is never put on the line break.
  await open(path);
  await page(`window.__fill([['Leistung', 'C62', '1', '10', '19']])`);
  const description = await page<{ ubl: string | null }>(`(window.__set('lines[0].name', 'Wartung\\nOktober'), document.querySelector('.bar-actions .act.check').click(), window.__wait(150)).then(() => ({ ubl: document.querySelector('.bar-actions .act.primary').getAttribute('aria-disabled') }))`);
  expect(`${locale} R01 a line break in a description: export refused`, description.ubl === 'true', description);
  await page(`window.__set('lines[0].name', 'Wartung Oktober')`);
  for (const id of ['payment.termsText', 'notes[0].text']) {
    const probe = (value: string) => page<{ value: string; error: string | null; ubl: string | null }>(`(window.__set(${JSON.stringify(id)}, ${JSON.stringify(value)}), document.querySelector('.bar-actions .act.check').click(), window.__wait(150)).then(() => ({
      value: document.getElementById(${JSON.stringify(id)}).value, error: document.getElementById(${JSON.stringify(id + '-error')})?.textContent ?? null, ubl: document.querySelector('.bar-actions .act.primary').getAttribute('aria-disabled') }))`);
    const valid = await probe('Zahlbar in 30 Tagen.\nVielen Dank.');
    expect(`${locale} R01 ${id}: an internal LF is accepted`, valid.error === null && valid.ubl === 'false' && valid.value.includes('\n'), valid);
    const padded = await probe('Zahlbar in 30 Tagen.\nVielen Dank. ');
    expect(`${locale} R01 ${id}: LF plus a final space names the spaces, not the break; export refused`, padded.error?.includes(d.padding) === true && !padded.error.includes(d.lineBreak) && padded.ubl === 'true' && padded.value.endsWith(' '), padded);
    const unpadded = await probe('Zahlbar in 30 Tagen.\nVielen Dank.');
    expect(`${locale} R01 ${id}: removing only the space cures it, the LF kept`, unpadded.error === null && unpadded.ubl === 'false' && unpadded.value === 'Zahlbar in 30 Tagen.\nVielen Dank.', unpadded);
    const flattened = await probe('Zahlbar in 30 Tagen. Vielen Dank. ');
    expect(`${locale} R01 ${id}: removing only the LF does not cure it and nothing mentions a break`, flattened.error?.includes(d.padding) === true && !flattened.error.includes(d.lineBreak) && flattened.ubl === 'true', flattened);
    await page(`window.__set(${JSON.stringify(id)}, '')`);
  }

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

  // CN: credit note 381 (MDR-49). Real key presses on the native radio group; focus stays on the choice; the fields of the
  // inactive type are not in the document (so not focusable); the clearing confirmation starts and returns unticked.
  for (const [width, mobile] of [[1366, false], [390, true]] as const) {
    await viewport(width, mobile);
    await open(path);
    await page(`window.__fill([['Gutschrift Beratung', 'HUR', '2', '95,00', '19']])`);
    const typeState = () => page<{ checked: string | null; title: string; meta: string; bg3: boolean; means: boolean; confirm: boolean; confirmChecked: boolean | null; live: string; overflow: number }>(`({
      checked: document.querySelector('input[name="documentType"]:checked')?.value ?? null, title: document.querySelector('.sheet-title').firstChild.textContent.trim(),
      meta: document.querySelector('.sheet-meta').textContent.trim(), bg3: !!document.getElementById('precedingInvoice.number'),
      means: !!document.querySelector('[id^="payment.means."]'), confirm: !!document.getElementById(${JSON.stringify(CLEARING)}),
      confirmChecked: document.getElementById(${JSON.stringify(CLEARING)})?.checked ?? null, live: document.querySelector('[role="status"][aria-live]').textContent,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth })`);
    const start = await typeState();
    expect(`${locale} CN ${width}px initial: invoice 380 selected, no credit note fields`, start.checked === '380' && start.title === d.invoice && !start.bg3 && start.means && !start.confirm, start);
    await page(`document.getElementById('documentType.380').focus()`);
    await press('ArrowRight');
    await sleep(150);
    const to381 = await typeState();
    const onRadio = await active();
    expect(`${locale} CN ${width}px ArrowRight selects 381: title, meta and fields follow`, to381.checked === '381' && to381.title === d.credit && to381.meta.includes('381') && to381.bg3 && !to381.means && to381.confirm, to381);
    expect(`${locale} CN ${width}px focus stays on the selected radio`, onRadio.id === 'documentType.381' && onRadio.visible, onRadio);
    expect(`${locale} CN ${width}px the change is announced`, to381.live.includes('381'), to381.live);
    expect(`${locale} CN ${width}px confirmation starts unticked; no horizontal overflow`, to381.confirmChecked === false && to381.overflow <= 0, to381);
    await press('Tab');
    const afterTab = await active();
    expect(`${locale} CN ${width}px Tab from the type choice lands on a visible control, never on a removed field`, afterTab.visible && !afterTab.id.startsWith('payment.means.'), afterTab);
    const focusable = await page<string[]>(`[...document.querySelectorAll('input, select, textarea, button, [tabindex]')].filter((e) => e.id.startsWith('payment.means.')).map((e) => e.id)`);
    expect(`${locale} CN ${width}px no credit-transfer control exists on a 381`, focusable.length === 0, focusable);

    // The unconfirmed 381 is refused; "next open point" goes to BT-25, then to the confirmation; Space ticks it; export opens.
    await page(`document.querySelector('.bar-actions .act.check').click(), window.__wait(150)`);
    const refused = await page<{ ubl: string | null; confirmError: string | null; bg3Error: string | null }>(`({ ubl: document.querySelector('.bar-actions .act.primary').getAttribute('aria-disabled'),
      confirmError: document.getElementById(${JSON.stringify(CLEARING + '-error')})?.textContent ?? null, bg3Error: document.getElementById('precedingInvoice.number-error')?.textContent ?? null })`);
    expect(`${locale} CN ${width}px unconfirmed and unreferenced 381: export refused, both shown at their controls`, refused.ubl === 'true' && refused.confirmError?.includes(d.confirm) === true && refused.bg3Error !== null, refused);
    await page(`document.querySelector('.act.next').focus()`);
    await press('Enter');
    const toBg3 = await active();
    expect(`${locale} CN ${width}px next open point: BT-25`, toBg3.id === 'precedingInvoice.number' && toBg3.visible, toBg3);
    await page(`window.__set('precedingInvoice.number', 'RE-2026-0042')`);
    await page(`document.querySelector('.act.next').focus()`);
    await press('Enter');
    const toConfirm = await active();
    expect(`${locale} CN ${width}px next open point: the clearing confirmation`, toConfirm.id === CLEARING && toConfirm.visible, toConfirm);
    await press(' ');
    const confirmed = await page<{ checked: boolean; ubl: string | null; error: boolean }>(`({ checked: document.getElementById(${JSON.stringify(CLEARING)}).checked, ubl: document.querySelector('.bar-actions .act.primary').getAttribute('aria-disabled'), error: !!document.getElementById(${JSON.stringify(CLEARING + '-error')}) })`);
    expect(`${locale} CN ${width}px Space ticks the confirmation; the 381 is ready for export`, confirmed.checked && confirmed.ubl === 'false' && !confirmed.error, confirmed);

    // Back to 380 and forward again: values return with their type, the confirmation does not.
    await page(`document.getElementById('documentType.381').focus()`);
    await press('ArrowLeft');
    await sleep(150);
    const back = await page<{ checked: string | null; iban: string | null; bg3: boolean; ubl: string | null }>(`({ checked: document.querySelector('input[name="documentType"]:checked')?.value ?? null, iban: document.getElementById('payment.means.account.id.value')?.value ?? null, bg3: !!document.getElementById('precedingInvoice.number'), ubl: document.querySelector('.bar-actions .act.primary').getAttribute('aria-disabled') })`);
    expect(`${locale} CN ${width}px ArrowLeft back to 380: bank details return, BG-3 leaves, the invoice is ready`, back.checked === '380' && back.iban === 'DE89370400440532013000' && !back.bg3 && back.ubl === 'false', back);
    expect(`${locale} CN ${width}px focus stays on the 380 radio`, (await active()).id === 'documentType.380', await active());
    await press('ArrowRight');
    await sleep(150);
    const again = await typeState();
    const bg3Value = await page<string | null>(`document.getElementById('precedingInvoice.number')?.value ?? null`);
    const ublAgain = await page<string | null>(`document.querySelector('.bar-actions .act.primary').getAttribute('aria-disabled')`);
    expect(`${locale} CN ${width}px forward to 381 again: BT-25 restored, confirmation withdrawn, export refused`, again.checked === '381' && bg3Value === 'RE-2026-0042' && again.confirmChecked === false && ublAgain === 'true', { again, bg3Value, ublAgain });
  }
  await viewport(1366);

  // SK: structured Skonto tiers on a 380, in the payment block. Real key presses for adding, moving, removing, undoing and
  // navigating; values are entered by script. Diagnostics stand at the tier control; on a 381 the editor is gone.
  const SK = (i: number, field: 'days' | 'percent') => `payment.skonto[${i}].${field}`;
  const ubl = () => page<string | null>(`document.querySelector('.bar-actions .act.primary').getAttribute('aria-disabled')`);
  for (const [width, mobile] of [[1366, false], [390, true]] as const) {
    await viewport(width, mobile);
    await open(path);
    await page(`window.__fill([['Beratung', 'HUR', '2', '95,00', '19']])`);
    await page(`(document.getElementById('payment.dueDate').focus(), window.__wait(120))`);
    const empty = await page<{ group: boolean; tiers: number; add: boolean }>(`({ group: !!document.querySelector('#section-payment .skonto'), tiers: document.querySelectorAll('#section-payment .tier').length, add: !!document.querySelector('#section-payment .tiers .add') })`);
    expect(`${locale} SK ${width}px the Skonto group is in the payment block, with no tier and an add action`, empty.group && empty.tiers === 0 && empty.add, empty);
    await page(`document.querySelector('#section-payment .tiers .add').focus()`);
    await press('Enter');
    const added = await active();
    expect(`${locale} SK ${width}px Enter on add focuses the new tier's Days`, added.id === SK(0, 'days') && added.visible, added);
    await page(`(window.__set(${JSON.stringify(SK(0, 'days'))}, '14'), window.__set(${JSON.stringify(SK(0, 'percent'))}, '2,5'), document.getElementById(${JSON.stringify(SK(0, 'days'))}).focus())`);
    await press('Tab');
    const toPercent = await active();
    await press('Tab');
    const toRemove = await active();
    expect(`${locale} SK ${width}px Tab: Days → Percent → remove`, toPercent.id === SK(0, 'percent') && toRemove.tag === 'BUTTON' && toRemove.cls.includes('remove'), { toPercent, toRemove });
    const label = await page<string>(`document.querySelector('label[for="${SK(0, 'percent')}"]').textContent`);
    expect(`${locale} SK ${width}px the label names the tier`, label.includes(locale === 'de' ? 'Skontostufe 1' : 'Discount tier 1') && label.includes(locale === 'de' ? 'Prozent' : 'Percent'), label);
    expect(`${locale} SK ${width}px one valid tier: export ready`, (await ubl()) === 'false', await ubl());

    // A second tier with fewer days: the order diagnostic stands at that tier's Days, navigation goes there, export is refused.
    await page(`document.querySelector('#section-payment .tiers .add').focus()`);
    await press('Enter');
    expect(`${locale} SK ${width}px a second add focuses tier 2 Days`, (await active()).id === SK(1, 'days'), await active());
    await page(`(window.__set(${JSON.stringify(SK(1, 'days'))}, '10'), window.__set(${JSON.stringify(SK(1, 'percent'))}, '1'), window.__wait(80))`);
    const order = await page<{ error: string | null; invalid: string | null; describedBy: string | null }>(`({ error: document.getElementById(${JSON.stringify(SK(1, 'days') + '-error')})?.textContent ?? null, invalid: document.getElementById(${JSON.stringify(SK(1, 'days'))}).getAttribute('aria-invalid'), describedBy: document.getElementById(${JSON.stringify(SK(1, 'days'))}).getAttribute('aria-describedby') })`);
    expect(`${locale} SK ${width}px decreasing days: the error stands at tier 2 Days, tied to it, export refused`, order.error?.includes(locale === 'de' ? 'Skontostufe 2: Tage' : 'Discount tier 2: Days') === true && order.invalid === 'true' && order.describedBy?.includes(`${SK(1, 'days')}-error`) === true && (await ubl()) === 'true', order);
    await page(`document.querySelector('.act.next').focus()`);
    await press('Enter');
    const navigated = await active();
    expect(`${locale} SK ${width}px next open point: tier 2 Days`, navigated.id === SK(1, 'days') && navigated.visible, navigated);
    await page(`(window.__set(${JSON.stringify(SK(1, 'days'))}, '30'), window.__wait(80))`);
    expect(`${locale} SK ${width}px corrected order: export ready`, (await ubl()) === 'false', await ubl());

    // Remove tier 2 by keyboard: focus moves to undo; undo restores it at its place with its values and focuses its Days.
    await page(`document.querySelector('#section-payment .tier:nth-of-type(2) .remove').focus()`);
    await press('Enter');
    const toUndo = await active();
    const afterRemove = await page<number>(`document.querySelectorAll('#section-payment .tier').length`);
    expect(`${locale} SK ${width}px Enter on remove: one tier left, focus on undo`, afterRemove === 1 && toUndo.id === 'skonto-undo' && toUndo.visible, { afterRemove, toUndo });
    await press('Enter');
    const restored = await page<{ active: string; days: string; percent: string; count: number }>(`({ active: document.activeElement.id, days: document.getElementById(${JSON.stringify(SK(1, 'days'))})?.value, percent: document.getElementById(${JSON.stringify(SK(1, 'percent'))})?.value, count: document.querySelectorAll('#section-payment .tier').length })`);
    expect(`${locale} SK ${width}px Enter on undo: tier 2 back with its values, focus on its Days`, restored.count === 2 && restored.active === SK(1, 'days') && restored.days === '30' && restored.percent === '1', restored);
    const overflow = await page<number>(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
    expect(`${locale} SK ${width}px no horizontal overflow with tiers`, overflow <= 0, overflow);

    // An empty added tier is reported missing at its own fields after a check, and blocks export.
    await page(`document.querySelector('#section-payment .tiers .add').click()`);
    await page(`document.querySelector('.bar-actions .act.check').click(), window.__wait(150)`);
    const emptyTier = await page<{ days: string | null; percent: string | null }>(`({ days: document.getElementById(${JSON.stringify(SK(2, 'days') + '-error')})?.textContent ?? null, percent: document.getElementById(${JSON.stringify(SK(2, 'percent') + '-error')})?.textContent ?? null })`);
    expect(`${locale} SK ${width}px an empty tier: both fields reported at the tier, export refused`, emptyTier.days !== null && emptyTier.percent !== null && (await ubl()) === 'true', emptyTier);
    await page(`document.querySelector('#section-payment .tier:nth-of-type(3) .remove').click()`);

    // Credit note: the editor leaves, a note says why, no Skonto control remains, focus stays on the radio; back on 380 the tiers return.
    await page(`document.getElementById('documentType.380').focus()`);
    await press('ArrowRight');
    await sleep(150);
    const cn = await page<{ controls: string[]; note: boolean; overflow: number }>(`({ controls: [...document.querySelectorAll('[id^="payment.skonto"]')].map((e) => e.id), note: !!document.querySelector('.skonto-cn'), overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth })`);
    const cnFocus = await active();
    expect(`${locale} SK ${width}px on 381: no Skonto control, the note is shown, focus stays on the radio`, cn.controls.length === 0 && cn.note && cnFocus.id === 'documentType.381' && cn.overflow <= 0, { cn, cnFocus });
    await press('ArrowLeft');
    await sleep(150);
    const back = await page<string[]>(`[${JSON.stringify(SK(0, 'days'))}, ${JSON.stringify(SK(0, 'percent'))}, ${JSON.stringify(SK(1, 'days'))}, ${JSON.stringify(SK(1, 'percent'))}].map((id) => document.getElementById(id)?.value ?? '?')`);
    expect(`${locale} SK ${width}px back on 380: the tiers return as typed; export ready`, JSON.stringify(back) === JSON.stringify(['14', '2,5', '30', '1']) && (await ubl()) === 'false', back);

    // Ten tiers: no add action any more, the limit is stated.
    for (let i = 2; i < 10; i++) await page(`(document.querySelector('#section-payment .tiers .add').click(), window.__wait(20))`);
    const full = await page<{ count: number; add: boolean; limit: string | null }>(`({ count: document.querySelectorAll('#section-payment .tier').length, add: !!document.querySelector('#section-payment .tiers .add'), limit: document.querySelector('#section-payment .tiers .limit')?.textContent ?? null })`);
    expect(`${locale} SK ${width}px ten tiers: no add action, the limit is stated`, full.count === 10 && !full.add && full.limit?.includes('10') === true, full);
    expect(`${locale} SK ${width}px the tenth add moved focus to tier 10 Days`, (await active()).id === SK(9, 'days'), await active());
    // SK-NB-01: the focus outline of a tier field (width plus offset) stays clear of its label.
    for (const fid of [SK(0, 'days'), SK(0, 'percent'), SK(1, 'days')]) {
      const gap = await page<{ label: number; outlineTop: number; outline: string }>(`(() => { const el = document.getElementById(${JSON.stringify(fid)}); el.focus(); const cs = getComputedStyle(el);
        return { label: document.querySelector('label[for="${fid}"]').getBoundingClientRect().bottom, outlineTop: el.getBoundingClientRect().top - parseFloat(cs.outlineWidth) - parseFloat(cs.outlineOffset), outline: cs.outlineStyle + ' ' + cs.outlineWidth }; })()`);
      expect(`${locale} SK ${width}px ${fid}: focus outline clear of its label, outline kept`, gap.outlineTop >= gap.label && gap.outline.startsWith('solid') && gap.outline.endsWith('3px'), gap);
    }
    // ... and clear of the "%" sign beside the Percent field.
    const unit = await page<{ outlineRight: number; unitLeft: number }>(`(() => { const el = document.getElementById(${JSON.stringify(SK(0, 'percent'))}); el.focus(); const cs = getComputedStyle(el);
      return { outlineRight: el.getBoundingClientRect().right + parseFloat(cs.outlineWidth) + parseFloat(cs.outlineOffset), unitLeft: el.parentElement.querySelector('.unit').getBoundingClientRect().left }; })()`);
    expect(`${locale} SK ${width}px Percent focus outline clear of the % sign`, unit.outlineRight <= unit.unitLeft, unit);
    // SK-NB-03: a real F1 in Days and in Percent (also on tier 2) opens the Skonto help; Escape closes it and focus returns.
    for (const fid of [SK(0, 'days'), SK(0, 'percent'), SK(1, 'percent')]) {
      await page(`(document.getElementById(${JSON.stringify(fid)}).focus(), window.__wait(60))`);
      await press('F1');
      const opened = await page<{ open: boolean; title: string | null }>(`({ open: !!document.querySelector('dialog.drawer[open]'), title: document.getElementById('help-title')?.textContent ?? null })`);
      expect(`${locale} SK ${width}px F1 in ${fid} opens the Skonto help`, opened.open && opened.title?.includes(locale === 'de' ? 'Skonto (strukturiert)' : 'Early-payment discount') === true, opened);
      await press('Escape');
      const closed = await page<{ open: boolean; active: string }>(`({ open: !!document.querySelector('dialog.drawer[open]'), active: document.activeElement.id })`);
      expect(`${locale} SK ${width}px Escape closes the help and returns focus to ${fid}`, !closed.open && closed.active === fid, closed);
    }
    // F1 elsewhere keeps its own behaviour: it toggles the field's inline help, no drawer.
    await page(`(document.getElementById('payment.dueDate').focus(), window.__wait(60))`);
    await press('F1');
    const inline = await page<{ expanded: string | null; drawer: boolean }>(`({ expanded: document.querySelector('[aria-controls="payment.dueDate-help"]').getAttribute('aria-expanded'), drawer: !!document.querySelector('dialog.drawer[open]') })`);
    expect(`${locale} SK ${width}px F1 in the due date still toggles its inline help, no drawer`, inline.expanded === 'true' && !inline.drawer, inline);
    await press('F1');
    // SK-NB-04: the rendered Skonto help gives the two-digit limit and the percent example; the quantity help keeps six.
    await page(`(document.querySelector('#section-payment .skonto .sec-help').click(), window.__wait(150))`);
    const mistakes = await page<string[]>(`[...document.querySelectorAll('dialog.drawer[open] section')].filter((s) => /Häufige Fehler|Common mistakes/.test(s.querySelector('h3')?.textContent ?? '')).flatMap((s) => [...s.querySelectorAll('li')].map((li) => li.textContent.trim()))`);
    const mistakeText = mistakes.join(' | ');
    expect(`${locale} SK ${width}px rendered Skonto help: two fractional digits, percent example, no six`, mistakeText.includes(locale === 'de' ? 'höchstens 2 Nachkommastellen' : 'at most 2 fractional digits') && mistakeText.includes('2,5') && !/\b6\b/.test(mistakeText), mistakes);
    await page(`(document.querySelector('dialog.drawer[open] .close').click(), window.__wait(100))`);
  }
  await viewport(1366);

  // SK-OBS-01 / SK-NB-04: the scope note lead names no count and two groups are shown; the quantity help keeps six digits.
  await open(path);
  const scope = await page<{ lead: string; groups: number }>(`(() => { const d = [...document.querySelectorAll('.scope details')][1]; d.open = true; return { lead: d.querySelector('.lead').textContent, groups: d.querySelectorAll('h3').length }; })()`);
  expect(`${locale} SK scope note: lead without a count, two groups shown`, scope.groups === 2 && !/\b(Drei|Three|Zwei|Two)\b/.test(scope.lead), scope);
  await page(`(document.getElementById('lines[0].quantity').focus(), window.__wait(80), [...document.querySelectorAll('.help-link')].find((b) => /Menge|Quantity/.test(b.textContent)).click(), window.__wait(150))`);
  const qtyHelp = await page<string>(`[...document.querySelectorAll('dialog.drawer[open] li')].map((li) => li.textContent).join(' | ')`);
  expect(`${locale} SK quantity/unit price help keeps the six-digit limit`, qtyHelp.includes(locale === 'de' ? 'höchstens 6 Nachkommastellen' : 'at most 6 fractional digits'), qtyHelp.slice(0, 300));
  await page(`document.querySelector('dialog.drawer[open] .close')?.click()`);

  // C7-02a: the electronic-address help is shared by both parties; leaving it (Jump, Escape, Close) keeps the party it was
  // opened from, at constant widths and after a wide-to-narrow change while it is open. Real F1, Tab, Enter, Escape and Tab.
  const settled = () => page<{ id: string; cls: string; visible: boolean; connected: boolean; field: string | null; block: string | null; controls: string | null }>(`new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => {
    const a = document.activeElement; done({ id: a?.id ?? '', cls: typeof a?.className === 'string' ? a.className : '', visible: !!a && a !== document.body && a.getClientRects().length > 0, connected: !!a?.isConnected,
      field: a?.closest?.('.field')?.querySelector('input, select, textarea')?.id ?? null, block: a?.closest?.('.blk')?.id ?? null, controls: a?.getAttribute?.('aria-controls') ?? null }); }, 250))))`);
  const CONDITIONS = [['wide', 1366, 1366], ['narrow', 390, 390], ['wide→narrow', 1366, 390]] as const;
  for (const party of ['buyer', 'seller'] as const) {
    for (const dismissal of party === 'buyer' ? (['jump', 'escape', 'close'] as const) : (['jump'] as const)) {
      for (const [condition, from, to] of CONDITIONS) {
        const tag = `${locale} C7-02a ${party} ${condition} ${dismissal}`;
        await viewport(from, from < 768);
        await open(path);
        await page(`(document.getElementById('${party}.electronicAddress.schemeId').focus(), window.__wait(80))`);
        await press('F1');
        await press('Tab');
        const more = await settled();
        await press('Enter');
        const opened = await page<{ open: boolean; bt: string | null }>(`({ open: !!document.querySelector('dialog.drawer[open]'), bt: document.querySelector('dialog.drawer[open] .bt')?.textContent ?? null })`);
        expect(`${tag}: More reached by Tab opens the electronic-address help`, more.cls.includes('more') && more.field === `${party}.electronicAddress.schemeId` && opened.open && opened.bt === 'BT-34 / BT-49', { more, opened });
        if (to !== from) await viewport(to, to < 768);
        if (dismissal === 'jump') { await page(`document.querySelector('dialog.drawer[open] .jump').focus()`); await press('Enter'); }
        else if (dismissal === 'close') { await page(`document.querySelector('dialog.drawer[open] .close').focus()`); await press('Enter'); }
        else await press('Escape');
        const landed = await settled();
        await press('Tab');
        const next = await settled();
        const block = `section-${party}`;
        if (dismissal === 'jump') {
          expect(`${tag}: lands on ${party}.electronicAddress.value, visible and connected`, landed.id === `${party}.electronicAddress.value` && landed.visible && landed.connected && landed.block === block, landed);
          expect(`${tag}: next Tab continues to the ${party} VAT-ID help`, next.controls === `${party}.vatId-help` && next.visible && next.block === block, next);
        } else {
          expect(`${tag}: returns to the ${party} scheme's More, visible and connected`, landed.cls.includes('more') && landed.field === `${party}.electronicAddress.schemeId` && landed.visible && landed.connected && landed.block === block, landed);
          expect(`${tag}: next Tab continues to ${party}.electronicAddress.value`, next.id === `${party}.electronicAddress.value` && next.visible && next.block === block, next);
        }
      }
    }
  }
  // Party-specific helps keep their own target: the party rule changes only a help both parties share.
  for (const [origin, targetId] of [['seller.contact.name', 'seller.contact.name'], ['seller.vatId', 'seller.vatId'], ['seller.taxRegistrationId', 'seller.taxRegistrationId'], ['seller.legalRegistrationId', 'seller.legalRegistrationId'], ['buyer.vatId', 'buyer.vatId']] as const) {
    await viewport(1366);
    await open(path);
    // Empty optional fields show only in the block being worked in: enter the block first.
    await page(`(async () => { document.getElementById('${origin.split('.')[0]}.name').focus(); await window.__wait(120); document.getElementById('${origin}').focus(); await window.__wait(80); })()`);
    await press('F1');
    await press('Tab');
    const more = await settled();
    await press('Enter');
    const opened = await page<boolean>(`!!document.querySelector('dialog.drawer[open] .jump')`);
    if (opened) { await page(`document.querySelector('dialog.drawer[open] .jump').focus()`); await press('Enter'); }
    const landed = await settled();
    expect(`${locale} C7-02a control party help from ${origin}: Jump lands on ${targetId}`, opened && landed.id === targetId && landed.visible && landed.connected, { more, opened, landed });
  }
  // C5-01/04/05: the rendered scope note names the B2B profile, the split exclusions and the missing sending and sign-in.
  await open(path);
  const scopeText = await page<string>(`[...document.querySelectorAll('.scope details')].map((d) => d.textContent).join(' ')`);
  for (const needle of locale === 'de' ? ['(B2B)', 'BT-113', 'BG-24', 'BT-7, BT-8', 'Peppol', 'Anmeldung', 'je Position'] : ['(B2B)', 'BT-113', 'BG-24', 'BT-7, BT-8', 'Peppol', 'sign-in', 'per line']) {
    expect(`${locale} C5 rendered scope note names ${needle}`, scopeText.includes(needle), scopeText.slice(0, 200));
  }
  // Controls on the shared mechanism: Skonto F1 → Jump goes to tier 1 Days, then Tab to Percent; a line-column help closes back
  // to its column link.
  for (const [condition, from, to] of CONDITIONS) {
    await viewport(from, from < 768);
    await open(path);
    await page(`(document.querySelector('#section-payment .tiers .add').click(), window.__wait(120))`);
    await page(`(document.getElementById(${JSON.stringify(SK(0, 'percent'))}).focus(), window.__wait(80))`);
    await press('F1');
    if (to !== from) await viewport(to, to < 768);
    await page(`document.querySelector('dialog.drawer[open] .jump').focus()`);
    await press('Enter');
    const landed = await settled();
    await press('Tab');
    const next = await settled();
    expect(`${locale} C7-02a control Skonto ${condition} jump: tier 1 Days, then Tab to tier 1 Percent`, landed.id === SK(0, 'days') && landed.visible && next.id === SK(0, 'percent'), { landed, next });

    await viewport(from, from < 768);
    await open(path);
    await page(`(document.getElementById('lines[0].quantity').focus(), window.__wait(80))`);
    await page(`[...document.querySelectorAll('.help-link')].find((b) => /Menge|Quantity/.test(b.textContent)).focus()`);
    await press('Enter');
    if (to !== from) await viewport(to, to < 768);
    await page(`document.querySelector('dialog.drawer[open] .close').focus()`);
    await press('Enter');
    const back = await settled();
    expect(`${locale} C7-02a control line-column help ${condition} close: back on its column link`, back.cls.includes('help-link') && back.visible && back.connected && back.block === 'section-lines', back);
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
