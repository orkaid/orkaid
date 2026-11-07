import assert from 'node:assert/strict';
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

test('IBAN texts explain the check digits, the no-space/uppercase requirement and the effect of changing digits', () => {
  const entry = helpEntries.iban;
  assert.ok(entry.de.invalid?.some((row) => row.value === WRONG_CHECKSUM_IBAN));
  assert.ok(entry.en.invalid?.some((row) => row.value === WRONG_CHECKSUM_IBAN));
  const de = describeError('invalid_iban', 'payment.means.account.id.value', 'de', 'IBAN');
  const en = describeError('invalid_iban', 'payment.means.account.id.value', 'en', 'IBAN');
  assert.match(de, /Prüfziffern/);
  assert.match(de, /Leerzeichen/);
  assert.match(de, /Großbuchstaben/);
  assert.match(de, /Länge/);
  assert.match(en, /check digits/);
  assert.match(en, /without spaces/);
  assert.match(en, /capital letters/);
  assert.match(en, /Length and characters alone are not enough/);
  for (const locale of locales) assert.match(copy.ibanHint[locale], /./);
});

test('scope note: three groups in both languages with equal structure; capabilities are placed in the right group', () => {
  for (const key of ['now', 'core', 'out'] as const) {
    assert.ok(scopeLists[key].de.length > 0);
    assert.equal(scopeLists[key].de.length, scopeLists[key].en.length, key);
  }
  const core = scopeLists.core.en.join(' | ');
  for (const needle of ['381', 'Kleinunternehmer', 'Reverse charge', 'BG-14', 'BT-11', 'Skonto', 'Leitweg-ID']) assert.match(core, new RegExp(needle), needle);
  const out = scopeLists.out.en.join(' | ');
  // A capability of the frozen domain must never be listed as unsupported.
  for (const needle of ['Kleinunternehmer', 'Reverse charge', 'Skonto', 'Leitweg', 'BG-14']) assert.doesNotMatch(out, new RegExp(needle, 'i'), needle);
  assert.match(scopeLists.now.en.join(' '), /19%.*7%/);
  assert.match(scopeLists.now.en.join(' '), /30 or 58/);
});

test('scope note never presents tool limits as legal prohibitions', () => {
  const forbidden = /illegal|unlawful|verboten|unzulässig|rechtswidrig|ungültig|invalid/i;
  for (const locale of locales) {
    for (const key of ['now', 'core', 'out'] as const) for (const line of scopeLists[key][locale]) assert.doesNotMatch(line, forbidden, line);
    assert.doesNotMatch(copy['scope.summary'][locale], forbidden);
  }
  assert.match(copy['scope.disclaimer'].de, /kein/);
  assert.match(copy['scope.disclaimer'].en, /does not say/);
});
