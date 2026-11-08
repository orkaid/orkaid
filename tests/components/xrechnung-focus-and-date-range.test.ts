import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { buildDocumentInput, checkForm } from '../../src/components/tools/xrechnung/form-adapter.ts';
import { returnTarget } from '../../src/components/tools/xrechnung/focus-return.ts';
import { NATIVE_DATE_MAX, NATIVE_DATE_MIN, textFromNativeDate, UNPARSABLE } from '../../src/components/tools/xrechnung/input-format.ts';
import { emptyFormState, type FormState } from '../../src/components/tools/xrechnung/form-state.ts';

const read = (name: string) => readFileSync(new URL(`../../src/components/tools/xrechnung/${name}`, import.meta.url), 'utf8');

function stateWithIssueDate(text: string): FormState {
  const state = emptyFormState();
  state.fields.issueDate = text;
  return state;
}

// ---- F2: the native calendar control can report a value TT.MM.JJJJ cannot express

test('the native control is limited to the years TT.MM.JJJJ can express', () => {
  assert.equal(NATIVE_DATE_MIN, '0001-01-01');
  assert.equal(NATIVE_DATE_MAX, '9999-12-31');
  const field = read('Field.svelte');
  assert.match(field, /min=\{NATIVE_DATE_MIN\}/);
  assert.match(field, /max=\{NATIVE_DATE_MAX\}/);
});

test('a native value in range becomes German text; cleared stays empty', () => {
  assert.equal(textFromNativeDate('2026-11-07'), '07.11.2026');
  assert.equal(textFromNativeDate('9999-12-31'), '31.12.9999');
  assert.equal(textFromNativeDate(''), '');
});

test('an unrepresentable native value (extended year) is carried as typed, never replaced by an earlier date', () => {
  for (const iso of ['20260-11-07', '275760-09-13', '-000001-01-01']) assert.equal(textFromNativeDate(iso), iso, iso);
});

test('an extended-year pick is reported on its own field and does not reach the domain as the earlier valid date', () => {
  const state = stateWithIssueDate('07.11.2026');
  assert.equal(buildDocumentInput(state).issueDate, '2026-11-07');
  state.fields.issueDate = textFromNativeDate('20260-11-07'); // what Field.picked() now writes
  assert.equal(state.fields.issueDate, '20260-11-07');
  assert.equal(buildDocumentInput(state).issueDate, UNPARSABLE);
  const result = checkForm(state);
  assert.ok(!result.ok);
  const problem = result.items.find((item) => item.path === 'issueDate');
  assert.deepEqual([problem?.code, problem?.fieldId], ['invalid_date', 'issueDate']);
});

test('Field.picked no longer falls back to the previous value', () => {
  const field = read('Field.svelte');
  const picked = field.slice(field.indexOf('function picked'), field.indexOf('let helpButton'));
  assert.match(picked, /textFromNativeDate\(/);
  assert.doesNotMatch(picked, /\?\?\s*value/);
});

// ---- F1: the help trigger can disappear while the drawer is open

type Fake = { name: string; connected: boolean; visible: boolean };
const usable = (el: Fake) => el.connected && el.visible;
const trigger = (over: Partial<Fake> = {}): Fake => ({ name: 'trigger', connected: true, visible: true, ...over });
const field = (over: Partial<Fake> = {}): Fake => ({ name: 'field', connected: true, visible: true, ...over });

test('ordinary case: the original trigger gets the focus back', () => {
  assert.equal(returnTarget([trigger(), field()], usable)?.name, 'trigger');
});

test('trigger removed from the DOM (inline help closed by the wide layout): focus goes to the field in the same context', () => {
  assert.equal(returnTarget([trigger({ connected: false }), field()], usable)?.name, 'field');
});

test('trigger still connected but hidden (header help hidden by the narrow layout): focus goes to the visible field', () => {
  assert.equal(returnTarget([trigger({ visible: false }), field()], usable)?.name, 'field');
});

test('missing candidates are skipped and nothing usable yields no target', () => {
  assert.equal(returnTarget([null, undefined, field()], usable)?.name, 'field');
  assert.equal(returnTarget([trigger({ connected: false }), field({ visible: false }), null], usable), undefined);
});

test('the drawer records the field context at opening and restores through the fallback, but a jump does not', () => {
  const drawer = read('HelpDrawer.svelte');
  const open = drawer.slice(drawer.indexOf('export async function open'), drawer.indexOf('const entry'));
  assert.match(open, /closest\('\.field'\)/); // captured before the trigger can disappear
  const closed = drawer.slice(drawer.indexOf('function closed'), drawer.indexOf('function backdrop'));
  assert.match(closed, /returnTarget\(/);
  assert.match(closed, /isConnected/);
  const jump = drawer.slice(drawer.indexOf('function jump'), drawer.indexOf('</script>'));
  assert.match(jump, /trigger = null/);
  assert.match(jump, /fieldContext = undefined/);
});
