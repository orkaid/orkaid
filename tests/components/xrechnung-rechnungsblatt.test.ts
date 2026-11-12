// Rechnungsblatt (MDR-46): the invoice sheet is the workspace. These pin the production rules the document-first workspace
// added on top of Slices 1-3; the behaviour of the domain and the form adapter is covered by the other component tests.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { navigationTarget, placementOf } from '../../src/components/tools/xrechnung/diagnostic-placement.ts';
import { checkForm, previewTotals, type DiagnosticItem } from '../../src/components/tools/xrechnung/form-adapter.ts';
import { emptyFormState, emptyLine } from '../../src/components/tools/xrechnung/form-state.ts';
import { copy } from '../../src/i18n/xrechnung.ts';
import { formatLocalizedDecimal } from '../../src/lib/domain/xrechnung/number-notation.ts';

const directory = new URL('../../src/components/tools/xrechnung/', import.meta.url);
const read = (name: string) => readFileSync(new URL(name, directory), 'utf8');
const locales = ['de', 'en'] as const;

test('field help is in the tab sequence of the active block, so it never depends on F1 alone', () => {
  const field = read('Field.svelte');
  const toggle = /<button\s+type="button" class="help"[^>]*>/.exec(field)?.[0] ?? '';
  assert.ok(toggle.length > 0, 'the field help toggle exists');
  assert.doesNotMatch(toggle, /tabindex/);
  assert.match(toggle, /aria-expanded=\{hintOpen\}/);
  // F1 stays as an announced shortcut to the same help.
  assert.match(field, /aria-keyshortcuts=\{helpId \? 'F1' : undefined\}/);
});

test('Enter advances only from a one-line text input, never while an IME composition is confirmed', () => {
  const workspace = read('XRechnungWorkspace.svelte');
  const handler = workspace.slice(workspace.indexOf('function onKey'), workspace.indexOf('const money'));
  const enter = /if \(event\.key === 'Enter'([^{]*)\{/.exec(handler)?.[1] ?? '';
  assert.match(enter, /!event\.isComposing/);
  assert.match(enter, /event\.keyCode !== 229/);
  assert.match(enter, /target instanceof HTMLInputElement && target\.type === 'text'/);
  // Selects, text areas and buttons are not HTMLInputElement of type text, so their native Enter is untouched.
  assert.doesNotMatch(enter, /HTMLSelectElement|HTMLTextAreaElement|HTMLButtonElement/);
});

test('a line description wraps on the document instead of being cut off', () => {
  const lines = read('LinesEditor.svelte');
  assert.match(lines, /<textarea id=\{id\(i, 'name'\)\} rows="1" enterkeyhint="next" onkeydown=\{\(event\) => descriptionKey\(event, i\)\} onbeforeinput=\{noLineBreak\} bind:value=\{line\.name\}/);
  assert.doesNotMatch(lines, /<input id=\{id\(i, 'name'\)\}/);
  assert.match(lines, /\.c-name textarea \{[^}]*overflow-wrap: anywhere;[^}]*field-sizing: content;/);
});

test('no prototype surface ships: no demo states, demo hash, concept placeholders or separate dictionary', () => {
  assert.equal(existsSync(new URL('demo-data.ts', directory)), false);
  assert.equal(existsSync(new URL('../../src/i18n/xrechnung-exp.ts', import.meta.url)), false);
  assert.equal(existsSync(new URL('SummaryRail.svelte', directory)), false);
  for (const file of readdirSync(directory).filter((name) => /\.(svelte|ts)$/.test(name))) {
    const source = read(file);
    assert.doesNotMatch(source, /demo|concept|xrechnung-exp|EXPLORATORY|location\.hash/i, file);
  }
  for (const [key, message] of Object.entries(copy)) for (const locale of locales) assert.doesNotMatch(message[locale], /prototyp|demo|Konzept · nicht|concept · not/i, key);
});

test('the sheet strings live in the single dictionary, in both languages, and the stamp names the check as local', () => {
  const keys = Object.keys(copy).filter((key) => key.startsWith('sheet.'));
  assert.ok(keys.length >= 40, `${keys.length} sheet strings`);
  for (const key of keys) for (const locale of locales) assert.ok(copy[key as keyof typeof copy][locale].trim().length > 0, `${key} (${locale})`);
  assert.match(copy['sheet.stampReady'].de, /^Lokal geprüft/);
  assert.match(copy['sheet.stampReady'].en, /^Checked locally/);
});

test('an individual line net is the domain value of that line alone and is labelled as such, never as a total', () => {
  const lines = read('LinesEditor.svelte');
  // Shown only while there are no invoice totals, and then always with the individual-value tag.
  assert.match(lines, /const net = \(index: number\) => \(totals\?\.lines\[index\] \? formatLocalizedDecimal\(totals\.lines\[index\]\.netAmount, 'de'\) : netFor\(index\)\);/);
  assert.match(lines, /\{value \?\? '—'\}\{#if !totals && value !== undefined\}<span class="solo-tag">\{copy\['sheet\.soloNet'\]\[locale\]\}<\/span>\{\/if\}/);
  assert.match(copy['sheet.soloNet'].de, /Einzelwert/);
  assert.match(copy['sheet.soloNote'].de, /keine Rechnungssumme und keine Zwischensumme/);
  assert.match(copy['sheet.soloNote'].en, /not an invoice total and not a subtotal/);
  // netFor asks the domain for one line taken alone; nothing in the workspace adds amounts.
  const workspace = read('XRechnungWorkspace.svelte');
  assert.match(workspace, /const single = previewTotals\(\{ \.\.\.form, lines: \[line\] \}\);/);
  for (const file of ['XRechnungWorkspace.svelte', 'LinesEditor.svelte']) assert.doesNotMatch(read(file), /\.netAmount\s*[+\-*/]|units\s*[+\-*/]|reduce\(/, file);

  // The single-line figure is the BT-131 the full invoice gives that line: the domain rounds each line on its own.
  const state = emptyFormState();
  state.lines = [emptyLine(), emptyLine()];
  Object.assign(state.lines[0]!, { name: 'A', quantity: '3', unitCode: 'C62', unitPrice: '33,333', vatRate: '19' });
  Object.assign(state.lines[1]!, { name: 'B', quantity: '1,5', unitCode: 'C62', unitPrice: '10,01', vatRate: '7' });
  const whole = previewTotals(state);
  assert.ok(whole.ok);
  state.lines.forEach((line, index) => {
    const alone = previewTotals({ ...state, lines: [line] });
    assert.ok(alone.ok);
    assert.equal(formatLocalizedDecimal(alone.totals.lines[0]!.netAmount, 'de'), formatLocalizedDecimal(whole.totals.lines[index]!.netAmount, 'de'));
  });
  // With a second line incomplete there is no invoice total, but the complete line still has its own net.
  state.lines[1]!.unitPrice = '';
  assert.equal(previewTotals(state).ok, false);
  assert.equal(checkForm(state).ok, false);
  assert.ok(previewTotals({ ...state, lines: [state.lines[0]!] }).ok);
});

// ---- Independent review of 053ea2b, F01: no domain diagnostic may disappear for lack of a matching field.

function validOneLine(quantity: string, unitPrice: string) {
  const state = emptyFormState();
  Object.assign(state.fields, {
    invoiceNumber: 'RB-1', issueDate: '10.11.2026', deliveryDate: '31.10.2026', buyerReference: 'Kostenstelle 4410',
    'seller.name': 'Musterwerk GmbH', 'seller.address.street': 'Beispielstraße 12', 'seller.address.postCode': '50667', 'seller.address.city': 'Köln',
    'seller.electronicAddress.schemeId': 'EM', 'seller.electronicAddress.value': 'rechnung@musterwerk.example',
    'seller.contact.name': 'Erika Mustermann', 'seller.contact.telephone': '+49 221 5550100', 'seller.contact.email': 'erika@musterwerk.example', 'seller.vatId': 'DE123456789',
    'buyer.name': 'Beispiel Handel AG', 'buyer.address.street': 'Musterallee 5', 'buyer.address.postCode': '20095', 'buyer.address.city': 'Hamburg',
    'buyer.electronicAddress.schemeId': 'EM', 'buyer.electronicAddress.value': 'eingang@beispiel-handel.example',
    'payment.means.code': '58', 'payment.means.account.id.value': 'DE89370400440532013000', 'payment.dueDate': '24.11.2026',
  });
  state.lines = [{ name: 'Leistung', unitCode: 'C62', quantity, unitPrice, vatRate: '19' }];
  return state;
}
const itemsOf = (state: ReturnType<typeof emptyFormState>): readonly DiagnosticItem[] => { const result = checkForm(state); return result.ok ? [] : result.items; };

test('a line whose calculated net reaches the ceiling is shown on that line and navigation goes to its quantity', () => {
  const items = itemsOf(validOneLine('100000', '100000'));
  const limit = items.filter((item) => item.code === 'calculated_amount_limit');
  assert.deepEqual(limit.map((item) => item.path), ['lines[0]']);
  assert.equal(limit[0]!.fieldId, undefined, 'the adapter gives no field: placement must not rely on one');
  assert.deepEqual(placementOf(limit[0]!), { at: 'line', line: 0 });
  assert.equal(navigationTarget(limit[0]!), 'lines[0].quantity');
});

test('an amount over all lines that reaches the ceiling is shown at the line table and navigation still has a target', () => {
  const state = validOneLine('60000', '100000');
  state.lines.push({ ...state.lines[0]! });
  const items = itemsOf(state);
  const aggregate = items.filter((item) => item.code === 'calculated_amount_limit');
  assert.ok(aggregate.length > 0, 'the domain reports the aggregate ceiling');
  for (const item of aggregate) {
    assert.equal(item.path, 'lines');
    assert.deepEqual(placementOf(item), { at: 'lines' });
    assert.ok(navigationTarget(item) !== undefined);
  }
});

test('every diagnostic has exactly one place, and the sheet renders each kind of place', () => {
  const samples: readonly DiagnosticItem[] = [
    ...itemsOf(emptyFormState()),
    ...itemsOf(validOneLine('100000', '100000')),
    ...itemsOf(Object.assign(validOneLine('1', '1'), { lines: [] })),
    { code: 'internal_inconsistency', path: '', fieldId: undefined, section: 'general', kind: 'internal' },
    { code: 'unknown_field', path: 'seller.name', fieldId: 'seller.name', section: 'seller', kind: 'internal' },
    { code: 'invalid_type', path: 'seller', fieldId: 'seller.vatId', section: 'seller', kind: 'invalid' },
  ];
  const kinds = new Set(samples.map((item) => placementOf(item).at));
  for (const kind of ['field', 'group', 'line', 'lines', 'document']) assert.ok(kinds.has(kind as never), kind);
  // Internal and unplaceable diagnostics land in the document's issue list, which the workspace always renders.
  assert.equal(placementOf(samples.at(-3)!).at, 'document');
  assert.equal(placementOf(samples.at(-2)!).at, 'document');
  assert.equal(placementOf(samples.at(-1)!).at, 'document');
  const workspace = read('XRechnungWorkspace.svelte');
  assert.match(workspace, /const documentIssues = \$derived\(items\.filter\(\(item\) => placementOf\(item\)\.at === 'document'\)\);/);
  assert.match(workspace, /\{#if documentIssues\.length > 0\}[\s\S]*?id="sheet-issues"[\s\S]*?\{#each documentIssues as item/);
  assert.match(workspace, /groupErrors=\{linesErrors\} \{lineErrors\}/);
  const lines = read('LinesEditor.svelte');
  assert.match(lines, /\{#each groupErrors as text/);
  assert.match(lines, /\{@const whole = lineErrors\(i\)\}/);
  assert.match(lines, /\{#each whole as text/);
});

test('"no open points" is said only when the domain reports nothing', () => {
  const workspace = read('XRechnungWorkspace.svelte');
  assert.match(workspace, /aria-disabled=\{openTotal === 0\} onclick=\{\(\) => nextOpen\(\)\}>\s*\{#if openTotal === 0\}\{copy\['sheet\.allDone'\]/);
  const next = workspace.slice(workspace.indexOf('function nextOpen'), workspace.indexOf('function nextBlock'));
  assert.ok(next.indexOf('if (openTotal > 0)') > 0 && next.indexOf('if (openTotal > 0)') < next.indexOf("copy['sheet.allDone']"), 'diagnostics without a target are shown before any all-done message');
});

test('a hard line break gets a line-break message, the ceiling a correction hint, and the line legend promises no F1', () => {
  for (const locale of locales) {
    assert.match(copy['sheet.lineBreak'][locale], locale === 'de' ? /Zeilenumbruch/ : /line break/);
    assert.match(copy['sheet.lineBreak'][locale], /\{field\}/);
    assert.doesNotMatch(copy['sheet.keysLines'][locale], /F1/);
    assert.match(copy['sheet.keys'][locale], /F1/);
  }
  const workspace = read('XRechnungWorkspace.svelte');
  assert.match(workspace, /item\.code === 'invalid_text' && \/\[\\r\\n\]\/\.test\(values\[item\.path\] \?\? ''\) \? fill\(copy\['sheet\.lineBreak'\]/);
  assert.match(workspace, /copy\[id === 'lines' \? 'sheet\.keysLines' : 'sheet\.keys'\]/);
  // The text itself is never changed: the frozen domain still rejects it and the export stays refused.
  const state = validOneLine('1', '10');
  state.lines[0]!.name = 'Wartung\nOktober';
  assert.deepEqual(itemsOf(state).map((item) => `${item.code}@${item.path}`), ['invalid_text@lines[0].name']);
  assert.equal(state.lines[0]!.name, 'Wartung\nOktober');
});

test('Enter in a line description goes on to the quantity; modified Enter, line-break insertion and composition are handled', () => {
  const lines = read('LinesEditor.svelte');
  const key = lines.slice(lines.indexOf('function descriptionKey'), lines.indexOf('function noLineBreak'));
  assert.match(key, /if \(event\.key !== 'Enter' \|\| event\.isComposing \|\| event\.keyCode === 229\) return;\s*event\.preventDefault\(\);\s*if \(event\.shiftKey \|\| event\.ctrlKey \|\| event\.altKey \|\| event\.metaKey\) return;/);
  assert.match(key, /document\.getElementById\(id\(i, 'quantity'\)\)\?\.focus\(\);/);
  assert.match(lines, /function noLineBreak\(event: InputEvent\): void \{\s*if \(event\.inputType === 'insertLineBreak' \|\| event\.inputType === 'insertParagraph'\) event\.preventDefault\(\);/);
});

test('the wide line table starts only where its tracks and gaps fit', () => {
  const lines = read('LinesEditor.svelte');
  const query = /@container lines \(min-width: ([\d.]+)rem\) \{\s*\.head, \.row \{ display: grid; grid-template-columns: ([^;]+); column-gap: ([\d.]+)rem;/.exec(lines);
  assert.ok(query, 'the wide grid definition');
  // Each track's minimum in rem (a `minmax(13.5rem, 1fr)` track contributes its 13.5rem).
  const tracks = [...query[2]!.matchAll(/([\d.]+)rem/g)].map((match) => Number(match[1]));
  assert.equal(tracks.length, 7);
  const needed = tracks.reduce((sum, rem) => sum + rem, 0) + (tracks.length - 1) * Number(query[3]);
  assert.ok(Number(query[1]) >= needed, `threshold ${query[1]}rem, needed ${needed}rem`);
});
