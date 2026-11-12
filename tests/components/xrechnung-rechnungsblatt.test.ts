// Rechnungsblatt (MDR-46): the invoice sheet is the workspace. These pin the production rules the document-first workspace
// added on top of Slices 1-3; the behaviour of the domain and the form adapter is covered by the other component tests.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { checkForm, previewTotals } from '../../src/components/tools/xrechnung/form-adapter.ts';
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
  assert.match(lines, /<textarea id=\{id\(i, 'name'\)\} rows="1" bind:value=\{line\.name\}/);
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
