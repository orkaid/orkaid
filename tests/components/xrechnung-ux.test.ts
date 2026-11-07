import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { displayDate } from '../../src/components/tools/xrechnung/date-display.ts';
import { buildDocumentInput, checkForm } from '../../src/components/tools/xrechnung/form-adapter.ts';
import { emptyFormState } from '../../src/components/tools/xrechnung/form-state.ts';
import { copy, describeError, scopeLists } from '../../src/i18n/xrechnung.ts';
import { helpEntries } from '../../src/i18n/xrechnung-help.ts';

const locales = ['de', 'en'] as const;
const VALID_IBAN = 'DE79000000001234567890';
const WRONG_CHECKSUM_IBAN = 'DE79000000001234567891'; // well-formed, last digit changed

test('date display is unambiguous per locale and never alters the ISO value', () => {
  assert.equal(displayDate('2026-11-07', 'de'), '07.11.2026');
  assert.equal(displayDate('2026-11-07', 'en'), '7 Nov 2026');
  assert.equal(displayDate('2026-01-31', 'en'), '31 Jan 2026');
  for (const bad of ['', '2026-1-7', '07.11.2026', '2026-13-01', '2026-00-10', '2026-11-32', '12026-11-07']) {
    assert.equal(displayDate(bad, 'de'), undefined, bad);
  }
  const state = emptyFormState();
  state.fields.issueDate = '2026-11-07';
  displayDate(state.fields.issueDate, 'de');
  assert.equal(state.fields.issueDate, '2026-11-07');
});

test('the ISO date typed in the form is what reaches the domain input unchanged', () => {
  const state = emptyFormState();
  state.fields.issueDate = '2026-11-07';
  state.fields.deliveryDate = '2026-11-01';
  const input = buildDocumentInput(state) as Record<string, unknown>;
  assert.equal(input.issueDate, '2026-11-07');
  assert.equal(input.deliveryDate, '2026-11-01');
});

test('IBAN: the documented example passes the domain, the one-digit change fails with invalid_iban, and input is not normalised', () => {
  const state = emptyFormState();
  const codeFor = (iban: string) => {
    state.fields['payment.means.account.id.value'] = iban;
    const result = checkForm(state, 'en');
    return result.ok ? undefined : result.items.find((item) => item.path === 'payment.means.account.id.value')?.code;
  };
  assert.equal(codeFor(VALID_IBAN), undefined);
  assert.equal(codeFor(WRONG_CHECKSUM_IBAN), 'invalid_iban');
  assert.equal(codeFor('DE79 0000 0000 1234 5678 90'), 'invalid_iban');
  assert.equal(codeFor(VALID_IBAN.toLowerCase()), 'invalid_iban');
  assert.equal(state.fields['payment.means.account.id.value'], VALID_IBAN.toLowerCase());
});

test('IBAN: the inline error is concise and points to the help; the detailed checksum guidance stays in the help entry', () => {
  const entry = helpEntries.iban;
  for (const locale of locales) assert.ok(entry[locale].invalid?.some((row) => row.value === WRONG_CHECKSUM_IBAN), locale);
  const de = describeError('invalid_iban', 'payment.means.account.id.value', 'de', 'IBAN');
  const en = describeError('invalid_iban', 'payment.means.account.id.value', 'en', 'IBAN');
  assert.ok(de.length < 150 && en.length < 150, `${de.length}/${en.length}`);
  assert.match(de, /Zeichen, Leerzeichen und Prüfziffern/);
  assert.match(de, /Hilfe/);
  assert.match(en, /characters, spaces and check digits/);
  assert.match(en, /help/);
  assert.match(entry.de.format ?? '', /Prüfziffern.*Modulo 97/);
  assert.match(entry.en.format ?? '', /check digits.*mod 97/);
  assert.match(entry.de.enter, /ohne Leerzeichen/);
  assert.match(entry.en.enter, /without spaces/);
  assert.ok(entry.sources.length > 0);
  for (const locale of locales) assert.match(copy.ibanHint[locale], /./);
});

test('help drawer waits for its content, then focuses the close button on every opening', () => {
  const source = readFileSync(new URL('../../src/components/tools/xrechnung/HelpDrawer.svelte', import.meta.url), 'utf8');
  const open = source.slice(source.indexOf('export async function open'), source.indexOf('const entry'));
  assert.ok(open.indexOf('await tick()') !== -1 && open.indexOf('await tick()') < open.indexOf('showModal()'));
  assert.ok(open.indexOf("querySelector<HTMLElement>('.close')?.focus()") > open.indexOf('showModal()'));
});

test('scope note: four groups in both languages with equal structure; capabilities are placed in the right group', () => {
  for (const key of ['now', 'core', 'out', 'tool'] as const) {
    assert.ok(scopeLists[key].de.length > 0);
    assert.equal(scopeLists[key].de.length, scopeLists[key].en.length, key);
  }
  const core = scopeLists.core.en.join(' | ');
  for (const needle of ['381', 'Kleinunternehmer', 'Reverse charge', 'Skonto']) assert.match(core, new RegExp(needle), needle);
  const out = scopeLists.out.en.join(' | ');
  // A capability of the frozen domain must never be listed as unsupported.
  for (const needle of ['Kleinunternehmer', 'Reverse charge', 'Skonto', 'Leitweg', 'BG-14']) assert.doesNotMatch(out, new RegExp(needle, 'i'), needle);
  // Application features that do not exist are a category of their own, not invoice scenarios outside the profile.
  assert.doesNotMatch(out, /XML import|PDF/);
  assert.match(scopeLists.tool.en.join(' | '), /XML import/);
  assert.match(scopeLists.tool.en.join(' | '), /PDF/);
  assert.match(scopeLists.tool.de.join(' | '), /XML-Import/);
  assert.match(scopeLists.tool.de.join(' | '), /PDF/);
  assert.equal(copy['scope.toolTitle'].de, 'Nicht verfügbare Werkzeugfunktionen');
  assert.equal(copy['scope.toolTitle'].en, 'Unavailable tool features');
  assert.match(scopeLists.now.en.join(' '), /19%.*7%/);
  assert.match(scopeLists.now.en.join(' '), /30 or 58/);
});

test('scope note never presents tool limits as legal prohibitions', () => {
  const forbidden = /illegal|unlawful|verboten|unzulässig|rechtswidrig|ungültig|invalid/i;
  for (const locale of locales) {
    for (const key of ['now', 'core', 'out', 'tool'] as const) for (const line of scopeLists[key][locale]) assert.doesNotMatch(line, forbidden, line);
    assert.doesNotMatch(copy['scope.summary'][locale], forbidden);
  }
  assert.match(copy['scope.disclaimer'].de, /kein/);
  assert.match(copy['scope.disclaimer'].en, /does not say/);
});
